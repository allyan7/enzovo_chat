import { useEffect, useState } from 'react';
import { chatApi } from '../../services/api/chat';
import type { MemorySnapshot, Message } from '../../types/chat';
import styles from './Inspector.module.css';

interface Props {
	customerId: string;
	messages: Message[];
	threadId: string;
}

/** Learning aid: shows the memory layer and the last agent/tool trace live. */
export function Inspector({ customerId, messages, threadId }: Props) {
	const [memory, setMemory] = useState<MemorySnapshot | null>(null);
	const refresh = () => chatApi.memory(customerId).then(setMemory).catch(() => setMemory(null));
	useEffect(() => { refresh(); }, [customerId, messages.length]);
	const last = [...messages].reverse().find((m) => m.trace);

	return (
		<aside className={styles.panel}>
			<h3>Last turn</h3>
			{last?.trace ? (
				<ul>
					<li>Agents: {last.trace.agents.join(', ') || 'none (off-topic)'}</li>
					<li>Tools: {last.trace.tools.join(', ') || 'none'}</li>
					<li>Latency: {((last.ms ?? 0) / 1000).toFixed(1)}s</li>
				</ul>
			) : <p className={styles.muted}>Send a message to see routing.</p>}

			<h3>Memory</h3>
			<p className={styles.muted}>Thread (short-term): {threadId}, {messages.filter((m) => m.role !== 'system').length} messages</p>
			<strong>Long-term facts</strong>
			<ul>{memory?.facts.map((f) => <li key={f.key}>{f.key}: {f.value}</li>)}</ul>
			<strong>Episodes</strong>
			<ul>{memory?.episodes.map((e, i) => <li key={i}>{e.date}: {e.summary}</li>)}</ul>
			<button className={styles.small} onClick={() => chatApi.forget(customerId).then(refresh)}>Forget me</button>
		</aside>
	);
}
