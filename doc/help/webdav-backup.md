# WebDAV Backup

WebDAV Backup uploads and downloads your data to/from a WebDAV folder, letting you back up a single device or exchange data between multiple Cashier instances.

Before using it, open **WebDAV Config** from the toolbar menu (also under Settings) and set the folder URL, username, and password/app token.

## Files

Three items can be backed up independently:

- **Local Transactions** — the transactions entered on this device. Only the changes since the last upload are sent, as small numbered files of this device, so devices never overwrite each other and little data is transferred.
- **Settings**
- **Scheduled Transactions**

Check the ones you want, or use **Select all**. Each item shows the last-modified time on the remote, refreshed automatically or via the refresh icon.

Tap the arrow next to **Local Transactions** to list the devices that have uploaded to the folder. What trusted devices uploaded is merged into yours on **Download**. Tap **Trust** on an unknown device to add it, or open **Manage trusted devices** to mark a device read-only or remove its trust. The trash icon deletes a device's files from the folder; if the device is trusted, its changes are merged here and kept for the other devices first.

The uploaded changes pile up in the folder. **Compact now** (next to the refresh link) folds them into one snapshot and deletes the files every device has already applied. This also happens automatically after enough uploads. A device that was away for a long time simply takes the snapshot.

## Actions

- **Upload** — sends the checked items to the WebDAV folder, overwriting the remote copies.
- **Download** — pulls the checked items from the WebDAV folder. Settings and Scheduled Transactions overwrite local data, so a confirmation is asked first. Local Transactions are merged instead, so nothing is lost; afterwards a **Reload Ledger** button appears.
- **Diff** — shows a line-by-line comparison between the local and remote versions of the checked Settings and Scheduled Transactions.
- **Preview Local** / **Preview Remote** — shows the raw content of the checked Settings and Scheduled Transactions on either side, without changing anything.

Local Transactions are a binary file, so Diff and Preview don't include them.

## Setting up a WebDAV server

Any WebDAV server works, but the simplest option is [RClone](https://rclone.org/), which can expose local storage or many cloud providers as a WebDAV endpoint without Cashier ever handling your cloud credentials directly:

```
rclone serve webdav <source> --allow-origin "*"
```

`<source>` is any storage remote RClone supports — a local folder or a configured cloud provider.

If the file listing looks stale, add a short `--dir-cache-time`, e.g. `--dir-cache-time 10s`.
