// Talks to the real MCP server through an in-memory transport, the same
// protocol the agents use over stdio.
import { beforeAll, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

process.env.DB_PATH = ':memory:';
const { getDb } = await import('../models/db.js');
const { seed } = await import('../models/seed.js');
const { buildServer } = await import('../mcp/enzovo.mcp.js');

let client: Client;
const call = async (name: string, args: Record<string, unknown> = {}) => {
	const r: any = await client.callTool({ name, arguments: args });
	return { isError: !!r.isError, text: r.content[0].text as string };
};

beforeAll(async () => {
	seed(getDb());
	const [a, b] = InMemoryTransport.createLinkedPair();
	await buildServer('CUST-001').connect(a);
	client = new Client({ name: 'test', version: '1' });
	await client.connect(b);
});

describe('enzovo MCP server', () => {
	it('lists 13 tools, none of which accept a customer_id', async () => {
		const { tools } = await client.listTools();
		expect(tools).toHaveLength(13);
		for (const t of tools) expect(Object.keys((t.inputSchema as any).properties ?? {})).not.toContain('customer_id');
	});
	it('write tools default to a dry-run preview', async () => {
		const r = await call('cancel_order', { order_id: 'ORD-1004' });
		expect(JSON.parse(r.text)).toMatchObject({ dry_run: true });
	});
	it("returns a domain error for another customer's order", async () => {
		const r = await call('track_order', { order_id: 'ORD-3001' });
		expect(r).toMatchObject({ isError: true });
		expect(r.text).toMatch(/NOT_FOUND/);
	});
});
