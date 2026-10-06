# Peer Sync

Peer Sync transfers data directly between devices over a peer-to-peer connection — no server or cloud storage involved.

## Device & Room

Each device has an editable **Device Name** and a **Room** code (default `cashier`). Devices in the same room can see each other; use a custom room code if you want to keep your devices separate from others.

## Trusting a device

When another device joins your room, it appears under **Peers in Room**. Before you can sync with it, both devices must confirm they see the same **pairing code** — a 6-digit code shown on both screens. Tap **Trust This Device** on each device once you've verified the codes match. Only trusted peers can be selected as a sync source.

Trusted devices are remembered and listed on the **Trusted Devices** page (open it from the **Trusted devices** card on Peer Sync Setup, or from the WebDAV and S3 sync pages). There you can mark a device **read-only** — it stays on the list but its data is ignored — or remove trust at any time.

The same list is used by WebDAV and S3 sync: they merge transactions only from trusted devices, so you can manage trust there even if you never use Peer Sync.

## Syncing from a trusted peer

1. Tap **Sync from** on a trusted peer to open the sync panel.
2. As soon as the peer is selected, the page exchanges content hashes for **Settings**, **Scheduled Transactions**, and **Local Transactions** and marks each one **Same** or **Different** — a quick way to see what's actually changed before pulling anything. A spinner shows while a check is in progress; a **?** means the comparison couldn't complete (peer offline or the request timed out). Tap the refresh icon in the panel header to re-check at any time; it also re-checks automatically after a **Pull** or merge.
3. Check which items to pull: **Settings** and/or **Scheduled Transactions**.
4. Use **Preview** to see the raw remote content, or **Diff** to compare it against your local copy, before committing to anything.
5. Tap **Pull** and confirm — this overwrites your local data with the peer's version and cannot be undone.

**Local Transactions** — the transactions entered on your devices — are merged, not overwritten: **Pull & merge** combines both devices' transactions, so nothing entered on either side is lost. While both devices are connected, new transactions are also sent to trusted peers as you enter them.

Need to sync the rest of your Beancount book (all its files)? Use the **Open Beancount Sync** link below the sync options instead — it compares your full local ledger against the peer's and lets you pull individual files.
