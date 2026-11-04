// RAG over policy documents.
// 1. Chunk: one chunk per "## n. Heading" section, so answers can cite "§n".
// 2. Retrieve: BM25 keyword score, blended with embedding cosine similarity
//    when embeddings exist (hybrid search). BM25 alone works offline and in CI.
import { readdirSync, readFileSync } from 'node:fs';
import type { DB } from '../../models/db.js';
import { embed } from '../../vendors/ollama/Ollama.js';

const POLICY_DIR = new URL('../../knowledge/policies/', import.meta.url);

export interface Chunk { id: string; doc: string; section: string; text: string; embedding: string | null }

export function chunkMarkdown(doc: string, md: string) {
	const title = md.match(/^# (.+)$/m)?.[1] ?? doc;
	return md.split(/^## /m).slice(1).map((part) => {
		const heading = part.split('\n')[0].trim();
		const num = heading.match(/^(\d+)\./)?.[1] ?? heading;
		return { id: `${doc} §${num}`, doc, section: heading, text: `${title} — ${heading}\n${part.slice(heading.length).trim()}` };
	});
}

export function indexPolicies(db: DB) {
	db.prepare('DELETE FROM policy_chunks').run();
	const ins = db.prepare('INSERT INTO policy_chunks VALUES (?,?,?,?,NULL)');
	let n = 0;
	for (const f of readdirSync(POLICY_DIR).filter((f) => f.endsWith('.md'))) {
		for (const c of chunkMarkdown(f.replace(/\.md$/, ''), readFileSync(new URL(f, POLICY_DIR), 'utf8'))) {
			ins.run(c.id, c.doc, c.section, c.text);
			n++;
		}
	}
	return n;
}

/** Adds embeddings to every chunk (needs Ollama + nomic-embed-text). */
export async function embedPolicies(db: DB) {
	const chunks = db.prepare('SELECT id, text FROM policy_chunks').all() as Chunk[];
	const vectors = await embed(chunks.map((c) => `search_document: ${c.text}`));
	const up = db.prepare('UPDATE policy_chunks SET embedding = ? WHERE id = ?');
	chunks.forEach((c, i) => up.run(JSON.stringify(vectors[i]), c.id));
	return chunks.length;
}

const tokenize = (s: string) => s.toLowerCase().replace(/[^a-z0-9₹§ ]/g, ' ').split(/\s+/).filter((w) => w.length > 2);

/** Classic BM25 (k1 = 1.2, b = 0.75) over the chunk set. */
export function bm25(query: string, docs: string[]) {
	const tq = tokenize(query);
	const td = docs.map(tokenize);
	const avg = td.reduce((s, d) => s + d.length, 0) / td.length;
	return td.map((d) => tq.reduce((score, term) => {
		const tf = d.filter((w) => w === term).length;
		if (!tf) return score;
		const df = td.filter((x) => x.includes(term)).length;
		const idf = Math.log(1 + (td.length - df + 0.5) / (df + 0.5));
		return score + (idf * tf * 2.2) / (tf + 1.2 * (0.25 + (0.75 * d.length) / avg));
	}, 0));
}

const cosine = (a: number[], b: number[]) => {
	let dot = 0, na = 0, nb = 0;
	for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] ** 2; nb += b[i] ** 2; }
	return dot / (Math.sqrt(na * nb) || 1);
};

export async function searchPolicies(db: DB, query: string, k = 3) {
	const chunks = db.prepare('SELECT * FROM policy_chunks').all() as Chunk[];
	const kw = bm25(query, chunks.map((c) => c.text));
	const maxKw = Math.max(...kw, 1e-9);
	let mode = 'bm25';
	let sem: number[] | null = null;
	if (chunks.every((c) => c.embedding)) {
		try {
			const [q] = await embed([`search_query: ${query}`]);
			sem = chunks.map((c) => cosine(q, JSON.parse(c.embedding!)));
			mode = 'hybrid';
		} catch { /* Ollama down: fall back to keyword search */ }
	}
	return {
		mode,
		results: chunks
			.map((c, i) => ({ cite: c.id, section: c.section, text: c.text, score: 0.5 * (kw[i] / maxKw) + 0.5 * (sem ? sem[i] : kw[i] / maxKw) }))
			.sort((a, b) => b.score - a.score)
			.slice(0, k)
			.map((r) => ({ ...r, score: Number(r.score.toFixed(3)) })),
	};
}
