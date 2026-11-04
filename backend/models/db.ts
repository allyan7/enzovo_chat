import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { config } from '../configs/app.config.js';

export type DB = Database.Database;

let shared: DB | undefined;

/** Opens SQLite (WAL so the API server and the MCP process can share it). */
export function openDb(path = config.dbPath): DB {
	const db = new Database(path);
	db.pragma('journal_mode = WAL');
	db.exec(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
	return db;
}

export function getDb(): DB {
	shared ??= openDb();
	return shared;
}

/** Parse a JSON text column. */
export const j = <T = any>(s: string): T => JSON.parse(s);
