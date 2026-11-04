import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { Confirmation, Message } from '../../types/chat';
import { ConfirmCard } from './ConfirmCard';
import { RichText } from './RichText';
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
	customerName: string;
	messages: Message[];
	pending: Confirmation | null;
	busy: boolean;
	onSend: (text: string) => void;
	onConfirm: (approved: boolean) => void;
}

const initials = (name: string) => name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();

export function ChatWindow({ customerName, messages, pending, busy, onSend, onConfirm }: Props) {
	const [text, setText] = useState('');
	const end = useRef<HTMLDivElement>(null);
	useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [messages.length, pending, busy]);

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
					<div className={styles.welcome}>
						<h2>Hi {customerName.split(' ')[0]}, how can we help?</h2>
						<p>Track orders, check refunds and your wallet, find a phone, or buy one with a single confirmation.</p>
						<div className={styles.suggestions}>
							{SUGGESTIONS.map((s) => <button key={s} onClick={() => onSend(s)}>{s}</button>)}
						</div>
					</div>
				)}
				{messages.map((m, i) => m.role === 'system' ? (
					<div key={i} className={styles.system}>{m.text}</div>
				) : (
					<div key={i} className={`${styles.row} ${m.role === 'user' ? styles.rowUser : ''}`}>
						<div className={styles.avatar} aria-hidden="true">{m.role === 'user' ? initials(customerName) : 'e'}</div>
						<div className={`${styles.msg} ${styles[m.role]}`}>
							{m.role === 'assistant' ? <RichText text={m.text} /> : <p>{m.text}</p>}
							{m.trace && (
								<div className={styles.trace}>
									{(m.trace.agents.length ? m.trace.agents : ['supervisor']).map((a) => <span key={a} className={styles.agent}>{a}</span>)}
									{m.trace.tools.map((t, k) => <span key={k}>{t}</span>)}
									<span>{((m.ms ?? 0) / 1000).toFixed(1)}s</span>
								</div>
							)}
						</div>
					</div>
				))}
				{pending && <ConfirmCard request={pending} busy={busy} onAnswer={onConfirm} />}
				{busy && (
					<div className={styles.row}>
						<div className={styles.avatar} aria-hidden="true">e</div>
						<div className={styles.typing} aria-label="Assistant is typing"><i /><i /><i /></div>
					</div>
				)}
				<div ref={end} />
			</div>
			<form className={styles.input} onSubmit={submit}>
				<input id="chat-input" value={text} onChange={(e) => setText(e.target.value)} placeholder={pending ? 'Answer the confirmation above' : 'Ask about products, orders, refunds…'} />
				<button disabled={busy || !!pending || !text.trim()}>Send</button>
			</form>
		</section>
	);
}
