// Wallet, refunds, returns and failed payments. Read-only except the wallet
// helpers that Orders uses inside its transactions.
import { j } from '../../models/db.js';
import type { Ctx, Order } from '../../utils/types/mod.js';
import { DomainError } from '../../utils/errors.js';
import { addDays, dateOnly } from '../../utils/dates.js';
import { config } from '../../configs/app.config.js';

export function getWalletRow({ db, customerId }: Ctx) {
	const w: any = db.prepare('SELECT * FROM wallets WHERE customer_id = ?').get(customerId);
	if (!w) throw new DomainError('NOT_FOUND', 'No wallet for this customer');
	const promoValid = w.promo_balance > 0 && (!w.promo_expiry || w.promo_expiry >= config.today);
	return {
		...w,
		cash_balance: w.balance - w.promo_balance,
		usable_promo: promoValid ? w.promo_balance : 0,
	};
}

export function getWallet(ctx: Ctx, limit = 5) {
	const w = getWalletRow(ctx);
	const txns = ctx.db.prepare(
		'SELECT * FROM wallet_txns WHERE customer_id = ? ORDER BY date DESC LIMIT ?',
	).all(ctx.customerId, Math.min(limit, 20));
	return {
		balance: w.balance,
		cash_balance: w.cash_balance,
		promo_credit: w.promo_balance
			? { amount: w.promo_balance, expires: w.promo_expiry, rule: 'Usable for at most 10% of an order' }
			: null,
		kyc_limit: w.wallet_limit,
		recent_transactions: txns,
	};
}

/** Appends a ledger row and updates the balance. Call inside a transaction. */
export function walletMove(
	ctx: Ctx,
	t: { type: 'credit' | 'debit'; reason: string; amount: number; order_id?: string; refund_id?: string; note?: string; promo_used?: number },
) {
	const w = getWalletRow(ctx);
	const balance = w.balance + (t.type === 'credit' ? t.amount : -t.amount);
	if (balance < 0) throw new DomainError('INSUFFICIENT_BALANCE', 'Wallet balance is too low');
	const promo = Math.max(0, w.promo_balance - (t.promo_used ?? 0));
	const id = `WTX-${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 100)}`;
	ctx.db.prepare('UPDATE wallets SET balance = ?, promo_balance = ? WHERE customer_id = ?')
		.run(balance, promo, ctx.customerId);
	ctx.db.prepare('INSERT INTO wallet_txns VALUES (?,?,?,?,?,?,?,?,?,?)').run(
		id, ctx.customerId, new Date().toISOString(), t.type, t.reason, t.amount, balance,
		t.order_id ?? null, t.refund_id ?? null, t.note ?? null,
	);
	return { wallet_txn_id: id, balance_after: balance };
}

export function getRefundStatus({ db, customerId }: Ctx, orderId?: string) {
	const rows: any[] = orderId
		? db.prepare('SELECT * FROM refunds WHERE customer_id = ? AND order_id = ?').all(customerId, orderId)
		: db.prepare('SELECT * FROM refunds WHERE customer_id = ?').all(customerId);
	const refunds = rows.map((r) => {
		const d = j(r.data);
		const done = String(d.status).startsWith('completed');
		return {
			refund_id: d.id, order_id: d.order_id, amount: d.amount, trigger: d.trigger,
			status: d.status, destination: d.destination, initiated_at: d.initiated_at,
			expected_by: d.expected_by ?? null, completed_at: d.completed_at,
			is_delayed: !done && d.expected_by ? config.today > d.expected_by : false,
			attempts: d.attempts,
		};
	});

	// Failed payments where the bank still debited money: the "money deducted but no order" case.
	const failed = (db.prepare(
		"SELECT data FROM orders WHERE customer_id = ? AND status = 'payment_failed'",
	).all(customerId) as { data: string }[])
		.map((r) => j<Order>(r.data))
		.filter((o) => !orderId || o.id === orderId)
		.flatMap((o) => o.payments.filter((p) => p.bank_debited).map((p: any) => ({
			order_id: o.id, amount: p.amount, reason: p.failure_reason,
			bank_reference_rrn: p.bank_rrn, reversal_status: p.auto_reversal?.status,
			reversal_expected_by: p.auto_reversal?.expected_by,
		})));

	return { refunds, failed_payment_reversals: failed, policy_ref: 'returns-and-refunds §5, §6; wallet-and-payments §4' };
}

export function getReturnStatus({ db, customerId }: Ctx, orderId?: string) {
	const rows: any[] = orderId
		? db.prepare('SELECT data FROM returns WHERE customer_id = ? AND order_id = ?').all(customerId, orderId)
		: db.prepare('SELECT data FROM returns WHERE customer_id = ?').all(customerId);
	return { returns: rows.map((r) => j(r.data)) };
}

const WINDOW_DAYS: Record<string, number> = { mobiles: 7, tablets: 7, laptops: 7, wearables: 10, audio: 10, accessories: 10 };
const REPLACEMENT_ONLY = ['mobiles', 'tablets', 'laptops'];

/** Applies returns-and-refunds §1: window from the day after delivery. */
export function checkReturnEligibility({ db, customerId }: Ctx, orderId: string) {
	const row: any = db.prepare('SELECT data FROM orders WHERE id = ? AND customer_id = ?').get(orderId, customerId);
	if (!row) throw new DomainError('NOT_FOUND', `No order ${orderId} on this account`);
	const o = j<Order>(row.data);
	if (!o.delivered_at) {
		return { order_id: o.id, eligible: false, reason: `Order is "${o.status}", not delivered yet. Returns start after delivery.` };
	}
	const items = o.items.map((i) => {
		const p: any = db.prepare('SELECT category FROM products WHERE id = ?').get(i.product_id);
		const days = WINDOW_DAYS[p.category] ?? 10;
		const last = addDays(o.delivered_at!, days);
		return {
			product_id: i.product_id, title: i.title, category: p.category,
			delivered_on: dateOnly(o.delivered_at!), window_days: days, last_day: last,
			eligible: config.today <= last,
			allowed: REPLACEMENT_ONLY.includes(p.category) ? 'replacement only, if defective/damaged/wrong item' : 'refund or replacement',
		};
	});
	return { order_id: o.id, today: config.today, items, policy_ref: 'returns-and-refunds §1, §2' };
}
