# Device Identity: Public-Key Pairing for Multi-Device Sync

Status: in progress. Step 1 (keys and signed hello) is implemented: `src/lib/sync/deviceKey.ts`, `assessHello` in `peerPresence.svelte.ts`, Dexie v8 `deviceKeys` store. Its hello also signs the (still UUID) `id`. Step 2 (names and fingerprints) is implemented: `DeviceLabel.svelte` (`name · 7KQ2-M9XA`) on the peer lists, the pairing prompt and Trusted Devices; local rename (`renamePeer`) with `TrustedPeer.announcedName`; `TrustedPeer.fingerprint`, derived from the key. The Trusted Devices page no longer shows the UUID and flags records without a key. Still shown with a UUID prefix: S3/WebDAV device lists (`Device abc123`) and the journal's origin labels; they switch with the ID in step 5. Step 3 (invite link and private room) is implemented: `invite.ts` (link format), `syncGroup.ts` (secret, derived room and password), `pairing.svelte.ts` (`InviteSession` / `JoinSession`), `InviteDialog.svelte`, the `/pair` route and "Paste invite link" on Peer Sync. The Room field, the public lobby, the 8-digit code and `pair-confirm` are gone. Step 4 (introductions) is implemented: `introductions.ts` (signed records, validation of what arrives), a Dexie v9 `introductions` store (`PendingIntroduction`), an `intro` action in `PeerPresence`, `IntroductionRequests.svelte` on Peer Sync, and `TrustedPeer.addedBy` shown on Trusted Devices. Not yet verified between real devices (only against an in-memory fake of trystero in `tests/unit/pairing.test.ts`, and unit tests for the introduction logic).

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
- **Device ID = first 16 bytes of SHA-256(public key SPKI), Crockford base32 lowercase** (alphabet `0-9a-z` without `i l o u`, so an ID that is read out or typed is hard to mistake; 26 characters, no `.`, safe in S3 keys and WebDAV file names). It replaces the UUID in the trust list, the bucket layout (`manifests/<id>.json`, `crdt/<kind>/<id>.<seq>.upd`, `<id>.ack`) and the hello. Checked: `parseObjectKey` in `deltaSync.ts` matches the device with `[^/.]+`, so a 26-character base32 ID parses; nothing assumes the UUID shape (hyphens, length).
- **Names are labels, not identity.** They are not unique ("My Device" is the default) and anyone can set any name. The name is exchanged in the hello and the invite. Each device can rename a peer locally ("Anna's phone"); the name the peer announced is kept alongside.
- **UI:** show `name · 7KQ2-M9XA` (the first 8 characters of the ID, grouped). Never show the full ID.
- `TrustedPeer` gets `publicKey` (base64 SPKI) and `legacyIds?: string[]` (see Migration).

### 2. Signed hello bound to the connection

