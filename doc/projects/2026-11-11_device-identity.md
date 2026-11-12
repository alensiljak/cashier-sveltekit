# Device Identity: Public-Key Pairing for Multi-Device Sync

Status: planned, not started.

## Problem

Device identity is a random UUID (`getDeviceId()` in [ydocDevices.ts](/src/lib/sync/ydocDevices.ts)). Each device announces it in plain text in its `hello` message, and trust is decided by ID alone ([peerPresence.svelte.ts](/src/lib/sync/peerPresence.svelte.ts)):

```ts
const isTrusted = this.trustedPeers.some((p) => p.id === data.id);
```

The 8-digit pairing code is bound to the connection's DTLS fingerprints, but it only protects the first pairing. After that, any peer in the same room that claims a trusted UUID passes every `isTrusted` check and can call `ydoc-sync` or `scx-sync`, which return full transaction history. The default room (`cashier`) is a public string, and every hello goes to everyone who joins.

The UUID is also shown to users (Trusted Devices page), where it is hard to read and tells them nothing.

## Goals

- A trusted peer is one that proves possession of a key paired with it, not one that repeats an ID.
- The device ID is derived from the key, so it cannot be claimed without the key. It stays internal; people see the device **name** and a short **fingerprint**.
- Devices find each other through a private rendezvous instead of a shared public room string, and pair through a single invite link.
- The same trust model covers S3 and WebDAV, where trust currently only filters what is merged.

## Design

### 1. Device key pair and ID

- On first use, generate an ECDSA P-256 key pair with WebCrypto, `extractable: false`. Store the `CryptoKeyPair` in IndexedDB next to the other device settings.
- **Device ID = first 16 bytes of SHA-256(public key SPKI), base32 lowercase** (26 characters, no `.`, safe in S3 keys and WebDAV file names). It replaces the UUID in the trust list, the bucket layout (`manifests/<id>.json`, `crdt/<kind>/<id>.<seq>.upd`, `<id>.ack`) and the hello. Check the key parsers in `deltaSync.ts` for assumptions about the old UUID shape.
- **Names are labels, not identity.** They are not unique ("My Device" is the default) and anyone can set any name. The name is exchanged in the hello and the invite. Each device can rename a peer locally ("Anna's phone"); the name the peer announced is kept alongside.
- **UI:** show `name · 7KQ2-M9XA` (the first 8 characters of the ID, grouped). Never show the full ID.
- `TrustedPeer` gets `publicKey` (base64 SPKI) and `legacyIds?: string[]` (see Migration).

### 2. Signed hello bound to the connection

- Hello changes from `{ id, name }` to `{ name, publicKey, sig }`. The ID is not sent; the receiver derives it from `publicKey`. `sig = Sign(privKey, "cashier-hello-v1" | name | myDtlsFingerprint | peerDtlsFingerprint)`.
- The receiver reads both fingerprints with `connectionFingerprints()`, swaps their order for the peer's view, and verifies the signature.
- A peer is trusted only if the signature verifies **and** a `TrustedPeer` with the derived ID has the same `publicKey`.
- Binding to DTLS fingerprints stops replay and relay: a captured hello fails on any other connection.
- Existing `peersMap[fromId]?.isTrusted` checks in [peerConnection.svelte.ts](/src/lib/sync/peerConnection.svelte.ts) stay as they are. Only where `isTrusted` is set changes.

### 3. Pairing by invite link

One invite link, pasted into any chat. No QR code in the first release (see Decisions).

`https://<app-origin>/pair#<base64url payload>` where the payload is `{ v: 1, name, fingerprint, room, exp }`:

- `fingerprint` is the inviter's device ID. The joiner verifies the inviter's signed hello against it, so the joiner knows it reached the right device.
- `room` is a random 128-bit name used once, on the same relay network. It is the rendezvous for this invite only.
- `exp` is about 10 minutes from creation.
- The payload is in the URL fragment, so it never reaches a server or its logs.

Flow:

1. **Inviter** taps "Invite a device", the app creates the room and the link, and the inviter shares the link.
2. **Joiner** opens the link (or pastes it into "Paste invite link" in the app) and joins the room. Both sides exchange signed hellos.
3. **Inviter** sees "**Anna's phone** (7KQ2-M9XA) wants to join" and taps Approve. This is what authenticates the joiner, who is otherwise unknown to the inviter. An optional 4-digit code read out over a call can be added for links sent over untrusted chat.
4. On approval each side saves the other's name, key and ID, and the inviter leaves the room. A link works once and expires.

What a leaked link allows: asking to join. Nobody is trusted until the inviter approves, and an unexpected device name shows up on that screen.

Notes:

- An installed PWA does not reliably capture `https` links, so the in-app "Paste invite link" field is the dependable path; the link is also usable by opening it in a browser where that browser shares the app's storage.
- The public `cashier` lobby, the Room field and the 8-digit code comparison go away: all pairing goes through an invite.
- **Private room for ongoing sync (group secret).** At pairing, the inviter sends a random 32-byte `syncGroupSecret` over the newly authenticated channel (or, if the group exists, shares the existing one). The sync room becomes `HMAC(secret, "room-v1")`, so strangers never see hellos. If the trystero version in use supports a `password` option for signaling encryption, derive it from the same secret so relays see only ciphertext. **Unverified:** `node_modules` was not installed when this was written, so check the `@trystero-p2p/core` 0.26 typings first. The alternative is one room per pair, `hash(sort(idA, idB))`, with no shared secret but N−1 rooms per device.

