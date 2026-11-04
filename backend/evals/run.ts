// npm run eval            run every scenario once against the real model
// npm run eval -- -k 3    run each 3 times and report pass^3 (τ-bench style:
//                         a scenario passes only if ALL k runs pass)
// npm run eval -- trending  run scenarios whose id contains "trending"
//
// Uses its own databases (evals/*.db) and re-seeds before every run, so
// writes like "buy then cancel" never leak between scenarios.
import { mkdirSync, writeFileSync } from 'node:fs';

const dir = new URL('./', import.meta.url).pathname;
process.env.DB_PATH = `${dir}eval.db`;
process.env.CHECKPOINT_DB_PATH = `${dir}eval-checkpoints.db`;
mkdirSync(dir, { recursive: true });

const { config } = await import('../configs/app.config.js');
const { getDb } = await import('../models/db.js');
const { seed } = await import('../models/seed.js');
const { chat } = await import('../modules/Agents/mod.js');
const { SCENARIOS } = await import('./scenarios.js');
type Scenario = import('./scenarios.js').Scenario;

const args = process.argv.slice(2);
const k = Number(args[args.indexOf('-k') + 1]) || 1;
const filter = args.find((a, i) => !a.startsWith('-') && args[i - 1] !== '-k');
const scenarios: Scenario[] = SCENARIOS.filter((s: Scenario) => !filter || s.id.includes(filter));

interface RunResult { pass: boolean; failures: string[]; ms: number; turns: number }

async function runOnce(s: Scenario, run: number): Promise<RunResult> {
	seed(getDb());
	const threadId = `eval-${s.id}-${run}-${Date.now()}`;
	const failures: string[] = [];
	let ms = 0;
	for (const [i, t] of s.turns.entries()) {
		const started = Date.now();
		let r = await chat({ customerId: s.customer, threadId, message: t.say });
		const agents = new Set(r.trace.agents);
		const tools = new Set(r.trace.tools);
		const sawConfirmation = !!r.confirmation;
		if (r.confirmation && t.confirm !== undefined) {
			r = await chat({ customerId: s.customer, threadId, confirm: { approved: t.confirm } });
			r.trace.agents.forEach((a) => agents.add(a));
			r.trace.tools.forEach((x) => tools.add(x));
		}
		ms += Date.now() - started;
		const reply = r.reply ?? '';
		const tag = `turn ${i + 1}`;
		if (t.expectConfirmation && !sawConfirmation) failures.push(`${tag}: no confirmation card`);
		for (const a of t.agents ?? []) if (!agents.has(a)) failures.push(`${tag}: agent ${a} did not run`);
		for (const x of t.tools ?? []) if (!tools.has(x)) failures.push(`${tag}: tool ${x} not called`);
		for (const re of t.facts ?? []) if (!re.test(reply)) failures.push(`${tag}: reply missing ${re}`);
		for (const re of t.notFacts ?? []) if (re.test(reply)) failures.push(`${tag}: reply must not match ${re}`);
	}
	return { pass: failures.length === 0, failures, ms, turns: s.turns.length };
}

console.log(`enzovo evals · model ${config.llmModel} · ${scenarios.length} scenarios · k=${k}\n`);
const rows: { s: Scenario; runs: RunResult[] }[] = [];
for (const s of scenarios) {
	const runs: RunResult[] = [];
	for (let r = 0; r < k; r++) {
		try {
			runs.push(await runOnce(s, r));
		} catch (e) {
			runs.push({ pass: false, failures: [`error: ${(e as Error).message}`], ms: 0, turns: s.turns.length });
		}
	}
	rows.push({ s, runs });
	const ok = runs.filter((r) => r.pass).length;
	console.log(`${ok === k ? '✅' : ok ? '🟡' : '❌'} ${s.id.padEnd(26)} ${ok}/${k}  ${(runs.reduce((a, r) => a + r.ms, 0) / k / 1000).toFixed(1)}s`);
	for (const f of [...new Set(runs.flatMap((r) => r.failures))]) console.log(`     ↳ ${f}`);
}

const passAll = rows.filter((r) => r.runs.every((x) => x.pass)).length;
const pass1 = rows.reduce((a, r) => a + r.runs.filter((x) => x.pass).length / k, 0);
const avgTurn = rows.reduce((a, r) => a + r.runs.reduce((b, x) => b + x.ms / x.turns, 0) / k, 0) / rows.length / 1000;
const pct = (n: number) => `${Math.round((100 * n) / rows.length)}%`;
const summary = `pass^1 ${pct(pass1)} · pass^${k} ${pct(passAll)} · avg ${avgTurn.toFixed(1)}s per turn`;
console.log(`\n${summary}`);

const md = [
	`# Eval results`, '',
	`Model \`${config.llmModel}\` · ${new Date().toISOString().slice(0, 10)} · ${rows.length} scenarios · k = ${k}`, '',
	`**${summary}**`, '',
	'| Scenario | Area | Passed | Avg time | Failures |', '|---|---|---|---|---|',
	...rows.map(({ s, runs }) => `| ${s.id} | ${s.area} | ${runs.filter((r) => r.pass).length}/${k} | ${(runs.reduce((a, r) => a + r.ms, 0) / k / 1000).toFixed(1)}s | ${[...new Set(runs.flatMap((r) => r.failures))].join('; ').replace(/\|/g, '/') || '—'} |`),
	'', 'Regenerate with `npm run eval -- -k 3` (needs Ollama).', '',
].join('\n');
writeFileSync(`${dir}RESULTS.md`, md);
console.log(`Wrote evals/RESULTS.md`);
process.exit(0);
