import { useEffect, useState } from 'react';
import { chatApi } from './services/api/chat';
import { useChat } from './hooks/useChat';
import type { Customer } from './types/chat';
import { ChatWindow } from './components/Chat/ChatWindow';
import { Inspector } from './components/Inspector/Inspector';
import { UserSwitcher } from './components/UserSwitcher/UserSwitcher';
import styles from './App.module.css';

export default function App() {
	const [customers, setCustomers] = useState<Customer[]>([]);
	const [customerId, setCustomerId] = useState('CUST-001');
	useEffect(() => { chatApi.customers().then(setCustomers).catch(() => setCustomers([])); }, []);

	return <Session key={customerId} customerId={customerId} customers={customers} onSwitch={setCustomerId} />;
}

function Session({ customerId, customers, onSwitch }: { customerId: string; customers: Customer[]; onSwitch: (id: string) => void }) {
	const chat = useChat(customerId);
	return (
		<div className={styles.shell}>
			<header className={styles.header}>
				<span className={styles.brand}>enzovo<span>chat</span></span>
				<div className={styles.controls}>
					<UserSwitcher customers={customers} value={customerId} onChange={onSwitch} />
					<button className={styles.ghost} onClick={chat.reset}>New chat</button>
				</div>
			</header>
			<main className={styles.main}>
				<ChatWindow messages={chat.messages} pending={chat.pending} busy={chat.busy} onSend={chat.send} onConfirm={chat.confirm} />
				<Inspector customerId={customerId} messages={chat.messages} threadId={chat.threadId} />
			</main>
		</div>
	);
}
