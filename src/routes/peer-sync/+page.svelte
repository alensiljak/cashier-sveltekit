<script lang="ts">
	import Toolbar from '$lib/components/Toolbar.svelte';
	import { onMount, onDestroy } from 'svelte';

	// Import PeerJS
	import Peer from 'peerjs';

	// State variables
	let peerId: string = '';
	let remotePeerId: string = '';
	let messageText: string = '';
	let messages: Array<{text: string, sender: 'me' | 'remote', timestamp: Date}> = [];
	let peer: any = null;
	let connection: any = null;
	let isConnected: boolean = false;
	let myPeerId: string = '';
	let errorMessage: string = '';
	let isPeerReady: boolean = false;
	let connectionStatus: string = 'Disconnected';

	// Generate a random peer ID
	function generatePeerId(): string {
		return 'cashier-' + Math.random().toString(36).substring(2, 10) + '-' + Date.now().toString(36).substring(5);
	}

	// Initialize peer connection
	function initPeer() {
		try {
			if (peer) {
				peer.destroy();
			}

			myPeerId = generatePeerId();
			peer = new Peer(myPeerId, {
				host: '0.peerjs.com',
				port: 443,
				path: '/'
			});

			peer.on('open', (id: string) => {
				console.log('My peer ID is: ' + id);
				myPeerId = id;
				isPeerReady = true;
				connectionStatus = 'Ready to connect';
				errorMessage = '';
			});

			peer.on('error', (err: any) => {
				console.error('Peer error:', err);
				errorMessage = 'Peer connection error: ' + err.message;
			});

			peer.on('connection', (conn: any) => {
				console.log('Received connection from: ' + conn.peer);
				handleConnection(conn);
			});

		} catch (err) {
			console.error('Error initializing peer:', err);
			errorMessage = 'Error initializing peer: ' + (err as Error).message;
		}
	}

	// Handle incoming connection
	function handleConnection(conn: any) {
		connection = conn;

		conn.on('open', () => {
			isConnected = true;
			connectionStatus = 'Connected to ' + conn.peer;
			console.log('Connected to: ' + conn.peer);
			addMessage('Connected to ' + conn.peer, 'remote');
			errorMessage = '';
		});

		conn.on('data', (data: any) => {
			console.log('Received message:', data);
			addMessage(data, 'remote');
		});

		conn.on('close', () => {
			isConnected = false;
			connectionStatus = 'Disconnected';
			console.log('Connection closed');
			addMessage('Connection closed', 'remote');
		});

		conn.on('error', (err: any) => {
			console.error('Connection error:', err);
			errorMessage = 'Connection error: ' + err.message;
		});
	}

	// Connect to remote peer
	function connectToPeer() {
		if (!remotePeerId) {
			errorMessage = 'Please enter a remote peer ID';
			return;
		}

		try {
			if (connection) {
				connection.close();
			}

			connection = peer.connect(remotePeerId);
			handleConnection(connection);

		} catch (err) {
			console.error('Error connecting to peer:', err);
			errorMessage = 'Error connecting to peer: ' + (err as Error).message;
		}
	}

	// Send message
	function sendMessage() {
		if (!messageText.trim() || !connection || !isConnected) {
			return;
		}

		try {
			connection.send(messageText);
			addMessage(messageText, 'me');
			messageText = '';

		} catch (err) {
			console.error('Error sending message:', err);
			errorMessage = 'Error sending message: ' + (err as Error).message;
		}
	}

	// Add message to chat history
	function addMessage(text: string, sender: 'me' | 'remote') {
		messages = [...messages, {
			text,
			sender,
			timestamp: new Date()
		}];

		// Auto-scroll to bottom
		setTimeout(() => {
			const chatMessages = document.getElementById('chat-messages');
			if (chatMessages) {
				chatMessages.scrollTop = chatMessages.scrollHeight;
			}
		}, 50);
	}

	// Format timestamp
	function formatTime(timestamp: Date): string {
		return timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
	}

	// Cleanup on component destroy
	onDestroy(() => {
		if (connection) {
			connection.close();
		}
		if (peer) {
			peer.destroy();
		}
	});

	// Initialize peer on mount
	onMount(() => {
		initPeer();
	});
