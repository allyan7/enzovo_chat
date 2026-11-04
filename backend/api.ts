// API entrypoint (like api.ts in 42-services).
import express from 'express';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { config } from './configs/app.config.js';
import { chatRouter } from './endpoints/chat/chat.endpoint.js';

const app = express();
app.use(express.json({ limit: '32kb' }));
app.get('/health', (_req, res) => res.json({ ok: true, model: config.llmModel, today: config.today }));
app.use('/api', chatRouter);

// In Docker/production the API also serves the built React app.
const web = fileURLToPath(new URL('../frontend/dist', import.meta.url));
if (existsSync(web)) {
	app.use(express.static(web));
	app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(`${web}/index.html`));
}

app.listen(config.port, () => {
	console.log(`enzovo_chat API on http://localhost:${config.port} (model ${config.llmModel})`);
});
