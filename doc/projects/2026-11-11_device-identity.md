# Device Identity: Public-Key Pairing for Multi-Device Sync

Status: planned, not started.

## Problem

Device identity is a random UUID (`getDeviceId()` in [ydocDevices.ts](/src/lib/sync/ydocDevices.ts)). Each device announces it in plain text in its `hello` message, and trust is decided by ID alone ([peerPresence.svelte.ts](/src/lib/sync/peerPresence.svelte.ts)):

```ts
const isTrusted = this.trustedPeers.some((p) => p.id === data.id);
```

The 8-digit pairing code is bound to the connection's DTLS fingerprints, but it only protects the first pairing. After that, any peer in the same room that claims a trusted UUID passes every `isTrusted` check and can call `ydoc-sync` or `scx-sync`, which return full transaction history. The default room (`cashier`) is a public string, and every hello goes to everyone who joins.

## Goal

- A trusted peer is one that proves possession of a key paired with it, not one that repeats an ID.
- Devices find each other through a private rendezvous rather than a shared public room string.
- The same trust model covers S3 and WebDAV, where trust currently only filters what is merged.

## Design

### 1. Device key pair

- On first use, generate an ECDSA P-256 key pair with WebCrypto, `extractable: false`.
- Store the `CryptoKeyPair` in IndexedDB next to the other device settings.
- Keep the existing UUID. S3 and WebDAV key files by it (`manifests/<deviceId>.json`, `crdt/<kind>/<deviceId>.<seq>.upd`), so changing it would need a data migration. The key is attached to the UUID instead.
- `TrustedPeer` gets `publicKey` (base64 SPKI). Trust means "this UUID **and** this key".
- Show a short fingerprint (first 8 base32 characters of SHA-256(SPKI)) on the Trusted Devices page.

### 2. Signed hello bound to the connection

- Hello changes from `{ id, name }` to `{ id, name, publicKey, sig }`, where
  `sig = Sign(privKey, "cashier-hello-v1" | id | myDtlsFingerprint | peerDtlsFingerprint)`.
- The receiver reads both fingerprints with `connectionFingerprints()`, verifies the signature with the peer's key, and swaps the fingerprint order for the peer's view.
- A peer is trusted only if the signature verifies **and** a `TrustedPeer` with that `id` has the same `publicKey`.
- Binding to DTLS fingerprints stops replay and relay: a captured hello fails on any other connection.
- Existing `peersMap[fromId]?.isTrusted` checks in [peerConnection.svelte.ts](/src/lib/sync/peerConnection.svelte.ts) stay as they are. Only where `isTrusted` is set changes.
- The pairing code also covers both public keys, and `trust()` saves `peer.publicKey` on the record.

### 3. Private rendezvous instead of a shared room

- **Group secret (preferred).** At first pairing, an existing group member generates a random 32-byte `syncGroupSecret` and sends it over the newly authenticated channel. The room becomes `HMAC(secret, "room-v1")`. The Room field disappears from setup.
- If the trystero version in use supports a `password` option for signaling encryption, derive it from the same secret so relays see only ciphertext. **Unverified:** `node_modules` was not installed when this was written, so check the `@trystero-p2p/core` 0.26 typings first.
- **Alternative: one room per pair.** Room name = `hash(sort(pkA, pkB))`. No shared secret, but each device joins N−1 rooms.
- New devices need a lobby. Either keep the current public room for pairing only, or show a one-time room code as a QR code that carries the code and the inviter's key fingerprint. Scanning verifies the key, so the 8-digit comparison can be skipped.

### 4. S3 and WebDAV

- Devices sign their manifest and CRDT update files with their key.
- Readers check each file against the stored `publicKey` and skip unsigned or wrongly signed files.
- Publish `devices/<uuid>.json` with `{ name, publicKey }`, so "Trust this device" on those pages can show the fingerprint for comparison.
- Note: the bucket passphrase is still shared. Anyone with it can write objects, so signatures are what limit a device to its own files.

### 5. Migrating existing trust

- Legacy `TrustedPeer` records have no `publicKey`. Do not accept the first key a legacy device presents, since that leaves the hole open.
- Mark them "legacy, re-pair needed". Keep name and read-only flag, but require one pairing-code confirmation per device pair.

### 6. Edge cases

- Clearing site data deletes the key, so the device must pair again. This matches today's behaviour for the UUID.
- Removing trust is per device. With a group secret, also rotate the secret and send it to remaining devices, so a removed device cannot rejoin the room.
- S3 passphrase rotation is separate and still needed on its own.

## Implementation steps

Each step can ship alone. Step 1 fixes the impersonation problem.

1. **Keys and signed hello.** Create and store the key. Add `publicKey` to `TrustedPeer` with a Dexie schema bump. Send the signed hello and verify it. Legacy records require re-pairing.
2. **Pairing code and display.** Add both public keys to `computePairingCode()`. Show the key fingerprint on Trusted Devices.
3. **Group secret and derived room.** Add the secret exchange and derived room. Remove the Room field from setup.
4. **QR pairing.** Lobby with one-time code and key fingerprint.
5. **Signed S3 and WebDAV data.** Sign and verify manifests and updates. Publish device records.

## Tests to add

- Unit: signature verify for valid, replayed (different fingerprints), and wrong-key hellos; pairing-code stability with keys; legacy-record handling.
- E2E or manual: two-browser pairing; an impersonating peer with a copied UUID is not trusted; removed device cannot merge.

## Open questions

- Is a group secret acceptable, or should every pair use its own room?
- Is QR pairing needed in the first release, or is the 8-digit code enough?
- Should S3 and WebDAV signing ship together with peer sync, or after it?

## Related

- [peer-sync help](/doc/help/peer-sync.md)
- [s3-sync](/doc/s3-sync.md)
