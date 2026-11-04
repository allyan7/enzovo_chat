// Chat service used by the API: runs a turn, handles confirmation pauses,
// and updates long-term memory after the reply is sent.
import { Command } from '@langchain/langgraph';
import { SqliteSaver } from '@langchain/langgraph-checkpoint-sqlite';
import { HumanMessage } from '@langchain/core/messages';
import { config } from '../../configs/app.config.js';
import { getDb } from '../../models/db.js';
import { addEpisode, upsertFact } from '../Memory/Memory.module.js';
import { buildGraph } from './graph.js';
import { jsonModel, parseJson } from './llm.js';
import { MEMORY_PROMPT } from './prompts.js';
import type { ConfirmRequest } from './tools.js';

const graph = buildGraph(SqliteSaver.fromConnString(config.checkpointDbPath));

export interface ChatTurn {
	customerId: string;
	threadId: string;
	message?: string;
	confirm?: { approved: boolean };
}

export interface ChatResult {
	reply: string | null;
	confirmation: ConfirmRequest | null;
	trace: { agents: string[]; tools: string[] };
}

export async function chat(turn: ChatTurn): Promise<ChatResult> {
	// thread_id is namespaced by customer, so one customer can never load another's thread.
	const cfg = { configurable: { thread_id: `${turn.customerId}:${turn.threadId}` }, recursionLimit: 25 };
	const input = turn.confirm
		? new Command({ resume: turn.confirm })
		: { messages: [new HumanMessage(turn.message ?? '')], customerId: turn.customerId };

	const out: any = await graph.invoke(input as any, cfg);
	const state = await graph.getState(cfg);
	const pending = state.tasks.flatMap((t) => t.interrupts ?? [])[0];
	const replies = (out.replies ?? []) as { agent: string; tools: string[] }[];
	const trace = { agents: replies.map((r) => r.agent), tools: replies.flatMap((r) => r.tools) };

	if (pending) return { reply: null, confirmation: pending.value as ConfirmRequest, trace };

	const reply = String(out.messages.at(-1)?.content ?? '');
	if (turn.message) void rememberTurn(turn.customerId, turn.message, reply);
	return { reply, confirmation: null, trace };
}

/** Background memory extraction: runs after the reply, so the user never waits. */
// Only messages that state something about the customer are worth an LLM call.
const HAS_FACT = /\b(prefer|always|usually|budget|i like|i love|i use|i own|i have|my (phone|budget|brand)|language|hindi|tamil|don't like|never)\b/i;

async function rememberTurn(customerId: string, user: string, assistant: string) {
	// Episode: a cheap one-liner, no LLM needed.
	addEpisode(getDb(), customerId, `asked: ${user.slice(0, 120)}`);
	if (!HAS_FACT.test(user)) return; // skip the extraction call (keeps Ollama free for the next message)
	try {
		const res = await jsonModel().invoke([
			['system', MEMORY_PROMPT],
			['user', `Customer: ${user}\nAssistant: ${assistant}`],
		]);
		const { facts = [] } = parseJson<{ facts?: { key: string; value: string }[] }>(String(res.content), {});
		for (const f of facts.slice(0, 3)) if (f?.key && f?.value) upsertFact(getDb(), customerId, f.key, String(f.value));
	} catch { /* memory is best-effort */ }
}

export async function history(customerId: string, threadId: string) {
	const state = await graph.getState({ configurable: { thread_id: `${customerId}:${threadId}` } });
	return ((state.values as any).messages ?? []).map((m: any) => ({ role: m.getType() === 'human' ? 'user' : 'assistant', text: String(m.content) }));
}
