// API layer: components never call fetch directly (TDU_FE rule: no inline API calls).
import type { ChatResponse, Customer, MemorySnapshot } from '../../types/chat';

async function request<T>(path: string, customerId?: string, init?: RequestInit): Promise<T> {
	const res = await fetch(`/api${path}`, {
		...init,
		headers: {
			'content-type': 'application/json',
			...(customerId ? { 'x-customer-id': customerId } : {}),
		},
	});
	const body = await res.json();
	if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
	return body as T;
}

export const chatApi = {
	customers: () => request<Customer[]>('/customers'),
	send: (customerId: string, threadId: string, message: string) =>
		request<ChatResponse>('/chat', customerId, { method: 'POST', body: JSON.stringify({ threadId, message }) }),
	confirm: (customerId: string, threadId: string, approved: boolean) =>
		request<ChatResponse>('/chat', customerId, { method: 'POST', body: JSON.stringify({ threadId, confirm: { approved } }) }),
	memory: (customerId: string) => request<MemorySnapshot>('/memory', customerId),
	forget: (customerId: string) => request<{ ok: boolean }>('/memory', customerId, { method: 'DELETE' }),
};
