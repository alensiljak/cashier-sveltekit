# Peer Sync

Peer Sync transfers data directly between devices over a peer-to-peer connection — no server or cloud storage involved.

## Your device

Each device has an editable **Device Name** (on the Setup page) and a **fingerprint** such as `7KQ2-M9XA`, made from the device's secret key. Names are only labels and several devices can share one, so other devices show your name together with the fingerprint (`Anna's phone · 7KQ2-M9XA`).

## Pairing a device

Devices meet in a **private room** that only paired devices know, so strangers never see them. To pair two devices:

1. On the first device, tap **Invite a device**. Send the link it shows to the other device (any chat will do). The link works once and expires after 10 minutes.
2. On the other device, open the link, or paste it into **Paste invite link** on the Peer Sync page, and tap **Join**. If the app is not set up on that device yet, finish setup first and then paste the link.
3. The first device shows `Anna's phone · 7KQ2-M9XA wants to join`. Check that it is the device you invited, then tap **Approve**. Both devices now trust each other, and the second joins the first one's private room.

Someone who gets hold of the link can only ask to join; nothing is trusted until you tap **Approve**, and an unexpected name or fingerprint shows up on that screen. If you are unsure, tap **Reject**.

A device that was trusted before devices proved their identity (or was trusted through S3 or WebDAV only) shows **Invite again** until it is paired this way. A device that shows **Key changed** is using a different key than the trusted device with the same ID; remove the trusted device and pair again if you recognise it.

If a device already belongs to a group of paired devices, joining another group replaces its group: the devices paired before have to be invited again.

## Introduced devices

You do not have to invite a new device from every device. Once a device you trust has paired it, it tells your other devices about it the next time they connect. An **Introduced devices** card on the Peer Sync page then asks "Introduced by Laptop": compare the fingerprint with the device itself and tap **Trust** or **Dismiss**. The new device gets the same kind of question about the devices of the one that invited it. Two devices sync only after both have said yes.

## Trusted devices

Only trusted peers can be selected as a sync source. You can rename a trusted device on the **Trusted Devices** page; the name it announces is kept next to your label.

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
