# Peer Sync

Peer Sync transfers data directly between devices over a peer-to-peer connection — no server or cloud storage involved.

## Your device

Each device has an editable **Device Name** (on the Setup page) and a **fingerprint** such as `7KQ2-M9XA`, made from the device's secret key. Names are only labels and several devices can share one, so other devices show your name together with the fingerprint (`Anna's phone · 7KQ2-M9XA`).

## Sync groups

Devices find each other only when they are in the same **sync group**. A group meets in a private room that only its devices know, so strangers never see them. Until a device is in a group, the Peer Sync page asks you to choose:

- **Start a new sync group** on your first device.
- **Join with invite code** on a device that should join an existing group.

Each browser is a separate device: installing Cashier in a second browser means joining the group from that browser too.

The page shows the group's ID, such as `A1B2-C3D4`, and its devices, including those that are not connected. Two devices that show different IDs are in different groups and will not see each other. The ID cannot be used to join.

## Adding a device

1. On a device in the group, tap **Add a device**. (**Start a new sync group** opens the same screen.) Tap **Copy code** and get the code to the other device (any chat will do). The code works once and expires after 10 minutes.
2. On the other device, open Peer Sync, tap **Join with invite code**, paste the code and tap **Join**. If the app is not set up on that device yet, finish setup first. **Share link…** sends a link instead, which opens in the device's default browser; if that is not the browser you use Cashier in, paste the link or code there.
3. The first device shows `Anna's phone · 7KQ2-M9XA wants to join`. Check that it is the device you invited, then tap **Approve**. Both devices now trust each other, and the second joins the group, using the same discovery network. Pairing also records the Beancount files both devices already hold as the starting point for [Beancount Sync](/help/beancount-sync), so they don't show as conflicts just because they were never synced before.

Someone who gets hold of the code can only ask to join; nothing is trusted until you tap **Approve**, and an unexpected name or fingerprint shows up on that screen. If you are unsure, tap **Reject**.

A device that was trusted before devices proved their identity (or was trusted through S3 or WebDAV only) shows **Invite again** until it is paired this way. A device that shows **Key changed** is using a different key than the trusted device with the same ID; remove the trusted device and pair again if you recognise it.

A device is in one group at a time. Joining another group moves it there: to sync with the devices of the old group again, they have to join the new one.

## Introduced devices

You do not have to invite a new device from every device. Once a device you trust has paired it, it tells your other devices about it the next time they connect. An **Introduced devices** card on the Peer Sync page then asks "Introduced by Laptop": compare the fingerprint with the device itself and tap **Trust** or **Dismiss**. The new device gets the same kind of question about the devices of the one that invited it. Two devices sync only after both have said yes.

## Trusted devices

Only trusted peers can be selected as a sync source. You can rename a trusted device on the **Trusted Devices** page; the name it announces is kept next to your label.

Trusted devices are remembered and listed on the **Trusted Devices** page (open it from the **Trusted devices** card on Peer Sync Setup, or from the WebDAV and S3 sync pages). There you can mark a device **read-only** — it stays on the list but its data is ignored — or remove trust at any time.

The same list is used by WebDAV and S3 sync: they merge transactions only from trusted devices, so you can manage trust there even if you never use Peer Sync.

## Syncing from a trusted peer

1. Tap **Sync from** on a trusted peer to open the sync panel.
2. As soon as the peer is selected, the page exchanges content hashes for **Shared settings**, the **Working set** and the **Scheduled transactions** and marks each one **Same** or **Different** — a quick way to see what's actually changed before pulling anything. A spinner shows while a check is in progress; a **?** means the comparison couldn't complete (peer offline or the request timed out). Tap the refresh icon in the panel header to re-check at any time; it also re-checks automatically after a **Pull** or merge.
3. For **Shared settings**, use **Diff** to compare the peer's copy with yours. From there you can merge them entry by entry.
4. Tap **Pull** next to **Shared settings** and confirm to replace yours with the peer's. This cannot be undone.
5. Tap **Pull & merge** next to the **Working set** or the **Scheduled transactions** to merge them.

**Settings and credentials:** the shared settings are sent without the WebDAV password, and comparison and preview views do not show it. A password in a copy that an older version uploaded is ignored. Taking settings from elsewhere keeps the password on this device, as long as the server URL and user name are the same; otherwise enter it again in **WebDAV Config**. An empty settings list is not uploaded, and a list that is empty or damaged is not applied: your settings stay as they are, and an error is shown.

The **working set** — the new transactions entered on your devices — and the **scheduled transactions** are merged, not overwritten: **Pull & merge** combines both devices' transactions, so nothing entered on either side is lost. While both devices are connected, new transactions are also sent to trusted peers as you enter them.

Need to sync the rest of your Beancount book (all its files)? Use the **Open Beancount Sync** link below the sync options instead — it compares your full local ledger against the peer's and lets you pull individual files.