</script>

<article class="flex h-screen flex-col">
	<Toolbar title="PeerSync"></Toolbar>

	<section class="space-y-4 overflow-auto p-4">
		<div class="card bg-base-200 shadow-xl p-4 mb-4">
			<h2 class="text-xl font-bold mb-4">Peer Connection</h2>
			<div class="alert alert-info mb-4">
				<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" class="stroke-current shrink-0 w-6 h-6"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
				<span>1. Share your Peer ID with the remote device. 2. Enter their Peer ID and click Connect. 3. Start chatting!</span>
			</div>

			<div class="form-control mb-4">
				<label class="label">
					<span class="label-text">Your Peer ID</span>
				</label>
				<div class="input-group">
					<input type="text" value={myPeerId} readonly class="input input-bordered w-full" />
					<button class="btn btn-square" on:click={initPeer} title="Generate new ID">
						<svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h5M20 20v-5h-5M4 20h5v-5M20 4h-5v5" />
						</svg>
					</button>
					<button class="btn btn-square" on:click={() => navigator.clipboard.writeText(myPeerId)} disabled={!myPeerId} title="Copy to clipboard">
						<svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
						</svg>
					</button>
				</div>
				<div class="mt-2">
					<span class="badge {isPeerReady ? 'badge-success' : 'badge-warning'}">
						{connectionStatus}
					</span>
				</div>
				{#if isConnected}
					<div class="mt-2">
						<button class="btn btn-error btn-sm" on:click={() => {
							if (connection) connection.close();
							isConnected = false;
							connectionStatus = 'Disconnected';
							addMessage('Disconnected from remote peer', 'me');
						}}>
							Disconnect
						</button>
					</div>
				{/if}
			</div>

			<div class="form-control mb-4">
				<label class="label">
					<span class="label-text">Remote Peer ID</span>
				</label>
				<div class="input-group">
					<input type="text" bind:value={remotePeerId} placeholder="Enter remote peer ID" class="input input-bordered w-full" />
					<button class="btn {isConnected ? 'btn-success' : 'btn-primary'}" on:click={connectToPeer} disabled={!remotePeerId || !isPeerReady}>
						{isConnected ? 'Connected' : 'Connect'}
					</button>
				</div>
			</div>

			{#if errorMessage}
				<div class="alert alert-error mb-4">
					<svg xmlns="http://www.w3.org/2000/svg" class="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
					<span>{errorMessage}</span>
				</div>
			{/if}
		</div>

		<div class="card bg-base-200 shadow-xl p-4 flex-1">
			<h2 class="text-xl font-bold mb-4">Chat</h2>

			<div class="flex flex-col h-full">
				<div class="flex-1 overflow-auto mb-4 space-y-2 p-2" id="chat-messages" style="max-height: 400px;">
					{#each messages as message (message.timestamp)}
						<div class="chat {message.sender === 'me' ? 'chat-end' : 'chat-start'}">
							<div class="chat-bubble {message.sender === 'me' ? 'chat-bubble-primary' : 'chat-bubble-secondary'} break-words max-w-xs md:max-w-md">
								{message.text}
							</div>
							<div class="chat-footer opacity-50 text-xs mt-1">
								{formatTime(message.timestamp)}
							</div>
						</div>
					{/each}
				</div>

				<div class="form-control mt-4">
					<div class="input-group">
						<input type="text" bind:value={messageText}
								placeholder="Type a message..."
								class="input input-bordered w-full"
								on:keydown={e => e.key === 'Enter' && sendMessage()}
								disabled={!isConnected} />
						<button class="btn btn-primary" on:click={sendMessage} disabled={!isConnected || !messageText.trim()}>
							Send
						</button>
					</div>
				</div>
			</div>
		</div>
	</section>
</article>
