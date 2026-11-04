export interface Customer {
	id: string;
	name: string;
	tier: string;
}

export interface Confirmation {
	type: 'confirm';
	tool: 'place_order' | 'cancel_order' | string;
	args: Record<string, unknown>;
	preview: Record<string, unknown>;
}

export interface Trace {
	agents: string[];
	tools: string[];
}

export interface ChatResponse {
	reply: string | null;
	confirmation: Confirmation | null;
	trace: Trace;
	ms: number;
}

export interface Message {
	role: 'user' | 'assistant' | 'system';
	text: string;
	trace?: Trace;
	ms?: number;
}

export interface MemorySnapshot {
	facts: { key: string; value: string }[];
	episodes: { date: string; summary: string }[];
}
