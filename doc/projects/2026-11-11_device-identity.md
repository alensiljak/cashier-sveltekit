# Device Identity: Public-Key Pairing for Multi-Device Sync

Status: Practically complete

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
  - Refusing an evicted key, and dropping a request when its key is evicted, were added in step 6a (`receiveIntroductions` takes `evicted`; `approveIntroduction` refuses; `applyRevocation` deletes the requests).

### 5. S3 and WebDAV: signed objects

Why it matters: a bucket object is attributed to a device by its file name (`crdt/<kind>/<id>.<seq>.upd`), and readers merge it when that device is trusted. Every device, including a lost, stolen or evicted one, holds the shared bucket credentials and passphrase, so it can write an object under another device's name and readers will merge it. The AES-GCM binding of an object to its key (format version 2) stops an object being moved to another name, but not a new one being written, since the writer has the passphrase. A signature ties an object to its author's key, which a passphrase holder does not have. It is also what makes eviction enforceable for the bucket: without it, "readers ignore the evicted device's objects" can be bypassed by writing under a trusted ID.

- Each object gets a signature over `"cashier-obj-v1" | objectKey | author | SHA-256(content)` from its author's key, kept in an envelope around the content.
- **As built (5a):** the envelope (`CSO3 | idLength | author id | 64-byte signature | content`) sits _inside_ the encryption, not around it (`signedObjects.ts`). Reason: WebDAV can convert a folder between encrypted and plain, and a signature over the stored bytes would break on every conversion, which only the author could repair. The cost is that verifying needs the decryption first, which every reader does anyway. S3 manifests (`manifests/<id>.json`) are signed too; the data files under `data/` are not (their hashes are in the signed manifests).
- **Acceptance rules:** a signed object is accepted when its author is key-derived, matches the author in its name, and the author's key is known and hashes to the ID. An unsigned object is accepted only from a legacy (non-key-derived) author, until it is forgotten. An unsigned snapshot is accepted only while this device itself still has a legacy ID. A rejected object is skipped and reported (`ObjectRejectedError`), and one rejected delta stops only that device's run; a rejected snapshot is skipped and the deltas are still read; a rejected `.ack` is ignored.
- **Device records (5a):** `devices/<id>.json` (WebDAV: `cashier-device-<id>.json`) is self-certifying: `{ v, name, publicKey, previousId?, sig }`, where the ID must be the hash of the key and the key signs the rest. It is not wrapped in an envelope, as it carries its own key. The key of an author is looked up in the Trusted Devices list first, then in the store.
- **Inert until the switch:** a device with a legacy ID signs nothing and publishes no record (`loadBucketSigning`, `announceDevice`); only the checks on key-derived authors are active.
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
- **Group secret rotation: not done (decision, see step 6c).** The design was: the evictor generates a new secret and sends it to the remaining devices over live authenticated channels, and devices stay in the previous room for the ack window (30 days) to hand it to a returning device. It would only hide presence from the evicted device; the enforcement is the key check, not the room.

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
✅ 4. **Introductions.** Signed introduction records, the "also trusted by" choice list on the new device, an approval request on every existing device. Needs steps 1 and 3 (keys, group secret).
✅ 5. **Switch the ID to the key-derived one, with signed objects.** Migration as above for peers, S3 and WebDAV together (they share `getDeviceId()`), `legacyIds`, self-`forget`, `devices/<id>.json`, and signing and verifying every bucket object. `lastSeen` from sync modification dates ships here too.
✅ 6. **Eviction.** Revocation records, gossip over peer sync and the bucket, tombstones, group secret rotation. Needs steps 1 and 3; the bucket part needs step 5. Done except the group secret rotation, which is left out (see below). 7. **Later, optional:**

1. QR code for the invite;
2. ✅ remove-unseen-devices action (`unseenDevices` in `lastSeen.ts`, a button and confirmation dialog on Trusted Devices; devices unseen for 30+ days, counted from `trustedAt` when never seen; local removal only, no bucket clean-up);
3. **handshake hardening**: also verify the signature in trystero's `onPeerHandshake(peerId, send, receive, isInitiator)` (`JoinRoomCallbacks`, with `handshakeTimeoutMs`), so a peer with an invalid signature never gets an active connection. It would reject only bad signatures, not unknown keys (pairing needs those). Unchecked: whether the DTLS fingerprints are readable inside the callback, and how a failed handshake treats legacy unsigned peers (they would be dropped, not shown as "needs re-pairing"), so apply it only once legacy hellos are no longer supported.

