# Backup

The Backup screen saves your data and configuration to a file, and restores it later, for example on a new or cleaned phone. The file does not have to hold everything: you choose what goes in.

A backup is a copy of your data as it is at that moment. It does not change afterwards, and nothing happens until you restore it. It is not [Sync](/help/sync), which keeps exchanging changes between devices and so spreads deletions and mistakes too.

## Create Backup

Tick what the backup should include:

- **Shared settings** — accounts, groups, budget, formats, forecast and the other settings your devices share. On at first.
- **Working set** — the new transactions you entered. On at first.
- **Scheduled transactions** — on at first.
- **This device** — the device settings (home cards, device name, notifications, the WebDAV, S3 and Peer Sync options, HTTP proxy, speech settings, the stale-sync warning) and the trusted Peer Sync devices, so you do not have to pair every device again. On at first. The device's own signing key and sync progress are not included, and neither are the names of the import and export folders.
- **Credentials** — off at first, see below.

Click **Backup** to download a compressed file (`.json.gz`) named with the current date and time, or **Share** to send it via your device's share sheet (where supported by the browser). Where the browser cannot share a compressed file, Share sends it as plain JSON, which can be restored the same way.

### Credentials

Without **Credentials**, the file contains none: no passwords, keys or tokens. The rest of a connection (server URL, bucket, user name, proxy URL) is in **Shared settings** (WebDAV) or **This device**, so after a restore you only fill in the blanks, for instance by copying the values from your password manager. The pages mark the missing WebDAV and S3 fields as **required**.

With **Credentials** switched on, the file also holds all of these, whatever else you ticked:

- the WebDAV and S3 connections, with the S3 and WebDAV encryption passphrases
- the TURN servers and the HTTP proxy
- the Mistral and Aware Super API keys
- the Scalable Capital tokens
- the Enable Banking application ID, private key and bank sessions

Each connection is stored whole, so its secret stays with its address. They are encrypted with a passphrase you enter. Use a long random one (the **Generate a random one** button makes one) and keep it in your password manager. The passphrase is not stored anywhere: without it the credentials cannot be recovered, though the rest of the file can still be restored. Which credentials the file holds can be seen without the passphrase.

An old token or an expired bank session can still require you to sign in again.

Credentials are never synced between devices. This group is the only way they leave the device.

## Restore Backup

On a new device, choose **Restore from backup** on the welcome screen. It sets up an empty app and opens the Backup screen.

Click the file chooser and select a backup file, compressed or not. The page shows its format version, whether it is compressed and whether it has encrypted credentials. Groups the file does not have are greyed out. Choose what to restore and click **Restore**.

Restoring changes this device only. If you sync afterwards, anything in the backup that was never synced reaches your other devices too.

- **Shared settings** replace what is already on the device. Untick them to keep your current settings. An empty settings list is not restored, as it would erase your settings.
- **Working set** and **scheduled transactions** are merged with what is there. Before you restore, the page shows how many records of each would be added, changed and deleted.
- **This device** overwrites the device settings the file has; others stay. **Trusted devices** are added: none is overwritten, and a device you evicted is not brought back. Notifications are turned on only if the browser already allows them here. Otherwise turn them on in [Settings](/help/settings). The reminder time is always restored.
- **Credentials** need the file's passphrase. Each connection and key in the file replaces the local one as a whole; the others stay. Leave the passphrase empty, or enter a wrong one, and everything else is still restored; restore the file again to get the credentials. Without credentials, a secret already on this device is kept only if it belongs to the same connection.

Files of backup format 2 hold only the secret fields, not whole connections. If you restore their credentials without **This device**, a secret is added only to a local connection with the same address.

An invalid or damaged file is rejected before anything is changed. So is a file made by a newer version of Cashier: update the app first.

After restoring on a new device:

- Fill in the fields marked **required** on the WebDAV and S3 configuration pages.
- Pick the import and export folders again on their pages (the browser does not keep access to a folder across devices).
- Import your Beancount files, as a backup does not hold them — see [Ledger Import](/help/ledger-import) or [Sync OPFS ↔ Filesystem](/help/opfs-sync). That includes the Asset Allocation definition file, if you use one; check [File Storage](/help/opfs-file-storage) that it is there.
- **Pair the device again.** A restored device is a new device with a key of its own, so the others do not trust it yet. Add it from one of them (see [Peer Sync](/help/peer-sync)); that device then introduces it to the rest, which each ask you to approve it.

### Trusted devices

**Restore trusted devices only from a file you trust.** A trusted device can send data to this one. The page shows how many the file holds and how many would be added. Devices already on the list, and ones you evicted, are not added.

An old backup can trust a device that you evicted later. A new device does not know about the eviction until it receives it from another one, so check the Trusted Devices page after restoring an old file.

### Merging and starting over

The working set and the scheduled transactions are never replaced by a restore. What you get depends on what the device holds beforehand:

| You want to                                 | Do this               | Result                                                  |
| ------------------------------------------- | --------------------- | ------------------------------------------------------- |
| set up a new device                         | restore               | the backup's data; a sync brings newer changes          |
| start over on a device that has data        | destroy, then restore | the backup's data; a sync brings newer changes          |
| combine the backup with what is on a device | restore               | the backup's changes are merged into this device's data |

You choose for each of the two, so you can destroy one and merge the other.

Merging adds only what this device has not seen. A record you deleted after the backup was made does not come back, and a record you edited since keeps the newer version: the device remembers both changes. So restoring an older backup of this same device may change nothing. A backup that holds changes made on another device can change or delete records here. If the same record was edited in both places, the newer edit does not necessarily win.

Resets (see [Settings](/help/settings)) also affect merging:

- A backup made before a store was reset is ignored.
- A backup made after a store was reset on another device replaces this device's copy. Records here that the other device had not seen when it was reset are kept. If changes that were not uploaded yet would be lost, you are asked first; if you choose to wait, the store is not changed.

If you tried the demo data, its records are merged with the restored ones. Destroy the stores before restoring over it.

To return to the backup's state, destroy the store first, then restore. For each selected store that holds data or history, the page has a **Destroy** button in a box with a red border. It asks for its own confirmation (see [Settings](/help/settings) for what destroying does), and the chosen file stays selected. If you sync afterwards, a mistake that was already synced comes back.

If a restore adds nothing to a store, the page says so and keeps the file selected.

### The old device

The backup remembers which device it was made on. After a restore on a different device that has never synced, this device reads what the old one uploaded to S3 or WebDAV as its own, so none of its changes are missed. A notice (here and on Trusted Devices) asks what became of the old device:

- **It is lost** — at the next sync its files are merged here and removed from the bucket.
- **It is still in use** — nothing is removed, and the old device is paired and trusted like any other.

On a device that has already synced, the backup's device is not taken over: it stays a device of its own.

## Older backup files

Files made before the format version existed (settings and scheduled transactions only) can still be restored.

Files of backup format 1 and 2 hold the scheduled transactions as a list, without their history. Restoring them **adds** the entries this device does not have; existing ones stay as they are and nothing is deleted. Without history, sync cannot tell that the restored entries are older. After a sync, deleted entries can come back, or old versions can replace newer edits, also on other devices. This applies even if you destroyed the store first. If sync has your current scheduled transactions, leave them out of the restore and sync instead.
