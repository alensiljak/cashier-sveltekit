# Ledger Sync

## Background

After implementing Rust Ledger engine, the Beancount files would be used directly. There would be no need for Cashier Sync with a remote storage.
The files would be stored offline in OPFS, offloading to a Git repository.

## Goal

The goal of this project is to provide browser sync between different devices.

## Options

### WebDAV Sync

This is a simple and direct synchronization of the files between OPFS storage and a remote WebDAV server.

Risks:

- possibility of data loss due to conflicts. Requires a merge strategy.

### Filesystem Sync

OPFS could be synchronized with a filesystem directory directly. The directory could be a Git repository.
This requires File System API access, provided only by Chromium-based browsers.

Route: `/fs-sync`.

### P2P Sync

Direct synchronization between browsers / instances of Cashier.
Requires a signalling server. This can be a simple WebDAV, for signalling data.
The synchronization happens directly, over Tailscale VPN, thereafter.

#### Signalling via Nextcloud WebDAV

The flow would be:

1. Device A writes an SDP offer to e.g. Nextcloud/cashier-signal/offer.json
2. Device B polls or is manually triggered, reads the offer, writes answer.json
3. Both exchange ICE candidates similarly (append to a candidates-a.json / candidates-b.json)
4. WebRTC connection established — Nextcloud is no longer involved
5. Clean up the signal files

#### Signalling via Custom WebRTC Server

Set up a simple WebRTC signalling server just for this purpose.

- Cloudflare Workers + KV
- PeerJS Server + PeerJS client (or `simplee-peer`)
- `0.peerjs.com`

#### Conflict Resolution

Conflict handling is manual. The conflicts should be marked and a diff displayed.
`diff` would suffice for this purpose.

#### Implementation Suggestion

- A SignallingChannel class — reads/writes to Nextcloud via WebDAV fetch calls
- A PeerSync class — wraps RTCPeerConnection and a data channel
- A SyncManager — manifest exchange, diff display, file transfer
- All wired into a "Sync" page/modal in the Svelte app

```typescript
interface SignallingChannel {
	sendOffer(peerId: string, sdp: string): Promise<void>;
	sendAnswer(peerId: string, sdp: string): Promise<void>;
	sendCandidate(peerId: string, candidate: string): Promise<void>;
	onMessage(handler: (msg: SignalMessage) => void): void;
	cleanup(): Promise<void>;
}
```

Implement for different backends:

- CloudflareSignalling
- PeerJSSignalling
- NextCloudSignalling
- WebSocketSignalling
