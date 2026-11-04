// Checks that the seed data is internally consistent.
// Run: node scripts/validate-seed.mjs
import { readFileSync } from "node:fs";

const load = (f) => JSON.parse(readFileSync(new URL(`./seed/${f.replace(".json", ".seed.json")}`, import.meta.url)));
const products = load("products.json");
const customers = load("customers.json");
const wallets = load("wallets.json");
const orders = load("orders.json");
const shipments = load("shipments.json");
const returns = load("returns.json");
const refunds = load("refunds.json");
const coupons = load("coupons.json");

const errors = [];
const check = (ok, msg) => { if (!ok) errors.push(msg); };
const byId = (arr) => Object.fromEntries(arr.map((x) => [x.id, x]));
const P = byId(products), C = byId(customers), O = byId(orders), S = byId(shipments), R = byId(returns), F = byId(refunds);

// Orders: pricing and payments add up, references exist
for (const o of orders) {
  check(C[o.customer_id], `${o.id}: unknown customer`);
  check(C[o.customer_id]?.addresses.some((a) => a.id === o.address_id), `${o.id}: address not on customer`);
  const subtotal = o.items.reduce((s, i) => s + i.qty * i.unit_price, 0);
  check(subtotal === o.pricing.subtotal, `${o.id}: subtotal ${subtotal} != ${o.pricing.subtotal}`);
  for (const i of o.items) {
    check(P[i.product_id], `${o.id}: unknown product ${i.product_id}`);
    check(P[i.product_id]?.price === i.unit_price, `${o.id}: price of ${i.product_id} differs from catalog`);
  }
  const total = o.pricing.subtotal - o.pricing.discount + o.pricing.delivery_fee;
  check(total === o.pricing.total, `${o.id}: total ${total} != ${o.pricing.total}`);
  const paid = o.payments.reduce((s, p) => s + p.amount, 0);
  check(paid === o.pricing.total, `${o.id}: payments ${paid} != total ${o.pricing.total}`);
  if (o.pricing.coupon_code) check(coupons.some((c) => c.code === o.pricing.coupon_code), `${o.id}: unknown coupon`);
  if (o.shipment_id) check(S[o.shipment_id]?.order_id === o.id, `${o.id}: shipment link broken`);
  if (o.return_id) check(R[o.return_id]?.order_id === o.id, `${o.id}: return link broken`);
  if (o.refund_id) check(F[o.refund_id]?.order_id === o.id, `${o.id}: refund link broken`);
}

// Wallets: running balances and final balance match the ledger
for (const w of wallets) {
  let bal = 0;
  for (const t of w.transactions) {
    bal += t.type === "credit" ? t.amount : -t.amount;
    check(bal === t.balance_after, `${w.wallet_id} ${t.id}: running balance ${bal} != ${t.balance_after}`);
    if (t.reason === "order_payment") {
      const pay = O[t.order_id]?.payments.find((p) => p.method === "wallet");
      check(pay?.amount === t.amount, `${t.id}: wallet debit does not match order ${t.order_id}`);
    }
    if (t.reason === "refund") check(F[t.refund_id]?.amount === t.amount, `${t.id}: refund amount mismatch`);
  }
  check(bal === w.balance, `${w.wallet_id}: ledger ${bal} != balance ${w.balance}`);
  if (w.cash_balance !== undefined) check(w.cash_balance + w.promo_balance === w.balance, `${w.wallet_id}: cash + promo != balance`);
  check(w.balance <= w.limit, `${w.wallet_id}: balance over KYC limit`);
}

// Refunds equal the order total for full cancellations/returns
for (const f of refunds) check(f.amount === O[f.order_id]?.pricing.total, `${f.id}: amount != order total`);

// Return windows (policy: mobiles 7 days, audio/accessories 10 days, counted from the day after delivery)
const days = (a, b) => Math.round((new Date(b.slice(0, 10)) - new Date(a.slice(0, 10))) / 86400000);
for (const r of returns) {
  const o = O[r.order_id];
  const window = P[r.product_id].category === "mobiles" ? 7 : 10;
  check(days(o.delivered_at, r.requested_at) <= window, `${r.id}: requested outside ${window}-day window`);
}

// Business-day helper for the SLA dates used in the data
const addBusinessDays = (iso, n) => {
  const d = new Date(iso.slice(0, 10));
  while (n > 0) { d.setUTCDate(d.getUTCDate() + 1); if (![0, 6].includes(d.getUTCDay())) n--; }
  return d.toISOString().slice(0, 10);
};
check(addBusinessDays("2026-10-31", 4) === F["RFD-2002"].expected_by, "RFD-2002: UPI expected_by not 4 business days");
check(addBusinessDays("2026-11-02", 5) === O["ORD-2003"].payments[0].auto_reversal.expected_by, "ORD-2003: reversal expected_by not 5 business days");

if (errors.length) { console.error("❌ Problems found:\n" + errors.map((e) => " - " + e).join("\n")); process.exit(1); }
console.log(`✅ Seed data consistent: ${products.length} products, ${customers.length} customers, ${orders.length} orders, ${refunds.length} refunds, ${returns.length} returns.`);
