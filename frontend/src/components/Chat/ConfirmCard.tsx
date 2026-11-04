import type { Confirmation } from '../../types/chat';
import styles from './Chat.module.css';

const rupees = (n: unknown) => (typeof n === 'number' ? `₹${n.toLocaleString('en-IN')}` : '');

interface Props {
	request: Confirmation;
	busy: boolean;
	onAnswer: (approved: boolean) => void;
}

/** Human-in-the-loop card: the graph is paused until the user answers. */
export function ConfirmCard({ request, busy, onAnswer }: Props) {
	const p = request.preview as Record<string, any>;
	const isOrder = request.tool === 'place_order';
	return (
		<div className={styles.confirm}>
			<strong>{isOrder ? 'Confirm your order' : `Cancel ${p.order_id}?`}</strong>
			<ul>
				{(p.items ?? []).map((i: any, k: number) => <li key={k}>{typeof i === 'string' ? i : `${i.title} × ${i.qty}`}</li>)}
				{isOrder && <li>Total: {rupees(p.total)}{p.discount ? ` (saved ${rupees(p.discount)})` : ''}</li>}
				{isOrder && (p.payment_plan ?? []).map((pp: any, k: number) => (
					<li key={`p${k}`}>{pp.method === 'wallet' ? 'Wallet' : pp.label ?? pp.vpa ?? pp.method}: {rupees(pp.amount)}</li>
				))}
				{isOrder && p.wallet_balance_after !== undefined && <li>Wallet after: {rupees(p.wallet_balance_after)}</li>}
				{isOrder && <li>Deliver to {p.deliver_to}, by {p.expected_delivery}</li>}
				{!isOrder && (p.refunds ?? []).map((r: any, k: number) => (
					<li key={`r${k}`}>Refund {rupees(r.amount)} to {r.destination} by {r.expected_by}</li>
				))}
				{!isOrder && p.note && <li>{p.note}</li>}
			</ul>
			<div className={styles.confirmActions}>
				<button disabled={busy} onClick={() => onAnswer(true)}>{isOrder ? 'Place order' : 'Yes, cancel'}</button>
				<button disabled={busy} className={styles.secondary} onClick={() => onAnswer(false)}>No</button>
			</div>
		</div>
	);
}
