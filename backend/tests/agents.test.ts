// Agent plumbing that does not need an LLM: keyword routing fallback, and
// least-privilege tool groups loaded from the real MCP server over stdio.
import { beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'enzovo-')), 'test.db');
const { getDb } = await import('../models/db.js');
const { seed } = await import('../models/seed.js');
const { keywordRoute } = await import('../modules/Agents/router.js');
const { toolsFor } = await import('../modules/Agents/tools.js');

beforeAll(() => { seed(getDb()); });

describe('router fallback', () => {
	it('routes multi-intent messages to several agents', () => {
		expect(keywordRoute("Where's my refund and is my phone arriving tomorrow?")).toEqual(['payments', 'order', 'product']);
		expect(keywordRoute('show me trending phones')).toEqual(['product']);
	});
});

describe('tools over MCP stdio', () => {
	it('gives each agent only its own tools, bound to one customer', async () => {
		const product = await toolsFor('CUST-002', 'product');
		expect(product.map((t) => t.name).sort()).toEqual(['check_delivery', 'get_product', 'search_products']);
		const payments = await toolsFor('CUST-002', 'payments');
		const refund: any = payments.find((t) => t.name === 'get_refund_status');
		expect(String(await refund.invoke({}))).toContain('RFD-2002');
	}, 30_000);
});
