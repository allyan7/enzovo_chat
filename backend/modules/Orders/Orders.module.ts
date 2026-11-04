// Orders: list, track, quote -> place (idempotent), cancel.
// Writes run in one SQLite transaction: wallet debit + stock + order insert
// all succeed or all roll back.
import { randomUUID } from 'node:crypto';
import { j } from '../../models/db.js';
import type { Ctx, Customer, Order, Payment } from '../../utils/types/mod.js';
import { DomainError } from '../../utils/errors.js';
import { addBusinessDays, addDays, dateOnly, nowIso } from '../../utils/dates.js';
import { config } from '../../configs/app.config.js';
import { getWalletRow, walletMove } from '../Payments/Payments.module.js';

const CLOSED = ['delivered', 'cancelled', 'returned', 'payment_failed'];

function getCustomer({ db, customerId }: Ctx): Customer {
	const r: any = db.prepare('SELECT data FROM customers WHERE id = ?').get(customerId);
	if (!r) throw new DomainError('NOT_FOUND', 'Unknown customer');
	return j(r.data);
}

/** Ownership check lives in SQL: another customer's order is simply "not found". */
function getOrder({ db, customerId }: Ctx, orderId: string): Order {
	const r: any = db.prepare('SELECT data FROM orders WHERE id = ? AND customer_id = ?').get(orderId, customerId);
	if (!r) throw new DomainError('NOT_FOUND', `No order ${orderId} on this account`);
	return j(r.data);
}

export function listOrders({ db, customerId }: Ctx, status?: string, limit = 10) {
	const rows = db.prepare(
		`SELECT data FROM orders WHERE customer_id = ? ${status ? 'AND status = ?' : ''}
		ORDER BY placed_at DESC LIMIT ?`,
	).all(...[customerId, status, limit].filter((v) => v !== undefined)) as { data: string }[];
	return {
		orders: rows.map(({ data }) => {
			const o = j<Order>(data);
			return { order_id: o.id, placed_at: o.placed_at, status: o.status, total: o.pricing.total, items: o.items.map((i) => i.title) };
		}),
	};
}

/** With no order_id, tracks every open order: the "where is my order?" zero-question path. */
export function trackOrder(ctx: Ctx, orderId?: string) {
	const ids = orderId
		? [orderId]
		: listOrders(ctx).orders.filter((o) => !CLOSED.includes(o.status)).map((o) => o.order_id);
	if (!ids.length) return { message: 'No open orders. All orders are delivered, cancelled or returned.', recent: listOrders(ctx, undefined, 3).orders };

	return {
		tracked: ids.map((id) => {
			const o = getOrder(ctx, id);
			const s: any = o.shipment_id
				? j((ctx.db.prepare('SELECT data FROM shipments WHERE id = ?').get(o.shipment_id) as any).data)
				: null;
			return {
				order_id: o.id, status: o.status, items: o.items.map((i) => i.title),
				...(s
					? {
						courier: s.courier, awb: s.awb, shipment_status: s.status,
						expected_delivery: s.revised_expected_delivery ?? s.expected_delivery,
						original_expected_delivery: s.expected_delivery,
						delay_reason: s.delay_reason ?? null, latest_event: s.events.at(-1),
						delivered_at: s.delivered_at,
					}
					: { shipment_status: 'not dispatched yet' }),
			};
		}),
	};
}

export interface QuoteInput {
	items: { product_id: string; qty?: number; color?: string }[];
	payment_method: 'wallet' | 'card' | 'upi' | 'cod';
	address_id?: string;
	coupon_code?: string;
}

