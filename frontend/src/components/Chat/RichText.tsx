import type { ReactNode } from 'react';

/** Renders the small markdown subset the model uses (**bold**, "- " lists,
 * paragraphs) as React nodes. No HTML injection: everything is text nodes. */
function inline(text: string): ReactNode[] {
	return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
		part.startsWith('**') && part.endsWith('**') ? <strong key={i}>{part.slice(2, -2)}</strong> : part,
	);
}

export function RichText({ text }: { text: string }) {
	const blocks: ReactNode[] = [];
	let list: string[] = [];
	const flush = () => {
		if (list.length) blocks.push(<ul key={`l${blocks.length}`}>{list.map((li, i) => <li key={i}>{inline(li)}</li>)}</ul>);
		list = [];
	};
	for (const line of text.split('\n')) {
		const item = line.match(/^\s*(?:[-*•]|\d+\.)\s+(.*)$/);
		if (item) { list.push(item[1]); continue; }
		flush();
		if (line.trim()) blocks.push(<p key={`p${blocks.length}`}>{inline(line)}</p>);
	}
	flush();
	return <>{blocks}</>;
}
