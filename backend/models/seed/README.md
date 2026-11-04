# enzovo seed data — e-commerce support chatbot POC

Mock data for a fictional store, **enzovo**, so the agent can answer product, order, wallet, return and refund questions locally. "Today" in the data is **Wednesday, 4 November 2026**.

Run `npm run validate:seed` after any edit. It checks that totals, payments, wallet ledgers, refund amounts, return windows and SLA dates all agree.

## Folder layout

| Path | What it holds | Answers questions like |
|---|---|---|
| `products.seed.json` | 15 phones + 5 accessories: price, MRP, rating, rating count, `units_sold_7d` (trending), stock, specs | "Trending phones", "Phones rated 4+", "5G under ₹20k" |
| `coupons.seed.json` | 4 coupons incl. one expired (`DIWALI25`) | "Apply the best coupon" |
| `serviceability.seed.json` | Pincodes, delivery days, COD | "Can it reach 682024 by Friday?" |
| `customers.seed.json` | 3 customers, addresses, saved cards (last 4 only), preferences | Session identity, default address |
| `wallets.seed.json` | Balance + full transaction ledger per customer | "Wallet balance?", "Why was ₹5,000 deducted?" |
| `orders.seed.json` | 10 orders across every state | "Where is my order?", "Cancel it" |
| `shipments.seed.json` | Courier events, ETA, delay reason | Tracking and delays |
| `returns.seed.json` | Return and replacement requests | "Status of my return?" |
| `refunds.seed.json` | Refunds with attempts (incl. a failed one) | "What happened to my refund?" |
| `../../knowledge/policies/*.md` | Returns & refunds, cancellation, shipping, wallet & payments — numbered sections for RAG citations | "What's the return policy for phones?" |

Trending = sort by `units_sold_7d` (or a blend with `views_7d`). Top 3 phones: Redmi Note 14 Pro, Nothing Phone (3a), iPhone 16.

## The three customers and their test scenarios

### CUST-001 Aarav Mehta — Bengaluru, Gold tier, wallet ₹8,449
| Ask | Data behind it | Expected answer |
|---|---|---|
| "Where is my order?" | ORD-1002 in transit; ORD-1004 confirmed, not dispatched | Nothing Phone (3a) is at the Koramangala hub, arriving tomorrow (5 Nov). Also mention the charger (ORD-1004) is confirmed and not dispatched yet. |
| "What happened to my refund?" | RFD-1003 | ₹2,999 for the earbuds was credited to the wallet on 26 Oct. |
| "Why do I have ₹450 extra?" | WTX-0003 | Gold cashback on the Galaxy S24 order. |
| "Cancel the charger" | ORD-1004, COD, not dispatched | Eligible, free cancel, nothing to refund (COD). Confirm first. |
| "Buy a case for my phone" | Owns P101 → A201 | Suggest the S24 silicone case; wallet covers it. Confirm once. |

### CUST-002 Priya Nair — Kochi, Silver, min-KYC wallet ₹1,200 (₹700 cash + ₹500 promo)
| Ask | Data behind it | Expected answer |
|---|---|---|
| "Where is my order?" | ORD-2001, SHP-2001 delayed | Held at Kochi hub due to heavy rain; revised ETA 6 Nov. If not delivered by then she may cancel for a full refund (cancellation §3). |
| "What happened to my refund?" | RFD-2002, UPI, processing | ₹13,499 sent to UPI on 31 Oct; due by 5 Nov. Not delayed yet. |
| "Money got deducted but no order" | ORD-2003 payment failed | ₹1,799 auto-reversal in progress, by 9 Nov, RRN 630612345678. |
| "Buy the Nothing Phone (3a) with my wallet" | Balance ₹1,200 | Not enough. Promo usable only up to 10%. Offer split payment. |

### CUST-003 Rohan Gupta — Delhi, Silver, full-KYC wallet ₹52,788
| Ask | Data behind it | Expected answer |
|---|---|---|
| "Return my iPhone" | ORD-3001 delivered 8 Sep | Window closed 15 Sep. Point to manufacturer warranty / service centre. |
| "Status of my Pixel replacement?" | RET-3002 | Exchange on delivery booked for 5 Nov, 10:00–14:00, at the Gurugram office. |
| "Why did my refund go to the wallet?" | RFD-3003 | Card ending 1093 was closed, so the refund failed on 13 Oct and was auto-credited to the wallet on 15 Oct (refunds §6). |
| "Order an iPhone 16 from my wallet" | Balance ₹52,788 < ₹69,900 | Offer split: ₹52,788 wallet + ₹17,112 on Visa 6411 (never the closed card). Confirm once. |
| "Buy a OnePlus 13R from wallet" | ₹42,999 ≤ balance | Show summary (balance after ₹9,789), confirm, place order. |

## Edge cases built into the data

- Out of stock: iQOO Z9 (P109) → offer alternatives.
- Expired coupon: DIWALI25.
- Closed saved card: Rohan's CARD-R1 must not be offered for payment.
- COD not available: pincodes 122002 and 744101.
- Promo credit rules: expiry date and the 10% cap.
- Gift order: ORD-1002 (price hidden on the slip).

## Why local mock data and not a public API

Public fake-store APIs (DummyJSON, FakeStoreAPI, Platzi, Beeceptor) are fine for a product catalogue, but they have no wallet, shipments, returns or refunds, and their write calls don't persist. Order placement and wallet debits need a real transactional store, so this data is meant to be loaded into SQLite and served by your own local REST API / MCP server.

### CUST-004 Meera Iyer — Mumbai, Gold, wallet ₹15,000, prefers card
| Ask | Data behind it | Expected answer |
|---|---|---|
| "When will my Apple Watch arrive?" | ORD-4002, SHP-4002 out for delivery | Arriving today; OTP needed (order over ₹10,000) |
| "Status of my AirPods return?" | RET-4003 pickup 5 Nov, 14:00–18:00 | Pickup tomorrow; ₹24,900 to Visa 2290 after QC, 5–7 business days |
| "How am I paying for the MacBook?" | ORD-4001 card, 6-month no-cost EMI | ₹19,150/month for 6 months |
| "Which tablets under ₹40,000?" | T301, T302, T303 | iPad 10th gen, Galaxy Tab S9 FE, Xiaomi Pad 6 |

### CUST-005 Arjun Kulkarni — Pune, Silver, min-KYC, ₹200 promo credit, prefers COD
| Ask | Data behind it | Expected answer |
|---|---|---|
| "Cancel my Realme order" | ORD-5001 packed, COD | Free cancel before dispatch; nothing to refund (COD) |
| "Can I pay with my wallet?" | ₹200 promo only, capped at 10% | Promo covers at most 10% of an order, expires 30 Nov |
| "Is COD available?" | Pincode 411038 | Yes, for orders up to ₹50,000 |

## Catalogue (46 products)
Mobiles 25 · tablets 3 · laptops 3 · wearables 4 · audio 4 · accessories 7. Out of stock: iQOO Z9 (P109), HP Pavilion x360 (L403).

## Evals
`npm run eval` turns these scenarios into automatic checks: `backend/evals/scenarios.ts`.
