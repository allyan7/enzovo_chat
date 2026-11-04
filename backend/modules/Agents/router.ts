// Supervisor routing: LLM first, keyword rules as a safety net.
// A local 14B model occasionally returns bad JSON; the fallback keeps the bot useful.
import { z } from 'zod';
import { jsonModel, parseJson } from './llm.js';
import { ROUTER_PROMPT } from './prompts.js';
import type { AgentName } from './tools.js';

const AGENTS = ['product', 'order', 'payments', 'policy'] as const;
const RouteSchema = z.object({ agents: z.array(z.enum([...AGENTS, 'none'])).min(1) });

const RULES: [AgentName, RegExp][] = [
	['payments', /refund|wallet|balance|deduct|charged|cashback|return|replace|money/i],
	['order', /order|track|deliver|arriv|where is|cancel|buy|purchase|place/i],
	['policy', /policy|cod\b|emi|window|charges|how long|rules?/i],
	['product', /phone|mobile|trending|rated|stars?|price|under|cheap|best|compare|case|charger|earbud|stock/i],
];

export function keywordRoute(text: string): AgentName[] {
	return RULES.filter(([, re]) => re.test(text)).map(([a]) => a);
}

export async function route(text: string, recentContext: string): Promise<AgentName[] | 'none'> {
	try {
		const res = await jsonModel().invoke([
			['system', ROUTER_PROMPT],
			['user', `${recentContext ? `Recent chat:\n${recentContext}\n\n` : ''}Customer: ${text}`],
		]);
		const parsed = RouteSchema.safeParse(parseJson(String(res.content), {}));
		if (parsed.success) {
			const agents = parsed.data.agents.filter((a): a is AgentName => a !== 'none');
			return agents.length ? [...new Set(agents)] : 'none';
		}
	} catch { /* fall through to rules */ }
	const fallback = keywordRoute(text);
	return fallback.length ? fallback : 'none';
}
