/**
 * Manages WebRTC peer-to-peer connections using RTCPeerConnection.
 * Optimized for Tailscale network (no STUN/TURN servers).
 */
export class PeerConnectionManager {
	private peerConnection: RTCPeerConnection | null = null;
	private dataChannel: RTCDataChannel | null = null;
	private localPeerId: string;
	private remotePeerId: string | null = null;
	private _connectionState: 'new' | 'connecting' | 'connected' | 'disconnected' | 'failed' = 'new';
	private iceCandidates: string[] = [];

	// Event handlers
	public onIceGatheringComplete: ((sdp: string) => void) | null = null;
	public onConnectionStateChange: ((state: string) => void) | null = null;
	public onMessage: ((message: string) => void) | null = null;
	public onError: ((error: Error) => void) | null = null;
	public onIceCandidate: ((candidate: RTCIceCandidate) => void) | null = null;

	constructor(localPeerId: string) {
		this.localPeerId = localPeerId;
	}

	/**
	 * Creates an offer to initiate a connection.
	 * Returns a promise that resolves when ICE gathering is complete and the offer SDP is ready.
	 */
	async createOffer(): Promise<string> {
		this.initializePeerConnection();

		// Create data channel
		this.dataChannel = this.peerConnection!.createDataChannel('messages', {
			ordered: true
		});
		console.log('[WebRTC] Created data channel');
		this.setupDataChannel(this.dataChannel);

		// Create offer
		console.log('[WebRTC] Creating offer...');
		const offer = await this.peerConnection!.createOffer();
		console.log('[WebRTC] Offer created, setting local description...');
		await this.peerConnection!.setLocalDescription(offer);
		console.log('[WebRTC] Local description set, waiting for ICE gathering...');

		// Wait for ICE gathering to complete
		await this.waitForIceGatheringComplete();

		if (!this.peerConnection!.localDescription) {
			throw new Error('Failed to generate offer: no local description');
		}

		const sdp = this.peerConnection!.localDescription.sdp.replace(/^a=sendrecv\r?\n/m, '');
		if (this.onIceGatheringComplete) {
			this.onIceGatheringComplete(sdp);
		}
		return sdp;
	}

	/**
	 * Accepts an incoming offer and generates an answer.
	 * Returns a promise that resolves when ICE gathering is complete and the answer SDP is ready.
	 */
	async acceptOffer(offerSdp: string, remotePeerId: string): Promise<string> {
		this.remotePeerId = remotePeerId;
		this.initializePeerConnection();

		// Set remote description (the offer)
		const offerDescription = new RTCSessionDescription({
			type: 'offer',
			sdp: offerSdp
		});
		await this.peerConnection!.setRemoteDescription(offerDescription);

		// Listen for data channel from remote peer
		this.peerConnection!.ondatachannel = (event) => {
			this.dataChannel = event.channel;
			this.setupDataChannel(this.dataChannel);
		};

		// Create answer
		const answer = await this.peerConnection!.createAnswer();
		await this.peerConnection!.setLocalDescription(answer);

		// Wait for ICE gathering to complete
		await this.waitForIceGatheringComplete();

		if (!this.peerConnection!.localDescription) {
			throw new Error('Failed to generate offer: no local description');
		}

		const sdp = this.peerConnection!.localDescription.sdp.replace(/^a=sendrecv\r?\n/m, '');
		if (this.onIceGatheringComplete) {
			this.onIceGatheringComplete(sdp);
		}
		return sdp;
	}

	/**
	 * Accepts an incoming answer to complete the connection.
	 */
	async acceptAnswer(answerSdp: string): Promise<void> {
		if (!this.peerConnection) {
			throw new Error('Cannot accept answer: no active peer connection');
		}

		const answerDescription = new RTCSessionDescription({
			type: 'answer',
			sdp: answerSdp
		});
		await this.peerConnection.setRemoteDescription(answerDescription);
	}

	/**
	 * Adds a remote ICE candidate to the peer connection.
	 */
	async addIceCandidate(candidateStr: string): Promise<void> {
		if (!this.peerConnection) {
			throw new Error('Cannot add ICE candidate: no active peer connection');
		}

		try {
			const candidate = new RTCIceCandidate({ candidate: candidateStr });
			await this.peerConnection.addIceCandidate(candidate);
			console.log('[WebRTC] Added remote ICE candidate:', candidateStr);
		} catch (error) {
			console.error('Error adding ICE candidate:', error);
			throw error;
		}
	}

	/**
	 * Sends a text message over the data channel.
	 */
	sendMessage(message: string): void {
		if (!this.dataChannel || this.dataChannel.readyState !== 'open') {
			throw new Error('Cannot send message: data channel not open');
		}
		this.dataChannel.send(message);
	}

	/**
	 * Closes the connection and cleans up resources.
	 */
	close(): void {
		if (this.dataChannel) {
			this.dataChannel.close();
			this.dataChannel = null;
		}
		if (this.peerConnection) {
			this.peerConnection.close();
			this.peerConnection = null;
		}
		this._connectionState = 'disconnected';
		this.remotePeerId = null;
	}

	get connectionState(): string {
		return this._connectionState;
	}

