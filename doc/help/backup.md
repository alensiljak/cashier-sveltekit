# Backup

The Backup screen saves your data and configuration to a file, and restores it later, for example on a new or cleaned phone. The file does not have to hold everything: you choose what goes in.

## Create Backup

Tick what the backup should include (everything is ticked at first):

- **Settings** — accounts, groups, budget, formats, forecast and the other shared settings.
- **Scheduled transactions**
- **Transactions** — the working set of transactions you entered on this device.
- **Device settings and sync configuration** — home cards, notifications, the WebDAV, S3 and Peer Sync options, the names of the import and export folders. The device's own identity and sync progress are not included.
- **Trusted devices** — the Peer Sync links, so you do not have to pair every device again.

Click **Backup** to download a file named with the current date and time, or **Share** to send it directly via your device's share sheet (where supported by the browser).

### Credentials

By default the file contains **no credentials**: the WebDAV password, the S3 access key and secret key, the S3 and WebDAV encryption passphrases and the TURN server credentials are left out. Everything else of those settings (server URL, bucket, user name, on/off switches) is in the file, so after a restore you only fill in the blanks, for instance by copying the values from your password manager. The pages mark the missing fields as **required**.

To put the credentials in the file as well, switch on **Include credentials, encrypted** and enter a passphrase. Use a long random one (the **Generate** button makes one) and keep it in your password manager. The passphrase is not stored anywhere: without it the credentials in the file cannot be recovered, though the rest of the file can still be restored.

The file also records a format version, so a newer backup is never half-restored by an older app.

## Restore Backup

Click the file chooser, select a previously-created backup file, then choose which of the sections it holds to restore and confirm.

- **Settings** and **scheduled transactions** replace what is already on the device.
- **Transactions** and **trusted devices** are added to what is there. Nothing is overwritten, and a device you evicted is not brought back.
- If the file has credentials, enter its passphrase. Leave it empty, or enter a wrong one, and everything else is still restored; restore the file again to get the credentials.

An invalid file is rejected before anything is changed.

After restoring on a new device:

- Fill in the fields marked **required** on the WebDAV and S3 configuration pages.
- Pick the import and export folders again (the browser does not keep access to a folder across devices); their pages mark them as required.
- Reload the Asset Allocation definition file, if you use one (it's stored separately in OPFS and isn't included in the backup) — see [File Storage](/help/opfs-file-storage).
- Re-run a sync or import to bring in the latest journal data — see [Sync OPFS ↔ Filesystem](/help/opfs-sync) or [Ledger Import](/help/ledger-import).
- **Pair the device again.** A restored device is a new device with a key of its own, so the others do not trust it yet. Invite it from one of them (see [Peer Sync](/help/peer-sync)); that device then introduces it to the rest, which each ask you to approve it.

### The old device

The backup remembers which device it was made on. After a restore on a different device, this device reads what the old one uploaded to S3 or WebDAV as its own, so none of its changes are missed. A notice (here and on Trusted Devices) asks what became of the old device:

- **It is lost** — at the next sync its files are merged here and removed from the bucket.
- **It is still in use** — nothing is removed, and the old device is paired and trusted like any other.

## Older backup files

Files made before the format version existed (settings and scheduled transactions only) can still be restored.
