// Loads models/seed/*.seed.json into SQLite. Safe to re-run: wipes and reloads.
import { readFileSync } from 'node:fs';
import { openDb, type DB } from './db.js';
import { config } from '../configs/app.config.js';
import { indexPolicies } from '../modules/Knowledge/mod.js';

const load = (name: string) =>
	JSON.parse(
		readFileSync(new URL(`./seed/${name}.seed.json`, import.meta.url), 'utf8'),
	);

const TABLES = [
	'products', 'coupons', 'pincodes', 'customers', 'wallets', 'wallet_txns',
	'orders', 'shipments', 'returns', 'refunds', 'quotes', 'memories',
	'episodes', 'policy_chunks',
];

export function seed(db: DB) {
	db.transaction(() => {
		for (const t of TABLES) db.prepare(`DELETE FROM ${t}`).run();

		const ip = db.prepare(`INSERT INTO products VALUES (@id,@title,@brand,
			@category,@price,@mrp,@rating,@rating_count,@units_sold_7d,@views_7d,
			@stock,@is_5g,@ram_gb,@storage_gb,@launch_date,@details)`);
		for (const p of load('products')) {
			ip.run({
				ram_gb: null, storage_gb: null, ...p,
				is_5g: p.is_5g ? 1 : 0, details: JSON.stringify(p),
			});
		}
		for (const c of load('coupons')) {
			db.prepare('INSERT INTO coupons VALUES (?,?)').run(c.code, JSON.stringify(c));
		}
		for (const p of load('serviceability').pincodes) {
			db.prepare('INSERT INTO pincodes VALUES (?,?,?,?,?)')
				.run(p.pincode, p.city, p.state, p.delivery_days, p.cod_available ? 1 : 0);
		}
		for (const c of load('customers')) {
			db.prepare('INSERT INTO customers VALUES (?,?,?,?)')
				.run(c.id, c.name, c.tier, JSON.stringify(c));
		}
		for (const w of load('wallets')) {
			db.prepare('INSERT INTO wallets VALUES (?,?,?,?,?,?,?)').run(
				w.customer_id, w.wallet_id, w.balance, w.promo_balance,
				w.promo_expiry ?? null, w.limit, w.status,
			);
			for (const t of w.transactions) {
				db.prepare('INSERT INTO wallet_txns VALUES (?,?,?,?,?,?,?,?,?,?)').run(
					t.id, w.customer_id, t.date, t.type, t.reason, t.amount,
					t.balance_after, t.order_id ?? null, t.refund_id ?? null, t.note ?? null,
				);
			}
		}
		for (const o of load('orders')) {
			db.prepare('INSERT INTO orders VALUES (?,?,?,?,?,?,?,?)').run(
				o.id, o.customer_id, o.placed_at, o.status, o.address_id,
				o.pricing.total, null, JSON.stringify(o),
			);
		}
		for (const s of load('shipments')) {
			db.prepare('INSERT INTO shipments VALUES (?,?,?,?)')
				.run(s.id, s.order_id, s.status, JSON.stringify(s));
		}
		for (const r of load('returns')) {
			db.prepare('INSERT INTO returns VALUES (?,?,?,?,?)')
				.run(r.id, r.order_id, r.customer_id, r.status, JSON.stringify(r));
		}
		for (const r of load('refunds')) {
			db.prepare('INSERT INTO refunds VALUES (?,?,?,?,?,?)')
				.run(r.id, r.order_id, r.customer_id, r.status, r.amount, JSON.stringify(r));
		}

		// Starter long-term memories so the memory layer shows something on day one.
		const mem = db.prepare(`INSERT INTO memories VALUES (?,?,?,'seed',?)`);
		mem.run('CUST-001', 'preferred_payment', 'wallet', config.today);
		mem.run('CUST-001', 'owns_phone', 'Samsung Galaxy S24 (P101)', config.today);
		mem.run('CUST-003', 'closed_card', 'Mastercard ending 1093 is closed; never offer it', config.today);
	})();

	return { policyChunks: indexPolicies(db) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
	const { policyChunks } = seed(openDb());
	console.log(
		`Seeded ${config.dbPath} (${policyChunks} policy chunks). ` +
			'Optional: "npm run rag:index" adds embeddings via Ollama.',
	);
}
