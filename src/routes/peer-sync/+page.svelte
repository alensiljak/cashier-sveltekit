<script lang="ts">
	import Toolbar from '$lib/components/Toolbar.svelte';
	import { onMount, onDestroy } from 'svelte';
	import { SettingKeys, settings } from '$lib/settings';
	import Notifier from '$lib/utils/notifier';
	import { PeerConnectionManager } from '$lib/webrtc/PeerConnectionManager';

	// UI State
	let myPeerId: string = '';
	let remotePeerId: string = '';
	let editablePeerId: string = '';
	let isEditingPeerId: boolean = false;

	// Offer/Answer
	let offerText: string = '';
	let answerText: string = '';
	let remoteOffer: string = '';
	let remoteAnswer: string = '';
	let isGeneratingOffer: boolean = false;
	let isGeneratingAnswer: boolean = false;
	let isAcceptingAnswer: boolean = false;
	let isAcceptingOffer: boolean = false;

	// Panel visibility
	let activePanel: 'generate' | 'accept' | null = null;

	// Connection & Chat
	let connectionManager: PeerConnectionManager | null = null;
	let connectionStatus: 'disconnected' | 'connecting' | 'connected' | 'failed' = 'disconnected';
	let messageText: string = '';
	let messages: Array<{ text: string; sender: 'me' | 'remote'; timestamp: Date }> = [];

	// Generate a random peer ID
	function generatePeerId(): string {
		return (
			'cashier-' +
			Math.random().toString(36).substring(2, 10) +
			'-' +
			Date.now().toString(36).substring(5)
		);
	}

	// Copy text to clipboard and notify
	async function copyToClipboard(text: string, successMessage: string): Promise<boolean> {
		try {
			await navigator.clipboard.writeText(text);
			Notifier.success(successMessage);
			return true;
		} catch (error) {
			Notifier.error('Failed to copy to clipboard');
			console.error('Clipboard error:', error);
			return false;
		}
	}

	// Validate SDP format
	function isValidSdp(sdp: string): boolean {
		return sdp.includes('v=') && sdp.includes('o=') && sdp.includes('s=');
	}

	// Initialize peer ID from settings
	onMount(async () => {
		const saved = await settings.get<string>(SettingKeys.peerId);
		if (saved) {
			myPeerId = saved;
			editablePeerId = saved;
		} else {
			myPeerId = generatePeerId();
			editablePeerId = myPeerId;
			await settings.set(SettingKeys.peerId, myPeerId);
		}
	});

	// Save peer ID when edited
	async function savePeerId(): Promise<void> {
		const newId = editablePeerId.trim();
		if (!newId) {
			Notifier.error('Peer ID cannot be empty');
			return;
		}
		myPeerId = newId;
		await settings.set(SettingKeys.peerId, newId);
		isEditingPeerId = false;
		Notifier.success('Peer ID saved');
	}

	// Generate Offer
	async function generateOffer(): Promise<void> {
		if (!myPeerId) {
			Notifier.error('Please set your Peer ID first');
			return;
		}

		isGeneratingOffer = true;
		offerText = '';
		remoteOffer = '';
		remoteAnswer = '';
		answerText = '';

		try {
			connectionManager = new PeerConnectionManager(myPeerId);

			connectionManager.onConnectionStateChange = (state) => {
				connectionStatus = state as 'disconnected' | 'connecting' | 'connected' | 'failed';
			};

			connectionManager.onIceGatheringComplete = (sdp) => {
				offerText = sdp;
				isGeneratingOffer = false;
				Notifier.success('Offer generated! Copy and send to remote peer.');
			};

			connectionManager.onError = (error) => {
				console.error('Connection error:', error);
				Notifier.error('Connection error: ' + error.message);
				isGeneratingOffer = false;
			};

			connectionManager.onMessage = (msg) => {
				addMessage(msg, 'remote');
			};

			// Start generating offer (this triggers ICE gathering)
			await connectionManager.createOffer();
		} catch (error) {
			console.error('Offer generation error:', error);
			Notifier.error('Failed to generate offer: ' + (error as Error).message);
			isGeneratingOffer = false;
		}
	}

	// Process Remote Offer (Generate Answer)
	async function processOffer(): Promise<void> {
		if (!remoteOffer.trim()) {
			Notifier.error('Please paste the offer');
			return;
		}

		if (!isValidSdp(remoteOffer)) {
			Notifier.error('Invalid offer format');
			return;
		}

		if (!myPeerId) {
			Notifier.error('Please set your Peer ID first');
			return;
		}

		isGeneratingAnswer = true;
		answerText = '';

		try {
			// Create new connection manager if not exists
			if (!connectionManager) {
				connectionManager = new PeerConnectionManager(myPeerId);

				connectionManager.onConnectionStateChange = (state) => {
					connectionStatus = state as 'disconnected' | 'connecting' | 'connected' | 'failed';
				};

				connectionManager.onMessage = (msg) => {
					addMessage(msg, 'remote');
				};

				connectionManager.onError = (error) => {
					console.error('Connection error:', error);
					Notifier.error('Connection error: ' + error.message);
					isGeneratingAnswer = false;
				};
			}

			connectionManager.onIceGatheringComplete = (sdp) => {
				answerText = sdp;
				isGeneratingAnswer = false;
				Notifier.success('Answer generated! Copy and send back to the remote peer.');
			};

			// Generate answer from offer
			await connectionManager.acceptOffer(remoteOffer, myPeerId);
		} catch (error) {
			console.error('Answer generation error:', error);
			Notifier.error('Failed to process offer: ' + (error as Error).message);
			isGeneratingAnswer = false;
		}
	}

	// Process Remote Answer (Complete Connection)
	async function processAnswer(): Promise<void> {
		if (!remoteAnswer.trim()) {
			Notifier.error('Please paste the answer');
			return;
		}

		if (!isValidSdp(remoteAnswer)) {
			Notifier.error('Invalid answer format');
			return;
		}

		if (!connectionManager) {
			Notifier.error('No active connection. Generate an offer first.');
			return;
		}

		isAcceptingAnswer = true;

		try {
			await connectionManager.acceptAnswer(remoteAnswer);
			Notifier.success('Connection established!');
		} catch (error) {
			console.error('Answer processing error:', error);
			Notifier.error('Failed to establish connection: ' + (error as Error).message);
		} finally {
			isAcceptingAnswer = false;
		}
	}

	// Send Message
	function sendMessage(): void {
		if (!messageText.trim() || !connectionManager) {
			return;
		}

		try {
			connectionManager.sendMessage(messageText);
			addMessage(messageText, 'me');
			messageText = '';
		} catch (error) {
			Notifier.error('Failed to send message: ' + (error as Error).message);
		}
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

	// Disconnect
	function disconnect(): void {
		if (connectionManager) {
			connectionManager.close();
			connectionManager = null;
		}
		connectionStatus = 'disconnected';
		messages = [];
		offerText = '';
		answerText = '';
		remoteOffer = '';
		remoteAnswer = '';
		Notifier.info('Disconnected');
	}

	onDestroy(() => {
		if (connectionManager) {
			connectionManager.close();
		}
	});
</script>

<article class="flex h-screen flex-col">
	<Toolbar title="Peer Sync" />
	<section class="flex-1 space-y-4 overflow-auto p-4">
		<!-- Peer ID Card -->
		<div class="card bg-base-200 shadow-xl">
			<div class="card-body p-4">
				<h2 class="card-title text-lg">Your Peer ID</h2>
				<div class="flex gap-2">
					{#if isEditingPeerId}
						<input
							type="text"
							bind:value={editablePeerId}
							class="input input-bordered flex-1"
							placeholder="Enter custom peer ID"
							on:keydown={(e) => e.key === 'Enter' && savePeerId()}
						/>
						<button class="btn btn-primary" on:click={savePeerId}>Save</button>
						<button class="btn btn-secondary" on:click={() => (isEditingPeerId = false)}
							>Cancel</button
						>
					{:else}
						<input
							type="text"
							value={myPeerId}
							readonly
							class="input input-bordered bg-base-300 flex-1"
						/>
						<button class="btn btn-outline" on:click={() => (isEditingPeerId = true)}>Edit</button>
						<button
							class="btn btn-primary"
							on:click={() => copyToClipboard(myPeerId, 'Peer ID copied to clipboard')}
						>
							Copy
						</button>
					{/if}
				</div>
			</div>
		</div>

		<!-- Status Card -->
		<div class="card bg-base-200 shadow-xl">
			<div class="card-body p-4">
				<div class="flex items-center justify-between">
					<h2 class="card-title text-lg">Connection Status</h2>
					<div class="flex items-center gap-2">
						<span
							class="status status-{connectionStatus === 'connected'
								? 'success'
								: connectionStatus === 'failed'
									? 'error'
									: 'warning'}"
						></span>
						<span class="capitalize">{connectionStatus}</span>
					</div>
				</div>
				{#if connectionManager}
					<button class="btn btn-error btn-outline btn-sm mt-2" on:click={disconnect}>
						Disconnect
					</button>
				{/if}
			</div>
		</div>

		<!-- Panel Selection Buttons -->
		<div class="flex gap-2">
			<button
				class="btn btn-primary flex-1"
				class:btn-outline={activePanel !== 'generate'}
				on:click={() => (activePanel = activePanel === 'generate' ? null : 'generate')}
			>
				Generate Offer
			</button>
			<button
				class="btn btn-primary flex-1"
				class:btn-outline={activePanel !== 'accept'}
				on:click={() => (activePanel = activePanel === 'accept' ? null : 'accept')}
			>
				Accept Offer
			</button>
		</div>

		<!-- Create Offer Panel -->
		{#if activePanel === 'generate'}
			<div class="card bg-base-200 shadow-xl">
				<div class="card-body p-4">
					<h2 class="card-title text-lg">Create Offer</h2>
					<p class="text-sm opacity-70">Generate an offer to connect to a remote peer.</p>

					{#if isGeneratingOffer}
						<div class="alert alert-info">
							<span class="loading loading-spinner"></span>
							Gathering ICE candidates...
						</div>
					{/if}

					{#if offerText}
						<div class="form-control mt-4">
							<label class="label" for="offer-output">
								<span class="label-text">Your Offer (copy and send to remote peer)</span>
							</label>
							<textarea
								id="offer-output"
								bind:value={offerText}
								readonly
								class="textarea textarea-bordered h-32 font-mono text-xs"
							></textarea>
							<button
								class="btn btn-primary mt-2"
								on:click={() => copyToClipboard(offerText, 'Offer copied to clipboard')}
							>
								Copy Offer to Clipboard
							</button>

							<div class="mt-4">
								<label class="label" for="remote-answer-input">
									<span class="label-text"
										>Remote Peer's Answer (paste here to establish connection)</span
									>
								</label>
								<textarea
									id="remote-answer-input"
									bind:value={remoteAnswer}
									placeholder="Paste answer here to establish connection..."
									class="textarea textarea-bordered h-32 font-mono text-xs"
									disabled={isAcceptingAnswer || connectionStatus === 'connected'}
								></textarea>
								<button
									class="btn btn-primary mt-2"
									on:click={processAnswer}
									disabled={isAcceptingAnswer || connectionStatus === 'connected'}
								>
									Accept Answer & Connect
								</button>
							</div>
						</div>
					{:else}
						<button
							class="btn btn-primary mt-2"
							on:click={generateOffer}
							disabled={isGeneratingOffer || !myPeerId}
						>
							Generate Offer
						</button>
					{/if}
				</div>
			</div>
		{/if}

		<!-- Accept Offer Panel -->
		{#if activePanel === 'accept'}
			<div class="card bg-base-200 shadow-xl">
				<div class="card-body p-4">
					<h2 class="card-title text-lg">Accept Offer</h2>
					<p class="text-sm opacity-70">
						Paste the offer received from a remote peer and generate an answer.
					</p>

					{#if isGeneratingAnswer}
						<div class="alert alert-info">
							<span class="loading loading-spinner"></span>
							Gathering ICE candidates...
						</div>
					{/if}

					{#if answerText}
						<div class="form-control mt-4">
							<label class="label" for="answer-output">
								<span class="label-text">Your Answer (copy and send back to remote peer)</span>
							</label>
							<textarea
								id="answer-output"
								bind:value={answerText}
								readonly
								class="textarea textarea-bordered h-32 font-mono text-xs"
							></textarea>
							<button
								class="btn btn-primary mt-2"
								on:click={() => copyToClipboard(answerText, 'Answer copied to clipboard')}
							>
								Copy Answer to Clipboard
							</button>
						</div>
					{:else}
						<div class="form-control mt-4">
							<label class="label" for="remote-offer-input">
								<span class="label-text">Remote Peer's Offer</span>
							</label>
							<textarea
								id="remote-offer-input"
								bind:value={remoteOffer}
								placeholder="Paste offer here..."
								class="textarea textarea-bordered h-32 font-mono text-xs"
							></textarea>
							<button
								class="btn btn-primary mt-2"
								on:click={processOffer}
								disabled={isGeneratingAnswer}
							>
								Enter Offer & Generate Answer
							</button>
						</div>
					{/if}
				</div>
			</div>
		{/if}

		<!-- Chat Section -->
		{#if connectionStatus === 'connected'}
			<div class="card bg-base-200 shadow-xl">
				<div class="card-body p-4">
					<h2 class="card-title text-lg">Chat</h2>
					<div class="flex h-96 flex-col">
						<!-- Messages -->
						<div id="chat-messages" class="bg-base-300 mb-4 flex-1 overflow-y-auto rounded-lg p-3">
							{#if messages.length === 0}
								<p class="text-center text-sm opacity-60">No messages yet</p>
							{/if}
							{#each messages as msg}
								<div class="chat {msg.sender === 'me' ? 'chat-end' : 'chat-start'} mb-2">
									<div class="chat-header text-xs opacity-60">
										{msg.sender === 'remote' ? 'Remote' : 'You'}
										<span class="mx-1">•</span>
										{formatTime(msg.timestamp)}
									</div>
									<div class="chat-bubble {msg.sender === 'me' ? 'chat-bubble-primary' : ''}">
										{msg.text}
									</div>
								</div>
							{/each}
						</div>

						<!-- Input -->
						<div class="flex gap-2">
							<input
								type="text"
								bind:value={messageText}
								placeholder="Type a message..."
								class="input input-bordered flex-1"
								on:keydown={(e) =>
									e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), sendMessage())}
							/>
							<button class="btn btn-primary" on:click={sendMessage} disabled={!messageText.trim()}>
								Send
							</button>
						</div>
					</div>
				</div>
			</div>
		{/if}
	</section>
</article>
