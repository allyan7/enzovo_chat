// Memory layer storage (see docs/LEARN.md §Memory).
// - Long-term facts: one row per (customer, key); new value overwrites old.
// - Episodes: one-line summary per past session.
// Thread history and working state live in the LangGraph checkpointer instead.
import type { DB } from '../../models/db.js';
import { config } from '../../configs/app.config.js';

export function loadMemory(db: DB, customerId: string) {
	const facts = db.prepare('SELECT key, value FROM memories WHERE customer_id = ? ORDER BY key')
		.all(customerId) as { key: string; value: string }[];
	const episodes = db.prepare('SELECT date, summary FROM episodes WHERE customer_id = ? ORDER BY id DESC LIMIT 2')
		.all(customerId) as { date: string; summary: string }[];
	return { facts, episodes };
}

/** Compact block injected into prompts (~100 tokens instead of full history). */
export function memoryBlock(db: DB, customerId: string) {
	const { facts, episodes } = loadMemory(db, customerId);
	const lines = [
		...facts.map((f) => `- ${f.key}: ${f.value}`),
		...episodes.map((e) => `- earlier (${e.date}): ${e.summary}`),
	];
	return lines.length ? lines.join('\n') : '- nothing yet';
}

// Never store secrets or live state in memory.
const BLOCKED = /\b(\d{12,19}|otp|password|cvv|pin\b)/i;
const BLOCKED_KEYS = /status|balance|refund|eta/i;

export function upsertFact(db: DB, customerId: string, key: string, value: string, source = 'chat') {
	if (BLOCKED.test(value) || BLOCKED_KEYS.test(key)) return false;
	db.prepare(`INSERT INTO memories VALUES (?,?,?,?,?)
		ON CONFLICT(customer_id, key) DO UPDATE SET value = excluded.value, source = excluded.source, updated_at = excluded.updated_at`)
		.run(customerId, key.slice(0, 40), value.slice(0, 200), source, config.today);
	return true;
}

export function addEpisode(db: DB, customerId: string, summary: string) {
	db.prepare('INSERT INTO episodes (customer_id, date, summary) VALUES (?,?,?)')
		.run(customerId, config.today, summary.slice(0, 240));
}

export function forget(db: DB, customerId: string) {
	db.prepare('DELETE FROM memories WHERE customer_id = ?').run(customerId);
	db.prepare('DELETE FROM episodes WHERE customer_id = ?').run(customerId);
}
