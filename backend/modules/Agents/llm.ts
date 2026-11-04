import { ChatOllama } from '@langchain/ollama';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { config } from '../../configs/app.config.js';

// Speed notes for local models:
// - Every model instance uses the SAME num_ctx. If it differs, Ollama reloads
//   the model between the router call and the agent call (seconds each time).
// - keepAlive keeps the model in memory between chats.
// - numPredict caps reply length; support answers are short anyway.
const base = { baseUrl: config.ollamaBaseUrl, temperature: 0, numCtx: 8192, keepAlive: '30m' };

const ollamaChat = (): BaseChatModel =>
	new ChatOllama({ ...base, model: config.llmModel, numPredict: 400 });

let factory = ollamaChat;
export const chatModel = () => factory();

/** Tests swap in a scripted model so the graph runs without Ollama. */
export const setChatModelFactory = (f: (() => BaseChatModel) | null) => { factory = f ?? ollamaChat; };

// JSON mode for the router and memory extractor: the model must return valid JSON.
export const jsonModel = (model = config.routerModel) =>
	new ChatOllama({ ...base, model, format: 'json', numPredict: 120 });

/** Small models sometimes wrap JSON in prose; take the first {...} block. */
export function parseJson<T>(text: string, fallback: T): T {
	try {
		const m = text.match(/\{[\s\S]*\}/);
		return m ? (JSON.parse(m[0]) as T) : fallback;
	} catch {
		return fallback;
	}
}
