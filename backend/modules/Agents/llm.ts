import { ChatOllama } from '@langchain/ollama';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { config } from '../../configs/app.config.js';

// temperature 0: tool calling and routing should be deterministic.
const ollamaChat = (): BaseChatModel =>
	new ChatOllama({ model: config.llmModel, baseUrl: config.ollamaBaseUrl, temperature: 0, numCtx: 8192 });

let factory = ollamaChat;
export const chatModel = () => factory();

/** Tests swap in a scripted model so the graph runs without Ollama. */
export const setChatModelFactory = (f: (() => BaseChatModel) | null) => { factory = f ?? ollamaChat; };

// JSON mode for the router and memory extractor: the model must return valid JSON.
export const jsonModel = (model = config.routerModel) =>
	new ChatOllama({ model, baseUrl: config.ollamaBaseUrl, temperature: 0, format: 'json' });

/** Small models sometimes wrap JSON in prose; take the first {...} block. */
export function parseJson<T>(text: string, fallback: T): T {
	try {
		const m = text.match(/\{[\s\S]*\}/);
		return m ? (JSON.parse(m[0]) as T) : fallback;
	} catch {
		return fallback;
	}
}
