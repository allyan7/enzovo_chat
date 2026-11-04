import { useState, type FormEvent } from 'react';
import type { Confirmation, Message } from '../../types/chat';
import { ConfirmCard } from './ConfirmCard';
import styles from './Chat.module.css';

const SUGGESTIONS = [
	'Show me trending phones',
	'Phones rated 4+ under ₹25,000',
	'Where is my order?',
	'What happened to my refund?',
	'Buy OnePlus 13R from my wallet',
	'What is the return policy for phones?',
];

interface Props {
	messages: Message[];
	pending: Confirmation | null;
	busy: boolean;
	onSend: (text: string) => void;
	onConfirm: (approved: boolean) => void;
}

export function ChatWindow({ messages, pending, busy, onSend, onConfirm }: Props) {
	const [text, setText] = useState('');
	const submit = (e: FormEvent) => {
		e.preventDefault();
		if (!text.trim() || busy || pending) return;
		onSend(text.trim());
		setText('');
	};

	return (
		<section className={styles.window}>
			<div className={styles.messages}>
				{!messages.length && (
					<div className={styles.suggestions}>
						{SUGGESTIONS.map((s) => <button key={s} onClick={() => onSend(s)}>{s}</button>)}
					</div>
				)}
				{messages.map((m, i) => (
					<div key={i} className={`${styles.msg} ${styles[m.role]}`}>
						<p>{m.text}</p>
						{m.trace && (
							<small>
								{m.trace.agents.join(' + ') || 'supervisor'} · {m.trace.tools.join(', ') || 'no tools'} · {((m.ms ?? 0) / 1000).toFixed(1)}s
							</small>
						)}
					</div>
				))}
				{pending && <ConfirmCard request={pending} busy={busy} onAnswer={onConfirm} />}
				{busy && <div className={styles.typing}>Thinking… (local model)</div>}
			</div>
			<form className={styles.input} onSubmit={submit}>
				<input value={text} onChange={(e) => setText(e.target.value)} placeholder={pending ? 'Answer the confirmation above' : 'Ask about products, orders, refunds…'} />
				<button disabled={busy || !!pending}>Send</button>
			</form>
		</section>
	);
}
