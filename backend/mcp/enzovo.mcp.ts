// enzovo MCP server: exposes the business modules as MCP tools over stdio.
//
// Identity: the customer is bound when the server process starts
// (ENZOVO_CUSTOMER_ID), like an OAuth token on an MCP connection. No tool
// takes a customer_id argument, so the LLM cannot ask for someone else's data.
//
// Works with any MCP client: our LangGraph agents, Claude Desktop, Cursor.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { getDb } from '../models/db.js';
import { DomainError } from '../utils/errors.js';
import type { Ctx } from '../utils/types/mod.js';
import { checkDelivery, getProduct, searchProducts } from '../modules/Catalog/Catalog.module.js';
import { cancelOrder, listOrders, placeOrder, quoteOrder, trackOrder } from '../modules/Orders/Orders.module.js';
import { checkReturnEligibility, getRefundStatus, getReturnStatus, getWallet } from '../modules/Payments/Payments.module.js';
import { searchPolicies } from '../modules/Knowledge/mod.js';

/** Which agent may see which tools (least privilege). Used by modules/Agents. */
export const TOOL_GROUPS = {
	product: ['search_products', 'get_product', 'check_delivery'],
	order: ['list_orders', 'track_order', 'search_products', 'quote_order', 'place_order', 'cancel_order'],
	payments: ['get_wallet', 'get_refund_status', 'get_return_status', 'check_return_eligibility', 'list_orders'],
	policy: ['search_policies'],
} as const;

/** Tools that change state. The graph forces a confirmation step before these. */
export const WRITE_TOOLS = ['place_order', 'cancel_order'] as const;

/** Small models send `null` for optional args; treat it as "not provided". */
type NoNull<T> = T extends null ? never : T extends object ? { [K in keyof T]: NoNull<Exclude<T[K], null>> } : T;
const clean = <T>(o: T) => JSON.parse(JSON.stringify(o, (_k, v) => (v === null ? undefined : v))) as NoNull<T>;

