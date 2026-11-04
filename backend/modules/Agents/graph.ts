// The multi-agent graph.
//
//   START → load_context → supervisor ─┬─ Send(specialist: product) ─┐
//                                      ├─ Send(specialist: order)   ─┼→ synthesize → END
//                                      ├─ Send(specialist: payments)─┤
//                                      └─ (off-topic) ───────────────┘
//   specialist ── (claimed an action, no tool call) ──► action_retry ──► synthesize
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
	// Set by the action guard when an agent claimed an action without a tool call.
	retry: Annotation<{ agent: AgentName; messages: BaseMessage[] } | null>({ reducer: (_a, b) => b, default: () => null }),
});
type S = typeof State.State;

const lastHuman = (msgs: BaseMessage[]) => String([...msgs].reverse().find((m) => m instanceof HumanMessage)?.content ?? '');
const ACTION_ASK = /\b(cancel|buy|purchase|place|order it)\b/i;
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

/** Builds the ReAct agent (LLM ⇄ tools loop) for one specialist, with only its own tools. */
async function reactFor(s: S, agent: AgentName) {
	return createReactAgent({
		llm: chatModel(),
		tools: await toolsFor(s.customerId, agent),
		prompt: agentPrompt(agent, s.memory, s.activeOrderId),
	});
}

const toolCalls = (msgs: BaseMessage[]) => msgs.flatMap((m) => (m as AIMessage).tool_calls?.map((t) => t.name) ?? []);

/** Turns an agent run into a reply + working-memory update. */
function toReply(agent: AgentName, all: BaseMessage[], newMsgs: BaseMessage[]) {
	const toolText = newMsgs.filter((m) => m.getType() === 'tool').map((m) => String(m.content)).join(' ');
	const orderIds = toolText.match(/ORD-\d+/g);
	return {
		replies: [{ agent, text: String(all.at(-1)?.content ?? ''), tools: toolCalls(newMsgs) }],
		// Working memory: remember the order we just talked about, for "cancel it".
		activeOrderId: orderIds && new Set(orderIds).size === 1 ? orderIds[0] : undefined,
	};
}

// Each node runs the agent exactly ONCE. LangGraph resumes an interrupt by
// re-running the node, so two agent runs in one node replay the wrong one.
async function specialist(s: S, config: RunnableConfig) {
	const agent = s.routes[0];
	// Only the last few user-facing turns: keeps a 14B model's context small.
	const input = s.messages.slice(-6);
	const out = await (await reactFor(s, agent)).invoke({ messages: input }, config);
	const newMsgs: BaseMessage[] = out.messages.slice(input.length);

	// Action guard: small models sometimes SAY "cancelled" without calling the
	// tool. If the customer asked for an action and no tool ran, hand over to
	// the `retry` node instead of trusting the claim.
	if (agent === 'order' && !toolCalls(newMsgs).length && ACTION_ASK.test(lastHuman(s.messages))) {
		const nudge = new HumanMessage(`You did not call any tool, so nothing happened. Call the right tool now${s.activeOrderId ? ` (the order is ${s.activeOrderId})` : ''}.`);
		return { retry: { agent, messages: [...input, ...newMsgs, nudge] } };
	}
	return toReply(agent, out.messages, newMsgs);
}

async function retry(s: S, config: RunnableConfig) {
	const { agent, messages } = s.retry!;
	const out = await (await reactFor(s, agent)).invoke({ messages }, config);
	const newMsgs: BaseMessage[] = out.messages.slice(messages.length);
	if (!toolCalls(newMsgs).length) {
		return { retry: null, replies: [{ agent, text: "Sorry, I couldn't complete that. Please try again, mentioning the order id.", tools: [] }] };
	}
	return { ...toReply(agent, out.messages, newMsgs), retry: null };
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
		.addNode('action_retry', retry)
		.addNode('synthesize', synthesize)
		.addEdge(START, 'load_context')
		.addEdge('load_context', 'supervisor')
		.addConditionalEdges('supervisor', fanOut, ['specialist', 'synthesize'])
		.addConditionalEdges('specialist', (s: S) => (s.retry ? 'action_retry' : 'synthesize'), ['action_retry', 'synthesize'])
		.addEdge('action_retry', 'synthesize')
		.addEdge('synthesize', END)
		.compile({ checkpointer });
}
