// npm run rag:index — re-chunks policies and embeds them with Ollama.
import { openDb } from '../../models/db.js';
import { embedPolicies, indexPolicies } from './Knowledge.module.js';

const db = openDb();
console.log(`Chunked ${indexPolicies(db)} policy sections.`);
console.log(`Embedded ${await embedPolicies(db)} chunks. search_policies now runs in hybrid mode.`);
