# Backup

The Backup screen saves your data and configuration to a file, and restores it later, for example on a new or cleaned phone. The file does not have to hold everything: you choose what goes in.

## Create Backup

Tick what the backup should include:

- **Shared settings** — accounts, groups, budget, formats, forecast and the other settings your devices share. Always included.
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

Click the file chooser and select a backup file, compressed or not. The page shows its format version, whether it is compressed and whether it has encrypted credentials. Groups the file does not have are greyed out. Choose what to restore and click **Restore**.

- **Shared settings** replace what is already on the device, and are always restored when the file has them. An empty settings list is not restored, as it would erase your settings.
- **Working set** and **scheduled transactions** are merged with what is there. Before you restore, the page shows how many records of each would be added, changed and deleted.
- **This device** overwrites the device settings the file has; others stay. **Trusted devices** are added: none is overwritten, and a device you evicted is not brought back. Notifications are turned on only if the browser already allows them here. Otherwise turn them on in [Settings](/help/settings). The reminder time is always restored.
- **Credentials** need the file's passphrase. Each connection and key in the file replaces the local one as a whole; the others stay. Leave the passphrase empty, or enter a wrong one, and everything else is still restored; restore the file again to get the credentials. Without credentials, a secret already on this device is kept only if it belongs to the same connection.

Files of backup format 2 hold only the secret fields, not whole connections. If you restore their credentials without **This device**, a secret is added only to a local connection with the same address.
An invalid file is rejected before anything is changed.

After restoring on a new device:

- Fill in the fields marked **required** on the WebDAV and S3 configuration pages.
- Pick the import and export folders again on their pages (the browser does not keep access to a folder across devices).
- Reload the Asset Allocation definition file, if you use one (it's stored separately in OPFS and isn't included in the backup) — see [File Storage](/help/opfs-file-storage).
- Re-run a sync or import to bring in the latest journal data — see [Sync OPFS ↔ Filesystem](/help/opfs-sync) or [Ledger Import](/help/ledger-import).
- **Pair the device again.** A restored device is a new device with a key of its own, so the others do not trust it yet. Add it from one of them (see [Peer Sync](/help/peer-sync)); that device then introduces it to the rest, which each ask you to approve it.

### Merging and starting over

Merging adds what this device has not seen. It does **not** undo what you deleted or edited after the backup was made, so an older backup of this device may change nothing. A backup that holds changes made on another device can change or delete records here. A backup made before a store was reset is ignored.

To return to the backup's state, destroy the store first, then restore. For each selected store that holds data or history, the page has a **Destroy** button in a box with a red border. It asks for its own confirmation (see [Settings](/help/settings) for what destroying does), and the chosen file stays selected.

If a restore adds nothing to a store, the page says so and keeps the file selected.

### The old device

The backup remembers which device it was made on. After a restore on a different device that has never synced, this device reads what the old one uploaded to S3 or WebDAV as its own, so none of its changes are missed. A notice (here and on Trusted Devices) asks what became of the old device:

- **It is lost** — at the next sync its files are merged here and removed from the bucket.
- **It is still in use** — nothing is removed, and the old device is paired and trusted like any other.

On a device that has already synced, the backup's device is not taken over: it stays a device of its own.

## Older backup files

Files made before the format version existed (settings and scheduled transactions only) can still be restored.

Files of backup format 1 and 2 hold the scheduled transactions as a list, without their history. Restoring them **adds** the entries this device does not have; existing ones stay as they are and nothing is deleted. Without history, sync cannot tell that the restored entries are older. After a sync, deleted entries can come back, or old versions can replace newer edits, also on other devices. This applies even if you destroyed the store first. If sync has your current scheduled transactions, leave them out of the restore and sync instead.
