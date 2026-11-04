// Thin client for Ollama's embedding endpoint. Chat goes through
// @langchain/ollama; embeddings are a plain fetch so RAG has no extra deps.
import { config } from '../../configs/app.config.js';

export class OllamaUnavailable extends Error {}

export async function embed(texts: string[]): Promise<number[][]> {
	try {
		const res = await fetch(`${config.ollamaBaseUrl}/api/embed`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ model: config.embedModel, input: texts }),
		});
		if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
		return ((await res.json()) as { embeddings: number[][] }).embeddings;
	} catch (e) {
		throw new OllamaUnavailable(`Ollama embeddings failed: ${(e as Error).message}`);
	}
}
