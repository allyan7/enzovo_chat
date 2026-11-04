import type { DB } from '../../models/db.js';

/**
 * Every module function receives this context. customerId comes from the
 * session (never from the LLM), so a tool can only ever see its own customer.
 */
export interface Ctx {
	db: DB;
	customerId: string;
}

export interface Address {
	id: string;
	label: string;
	line1: string;
	line2?: string;
	city: string;
	state: string;
	pincode: string;
	is_default: boolean;
}

export interface Customer {
	id: string;
	name: string;
	tier: 'gold' | 'silver';
	kyc: 'full' | 'minimum';
	preferences: { language: string; preferred_payment: string };
	saved_cards: {
		card_ref: string;
		network: string;
		last4: string;
		status: 'active' | 'closed';
	}[];
	saved_upi: string[];
	addresses: Address[];
}

export interface OrderItem {
	product_id: string;
	title: string;
	qty: number;
	unit_price: number;
	color?: string;
}

export interface Payment {
	id: string;
	method: 'wallet' | 'card' | 'upi' | 'cod';
	amount: number;
	status: string;
	card_ref?: string;
	vpa?: string;
	[k: string]: unknown;
}

export interface Order {
	id: string;
	customer_id: string;
	placed_at: string;
	status: string;
	address_id: string;
	items: OrderItem[];
	pricing: {
		subtotal: number;
		coupon_code: string | null;
		discount: number;
		delivery_fee: number;
		total: number;
	};
	payments: Payment[];
	shipment_id: string | null;
	delivered_at?: string;
	[k: string]: unknown;
}
