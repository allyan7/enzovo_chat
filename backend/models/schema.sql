-- enzovo_chat schema. Nested data (items, payments, events) is stored as JSON text:
-- simple for a POC, and SQLite's json_* functions can still query it.

CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, brand TEXT, category TEXT NOT NULL,
  price INTEGER NOT NULL, mrp INTEGER, rating REAL, rating_count INTEGER,
  units_sold_7d INTEGER DEFAULT 0, views_7d INTEGER DEFAULT 0, stock INTEGER NOT NULL,
  is_5g INTEGER, ram_gb INTEGER, storage_gb INTEGER, launch_date TEXT,
  details TEXT NOT NULL            -- full JSON (colors, highlights, in_box, warranty, compatible_with)
);

CREATE TABLE IF NOT EXISTS coupons (code TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS pincodes (pincode TEXT PRIMARY KEY, city TEXT, state TEXT, delivery_days INTEGER, cod_available INTEGER);

CREATE TABLE IF NOT EXISTS customers (id TEXT PRIMARY KEY, name TEXT NOT NULL, tier TEXT, data TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS wallets (
  customer_id TEXT PRIMARY KEY REFERENCES customers(id),
  wallet_id TEXT NOT NULL, balance INTEGER NOT NULL, promo_balance INTEGER NOT NULL DEFAULT 0,
  promo_expiry TEXT, wallet_limit INTEGER NOT NULL, status TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS wallet_txns (
  id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, date TEXT NOT NULL, type TEXT NOT NULL,
  reason TEXT NOT NULL, amount INTEGER NOT NULL, balance_after INTEGER NOT NULL,
  order_id TEXT, refund_id TEXT, note TEXT
);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, placed_at TEXT NOT NULL, status TEXT NOT NULL,
  address_id TEXT, total INTEGER NOT NULL, quote_id TEXT UNIQUE,  -- quote_id = idempotency key
  data TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS shipments (id TEXT PRIMARY KEY, order_id TEXT NOT NULL, status TEXT, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS returns (id TEXT PRIMARY KEY, order_id TEXT NOT NULL, customer_id TEXT NOT NULL, status TEXT, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS refunds (id TEXT PRIMARY KEY, order_id TEXT NOT NULL, customer_id TEXT NOT NULL, status TEXT, amount INTEGER, data TEXT NOT NULL);

-- Quotes: read-only price + payment plan the user confirms before an order is placed.
CREATE TABLE IF NOT EXISTS quotes (
  id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL, used_by_order TEXT, data TEXT NOT NULL
);

-- Memory layer: long-term facts and episodic summaries (see docs/LEARN.md).
CREATE TABLE IF NOT EXISTS memories (
  customer_id TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL,
  source TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (customer_id, key)
);
CREATE TABLE IF NOT EXISTS episodes (
  id INTEGER PRIMARY KEY AUTOINCREMENT, customer_id TEXT NOT NULL, date TEXT NOT NULL, summary TEXT NOT NULL
);

-- RAG: policy chunks + optional embeddings (JSON array of floats).
CREATE TABLE IF NOT EXISTS policy_chunks (
  id TEXT PRIMARY KEY, doc TEXT NOT NULL, section TEXT NOT NULL, text TEXT NOT NULL, embedding TEXT
);