## Tests to add

- Unit: signature verify for valid, replayed (different fingerprints) and wrong-key hellos; ID derivation; invite payload expiry and single use; `legacyIds` trust filter; migration sequence with simulated devices (sync, switch, forget old ID, no data lost).
- E2E or manual: two-browser pairing by invite; an impersonating peer with a copied ID is not trusted; removed device cannot merge.
- Eviction: a record signed by an untrusted or read-only device is refused; gossip reaches a third device when the evictor is offline; a tombstoned device cannot be re-added by gossip or an old invite; bucket readers skip an evicted device's objects.
- `lastSeen` takes the newest of hello time and object modification dates.
- Introductions: the new device is offered only non-revoked devices of the introducer and trusts only the ticked ones; an existing device queues a request for an introduction from a trusted, non-read-only introducer and trusts the device only after approval, and refuses one from a read-only or unknown device; a tombstoned key is refused; the chosen device's hello must match the introduced key.
- Signed objects: an object written under a trusted device's name without a valid signature is skipped; a valid signature by a revoked or untrusted author is skipped; a legacy-ID (unsigned) object is accepted until compacted; verification needs no decryption.

## Step 5 plan and decisions

Sub-steps (the switch comes last, so the earlier ones change nothing until it is turned on):

- ✅ **5a. Signed bucket objects.** `signedObjects.ts`, `deviceRecords.ts`, S3 and WebDAV stores, rejection handling in `deltaSync.ts`. Tests: `tests/unit/signedObjects.test.ts`.
- ✅ **5b. Trust model.** `identityMigration.ts`, `TrustedPeer.legacyIds`, `previousId` in the hello, `assessHello` / `trustVerified` / `approveMigration` in `peerPresence.svelte.ts`. Tests: `tests/unit/identityMigration.test.ts`. As built:
  - **Two ways a switched device is recognised.** _Rekey:_ a record under the old ID that holds the same key. The new hello is signed by that key, so the record is re-keyed with no prompt (this covers every device paired in steps 1–4). _Approve:_ a key-less record (trusted through S3/WebDAV) that the device names as its signed `previousId`; Peer Sync shows "Same device? Replace" and `approveMigration` does it. `previousId` is part of the signature only when present, so older hellos still verify.
  - **A key-derived ID must be the hash of its key**, in hellos and introductions; otherwise the hello is unverified / the introduction is dropped.
  - **Re-keying** (`replaceTrustedRecord`, one transaction) keeps the label, read-only flag, `addedBy`, trust date, and moves the Beancount sync baselines; the old UUID goes into `legacyIds`.
  - **Bucket trust:** `loadIgnoreReasons` also accepts `legacyIds`; `loadTrusted` / `loadTrustedIds` (compaction and reset) deliberately do not, so a device that switched does not hold them back. The S3/WebDAV device lists and the journal show legacy IDs under the device's name; the journal counts a record whose origin is this device's `previousDeviceId` as its own.
  - `trustDevice(id, name, publicKey?)` stores the key and fingerprint and refuses a key that does not hash to the ID. **Not yet wired (5d):** the S3/WebDAV pages passing the key from the device record, and the bucket-only "replace this device?" prompt (a device record whose `previousId` names a key-less record).
  - Not touched yet: the per-device record counts in `YdocDevices.svelte` (`originCounts`) are by origin ID and do not merge legacy and new IDs (5d).