/** Read-only: prices the cart and builds the payment plan the user must confirm. */
export function quoteOrder(ctx: Ctx, input: QuoteInput) {
	const customer = getCustomer(ctx);
	const address = input.address_id
		? customer.addresses.find((a) => a.id === input.address_id)
		: customer.addresses.find((a) => a.is_default);
	if (!address) throw new DomainError('BAD_ADDRESS', 'Address not found on this account');
	const pin: any = ctx.db.prepare('SELECT * FROM pincodes WHERE pincode = ?').get(address.pincode);
	if (!pin) throw new DomainError('NOT_SERVICEABLE', `We do not deliver to ${address.pincode}`);

	const lines = input.items.map((it) => {
		const qty = it.qty ?? 1;
		const p: any = ctx.db.prepare('SELECT * FROM products WHERE id = ?').get(it.product_id);
		if (!p) throw new DomainError('NOT_FOUND', `No product ${it.product_id}`);
		if (qty > config.maxQtyPerItem) throw new DomainError('QTY_LIMIT', `Max ${config.maxQtyPerItem} units per item per order`);
		if (p.stock < qty) throw new DomainError('OUT_OF_STOCK', `${p.title} is out of stock`);
		return { product_id: p.id, title: p.title, category: p.category, qty, unit_price: p.price, color: it.color };
	});
	const subtotal = lines.reduce((s, l) => s + l.qty * l.unit_price, 0);

	let discount = 0;
	if (input.coupon_code) {
		const r: any = ctx.db.prepare('SELECT data FROM coupons WHERE code = ?').get(input.coupon_code.toUpperCase());
		if (!r) throw new DomainError('BAD_COUPON', `Coupon ${input.coupon_code} does not exist`);
		const c = j(r.data);
		if (c.valid_until < config.today) throw new DomainError('BAD_COUPON', `Coupon ${c.code} expired on ${c.valid_until}`);
		const eligible = lines.filter((l) => c.applies_to.includes(l.category)).reduce((s, l) => s + l.qty * l.unit_price, 0);
		if (eligible < c.min_order_value) throw new DomainError('BAD_COUPON', `${c.code} needs ₹${c.min_order_value} of ${c.applies_to.join('/')}`);
		discount = c.type === 'flat' ? c.value : Math.min(Math.floor((eligible * c.value) / 100), c.max_discount ?? Infinity);
	}
	const deliveryFee = subtotal - discount >= 499 ? 0 : 49;
	const total = subtotal - discount + deliveryFee;

	// Payment plan. Closed cards are never offered.
	const card = customer.saved_cards.find((c) => c.status === 'active');
	const rest = (amount: number): Omit<Payment, 'id' | 'status'> =>
		card ? { method: 'card', card_ref: card.card_ref, label: `${card.network} ending ${card.last4}`, amount }
			: { method: 'upi', vpa: customer.saved_upi[0] ?? 'UPI collect request', amount };

	const plan: Omit<Payment, 'id' | 'status'>[] = [];
	let walletBalanceAfter: number | undefined;
	let promoUsed = 0;
	if (input.payment_method === 'wallet') {
		const w = getWalletRow(ctx);
		promoUsed = Math.min(w.usable_promo, Math.floor(total * 0.1)); // wallet-and-payments §1
		const fromWallet = Math.min(total, w.cash_balance + promoUsed);
		promoUsed = Math.min(promoUsed, fromWallet);
		if (fromWallet > 0) plan.push({ method: 'wallet', amount: fromWallet, promo_used: promoUsed });
		if (fromWallet < total) plan.push(rest(total - fromWallet));
		walletBalanceAfter = w.balance - fromWallet;
	} else if (input.payment_method === 'cod') {
		if (!pin.cod_available) throw new DomainError('COD_UNAVAILABLE', `COD is not available at ${address.pincode}`);
		if (total > 50_000) throw new DomainError('COD_UNAVAILABLE', 'COD is only for orders up to ₹50,000');
		plan.push({ method: 'cod', amount: total });
	} else if (input.payment_method === 'card') {
		if (!card) throw new DomainError('NO_CARD', 'No active saved card');
		plan.push(rest(total));
	} else {
		plan.push({ method: 'upi', vpa: customer.saved_upi[0] ?? 'UPI collect request', amount: total });
	}

	const quote = {
		quote_id: `Q-${randomUUID().slice(0, 8).toUpperCase()}`,
		items: lines, subtotal, coupon_code: discount ? input.coupon_code!.toUpperCase() : null, discount,
		delivery_fee: deliveryFee, total, payment_plan: plan, is_split_payment: plan.length > 1,
		wallet_balance_after: walletBalanceAfter,
		deliver_to: `${address.label}: ${address.line1}, ${address.city} ${address.pincode}`, address_id: address.id,
		expected_delivery: addDays(config.today, pin.delivery_days),
		expires_in_minutes: config.quoteTtlMinutes,
	};
	const now = new Date();
	ctx.db.prepare('INSERT INTO quotes VALUES (?,?,?,?,NULL,?)').run(
		quote.quote_id, ctx.customerId, now.toISOString(),
		new Date(now.getTime() + config.quoteTtlMinutes * 60_000).toISOString(), JSON.stringify(quote),
	);
	return quote;
}

/**
 * Places the order for a confirmed quote. quote_id is the idempotency key:
 * calling twice (retry, double click, graph replay) returns the same order.
 */
