// Session middleware: decides WHO the customer is.
// POC: the UI sends `x-customer-id` (a demo user switcher). In production this
// would verify a JWT and read the subject claim. Either way, identity is set
// here, before any LLM runs, and agents/tools only ever read it from context.
import type { NextFunction, Request, Response } from 'express';
import { getDb } from '../../models/db.js';

declare global {
	namespace Express {
		interface Request { customerId?: string }
	}
}

export function session(req: Request, res: Response, next: NextFunction) {
	const id = req.header('x-customer-id');
	const exists = id && getDb().prepare('SELECT 1 FROM customers WHERE id = ?').get(id);
	if (!exists) return res.status(401).json({ error: 'Unknown or missing customer' });
	req.customerId = id;
	next();
}