- ✅ **5c. The switch and migration.** `deviceIdSwitch.ts`, `getDeviceId()`, `DeltaSync.retire`, `DeltaState.owner` / `retired`. Tests: `tests/unit/deviceIdSwitch.test.ts`. As built:
  - **New devices** derive their ID from their key at first use (`getDeviceId`). **Existing devices** keep their UUID until `switchDeviceIdIfReady()` runs, once per launch from the root layout after the app has initialised.
  - **When it switches:** when no S3 bucket or WebDAV folder the device syncs with is missing any of its changes (`hasUpload()` is false for every store and remote; local check only, no network), or at once when it syncs with none. Otherwise it waits for a later launch. Limit: a remote that is configured but never reachable keeps the device on its UUID.
  - **What it writes:** `previousDeviceId` first, then `peerId`, so an interrupted launch is finished by the next. The UUID stays in `previousDeviceId` for good: records it created carry it as `origin`, and it goes into every hello (signed) so a peer with a key-less record can match it.
  - **Delta numbering:** `DeltaState.owner` records which ID `nextSeq` and `acked` belong to; when the ID differs (or an older state meets a key-derived ID), the device restarts at delta 1 and drops the old acknowledgement. The registry also rebuilds a sync whose device ID changed.
  - **Retiring the old objects:** after a full sync (`afterSync` with `compact`), `DeltaSync.retire(previousId)` runs `forget` once per store: merge, upload, snapshot, delete what was written under the UUID, then mark it in `DeltaState.retired`. A merge error aborts it and it is tried again at the next sync. `loadIgnoreReasons` lets the device's own `previousDeviceId` through meanwhile.
  - **Peers** re-key the record on the next hello (5b); introductions and "added by" find an introducer that switched through its `legacyIds`.
  - **Known limit:** a device still on the old app version that compacts after another has switched writes an unsigned snapshot, which switched devices reject, so their `compact` and `retire` report an error until it updates.
- ✅ **5d. Last seen and labels.** `lastSeen.ts`, `bucketDeviceInfo` / `adoptSwitchedDevices` in `deviceRecords.ts`, the S3 and WebDAV device lists. Tests: `tests/unit/bucketDevices.test.ts`. As built:
  - **`lastSeen`** moves forward (never back) to the newest modification date of anything a trusted device wrote, under its current or a legacy ID: every listing a `DeltaSync` makes reports to `noteBucketActivity` (`DeltaSyncOptions.onListed`), and the S3 manifest listing does too. A verified hello also sets it, so the field always holds the newest of the two.
  - **Device lists** (S3 page, `YdocDevices.svelte` for WebDAV) show `name · fingerprint`, taken from the trusted record or the device's record. S3 reads the records with the passphrase; without it they show as before. Records created under a device's legacy IDs are counted for it (`originIds`), and a device's own legacy ID is shown as "This device".
  - **"Trust this device"** shows name and fingerprint and passes the key from the record to `trustDevice`, which refuses a key that does not hash to the ID. A device whose record is missing (an older app version) can still be trusted, with a note that it cannot be checked.
  - **Bucket-only migration.** Once per session and store, `announceDevice` also runs `adoptSwitchedDevices`: a trusted record whose key matches a device record under a new ID is re-keyed without asking (the key proves it). A key-less record that a device record names as its `previousId` is not: the list shows **Replace** instead of **Trust**, with the old record's name, and `trustDevice(..., previousId)` replaces it after the person confirms.

Decisions:

- **Bucket-only devices migrate through a prompt.** A `devices/<newId>.json` whose `previousId` matches a trusted record asks "replace this device?", showing name and fingerprint. Nothing is trusted until a person confirms.
- **Legacy objects stay accepted until forgotten** (no bound on their numbers). The manual clean-up on Trusted Devices is the remedy.
- **The switch happens at once**, on the first launch after the update, when the outbox is empty and a sync succeeded. Approvals follow later: when a peer next connects (Peer Sync, "Introduced devices" / re-pairing prompt) or when the device is seen in a bucket.
- **Sign everything practical**, without extra machinery for edge cases.

Known limits of 5a: a forged object under a trusted name blocks `compact` and `forget` for that device (they refuse to run while a merge reports errors; "Remove anyway" still works). A device on an older app version that is not yet switched keeps writing unsigned snapshots, which switched devices ignore.

## Step 6 plan and decisions

Sub-steps:

