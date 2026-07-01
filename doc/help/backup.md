# Backup

The Backup screen lets you save all locally-created data to a file, and restore it later.

## Create Backup

The backup includes:

- Transactions
- Scheduled Transactions
- Settings

Click **Backup** to download a file named with the current date and time, or **Share** to send it directly via your device's share sheet (where supported by the browser).

## Restore Backup

Click the file chooser, select a previously-created backup file, and confirm the restore. This overwrites any transactions, scheduled transactions, and settings already on the device.

After restoring a backup, you should also:

- Reload the Asset Allocation definition file, if you use one (it's stored separately in OPFS and isn't included in the backup) — see [File Storage](/help/opfs-file-storage).
- Re-run a sync or import to bring in the latest journal data — see [Sync OPFS ↔ Filesystem](/help/opfs-sync) or [Ledger Import](/help/ledger-import).