export function placeOrder(ctx: Ctx, quoteId: string, dryRun = false) {
	const row: any = ctx.db.prepare('SELECT * FROM quotes WHERE id = ? AND customer_id = ?').get(quoteId, ctx.customerId);
	if (!row) throw new DomainError('NOT_FOUND', `No quote ${quoteId}. Create one with quote_order first.`);
	const q = j(row.data);
	if (row.used_by_order) return { order_id: row.used_by_order, status: 'confirmed', idempotent_replay: true };
	if (new Date(row.expires_at) < new Date()) throw new DomainError('QUOTE_EXPIRED', 'Quote expired, please create a new one');
	if (dryRun) return { dry_run: true, action: 'place_order', summary: q };

	return ctx.db.transaction(() => {
		const orderId = `ORD-${Date.now().toString().slice(-6)}`;
		for (const l of q.items) {
			const ok = ctx.db.prepare('UPDATE products SET stock = stock - ? WHERE id = ? AND stock >= ?').run(l.qty, l.product_id, l.qty);
			if (!ok.changes) throw new DomainError('OUT_OF_STOCK', `${l.title} just went out of stock`);
		}
		const payments: Payment[] = q.payment_plan.map((p: any, i: number) => ({
			...p, id: `PAY-${orderId}-${i}`, status: p.method === 'cod' ? 'pending_on_delivery' : 'captured',
		}));
		const wallet = payments.find((p) => p.method === 'wallet');
		if (wallet) {
			walletMove(ctx, { type: 'debit', reason: 'order_payment', amount: wallet.amount, order_id: orderId, promo_used: Number(wallet.promo_used ?? 0) });
		}
		const order: Order = {
			id: orderId, customer_id: ctx.customerId, placed_at: nowIso(), status: 'confirmed', address_id: q.address_id,
			items: q.items.map(({ category, ...i }: any) => i),
			pricing: { subtotal: q.subtotal, coupon_code: q.coupon_code, discount: q.discount, delivery_fee: q.delivery_fee, total: q.total },
			payments, shipment_id: null, expected_delivery: q.expected_delivery,
		};
		ctx.db.prepare('INSERT INTO orders VALUES (?,?,?,?,?,?,?,?)')
			.run(orderId, ctx.customerId, order.placed_at, order.status, order.address_id, q.total, quoteId, JSON.stringify(order));
		ctx.db.prepare('UPDATE quotes SET used_by_order = ? WHERE id = ?').run(orderId, quoteId);
		return { order_id: orderId, status: 'confirmed', total: q.total, payments, expected_delivery: q.expected_delivery, wallet_balance_after: q.wallet_balance_after };
	})();
}

const REFUND_DAYS = { upi: 4, card: 7 } as const; // business days, returns-and-refunds §5

/** Cancellation policy §1 (before dispatch) and §3 (delayed > 7 days). */
export function cancelOrder(ctx: Ctx, orderId: string, dryRun = false) {
	const o = getOrder(ctx, orderId);
	if (o.status === 'cancelled') return { order_id: o.id, status: 'cancelled', idempotent_replay: true };

	let allowed = ['placed', 'confirmed', 'packed'].includes(o.status);
	let basis = 'cancellation §1 (not dispatched yet)';
	if (!allowed && o.status === 'in_transit_delayed' && o.shipment_id) {
		const s = j((ctx.db.prepare('SELECT data FROM shipments WHERE id = ?').get(o.shipment_id) as any).data);
		allowed = config.today > addDays(s.expected_delivery, 7);
		basis = 'cancellation §3 (delivery delayed more than 7 days)';
		if (!allowed) {
			throw new DomainError('NOT_CANCELLABLE', `Order is delayed but in transit. It can be cancelled after ${addDays(s.expected_delivery, 7)} if still not delivered (cancellation §3).`);
		}
	}
	if (!allowed) {
		throw new DomainError('NOT_CANCELLABLE', `Order is "${o.status}" and can no longer be cancelled. Options: refuse delivery, or return/replace after delivery (cancellation §2).`);
	}

	const refundPlan = o.payments.filter((p) => p.status === 'captured').map((p) => ({
		method: p.method, amount: p.amount,
		destination: p.method === 'wallet' ? 'wallet (within 2 hours)' : `original ${p.method}`,
		expected_by: p.method === 'wallet' ? config.today : addBusinessDays(config.today, REFUND_DAYS[p.method as 'upi' | 'card'] ?? 7),
	}));
	const preview = { order_id: o.id, items: o.items.map((i) => i.title), total: o.pricing.total, basis, refunds: refundPlan, note: refundPlan.length ? undefined : 'Cash on delivery: nothing to refund' };
	if (dryRun) return { dry_run: true, action: 'cancel_order', summary: preview };

	return ctx.db.transaction(() => {
		for (const r of refundPlan) {
			const refundId = `RFD-${o.id}-${r.method}`;
			const done = r.method === 'wallet';
			if (done) walletMove(ctx, { type: 'credit', reason: 'refund', amount: r.amount, order_id: o.id, refund_id: refundId });
			const data = {
				id: refundId, order_id: o.id, customer_id: ctx.customerId, trigger: 'cancellation', amount: r.amount,
				destination: done ? 'wallet' : 'original_source', source_method: r.method,
				status: done ? 'completed' : 'processing', initiated_at: nowIso(), expected_by: r.expected_by,
				completed_at: done ? nowIso() : null, attempts: [],
			};
			ctx.db.prepare('INSERT INTO refunds VALUES (?,?,?,?,?,?)').run(refundId, o.id, ctx.customerId, data.status, r.amount, JSON.stringify(data));
		}
		const updated = { ...o, status: 'cancelled', cancelled_at: nowIso(), cancel_reason: 'Cancelled via support chat' };
		ctx.db.prepare("UPDATE orders SET status = 'cancelled', data = ? WHERE id = ?").run(JSON.stringify(updated), o.id);
		return { ...preview, status: 'cancelled' };
	})();
}

export { dateOnly };
