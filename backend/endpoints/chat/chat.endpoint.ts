import { Router } from 'express';
import { z } from 'zod';
import { chat, history } from '../../modules/Agents/mod.js';
import { getDb } from '../../models/db.js';
import { loadMemory, forget } from '../../modules/Memory/Memory.module.js';
import { session } from '../../middlewares/session/session.js';

const Body = z.object({
	threadId: z.string().min(1).max(64),
	message: z.string().min(1).max(1000).optional(),
	confirm: z.object({ approved: z.boolean() }).optional(),
}).refine((b) => b.message || b.confirm, 'message or confirm is required');

export const chatRouter = Router();

/** Demo user switcher (no auth). */
chatRouter.get('/customers', (_req, res) => {
	res.json(getDb().prepare('SELECT id, name, tier FROM customers ORDER BY id').all());
});

chatRouter.use(session);

chatRouter.post('/chat', async (req, res) => {
	const body = Body.safeParse(req.body);
	if (!body.success) return res.status(400).json({ error: body.error.issues[0].message });
	const started = Date.now();
	try {
		const result = await chat({ customerId: req.customerId!, ...body.data });
		res.json({ ...result, ms: Date.now() - started });
	} catch (e) {
		console.error(e);
		res.status(502).json({ error: 'The assistant is unavailable. Is Ollama running?', detail: (e as Error).message });
	}
});

chatRouter.get('/chat/:threadId', async (req, res) => {
	res.json(await history(req.customerId!, req.params.threadId as string));
});

/** Memory inspector: shows what the bot remembers (and lets the user wipe it). */
chatRouter.get('/memory', (req, res) => res.json(loadMemory(getDb(), req.customerId!)));
chatRouter.delete('/memory', (req, res) => {
	forget(getDb(), req.customerId!);
	res.json({ ok: true });
});