export function buildServer(customerId: string) {
	const ctx: Ctx = { db: getDb(), customerId };
	const server = new McpServer({ name: 'enzovo', version: '0.1.0' });

	const run = async (fn: () => unknown) => {
		try {
			return { content: [{ type: 'text' as const, text: JSON.stringify(await fn()) }] };
		} catch (e) {
			const msg = e instanceof DomainError ? `${e.code}: ${e.message}` : `ERROR: ${(e as Error).message}`;
			return { content: [{ type: 'text' as const, text: msg }], isError: true };
		}
	};

	server.registerTool('search_products', {
		description: 'Search the catalog with exact filters. Phones = category "mobiles"; also tablets, laptops, wearables (smartwatches), audio, accessories. Use sort="trending" for trending/popular, min_rating for "rated 4+", max_price for budgets. Returns total_matching plus up to 10 products (use limit 5 by default).',
		inputSchema: {
			query: z.string().nullish().describe('Only a product or brand name, e.g. "iphone", "galaxy s24". Leave empty for generic asks like "phones"; use category instead.'),
			category: z.enum(['mobiles', 'tablets', 'laptops', 'wearables', 'audio', 'accessories']).nullish(),
			brand: z.string().nullish(),
			min_rating: z.number().min(0).max(5).nullish(),
			min_price: z.number().int().nullish(),
			max_price: z.number().int().nullish().describe('Rupees'),
			five_g: z.boolean().nullish(),
			in_stock_only: z.boolean().nullish(),
			compatible_with: z.string().nullish().describe('Product id, to find accessories for a phone'),
			sort: z.enum(['trending', 'rating', 'price_asc', 'price_desc', 'newest']).nullish(),
			limit: z.number().int().min(1).max(10).nullish(),
		},
	}, (raw) => { const a = clean(raw); return run(() => searchProducts(ctx, a)); });

	server.registerTool('get_product', {
		description: 'Full details for one product: colors, highlights, in-box, warranty, compatible accessories.',
		inputSchema: { product_id: z.string() },
	}, (raw) => { const a = clean(raw); return run(() => getProduct(ctx, a.product_id)); });

	server.registerTool('check_delivery', {
		description: 'Check if a pincode is serviceable, the delivery date if ordered today, and COD availability.',
		inputSchema: { pincode: z.string().regex(/^\d{6}$/), product_id: z.string().nullish() },
	}, (raw) => { const a = clean(raw); return run(() => checkDelivery(ctx, a.pincode, a.product_id)); });

	server.registerTool('list_orders', {
		description: "List the customer's orders, newest first.",
		inputSchema: { status: z.string().nullish(), limit: z.number().int().max(20).nullish() },
	}, (raw) => { const a = clean(raw); return run(() => listOrders(ctx, a.status, a.limit)); });

	server.registerTool('track_order', {
		description: 'Track shipment status, ETA and delay reason. Omit order_id to track ALL open orders (do this for "where is my order").',
		inputSchema: { order_id: z.string().nullish() },
	}, (raw) => { const a = clean(raw); return run(() => trackOrder(ctx, a.order_id)); });

	server.registerTool('quote_order', {
		description: 'Price a purchase and build the payment plan (wallet / split / card / upi / cod). No side effects. Always call before place_order.',
		inputSchema: {
			items: z.array(z.object({ product_id: z.string(), qty: z.number().int().min(1).nullish(), color: z.string().nullish() })).min(1),
			payment_method: z.enum(['wallet', 'card', 'upi', 'cod']),
			address_id: z.string().nullish().describe('Omit for the default address'),
			coupon_code: z.string().nullish(),
		},
	}, (raw) => { const a = clean(raw); return run(() => quoteOrder(ctx, a)); });

	server.registerTool('place_order', {
		description: 'WRITE. Place the order for a quote_id from quote_order. Requires user confirmation. Idempotent.',
		inputSchema: { quote_id: z.string(), dry_run: z.boolean().nullish().describe('Defaults to true: preview only') },
	}, (raw) => { const a = clean(raw); return run(() => placeOrder(ctx, a.quote_id, a.dry_run ?? true)); });

	server.registerTool('cancel_order', {
		description: 'WRITE. Cancel an order if policy allows, and start refunds. Requires user confirmation.',
		inputSchema: { order_id: z.string(), dry_run: z.boolean().nullish().describe('Defaults to true: preview only') },
	}, (raw) => { const a = clean(raw); return run(() => cancelOrder(ctx, a.order_id, a.dry_run ?? true)); });

	server.registerTool('get_wallet', {
		description: 'Wallet balance (cash + promo credit) and recent transactions with reasons.',
		inputSchema: { limit: z.number().int().max(20).nullish() },
	}, (raw) => { const a = clean(raw); return run(() => getWallet(ctx, a.limit)); });

	server.registerTool('get_refund_status', {
		description: 'Refunds (status, destination, expected-by date, failed attempts) and bank reversals for failed payments. Omit order_id for all.',
		inputSchema: { order_id: z.string().nullish() },
	}, (raw) => { const a = clean(raw); return run(() => getRefundStatus(ctx, a.order_id)); });

	server.registerTool('get_return_status', {
		description: 'Return and replacement requests with pickup details and timeline.',
		inputSchema: { order_id: z.string().nullish() },
	}, (raw) => { const a = clean(raw); return run(() => getReturnStatus(ctx, a.order_id)); });

	server.registerTool('check_return_eligibility', {
		description: 'Whether each item in a delivered order is still inside its return window, and what is allowed.',
		inputSchema: { order_id: z.string() },
	}, (raw) => { const a = clean(raw); return run(() => checkReturnEligibility(ctx, a.order_id)); });

	server.registerTool('search_policies', {
		description: 'Search store policies (returns, refunds, cancellation, shipping, wallet, COD, EMI). Returns sections with a "cite" id to quote.',
		inputSchema: { query: z.string() },
	}, (raw) => { const a = clean(raw); return run(() => searchPolicies(ctx.db, a.query)); });

	return server;
}

if (import.meta.url === `file://${process.argv[1]}`) {
	const customerId = process.env.ENZOVO_CUSTOMER_ID;
	if (!customerId) {
		console.error('Set ENZOVO_CUSTOMER_ID (e.g. CUST-001) to bind this MCP session to a customer.');
		process.exit(1);
	}
	await buildServer(customerId).connect(new StdioServerTransport());
	console.error(`enzovo MCP server ready for ${customerId}`);
}
