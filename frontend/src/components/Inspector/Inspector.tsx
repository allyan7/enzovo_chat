import { useEffect, useState } from 'react';
import { chatApi } from '../../services/api/chat';
import type { Customer, MemorySnapshot, Message } from '../../types/chat';
import styles from './Inspector.module.css';

interface Props {
	customer?: Customer;
	messages: Message[];
	threadId: string;
}

/** Learning aid: shows routing, tools, latency and the memory layer live. */
export function Inspector({ customer, messages, threadId }: Props) {
	const [memory, setMemory] = useState<MemorySnapshot | null>(null);
	const id = customer?.id;
	const refresh = () => { if (id) chatApi.memory(id).then(setMemory).catch(() => setMemory(null)); };
	useEffect(refresh, [id, messages.length]);
	const last = [...messages].reverse().find((m) => m.trace);

	return (
		<aside className={styles.panel}>
			<section className={styles.card}>
				<h3>Signed in as</h3>
				<dl className={styles.kv}>
					<dt>{customer?.name ?? '—'}</dt>
					<dd><span className={styles.tier}>{customer?.tier ?? ''}</span></dd>
					<dt>Thread</dt><dd>{threadId}</dd>
					<dt>Messages</dt><dd>{messages.filter((m) => m.role !== 'system').length}</dd>
				</dl>
			</section>

			<section className={styles.card}>
				<h3>Last turn</h3>
				{last?.trace ? (
					<dl className={styles.kv}>
						<dt>Agents</dt>
						<dd className={styles.chips}>{(last.trace.agents.length ? last.trace.agents : ['none']).map((a) => <span key={a}>{a}</span>)}</dd>
						<dt>Tools</dt>
						<dd className={styles.chips}>{(last.trace.tools.length ? last.trace.tools : ['none']).map((t, k) => <span key={k}>{t}</span>)}</dd>
						<dt>Latency</dt><dd>{((last.ms ?? 0) / 1000).toFixed(1)} s</dd>
					</dl>
				) : <p className={styles.muted}>Send a message to see which agents and tools run.</p>}
			</section>

			<section className={styles.card}>
				<h3>Long-term memory</h3>
				{memory?.facts.length ? (
					<ul className={styles.facts}>{memory.facts.map((f) => <li key={f.key}><b>{f.key}</b>: {f.value}</li>)}</ul>
				) : <p className={styles.muted}>Nothing remembered yet.</p>}
				<h3 style={{ marginTop: 14 }}>Recent episodes</h3>
				{memory?.episodes.length ? (
					<ul className={styles.facts}>{memory.episodes.map((e, i) => <li key={i}>{e.summary}</li>)}</ul>
				) : <p className={styles.muted}>No past sessions.</p>}
				{id && <button className={styles.small} onClick={() => chatApi.forget(id).then(refresh)}>Forget me</button>}
			</section>
		</aside>
	);
}