- Hello changes from `{ id, name }` to `{ name, publicKey, sig }`. The ID is not sent; the receiver derives it from `publicKey`. `sig = Sign(privKey, "cashier-hello-v1" | name | myDtlsFingerprint | peerDtlsFingerprint)`.
- The receiver reads both fingerprints with `connectionFingerprints()`, swaps their order for the peer's view, and verifies the signature.
- A peer is trusted only if the signature verifies **and** a `TrustedPeer` with the derived ID has the same `publicKey`.
- Binding to DTLS fingerprints stops replay and relay: a captured hello fails on any other connection.
- **Decision: the signature check stays in the post-join `hello` action** (not trystero's `onPeerHandshake`). Legacy peers with an unsigned hello must stay visible as "needs re-pairing" instead of being dropped, and an unknown joiner must reach the inviter for approval, so trust is decided in the hello handler either way. See Hardening (step 7) for the handshake as an optional extra.
- Existing `peersMap[fromId]?.isTrusted` checks in [peerConnection.svelte.ts](/src/lib/sync/peerConnection.svelte.ts) stay as they are. Only where `isTrusted` is set changes.

### 3. Pairing by invite link

One invite link, pasted into any chat. No QR code in the first release (see Decisions).

`https://<app-origin>/pair#<base64url payload>` where the payload is `{ v: 1, name, fingerprint, strategy, seed, exp }`:

- `fingerprint` is the inviter's key-derived device ID (the full 26 characters, not the short form people see). The joiner accepts only a signed hello whose key hashes to it, so the joiner knows it reached the right device.
- `strategy` is the signaling network (Nostr, MQTT, BitTorrent) the inviter is on. Peers only find each other on the same network, so the joiner uses it for this invite whatever its own setting is.
- `seed` is 128 random bits. The one-use room and its signaling password are derived from it (`HMAC(seed, "invite-room-v1")` and `"invite-password-v1"`), so the relay sees neither the seed nor the password. A random room name alone would be public, since the room name is the relay topic, and the default signaling encryption is keyed from it.
- `exp` is about 10 minutes from creation.
- The payload is in the URL fragment, so it never reaches a server or its logs.

Flow:

1. **Inviter** taps "Invite a device", the app creates the room and the link, and the inviter shares the link.
2. **Joiner** opens the link (or pastes it into "Paste invite link" in the app) and joins the room. Both sides exchange signed hellos.
3. **Inviter** sees "**Anna's phone** (7KQ2-M9XA) wants to join" and taps Approve. This is what authenticates the joiner, who is otherwise unknown to the inviter. An optional 4-digit code read out over a call can be added for links sent over untrusted chat.
4. On approval each side saves the other's name, key and ID, and the inviter leaves the room. A link works once and expires.

What a leaked link allows: asking to join. Nobody is trusted until the inviter approves, and an unexpected device name shows up on that screen.

Notes:

- On a device where the app is not set up yet, the app first redirects to onboarding and the link's fragment is lost; finish onboarding, then paste the link.
- A device that joins an invite while already in a group replaces its group secret (after a warning); the devices it was paired with before have to be invited again. Merging two groups is not supported.
- Devices paired before step 3 have no group secret. Whichever of them sends the first invite creates it; the others get it when they are invited again.
- An installed PWA does not reliably capture `https` links, so the in-app "Paste invite link" field is the dependable path; the link is also usable by opening it in a browser where that browser shares the app's storage.
- The public `cashier` lobby, the Room field and the 8-digit code comparison go away: all pairing goes through an invite.
- **Private room for ongoing sync (group secret).** At pairing, the inviter sends a random 32-byte `syncGroupSecret` over the newly authenticated channel (or, if the group exists, shares the existing one). The sync room becomes `HMAC(secret, "room-v1")`, so strangers never see hellos. Derive the trystero `password` from the same secret so relays see only ciphertext: `@trystero-p2p/core` 0.26 supports `password` in the room config (`BaseRoomConfig.password`), which encrypts the session descriptions with AES-GCM (by default the key comes from the public app ID and room name, so a relay operator can recover it) and also runs a challenge handshake, so peers with a different password fail to connect. All peers in the room need the same password. The secret is rotated when a device is evicted (see Evicting a device).

### 4. Delegated trust (introductions)

Pairing a new device C with one existing device A does not require a full invite flow with every other device. An introduction is only a **proposal**: **every device approves for itself whom it syncs with**, on both sides.

- **Introduction record:** `{ v: 1, subject: { name, publicKey }, by: <id>, at, sig }`, where `sig` is the introducer's signature over `"cashier-intro-v1" | name | publicKey | at`. It says "I vouch for this key under this name".
- **The new device chooses.** After A approves C, A sends C an introduction for each non-revoked device A trusts. C lists them ("Also trusted by A: Laptop · 7KQ2-M9XA, Tablet · …") and the user ticks the ones C should trust. C trusts nothing it was not asked about. C verifies a chosen device's signed hello against the key in the introduction, so that device does not have to be online with A.
- **Existing devices are asked.** A sends each device B it trusts an introduction of C. B queues a request ("A introduced **Anna's phone** · 7KQ2-M9XA. Trust it?") and trusts C only after the user approves, recording `addedBy`. Until then C is not trusted and B ignores it. A pending request stays until it is approved or dismissed, and is dropped if the key is evicted. Trust is mutual only when both sides have approved, which is what sync needs because both sides check it.
- **Rules:** the introducer must be trusted and non-read-only. An introduction of a tombstoned (evicted) key is refused. A device that was itself added by introduction can introduce others. The read-only flag is not passed along: each device decides that for itself.
- The first device in a group is still paired by invite link, so every chain starts with a human approval.
- **As built:**
  - Introductions travel over the sync room (an `intro` action), not the invite room. When a trusted device connects, each side offers it the other devices it trusts, and tells the other connected trusted devices about it. So the new device gets its list, and the existing devices get their request, as soon as they next meet the introducer; no special moment is needed.
  - Both directions use one mechanism: a queued request on the receiver (**Introduced devices** on Peer Sync) with Trust or Dismiss. A dismissed request is kept, so it is not asked again.
  - The subject also carries its announced `id` (and it is signed), because the trust record is still keyed by that ID until step 5 derives it from the key. The request itself is keyed by the key-derived ID.
  - A device does not introduce to a peer it marked read-only, and refuses an introduction from one.
  - Approving checks that one of the introducers is still trusted, and records it in `addedBy`. Trusting a device another way (an invite) clears the request.
  - **Not yet:** refusing a tombstoned (evicted) key, and dropping a request when its key is evicted. There are no tombstones before step 6; add the check there.

### 5. S3 and WebDAV: signed objects

Why it matters: a bucket object is attributed to a device by its file name (`crdt/<kind>/<id>.<seq>.upd`), and readers merge it when that device is trusted. Every device, including a lost, stolen or evicted one, holds the shared bucket credentials and passphrase, so it can write an object under another device's name and readers will merge it. The AES-GCM binding of an object to its key (format version 2) stops an object being moved to another name, but not a new one being written, since the writer has the passphrase. A signature ties an object to its author's key, which a passphrase holder does not have. It is also what makes eviction enforceable for the bucket: without it, "readers ignore the evicted device's objects" can be bypassed by writing under a trusted ID.

- Each object gets a signature over `"cashier-obj-v1" | objectKey | SHA-256(stored bytes)` from its author's key, kept in the object header (a new format version). Verifying needs no decryption.
- The author is the ID in the file name. Snapshots and `revocations/` objects carry the author ID in the signed header (a snapshot has no device in its name). A snapshot's signature says who compacted, not who wrote the operations in it, so only snapshots by trusted devices are applied.
- Readers look up the author's `publicKey` (trusted list, or `devices/<id>.json`) and skip objects with a missing or wrong signature, or from an untrusted or revoked author.
- Each device publishes `devices/<id>.json` with `{ name, publicKey, previousId? }`. "Trust this device" on the S3 and WebDAV pages shows the name and fingerprint for comparison, as the invite does for peers.
- Cost: one ECDSA verify per object read, small next to the fetch itself.
- Signatures limit what a device can write as, not what it can read. The bucket passphrase is still shared.

When it ships: **together with the ID switch (step 5), and at the latest before eviction (step 6).** After the switch every object is written under a new ID, so it can be signed from its first byte and readers can require signatures for new IDs with no tolerance for unsigned objects. Shipping signing later would leave a window in which unsigned objects must be accepted for devices that have already switched, and an attacker can write exactly those. Objects written under legacy IDs before the switch are unsigned and are accepted only until they are compacted or forgotten. Peer sync alone does not need this step, because its hello is already signed and bound to the connection (step 1).

### 6. Migration

Existing trust records are keyed by UUID and have no key. Two facts shape the migration:

- **What already exists.** `ACK_ACTIVE_WINDOW_MS` (30 days, [deltaSync.ts](/src/lib/sync/deltaSync.ts)) makes compaction and the automatic reset ignore a device whose `.ack` object is older than that; it gets the snapshot when it returns. `forgetBucketDevice` / `DeltaSync.forget` merges a device's data, snapshots, and deletes its objects. Neither removes a device from the Trusted Devices list on its own, and `lastSeen` is only updated by peer sync today (see Last seen).
- **Do not accept the first key a legacy device presents.** That would keep the impersonation hole open. A legacy record needs one explicit confirmation.

Sequence per device:

1. Before switching, the device syncs, so everything it wrote is uploaded and merged elsewhere.
2. It generates its key, derives its new ID, and keeps the old UUID as `previousId` (device-only setting).
3. On pairing, the peer finds a `TrustedPeer` with that `previousId`, and after the user's approval replaces it with the new record, keeping the old UUID in `legacyIds`, plus the name and read-only flag. The trust filter treats `legacyIds` as trusted, so old-ID deltas stay readable until compacted.
4. After its first successful sync under the new ID, the device runs `forget(previousId)` on its own old objects. Anything other devices have not yet applied is covered by the snapshot `forget` writes first. Verified against `DeltaSync.forget`: it downloads and merges first (aborting on errors), uploads its own deltas, writes a snapshot, and only then deletes the device's objects. The device being forgotten must still be trusted (`ignore` must not filter it) while `forget` runs, so run it before dropping the old ID from the trust filter.
5. Old-ID objects on devices that never come back age out through the 30-day window; the user can remove them from Trusted Devices with the existing cleanup option.

Optional: a "Remove devices not seen for 30+ days" action on Trusted Devices, based on `lastSeen` (see Last seen). It is local housekeeping, not an eviction.

### 7. Edge cases

- Clearing site data deletes the key, so the device is a new device and must pair again. This matches today's behaviour for the UUID.
- Plain removal (Trusted Devices > Remove) is local to the device it is done on. To remove a device from all devices at once, use eviction (below).
- S3 passphrase rotation is separate and still needed on its own.

### 8. Last seen

`TrustedPeer.lastSeen` becomes the latest of the last verified hello and the newest modification date of any object that device wrote in any sync (delta, `.ack` or manifest, on S3 or WebDAV), refreshed whenever a sync lists the bucket or folder. Server modification times are informational, as in the delta-sync design: correctness never depends on them, so using them for display and housekeeping is safe.

### 9. Evicting a device

Yes, without a server: a signed **revocation record** that spreads between devices.

- **Record:** `{ v: 1, revoked: <id>, by: <id>, at, sig }`, where `sig` is the evictor's signature over `"cashier-revoke-v1" | revoked | at`.
- **Who may evict:** any trusted, non-read-only device. Trust is flat (every device can already read everything). Receivers accept a record only from such a device and show a notice ("Anna's phone evicted Old phone"). A compromised device could evict others, which is a nuisance, not a data leak, and is fixed by re-pairing.
- **How it spreads:**
  - Peer sync: after the hello, devices exchange their revocation records. A receiver verifies, applies, and passes the record on to its other peers, so it keeps spreading when the evictor goes offline.
  - Bucket: `revocations/<revokedId>.json`, encrypted like other objects, read at each S3/WebDAV sync.
  - A device that was offline learns of it at its next connection or sync.
- **Effect on a receiver:** the `TrustedPeer` is kept as a tombstone (`revoked`, `revokedBy`, `revokedAt`) rather than deleted, so gossip or an old invite cannot bring it back. Its live connection is closed, bucket readers ignore its objects, and compaction no longer waits for it. The evicting device is offered the existing removal cleanup (`forgetBucketDevice`), which merges what the evicted device wrote before deleting its objects. Re-admitting it needs an explicit re-pair on each device, which clears the tombstone.
- **Group secret rotation:** the evictor generates a new secret and sends it to the remaining devices over live authenticated channels. Devices stay in the previous room for the ack window (30 days) only to hand the new secret to a returning trusted device. Rotation hides presence from the evicted device; the enforcement is the key check, not the room.

Limits:

- A device that is offline keeps trusting the evicted one until it next connects or syncs.
- Eviction cannot take anything back. The evicted device keeps the data it already has, and it still holds the bucket passphrase and the S3/WebDAV credentials, so it can read the bucket until those are changed (a separate job, as noted above). Signatures (step 5) stop it forging other devices' objects, and readers ignore its own.

## Decisions

- **No QR code in the first release.** Measured against the packages: a QR generator is small (qrcode-generator is about 11 kB gzipped unminified), but a scanner is not (jsQR is about 57 kB gzipped as shipped, and `BarcodeDetector` is not in every browser). The phone's own camera app can scan a QR code that shows the link, but it opens a browser, which may not share storage with the installed PWA. The link works everywhere; revisit if pairing in person turns out to be common.
- **Name is a label; the key-derived ID is the identity.**
- **Group secret** for the private sync room (not one room per pair).
- **`lastSeen` follows any modification date in any sync**, not only peer hellos.
- **Eviction is a signed, gossiped revocation**, not a per-device manual removal. One trusted device is enough to evict; no second confirmation.
- **Introductions are signed proposals; every device approves for itself.** The new device chooses which of its introducer's devices to accept, and each existing device is asked before it accepts the new one. Admission needs each device's consent; eviction does not (one device is enough).
- **Signed S3/WebDAV objects ship with the ID switch**, and before eviction at the latest (see Signed objects).

## Implementation steps

Each step can ship alone. Step 1 fixes the impersonation problem.

✅ 1. **Keys and signed hello.** Create and store the key. Add `publicKey` to `TrustedPeer` (`src/lib/data/model.ts`) with a Dexie schema bump (the current version is 7 in `src/lib/data/db.ts`). The hello carries the key and signature; the UUID is still the ID, hidden from the UI. Legacy records require re-pairing.
✅ 2. **Names and fingerprints in the UI.** Show `name · fingerprint` on Trusted Devices and the peer lists; local rename of a peer.
✅ 3. **Invite link and private room.** `/pair` route, "Paste invite link", inviter approval, group secret, derived room. Remove the Room field and the public lobby.
✅ 4. **Introductions.** Signed introduction records, the "also trusted by" choice list on the new device, an approval request on every existing device. Needs steps 1 and 3 (keys, group secret). 5. **Switch the ID to the key-derived one, with signed objects.** Migration as above for peers, S3 and WebDAV together (they share `getDeviceId()`), `legacyIds`, self-`forget`, `devices/<id>.json`, and signing and verifying every bucket object. `lastSeen` from sync modification dates ships here too. 6. **Eviction.** Revocation records, gossip over peer sync and the bucket, tombstones, group secret rotation. Needs steps 1 and 3; the bucket part needs step 5. 7. **Later, optional:** QR code for the invite; remove-unseen-devices action; **handshake hardening**: also verify the signature in trystero's `onPeerHandshake(peerId, send, receive, isInitiator)` (`JoinRoomCallbacks`, with `handshakeTimeoutMs`), so a peer with an invalid signature never gets an active connection. It would reject only bad signatures, not unknown keys (pairing needs those). Unchecked: whether the DTLS fingerprints are readable inside the callback, and how a failed handshake treats legacy unsigned peers (they would be dropped, not shown as "needs re-pairing"), so apply it only once legacy hellos are no longer supported.

## Tests to add

- Unit: signature verify for valid, replayed (different fingerprints) and wrong-key hellos; ID derivation; invite payload expiry and single use; `legacyIds` trust filter; migration sequence with simulated devices (sync, switch, forget old ID, no data lost).
- E2E or manual: two-browser pairing by invite; an impersonating peer with a copied ID is not trusted; removed device cannot merge.
- Eviction: a record signed by an untrusted or read-only device is refused; gossip reaches a third device when the evictor is offline; a tombstoned device cannot be re-added by gossip or an old invite; a returning device receives the rotated group secret; bucket readers skip an evicted device's objects.
- `lastSeen` takes the newest of hello time and object modification dates.
- Introductions: the new device is offered only non-revoked devices of the introducer and trusts only the ticked ones; an existing device queues a request for an introduction from a trusted, non-read-only introducer and trusts the device only after approval, and refuses one from a read-only or unknown device; a tombstoned key is refused; the chosen device's hello must match the introduced key.
- Signed objects: an object written under a trusted device's name without a valid signature is skipped; a valid signature by a revoked or untrusted author is skipped; a legacy-ID (unsigned) object is accepted until compacted; verification needs no decryption.

## Open questions

- None open at the moment.

## Related

- [peer-sync help](/doc/help/peer-sync.md)
- [s3-sync](/doc/s3-sync.md)
- [delta-sync](/doc/completed-projects/2026-10-16_delta-sync.md)
