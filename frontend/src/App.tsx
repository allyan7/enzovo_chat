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
	const customer = customers.find((c) => c.id === customerId);

	return <Session key={customerId} customer={customer} customerId={customerId} customers={customers} onSwitch={setCustomerId} />;
}

interface SessionProps {
	customer?: Customer;
	customerId: string;
	customers: Customer[];
	onSwitch: (id: string) => void;
}

function Session({ customer, customerId, customers, onSwitch }: SessionProps) {
	const chat = useChat(customerId);
	return (
		<div className={styles.shell}>
			<header className={styles.header}>
				<div className={styles.brand}>
					<span className={styles.logo} aria-hidden="true">e</span>
					enzovo <small>support</small>
				</div>
				<div className={styles.controls}>
					<UserSwitcher customers={customers} value={customerId} onChange={onSwitch} />
					<button className={styles.ghost} onClick={chat.reset}>New chat</button>
				</div>
			</header>
			<main className={styles.main}>
				<ChatWindow customerName={customer?.name ?? 'there'} messages={chat.messages} pending={chat.pending} busy={chat.busy} onSend={chat.send} onConfirm={chat.confirm} />
				<Inspector customer={customer} messages={chat.messages} threadId={chat.threadId} />
			</main>
		</div>
	);
}
