// The multi-agent graph.
//
//   START → load_context → supervisor ─┬─ Send(specialist: product) ─┐
//                                      ├─ Send(specialist: order)   ─┼→ synthesize → END
//                                      ├─ Send(specialist: payments)─┤
//                                      └─ (off-topic) ───────────────┘
//
// Memory tiers used here:
//   thread  = `messages`, saved per thread_id by the SQLite checkpointer
//   working = `activeOrderId`, carried across turns in graph state
//   long-term + episodic = `memory` block loaded from the memories table
import { AIMessage, HumanMessage, type BaseMessage } from '@langchain/core/messages';
import { Annotation, END, MessagesAnnotation, Send, START, StateGraph, type BaseCheckpointSaver } from '@langchain/langgraph';
import { createReactAgent } from '@langchain/langgraph/prebuilt';
import type { RunnableConfig } from '@langchain/core/runnables';
import { getDb } from '../../models/db.js';
import { memoryBlock } from '../Memory/Memory.module.js';
import { chatModel } from './llm.js';
import { agentPrompt, OFF_TOPIC, SYNTH_PROMPT } from './prompts.js';
import { route } from './router.js';
import { toolsFor, type AgentName } from './tools.js';

interface AgentReply { agent: AgentName; text: string; tools: string[] }

export const State = Annotation.Root({
	...MessagesAnnotation.spec,
	customerId: Annotation<string>(),
	memory: Annotation<string>(),
	routes: Annotation<AgentName[]>(),
	activeOrderId: Annotation<string | null>({ reducer: (a, b) => b ?? a, default: () => null }),
	// Parallel specialists append here; load_context clears it each turn.
	replies: Annotation<AgentReply[]>({
		reducer: (a, b) => (b === null ? [] : [...a, ...b]) as AgentReply[],
		default: () => [],
	}),
});
type S = typeof State.State;

const lastHuman = (msgs: BaseMessage[]) => String([...msgs].reverse().find((m) => m instanceof HumanMessage)?.content ?? '');
const transcript = (msgs: BaseMessage[], n: number) =>
	msgs.slice(-n).map((m) => `${m instanceof HumanMessage ? 'Customer' : 'Assistant'}: ${m.content}`).join('\n');

async function loadContext(s: S) {
	return { memory: memoryBlock(getDb(), s.customerId), replies: null as unknown as AgentReply[] };
}

async function supervisor(s: S) {
	const routes = await route(lastHuman(s.messages), transcript(s.messages.slice(0, -1), 4));
	return { routes: routes === 'none' ? [] : routes };
}

function fanOut(s: S) {
	if (!s.routes.length) return 'synthesize';
	return s.routes.map((agent) => new Send('specialist', { ...s, routes: [agent] }));
}

/** One ReAct agent (LLM ⇄ tools loop) with only its own tools. */
async function specialist(s: S, config: RunnableConfig) {
	const agent = s.routes[0];
	const react = createReactAgent({
		llm: chatModel(),
		tools: await toolsFor(s.customerId, agent),
		prompt: agentPrompt(agent, s.memory, s.activeOrderId),
	});
	// Only the last few user-facing turns: keeps a 14B model's context small.
	const out = await react.invoke({ messages: s.messages.slice(-6) }, config);
	const newMsgs: BaseMessage[] = out.messages.slice(Math.min(6, s.messages.length));
	const toolText = newMsgs.filter((m) => m.getType() === 'tool').map((m) => String(m.content)).join(' ');
	const orderIds = toolText.match(/ORD-\d+/g);
	return {
		replies: [{
			agent,
			text: String(out.messages.at(-1)?.content ?? ''),
			tools: newMsgs.flatMap((m) => (m as AIMessage).tool_calls?.map((t) => t.name) ?? []),
		}],
		// Working memory: remember the order we just talked about, for "cancel it".
		activeOrderId: orderIds?.length === 1 || new Set(orderIds).size === 1 ? orderIds![0] : undefined,
	};
}

async function synthesize(s: S) {
	if (!s.replies.length) return { messages: [new AIMessage(OFF_TOPIC)] };
	if (s.replies.length === 1) return { messages: [new AIMessage(s.replies[0].text)] };
	const merged = await chatModel().invoke([
		['system', SYNTH_PROMPT],
		['user', `Customer asked: ${lastHuman(s.messages)}\n\n${s.replies.map((r) => `[${r.agent}]\n${r.text}`).join('\n\n')}`],
	]);
	return { messages: [new AIMessage(String(merged.content))] };
}

export function buildGraph(checkpointer: BaseCheckpointSaver) {
	return new StateGraph(State)
		.addNode('load_context', loadContext)
		.addNode('supervisor', supervisor)
		.addNode('specialist', specialist)
		.addNode('synthesize', synthesize)
		.addEdge(START, 'load_context')
		.addEdge('load_context', 'supervisor')
		.addConditionalEdges('supervisor', fanOut, ['specialist', 'synthesize'])
		.addEdge('specialist', 'synthesize')
		.addEdge('synthesize', END)
		.compile({ checkpointer });
}
