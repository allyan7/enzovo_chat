import { config } from '../configs/app.config.js';

/** "Now" in IST, pinned to ENZOVO_TODAY so seed scenarios stay consistent. */
export function nowIso(): string {
	const t = new Date().toISOString().slice(11, 19);
	return `${config.today}T${t}+05:30`;
}

export const dateOnly = (iso: string) => iso.slice(0, 10);

export function addDays(date: string, n: number): string {
	const d = new Date(`${dateOnly(date)}T00:00:00Z`);
	d.setUTCDate(d.getUTCDate() + n);
	return d.toISOString().slice(0, 10);
}

/** Adds business days (skips Sat/Sun), matching the refund-timeline policy. */
export function addBusinessDays(date: string, n: number): string {
	const d = new Date(`${dateOnly(date)}T00:00:00Z`);
	while (n > 0) {
		d.setUTCDate(d.getUTCDate() + 1);
		if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) n--;
	}
	return d.toISOString().slice(0, 10);
}

/** Whole days from a to b (date parts only). */
export const daysBetween = (a: string, b: string) =>
	Math.round(
		(Date.parse(dateOnly(b)) - Date.parse(dateOnly(a))) / 86_400_000,
	);
