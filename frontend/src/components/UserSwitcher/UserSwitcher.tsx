import type { Customer } from '../../types/chat';

interface Props {
	customers: Customer[];
	value: string;
	onChange: (id: string) => void;
}

/** Demo login: picks which seeded customer the session belongs to. */
export function UserSwitcher({ customers, value, onChange }: Props) {
	return (
		<select value={value} onChange={(e) => onChange(e.target.value)} aria-label="Customer">
			{customers.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.tier})</option>)}
		</select>
	);
}
