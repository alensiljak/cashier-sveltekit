<script lang="ts">
	import Toolbar from '$lib/components/Toolbar.svelte';
	import { onMount, onDestroy } from 'svelte';
	import { SettingKeys, settings } from '$lib/settings';
	import Notifier from '$lib/utils/notifier';

	// State (will be adapted for new WebRTC system)
	let remotePeerId: string = '';
	let messageText: string = '';
	let messages: Array<{ text: string; sender: 'me' | 'remote'; timestamp: Date }> = [];
	let connection: any = null;
	let isConnected: boolean = false;
	let myPeerId: string = '';
	let errorMessage: string = '';
	let connectionStatus: string = 'Disconnected';

	// Generate a random peer ID (will be used for new system)
	function generatePeerId(): string {
		return (
			'cashier-' +
			Math.random().toString(36).substring(2, 10) +
			'-' +
			Date.now().toString(36).substring(5)
		);
	}

	// Send message (will use WebRTC data channel)
	function sendMessage() {
		if (!messageText.trim() || !connection || !isConnected) {
			return;
		}
		// TODO: connection.send implementation
		addMessage(messageText, 'me');
		messageText = '';
	}

	// Add message to chat history
	function addMessage(text: string, sender: 'me' | 'remote') {
		messages = [
			...messages,
			{
				text,
				sender,
				timestamp: new Date()
			}
		];

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

	onDestroy(() => {
		if (connection) {
			connection.close();
		}
	});

	onMount(async () => {
		// TODO: Initialize WebRTC and IPFS signaling
		// For now, just generate a local peer ID
		const saved = await settings.get<string>(SettingKeys.peerId);
		if (saved) {
			myPeerId = saved;
		} else {
			myPeerId = generatePeerId();
		}
	});
</script>

<article class="flex h-screen flex-col">
	<Toolbar title="PeerSync" />
	<section class="space-y-4 overflow-auto p-4">
		<div class="card bg-base-200 p-4 shadow-xl">
			<h2 class="text-xl font-bold">Peer Sync Under Reconstruction</h2>
			<p class="opacity-60">
				PeerJS has been removed. A new implementation using WebRTC and IPFS signaling is in
				progress.
			</p>
		</div>
	</section>
</article>
