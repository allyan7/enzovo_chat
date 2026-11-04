import { useCallback, useState } from 'react';
import { chatApi } from '../services/api/chat';
import type { ChatResponse, Confirmation, Message } from '../types/chat';

const newThread = () => `t-${Date.now().toString(36)}`;

/** Chat state for one customer + thread. A new customer starts a new thread. */
export function useChat(customerId: string) {
	const [threadId, setThreadId] = useState(newThread);
	const [messages, setMessages] = useState<Message[]>([]);
	const [pending, setPending] = useState<Confirmation | null>(null);
	const [busy, setBusy] = useState(false);

	const handle = (r: ChatResponse) => {
		setPending(r.confirmation);
		if (r.reply) setMessages((m) => [...m, { role: 'assistant', text: r.reply!, trace: r.trace, ms: r.ms }]);
	};

	const run = async (fn: () => Promise<ChatResponse>) => {
		setBusy(true);
		try {
			handle(await fn());
		} catch (e) {
			setMessages((m) => [...m, { role: 'system', text: (e as Error).message }]);
		} finally {
			setBusy(false);
		}
	};

	const send = useCallback((text: string) => {
		setMessages((m) => [...m, { role: 'user', text }]);
		return run(() => chatApi.send(customerId, threadId, text));
	}, [customerId, threadId]);

	const confirm = useCallback((approved: boolean) => {
		setMessages((m) => [...m, { role: 'system', text: approved ? 'You confirmed.' : 'You declined.' }]);
		return run(() => chatApi.confirm(customerId, threadId, approved));
	}, [customerId, threadId]);

	const reset = useCallback(() => {
		setThreadId(newThread());
		setMessages([]);
		setPending(null);
	}, []);

	return { messages, pending, busy, send, confirm, reset, threadId };
}
