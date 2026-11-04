// Product discovery. Structured SQL, not RAG: ratings and prices are exact
// numbers, so filters give correct answers where similarity search would guess.
import { j } from '../../models/db.js';
import type { Ctx } from '../../utils/types/mod.js';
import { DomainError } from '../../utils/errors.js';
import { addDays } from '../../utils/dates.js';
import { config } from '../../configs/app.config.js';

export interface SearchInput {
	query?: string;
	category?: 'mobiles' | 'tablets' | 'laptops' | 'wearables' | 'audio' | 'accessories';
	brand?: string;
	min_rating?: number;
	min_price?: number;
	max_price?: number;
	five_g?: boolean;
	in_stock_only?: boolean;
	compatible_with?: string;
	sort?: 'trending' | 'rating' | 'price_asc' | 'price_desc' | 'newest';
	limit?: number;
}

const SORTS = {
	// "Trending" = most units sold in the last 7 days, views as tie-breaker.
	trending: 'units_sold_7d DESC, views_7d DESC',
	rating: 'rating DESC, rating_count DESC',
	price_asc: 'price ASC',
	price_desc: 'price DESC',
	newest: 'launch_date DESC',
} as const;

const summary = (r: any) => ({
	id: r.id,
	title: r.title,
	price: r.price,
	mrp: r.mrp,
	rating: r.rating,
	rating_count: r.rating_count,
	sold_last_7_days: r.units_sold_7d,
	in_stock: r.stock > 0,
});

// Generic words a model often puts in `query` ("phones rated 4+"). Matching them
// against titles would wrongly narrow results to e.g. "Nothing Phone".
const GENERIC = new Set(['phone', 'phones', 'mobile', 'mobiles', 'smartphone', 'smartphones', 'best',
	'good', 'top', 'cheap', 'under', 'below', 'rated', 'rating', 'stars', 'star', 'trending', 'popular',
	'show', 'me', 'all', 'products', 'product', 'with', 'and', 'for', 'the', '5g']);

export function searchProducts({ db }: Ctx, input: SearchInput) {
	const where: string[] = [];
	const args: unknown[] = [];
	const add = (sql: string, v: unknown) => (where.push(sql), args.push(v));

	if (input.query) {
		for (const word of input.query.toLowerCase().split(/[\s,]+/).filter((w) => w && !GENERIC.has(w) && !/^[\d₹+.,k]+$/.test(w))) {
			add("lower(title || ' ' || brand) LIKE ?", `%${word}%`);
		}
	}
	if (input.category) add('category = ?', input.category);
	if (input.brand) add('lower(brand) = ?', input.brand.toLowerCase());
	if (input.min_rating != null) add('rating >= ?', input.min_rating);
	if (input.min_price != null) add('price >= ?', input.min_price);
	if (input.max_price != null) add('price <= ?', input.max_price);
	if (input.five_g) add('is_5g = ?', 1);
	if (input.in_stock_only) add('stock > ?', 0);
	if (input.compatible_with) {
		add(
			"EXISTS (SELECT 1 FROM json_each(json_extract(details,'$.compatible_with')) WHERE value = ?)",
			input.compatible_with,
		);
	}

	const filter = where.length ? 'WHERE ' + where.join(' AND ') : '';
	const total = (db.prepare(`SELECT COUNT(*) AS n FROM products ${filter}`).get(...args) as { n: number }).n;
	const rows = db.prepare(`SELECT * FROM products ${filter}
		ORDER BY ${SORTS[input.sort ?? 'trending']} LIMIT ?`).all(...args, Math.min(input.limit ?? 5, 10));
	// total_matching answers "how many products do you have?" without listing everything.
	return { total_matching: total, showing: rows.length, products: rows.map(summary) };
}

export function getProduct({ db }: Ctx, productId: string) {
	const row: any = db.prepare('SELECT * FROM products WHERE id = ?').get(productId);
	if (!row) throw new DomainError('NOT_FOUND', `No product with id ${productId}`);
	const accessories = db.prepare(
		`SELECT * FROM products WHERE EXISTS (SELECT 1 FROM
		json_each(json_extract(details,'$.compatible_with')) WHERE value = ?)`,
	).all(productId);
	const d = j(row.details);
	return {
		...summary(row),
		brand: row.brand,
		category: row.category,
		stock: row.stock,
		colors: d.colors,
		highlights: d.highlights,
		in_box: d.in_box,
		warranty: d.warranty,
		compatible_accessories: accessories.map(summary),
	};
}

export function checkDelivery({ db }: Ctx, pincode: string, productId?: string) {
	const p: any = db.prepare('SELECT * FROM pincodes WHERE pincode = ?').get(pincode);
	if (!p) {
		return { pincode, serviceable: false, message: 'We do not deliver to this pincode yet.' };
	}
	const product: any = productId
		? db.prepare('SELECT id, title, stock, price FROM products WHERE id = ?').get(productId)
		: undefined;
	return {
		pincode,
		serviceable: true,
		city: p.city,
		delivery_days: p.delivery_days,
		expected_delivery_if_ordered_today: addDays(config.today, p.delivery_days),
		cod_available: !!p.cod_available,
		...(product && { product: product.title, in_stock: product.stock > 0 }),
	};
}
