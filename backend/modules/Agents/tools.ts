// Connects to the enzovo MCP server (one stdio process per customer) and turns
// its tools into LangChain tools. Write tools get a confirmation gate.
import { fileURLToPath } from 'node:url';
import { MultiServerMCPClient } from '@langchain/mcp-adapters';
import { tool, type StructuredToolInterface } from '@langchain/core/tools';
import { interrupt } from '@langchain/langgraph';
import { z } from 'zod';
import { TOOL_GROUPS, WRITE_TOOLS } from '../../mcp/enzovo.mcp.js';

export type AgentName = keyof typeof TOOL_GROUPS;

const SERVER = fileURLToPath(new URL('../../mcp/enzovo.mcp.ts', import.meta.url));
const clients = new Map<string, Promise<StructuredToolInterface[]>>();

/** Identity is bound here: the MCP process only ever serves this customer. */
function mcpToolsFor(customerId: string) {
	if (!clients.has(customerId)) {
		const client = new MultiServerMCPClient({
			mcpServers: {
				enzovo: {
					transport: 'stdio',
					command: process.execPath,
					args: ['--import', 'tsx', SERVER],
					env: { ...(process.env as Record<string, string>), ENZOVO_CUSTOMER_ID: customerId },
				},
			},
			prefixToolNameWithServerName: false,
		});
		clients.set(customerId, client.getTools());
	}
	return clients.get(customerId)!;
}

export interface ConfirmRequest {
	type: 'confirm';
	tool: string;
	args: Record<string, unknown>;
	preview: unknown;
}

/**
 * Human-in-the-loop at the tool boundary.
 * 1. Run the tool with dry_run=true to get a preview (no side effects).
 * 2. interrupt(): the graph pauses and the API returns the preview to the UI.
 * 3. On resume with { approved: true }, run it for real with dry_run=false.
 * The LLM cannot skip this: dry_run is set here, not by the model.
 */
function withConfirmation(t: StructuredToolInterface) {
	return tool(
		async (args: Record<string, unknown>) => {
			const preview = String(await t.invoke({ ...args, dry_run: true }));
			if (!preview.includes('"dry_run":true')) return preview; // error or idempotent replay
			const answer = interrupt<ConfirmRequest, { approved: boolean }>({
				type: 'confirm', tool: t.name, args, preview: JSON.parse(preview).summary,
			});
			if (!answer?.approved) return 'User declined. Nothing was changed. Ask if they want anything else.';
			return t.invoke({ ...args, dry_run: false });
		},
		{
			name: t.name,
			description: `${t.description} The system shows the user a confirmation card automatically; just call this tool.`,
			schema: t.name === 'place_order' ? z.object({ quote_id: z.string() }) : z.object({ order_id: z.string() }),
		},
	);
}

/** Least privilege: each agent only receives its own tool group. */
export async function toolsFor(customerId: string, agent: AgentName) {
	const all = await mcpToolsFor(customerId);
	const allowed: readonly string[] = TOOL_GROUPS[agent];
	return all
		.filter((t) => allowed.includes(t.name))
		.map((t) => ((WRITE_TOOLS as readonly string[]).includes(t.name) ? withConfirmation(t) : t));
}
