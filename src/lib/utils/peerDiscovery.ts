/*
 * Peer discovery utility for finding Cashier peers on the local network
 */

interface PeerInfo {
    peerId: string;
    deviceName: string;
    timestamp: number;
}

export class PeerDiscovery {
    private broadcastInterval: number | null = null;
    private peers: Map<string, PeerInfo> = new Map();
    private onPeersUpdated: ((peers: PeerInfo[]) => void) | null = null;
    private myPeerId: string = '';
    private deviceName: string = 'Cashier Device';
    
    constructor(myPeerId: string) {
        this.myPeerId = myPeerId;
        this.deviceName = this.getDeviceName();
    }
    
    private getDeviceName(): string {
        // Try to get a friendly device name
        try {
            // @ts-ignore - navigator.userAgentData might not be available in all browsers
            if (navigator.userAgentData && navigator.userAgentData.platform) {
                // @ts-ignore
                return `Cashier on ${navigator.userAgentData.platform}`;
            }
        } catch (e) {
            console.log('Could not get device info:', e);
        }
        
        return 'Cashier Device';
    }
    
    // Start broadcasting presence and listening for other peers
    startDiscovery() {
        // Start broadcasting our presence
        this.broadcastInterval = window.setInterval(() => {
            this.broadcastPresence();
        }, 5000); // Broadcast every 5 seconds
        
        // Start listening for broadcasts
        this.startListening();
        
        // Initial broadcast
        this.broadcastPresence();
    }
    
    // Stop discovery
    stopDiscovery() {
        if (this.broadcastInterval) {
            window.clearInterval(this.broadcastInterval);
            this.broadcastInterval = null;
        }
        this.peers.clear();
    }
    
    // Set callback for when peers are updated
    onPeersUpdatedCallback(callback: (peers: PeerInfo[]) => void) {
        this.onPeersUpdated = callback;
    }
    
    // Get current list of discovered peers (excluding self)
    getPeers(): PeerInfo[] {
        const peersArray = Array.from(this.peers.values());
        // Filter out our own peer ID and sort by timestamp (newest first)
        return peersArray
            .filter(peer => peer.peerId !== this.myPeerId)
            .sort((a, b) => b.timestamp - a.timestamp);
    }
    
    private broadcastPresence() {
        const message = JSON.stringify({
            type: 'peer-announcement',
            peerId: this.myPeerId,
            deviceName: this.deviceName,
            timestamp: Date.now()
        });
        
        // Use broadcast channel for local network discovery
        try {
            const channel = new BroadcastChannel('cashier-peer-discovery');
            channel.postMessage(message);
            channel.close();
        } catch (e) {
            console.log('Broadcast channel not available, falling back to localStorage');
            // Fallback: use localStorage for same-tab communication (limited)
            localStorage.setItem('cashier-peer-' + this.myPeerId, message);
        }
    }
    
    private startListening() {
        try {
            const channel = new BroadcastChannel('cashier-peer-discovery');
            
            channel.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    
                    if (data.type === 'peer-announcement' && data.peerId) {
                        // Update or add peer
                        this.peers.set(data.peerId, {
                            peerId: data.peerId,
                            deviceName: data.deviceName || 'Unknown Cashier Device',
                            timestamp: Date.now()
                        });
                        
                        // Notify about updated peers
                        if (this.onPeersUpdated) {
                            this.onPeersUpdated(this.getPeers());
                        }
                    }
                } catch (e) {
                    console.log('Error processing peer announcement:', e);
                }
            };
            
            // Store the channel reference so it doesn't get garbage collected
            // @ts-ignore
            window.cashierPeerDiscoveryChannel = channel;
            
        } catch (e) {
            console.log('Broadcast channel not available for listening:', e);
            // Fallback: poll localStorage for peer announcements
            this.startLocalStoragePolling();
        }
    }
    
    private startLocalStoragePolling() {
        // Fallback mechanism using localStorage polling
        const pollingInterval = window.setInterval(() => {
            // Look for peer announcements in localStorage
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key && key.startsWith('cashier-peer-')) {
                    try {
                        const value = localStorage.getItem(key);
                        if (value) {
                            const data = JSON.parse(value);
                            if (data.type === 'peer-announcement' && data.peerId) {
                                this.peers.set(data.peerId, {
                                    peerId: data.peerId,
                                    deviceName: data.deviceName || 'Unknown Cashier Device',
                                    timestamp: Date.now()
                                });
                            }
                        }
                    } catch (e) {
                        console.log('Error processing localStorage peer data:', e);
                    }
                }
            }
            
            if (this.onPeersUpdated) {
                this.onPeersUpdated(this.getPeers());
            }
        }, 2000);
        
        // @ts-ignore
        window.cashierPeerDiscoveryPollingInterval = pollingInterval;
    }
}