	get peerId(): string {
		return this.localPeerId;
	}

	/**
	 * Gets all collected ICE candidates as a newline-separated string.
	 */
	getIceCandidatesText(): string {
		return this.iceCandidates.join('\n');
	}

	/**
	 * Clears stored ICE candidates. Call when connection is closed.
	 */
	clearIceCandidates(): void {
		this.iceCandidates = [];
	}

	private initializePeerConnection(): void {
		this._connectionState = 'new';

		const config: RTCConfiguration = {
			iceServers: [],
			iceTransportPolicy: 'all'
		};

		this.peerConnection = new RTCPeerConnection(config);

		console.log('[WebRTC] Created peer connection with config:', config);
		console.log('[WebRTC] Local peer ID:', this.localPeerId);

		// ICE candidate handling
		this.peerConnection.onicecandidate = (event) => {
			if (event.candidate) {
				const candidateStr = event.candidate.candidate;
				console.log('[WebRTC] ICE candidate gathered:', {
					type: event.candidate.type,
					protocol: event.candidate.protocol,
					address: event.candidate.address,
					port: event.candidate.port
				});
				// Store candidate for later copying
				this.iceCandidates.push(candidateStr);
				// Notify external handler to send candidate to remote peer
				if (this.onIceCandidate) {
					this.onIceCandidate(event.candidate);
				}
			} else {
				console.log('[WebRTC] ICE candidate gathering completed (null candidate)');
			}
		};

		this.peerConnection.oniceconnectionstatechange = () => {
			const state = this.peerConnection?.iceConnectionState;
			if (state) {
				console.log('[WebRTC] ICE connection state:', state);
				if (state === 'connected' || state === 'completed') {
					this._connectionState = 'connected';
				} else if (state === 'disconnected' || state === 'failed') {
					this._connectionState = state as 'disconnected' | 'failed';
				}

				if (this.onConnectionStateChange) {
					this.onConnectionStateChange(state);
				}
			}
		};

		this.peerConnection.onconnectionstatechange = () => {
			const state = this.peerConnection?.connectionState;
			if (state && this.onConnectionStateChange) {
				this.onConnectionStateChange(state);
			}
		};

		this.peerConnection.onicecandidateerror = (error) => {
			console.error('ICE candidate error:', error);
			if (this.onError) {
				this.onError(new Error('ICE candidate error'));
			}
		};
	}

	private setupDataChannel(channel: RTCDataChannel): void {
		channel.onopen = () => {
			this._connectionState = 'connected';
			if (this.onConnectionStateChange) {
				this.onConnectionStateChange('connected');
			}
		};

		channel.onclose = () => {
			if (this._connectionState !== 'failed') {
				this._connectionState = 'disconnected';
				if (this.onConnectionStateChange) {
					this.onConnectionStateChange('disconnected');
				}
			}
		};

		channel.onerror = (error) => {
			console.error('Data channel error:', error);
			if (this.onError) {
				this.onError(new Error('Data channel error'));
			}
		};

		channel.onmessage = (event) => {
			if (this.onMessage) {
				this.onMessage(event.data);
			}
		};
	}

	private waitForIceGatheringComplete(): Promise<void> {
		return new Promise((resolve, reject) => {
			if (!this.peerConnection) {
				reject(new Error('No peer connection'));
				return;
			}

			// If already complete, resolve immediately
			if (this.peerConnection.iceGatheringState === 'complete') {
				console.log('[WebRTC] ICE already complete');
				resolve();
				return;
			}

			let gatheringDone = false;
			const done = () => {
				if (gatheringDone) return;
				gatheringDone = true;
				this.peerConnection?.removeEventListener('icegatheringstatechange', checkState);
				console.log('[WebRTC] ICE gathering resolved');
				resolve();
			};

			const fail = (error: Error) => {
				if (gatheringDone) return;
				gatheringDone = true;
				this.peerConnection?.removeEventListener('icegatheringstatechange', checkState);
				reject(error);
			};

			const checkState = () => {
				const pc = this.peerConnection;
				if (!pc) {
					fail(new Error('Peer connection closed during ICE gathering'));
					return;
				}
				const state = pc.iceGatheringState;
				console.log('[WebRTC] ICE gathering state:', state);
				if (state === 'complete') {
					done();
				}
				// Note: iceGatheringState does not have a 'failed' state; failures show as 'new' or 'gathering' with no candidates
			};

			// Also listen for the last ICE candidate (null) as a completion signal
			this.peerConnection.addEventListener('icecandidate', (event) => {
				if (event.candidate === null) {
					console.log('[WebRTC] Received null ICE candidate (end of candidates)');
					// Give a small delay for state to update
					setTimeout(() => {
						if (this.peerConnection?.iceGatheringState === 'complete') {
							done();
						} else if (!gatheringDone) {
							// Force complete if we got null candidate but state hasn't updated
							console.log('[WebRTC] Forcing completion after null candidate');
							done();
						}
					}, 100);
				}
			});

			this.peerConnection.addEventListener('icegatheringstatechange', checkState);

			// Timeout after 60 seconds
			setTimeout(() => {
				fail(new Error('ICE gathering timeout'));
			}, 60000);
		});
	}
}
