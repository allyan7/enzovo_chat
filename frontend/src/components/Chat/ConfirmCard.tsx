import type { Confirmation } from '../../types/chat';
import styles from './Chat.module.css';

const day = (d: unknown) => (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}/.test(d)
	? new Date(`${d.slice(0, 10)}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
	: String(d ?? '—'));
const rupees = (n: unknown) => (typeof n === 'number' ? `₹${n.toLocaleString('en-IN')}` : '—');

interface Props {
	request: Confirmation;
	busy: boolean;
	onAnswer: (approved: boolean) => void;
}

interface Line { label: string; value: string; total?: boolean }

/** Human-in-the-loop card: the graph is paused until the user answers. */
export function ConfirmCard({ request, busy, onAnswer }: Props) {
	const p = request.preview as Record<string, any>;
	const isOrder = request.tool === 'place_order';
	const lines: Line[] = isOrder
		? [
			...(p.items ?? []).map((i: any) => ({ label: `${i.title}${i.qty > 1 ? ` × ${i.qty}` : ''}`, value: rupees(i.unit_price * i.qty) })),
			...(p.discount ? [{ label: `Coupon ${p.coupon_code}`, value: `−${rupees(p.discount)}` }] : []),
			{ label: 'Delivery', value: p.delivery_fee ? rupees(p.delivery_fee) : 'Free' },
			...(p.payment_plan ?? []).map((pp: any) => ({ label: pp.method === 'wallet' ? 'From wallet' : `Pay by ${pp.label ?? pp.vpa ?? pp.method}`, value: rupees(pp.amount) })),
			...(p.wallet_balance_after !== undefined ? [{ label: 'Wallet after', value: rupees(p.wallet_balance_after) }] : []),
			{ label: 'Arrives by', value: day(p.expected_delivery) },
			{ label: 'Total', value: rupees(p.total), total: true },
		]
		: [
			...(p.items ?? []).map((i: string) => ({ label: 'Item', value: i })),
			...(p.refunds ?? []).map((r: any) => ({ label: `Refund to ${r.destination}`, value: `${rupees(r.amount)} by ${day(r.expected_by)}` })),
			...(p.note ? [{ label: 'Note', value: p.note }] : []),
			{ label: 'Order total', value: rupees(p.total), total: true },
		];

	return (
		<div className={styles.confirm} role="dialog" aria-label="Confirm action">
			<div className={styles.confirmHead}>
				<span>Needs your OK</span>
				{isOrder ? 'Place this order?' : `Cancel ${p.order_id}?`}
			</div>
			<ul className={styles.lines}>
				{lines.map((l, k) => (
					<li key={k} className={l.total ? styles.total : undefined}><span>{l.label}</span><span>{l.value}</span></li>
				))}
			</ul>
			{isOrder && p.deliver_to && <ul className={styles.lines}><li><span>Deliver to</span><span>{p.deliver_to}</span></li></ul>}
			<div className={styles.confirmActions}>
				<button disabled={busy} className={isOrder ? undefined : styles.danger} onClick={() => onAnswer(true)}>
					{isOrder ? `Pay ${rupees(p.total)}` : 'Yes, cancel order'}
				</button>
				<button disabled={busy} className={styles.secondary} onClick={() => onAnswer(false)}>Not now</button>
			</div>
		</div>
	);
}
