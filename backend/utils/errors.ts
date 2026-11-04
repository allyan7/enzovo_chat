/**
 * A business-rule failure (not a bug). Tools return its message to the LLM
 * so the agent can explain it, e.g. "Return window closed on 15 Sep".
 */
export class DomainError extends Error {
	constructor(
		public code: string,
		message: string,
		public details?: Record<string, unknown>,
	) {
		super(message);
	}
}
