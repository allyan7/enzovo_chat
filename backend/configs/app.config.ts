// Central config. Everything is overridable with env vars (see .env.example).
import { existsSync, readFileSync } from 'node:fs';

// Tiny .env loader so we don't need the dotenv package.
if (existsSync('.env')) {
	for (const line of readFileSync('.env', 'utf8').split('\n')) {
		const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
		if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
	}
}

const env = (k: string, d: string) => process.env[k] ?? d;

export const config = {
	ollamaBaseUrl: env('OLLAMA_BASE_URL', 'http://localhost:11434'),
	llmModel: env('LLM_MODEL', 'qwen2.5:14b'),
	routerModel: env('ROUTER_MODEL', env('LLM_MODEL', 'qwen2.5:14b')),
	embedModel: env('EMBED_MODEL', 'nomic-embed-text'),
	dbPath: env('DB_PATH', './enzovo.db'),
	checkpointDbPath: env('CHECKPOINT_DB_PATH', './checkpoints.db'),
	// The seed data is written "as of" this date so the demo answers stay stable.
	today: env('ENZOVO_TODAY', '2026-11-04'),
	port: Number(env('PORT', '3000')),
	// Business limits
	maxQtyPerItem: 3,
	quoteTtlMinutes: 15,
};
