// Runs the real graph (router → specialist → MCP tools → confirmation interrupt
// → resume) with a scripted model instead of Ollama. The router falls back to
// keyword rules because Ollama is not reachable here, which is also tested.
import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AIMessage } from '@langchain/core/messages';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { ChatResult } from '@langchain/core/outputs';

const dir = mkdtempSync(join(tmpdir(), 'enzovo-graph-'));
process.env.DB_PATH = join(dir, 'app.db');
process.env.CHECKPOINT_DB_PATH = join(dir, 'cp.db');
process.env.OLLAMA_BASE_URL = 'http://127.0.0.1:9'; // unreachable on purpose

const { getDb } = await import('../models/db.js');
const { seed } = await import('../models/seed.js');
const { setChatModelFactory } = await import('../modules/Agents/llm.js');
const { chat } = await import('../modules/Agents/mod.js');

/** Replays scripted AI messages in order; tool calls trigger real MCP tools. */
class ScriptedModel extends BaseChatModel {
	constructor(private script: AIMessage[]) { super({}); }
	_llmType() { return 'scripted'; }
	bindTools() { return this as any; }
	async _generate(): Promise<ChatResult> {
		const message = this.script.shift() ?? new AIMessage('done');
		return { generations: [{ message, text: String(message.content) }] };
	}
}

describe('action guard', () => {
	it('does not claim a cancel when the model never calls the tool', async () => {
		seed(getDb());
		setChatModelFactory(() => new ScriptedModel([
			new AIMessage('Order ORD-1004 has been cancelled.'), // lie, no tool
			new AIMessage('It is cancelled now.'),                 // lies again after the nudge
		]));
		const r = await chat({ customerId: 'CUST-001', threadId: 'guard', message: 'cancel order ORD-1004' });
		expect(r.reply).toMatch(/couldn't complete/);
		const row: any = getDb().prepare("SELECT status FROM orders WHERE id = 'ORD-1004'").get();
		expect(row.status).toBe('confirmed');
	}, 60_000);
});

describe('action guard + confirmation', () => {
	it('nudges a lazy model into the tool, then confirmation still works', async () => {
		seed(getDb());
		setChatModelFactory(() => new ScriptedModel([
			new AIMessage('Done, it is cancelled.'), // no tool -> nudge
			new AIMessage({ content: '', tool_calls: [{ id: 'g1', name: 'cancel_order', args: { order_id: 'ORD-1004' } }] }),
			new AIMessage('Cancelled ORD-1004.'),
		]));
		const first = await chat({ customerId: 'CUST-001', threadId: 'guard2', message: 'cancel order ORD-1004' });
		expect(first.confirmation).toMatchObject({ tool: 'cancel_order' });
		const second = await chat({ customerId: 'CUST-001', threadId: 'guard2', confirm: { approved: true } });
		const row: any = getDb().prepare("SELECT status FROM orders WHERE id = 'ORD-1004'").get();
		expect(row.status).toBe('cancelled');
		expect(second.reply).toBeTruthy();
	}, 60_000);
});

describe('router', () => {
	it('sends buy-from-wallet only to the order agent', async () => {
		const { route } = await import('../modules/Agents/router.js');
		expect(await route('Buy OnePlus 13R from my wallet', '')).toEqual(['order']);
	});
});

describe('multi-agent graph with confirmation', () => {
	it('pauses before cancel_order, then cancels after approval', async () => {
		seed(getDb());
		const script = [
			new AIMessage({ content: '', tool_calls: [{ id: 't1', name: 'cancel_order', args: { order_id: 'ORD-1004' } }] }),
			new AIMessage('Cancelled ORD-1004. It was cash on delivery, so there is nothing to refund.'),
		];
		const model = new ScriptedModel(script);
		setChatModelFactory(() => model);

		const first = await chat({ customerId: 'CUST-001', threadId: 't1', message: 'Please cancel order ORD-1004' });
		expect(first.reply).toBeNull();
		expect(first.confirmation).toMatchObject({ type: 'confirm', tool: 'cancel_order' });
		expect(first.confirmation!.preview).toMatchObject({ order_id: 'ORD-1004' });
		const before: any = getDb().prepare("SELECT status FROM orders WHERE id = 'ORD-1004'").get();
		expect(before.status).toBe('confirmed'); // nothing changed yet

		const second = await chat({ customerId: 'CUST-001', threadId: 't1', confirm: { approved: true } });
		expect(second.trace.agents).toEqual(['order']);
		expect(second.reply).toContain('Cancelled ORD-1004');
		const after: any = getDb().prepare("SELECT status FROM orders WHERE id = 'ORD-1004'").get();
		expect(after.status).toBe('cancelled');
	}, 60_000);
});