- ✅ **6a. Records, tombstones, peer gossip, UI.** `revocations.ts`, `Revocation` and `RevocationRecord` in `model.ts`, Dexie v10, `PeerPresence` (`evictPeer`, the `revoke` action, `evicted`, `unseenEvictions`), `EvictionNotices.svelte`, "Evict" on Trusted Devices. Tests: `tests/unit/revocations.test.ts`. As built:
  - **Tombstones are their own table**, not a flag on `TrustedPeer` (a change from the design above). Much code reads `db.peers` as "the trusted list" (bucket filters, compaction, sync pages); a tombstoned row there would count as trusted wherever one check was forgotten. Evicting deletes the trusted record (and its Beancount sync baselines and pending introductions) and writes one tombstone row per ID of the device (its ID and each legacy ID), each holding the signed record, the name this device knew it by, and the evictor's name.
  - **The signature covers `["cashier-revoke-v1", revoked, by, at]`**: the evictor's ID too, so a record cannot be re-attributed.
  - **A receiver accepts a record** only when its signer is trusted with a key, is not read-only, signed it, and does not evict itself; and the device is not already tombstoned. The relaying peer does not matter, only the signature, so records keep spreading when the evictor is offline.
  - **Gossip.** When a trusted device connects, each side sends the active records it holds (`recordsToShare`). A receiver applies the new ones and passes them to its other connected trusted devices.
  - **Evicted devices stay in the room**: trystero cannot kick a peer, so enforcement is that the peer is marked `evicted` and untrusted in `peersMap`. Every serve and merge check already requires `isTrusted`.
  - **Re-admission.** `trustVerified` refuses an evicted ID or key unless `readmit: true`, which pairing by invite passes (the person tapped Approve, or opened the link; the invite dialog's `Candidate.evicted` says so). That marks the tombstone `readmitted` with a time; records signed at or before that time are ignored, so a device that has not paired again cannot gossip the old eviction back. Other devices still hold the tombstone until their own person re-pairs.
  - **Introductions** of an evicted ID or key are refused; `approveIntroduction` refuses a request that predates the eviction.
  - A record that evicts **this** device is stored and shown ("X evicted this device"); nothing else is enforced on the evicted device itself.
  - The Evict button shows only for devices with a key.
- ✅ **6b. Bucket.** `syncBucketRevocations`, `publishRevocations`, `readBucketRevocations` in `revocations.ts`; WebDAV file mapping in `webdavRemoteStore.ts`. Tests in `tests/unit/revocations.test.ts`. As built:
  - `revocations/<revokedId>.json` (WebDAV `cashier-revocation-<id>.json`) holds the signed record as it is: self-certifying like device records, so no envelope, though it is encrypted like every other object. Written only if absent; if two devices evict the same one, the first wins and both are valid.
  - Before every delta sync of S3 or WebDAV (`deltaSyncFor`, `syncFor`; at most once per 30 seconds per store), the device reads the records, applies those that hold (`acceptRevocations`: the signer must be trusted here), then publishes the active tombstones the store lacks. So an eviction made while a device was offline, or between devices never online together, reaches the others through the bucket. The trusted list is updated before the sync's ignore list is built, so the evicted device's objects are skipped in the same run.
  - `PeerPresence` listens (`onRevocationsApplied`) and refreshes its trusted list, tombstones and connected peers when a bucket applied an eviction.
  - The Evict dialog offers the existing clean-up (`forgetBucketDevice`: merge, snapshot, delete its objects) when S3 is configured. It runs before the eviction, as the device must still be trusted to be merged.
  - WebDAV has no equivalent clean-up yet; its evicted objects are ignored but stay in the folder.
  - Limit: a record whose signer is not trusted on a device is ignored there, and stays in the bucket for other devices.
- **6c. Group secret rotation: left out on purpose.** Devices mostly sync one to one, so the room is rarely shared by more than two, and the evicted device can only learn who is online, not read or write anything: trust is decided by keys, and the evicted key is refused everywhere. Rotation would need each device in two rooms for 30 days (or re-inviting devices that were offline), a lot of machinery for hiding presence. Revisit if groups of three or more become common, or if hiding presence from an evicted device matters.

## Open questions

- None open at the moment.

## Related

- [peer-sync help](/doc/help/peer-sync.md)
- [s3-sync](/doc/s3-sync.md)
- [delta-sync](/doc/completed-projects/2026-10-16_delta-sync.md)