### 4. S3 and WebDAV

- Devices sign their manifest and CRDT update files with their key. Readers check each file against the stored `publicKey` and skip unsigned or wrongly signed files.
- Each device publishes `devices/<id>.json` with `{ name, publicKey, previousId? }`. "Trust this device" on the S3 and WebDAV pages shows the name and fingerprint for comparison, as the invite does for peers.
- The bucket passphrase is still shared. Anyone with it can write objects, so signatures are what limit a device to its own files.

### 5. Migration

Existing trust records are keyed by UUID and have no key. Two facts shape the migration:

- **What already exists.** `ACK_ACTIVE_WINDOW_MS` (30 days, [deltaSync.ts](/src/lib/sync/deltaSync.ts)) makes compaction and the automatic reset ignore a device whose `.ack` object is older than that; it gets the snapshot when it returns. `forgetBucketDevice` / `DeltaSync.forget` merges a device's data, snapshots, and deletes its objects. Neither removes a device from the Trusted Devices list on its own, and `lastSeen` is only updated by peer sync, not S3/WebDAV.
- **Do not accept the first key a legacy device presents.** That would keep the impersonation hole open. A legacy record needs one explicit confirmation.

Sequence per device:

1. Before switching, the device syncs, so everything it wrote is uploaded and merged elsewhere.
2. It generates its key, derives its new ID, and keeps the old UUID as `previousId` (device-only setting).
3. On pairing, the peer finds a `TrustedPeer` with that `previousId`, and after the user's approval replaces it with the new record, keeping the old UUID in `legacyIds`, plus the name and read-only flag. The trust filter treats `legacyIds` as trusted, so old-ID deltas stay readable until compacted.
4. After its first successful sync under the new ID, the device runs `forget(previousId)` on its own old objects. Anything other devices have not yet applied is covered by the snapshot `forget` writes first. Verify this ordering against `DeltaSync.forget` before relying on it.
5. Old-ID objects on devices that never come back age out through the 30-day window; the user can remove them from Trusted Devices with the existing cleanup option.

Optional: a "Remove devices not seen for 30+ days" action on Trusted Devices, using `lastSeen` for peers and the `.ack` time for bucket devices.

### 6. Edge cases

- Clearing site data deletes the key, so the device is a new device and must pair again. This matches today's behaviour for the UUID.
- Removing trust is per device. With a group secret, also rotate the secret and send it to the remaining devices, so a removed device cannot rejoin the room.
- S3 passphrase rotation is separate and still needed on its own.

## Decisions

- **No QR code in the first release.** Measured against the packages: a QR generator is small (qrcode-generator is about 11 kB gzipped unminified), but a scanner is not (jsQR is about 57 kB gzipped as shipped, and `BarcodeDetector` is not in every browser). The phone's own camera app can scan a QR code that shows the link, but it opens a browser, which may not share storage with the installed PWA. The link works everywhere; revisit if pairing in person turns out to be common.
- **Name is a label; the key-derived ID is the identity.**

## Implementation steps

Each step can ship alone. Step 1 fixes the impersonation problem.

1. **Keys and signed hello.** Create and store the key. Add `publicKey` to `TrustedPeer` with a Dexie schema bump. The hello carries the key and signature; the UUID is still the ID, hidden from the UI. Legacy records require re-pairing.
2. **Names and fingerprints in the UI.** Show `name · fingerprint` on Trusted Devices and the peer lists; local rename of a peer.
3. **Invite link and private room.** `/pair` route, "Paste invite link", inviter approval, group secret, derived room. Remove the Room field and the public lobby.
4. **Switch the ID to the key-derived one.** Migration as above for peers, S3 and WebDAV together (they share `getDeviceId()`), `legacyIds`, self-`forget`, `devices/<id>.json`.
5. **Signed S3 and WebDAV data.** Sign and verify manifests and updates.
6. **Later, optional:** QR code for the invite; remove-unseen-devices action.

## Tests to add

- Unit: signature verify for valid, replayed (different fingerprints) and wrong-key hellos; ID derivation; invite payload expiry and single use; `legacyIds` trust filter; migration sequence with simulated devices (sync, switch, forget old ID, no data lost).
- E2E or manual: two-browser pairing by invite; an impersonating peer with a copied ID is not trusted; removed device cannot merge.

## Open questions

- **Pairwise or transitive trust.** With three devices, pairing C with A does not make B trust C. Pairwise means each pair pairs once (the link makes that cheap). Transitive would let A forward a signed "I vouch for C" to B. Default: pairwise.
- Group secret, or one room per pair?
- Should S3 and WebDAV signing (step 5) ship together with peer sync, or after it?

## Related

- [peer-sync help](/doc/help/peer-sync.md)
- [s3-sync](/doc/s3-sync.md)
- [delta-sync](/doc/completed-projects/2026-10-16_delta-sync.md)
