# Peer Sync

Peer Sync transfers data directly between devices over a peer-to-peer connection — no server or cloud storage involved.

## Device & Room

Each device has an editable **Device Name** and a **Room** code (default `cashier`). Devices in the same room can see each other; use a custom room code if you want to keep your devices separate from others.

## Trusting a device

When another device joins your room, it appears under **Peers in Room**. Before you can sync with it, both devices must confirm they see the same **pairing code** — a 6-digit code shown on both screens. Tap **Trust This Device** on each device once you've verified the codes match. Only trusted peers can be selected as a sync source.

Trusted devices are remembered and listed under **Trusted Devices**, where you can remove trust for a device at any time.

## Syncing from a trusted peer

1. Tap **Sync from** on a trusted peer to open the sync panel.
2. As soon as the peer is selected, the page exchanges content hashes for **cashier.bean**, **Settings**, and **Scheduled Transactions** and marks each one **Same** or **Different** — a quick way to see what's actually changed before pulling anything. A spinner shows while a check is in progress; a **?** means the comparison couldn't complete (peer offline or the request timed out). Tap the refresh icon in the panel header to re-check at any time; it also re-checks automatically after a **Pull** or merge.
3. Check which items to pull: **cashier.bean**, **Settings**, and/or **Scheduled Transactions**.
4. Use **Preview** to see the raw remote content, or **Diff** to compare it against your local copy, before committing to anything.
5. Tap **Pull** and confirm — this overwrites your local data with the peer's version and cannot be undone.

Need to sync the rest of your Beancount book (all files, not just `cashier.bean`)? Use the **Open Beancount Sync** link below the sync options instead — it compares your full local ledger against the peer's and lets you pull individual files.
