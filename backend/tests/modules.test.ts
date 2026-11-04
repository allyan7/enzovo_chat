// Business-rule tests. No LLM needed, so they run in CI.
import { beforeEach, describe, expect, it } from 'vitest';
import { openDb, type DB } from '../models/db.js';
import { seed } from '../models/seed.js';
import { searchProducts } from '../modules/Catalog/Catalog.module.js';
import { cancelOrder, placeOrder, quoteOrder, trackOrder } from '../modules/Orders/Orders.module.js';
import { checkReturnEligibility, getRefundStatus, getWallet } from '../modules/Payments/Payments.module.js';
import { searchPolicies } from '../modules/Knowledge/mod.js';
import { memoryBlock, upsertFact } from '../modules/Memory/Memory.module.js';

let db: DB;
const as = (customerId: string) => ({ db, customerId });

beforeEach(() => {
	db = openDb(':memory:');
	seed(db);
});

describe('Catalog', () => {
	it('lists trending phones by 7-day sales', () => {
		const r = searchProducts(as('CUST-001'), { category: 'mobiles', sort: 'trending', limit: 3 });
		expect(r.products.map((p) => p.id)).toEqual(['P106', 'P105', 'P102']);
	});
	it('filters phones rated 4+', () => {
		const r = searchProducts(as('CUST-001'), { category: 'mobiles', min_rating: 4, limit: 10 });
		expect(r.products.every((p) => p.rating >= 4)).toBe(true);
	});
});

describe('Orders', () => {
	it('tracks open orders without asking for an id', () => {
		const r: any = trackOrder(as('CUST-002'));
		expect(r.tracked[0]).toMatchObject({ order_id: 'ORD-2001', expected_delivery: '2026-11-06' });
	});
	it("treats another customer's order as not found", () => {
		expect(() => trackOrder(as('CUST-001'), 'ORD-2001')).toThrow(/No order/);
	});
	it('places a wallet order once, even if called twice (idempotent)', () => {
		const q = quoteOrder(as('CUST-003'), { items: [{ product_id: 'P104' }], payment_method: 'wallet' });
		expect(q).toMatchObject({ total: 42999, wallet_balance_after: 9789, is_split_payment: false });
		const first = placeOrder(as('CUST-003'), q.quote_id);
		const again = placeOrder(as('CUST-003'), q.quote_id);
		expect(again).toMatchObject({ order_id: first.order_id, idempotent_replay: true });
		expect(getWallet(as('CUST-003')).balance).toBe(9789);
	});
	it('splits payment when the wallet is short and never offers a closed card', () => {
		const q = quoteOrder(as('CUST-003'), { items: [{ product_id: 'P102' }], payment_method: 'wallet' });
		expect(q.payment_plan).toEqual([
			expect.objectContaining({ method: 'wallet', amount: 52788 }),
			expect.objectContaining({ method: 'card', card_ref: 'CARD-R2', amount: 17112 }),
		]);
	});
	it('caps promo credit at 10% of the order', () => {
		const q = quoteOrder(as('CUST-002'), { items: [{ product_id: 'A203' }], payment_method: 'wallet' });
		expect(q.payment_plan[0]).toMatchObject({ method: 'wallet', amount: 879, promo_used: 179 });
	});
	it('rejects expired coupons and out-of-stock items', () => {
		expect(() => quoteOrder(as('CUST-001'), { items: [{ product_id: 'P101' }], payment_method: 'card', coupon_code: 'DIWALI25' })).toThrow(/expired/);
		expect(() => quoteOrder(as('CUST-001'), { items: [{ product_id: 'P109' }], payment_method: 'card' })).toThrow(/out of stock/);
	});
	it('cancels an undispatched COD order, but not an in-transit one', () => {
		expect(cancelOrder(as('CUST-001'), 'ORD-1004', true)).toMatchObject({ dry_run: true });
		expect(cancelOrder(as('CUST-001'), 'ORD-1004')).toMatchObject({ status: 'cancelled', refunds: [] });
		expect(() => cancelOrder(as('CUST-001'), 'ORD-1002')).toThrow(/can no longer be cancelled/);
	});
});

describe('Payments', () => {
	it('explains a failed card refund that went to the wallet', () => {
		const r = getRefundStatus(as('CUST-003'));
		expect(r.refunds[0]).toMatchObject({ refund_id: 'RFD-3003', status: 'completed_via_wallet' });
	});
	it('shows the bank reversal for a failed payment', () => {
		const r = getRefundStatus(as('CUST-002'));
		expect(r.failed_payment_reversals[0]).toMatchObject({ amount: 1799, reversal_expected_by: '2026-11-09' });
		expect(r.refunds[0]).toMatchObject({ refund_id: 'RFD-2002', is_delayed: false });
	});
	it('applies the 7-day return window for phones', () => {
		const r = checkReturnEligibility(as('CUST-003'), 'ORD-3001');
		expect(r.items![0]).toMatchObject({ last_day: '2026-09-15', eligible: false });
	});
});

describe('Knowledge (RAG)', () => {
	it('finds the failed-refund section with BM25', async () => {
		const r = await searchPolicies(db, 'refund failed card closed what happens', 3);
		expect(r.mode).toBe('bm25');
		expect(r.results.map((x) => x.cite)).toContain('returns-and-refunds §6');
	});
});

describe('Memory', () => {
	it('upserts facts and refuses secrets or live state', () => {
		expect(upsertFact(db, 'CUST-002', 'preferred_brand', 'Samsung')).toBe(true);
		expect(upsertFact(db, 'CUST-002', 'preferred_brand', 'OnePlus')).toBe(true);
		expect(upsertFact(db, 'CUST-002', 'card', '4111111111111111')).toBe(false);
		expect(upsertFact(db, 'CUST-002', 'refund_status', 'processing')).toBe(false);
		expect(memoryBlock(db, 'CUST-002')).toBe('- preferred_brand: OnePlus');
	});
});
