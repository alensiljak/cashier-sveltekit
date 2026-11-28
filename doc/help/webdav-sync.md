# WebDAV Sync

WebDAV Sync exchanges your data with a folder on a WebDAV server, so that several Cashier devices can share it. It is [sync](/help/sync), not a backup: to keep a copy of your data as it is now, use [Backup](/help/backup).

Before using it, open **WebDAV Config** from the toolbar menu (also under Settings) and set the folder URL, username, and password/app token.

## Files

Three items can be synced independently:

- **Shared settings**
- **Scheduled transactions**
- **Working set** — the new transactions you entered.

Check the ones you want, or use **Select all**. Each item shows the last-modified time on the remote, refreshed automatically or via the refresh icon.

For the working set and the scheduled transactions, only the changes since the last upload are sent, as small numbered files of this device, so devices never overwrite each other and little data is transferred.

Tap the arrow next to **Working set** to list the devices that have uploaded to the folder. What trusted devices uploaded is merged into yours on **Download**. Tap **Trust** on an unknown device to add it, or open **Manage trusted devices** to mark a device read-only or remove its trust. The trash icon deletes a device's files from the folder; if the device is trusted, its changes are merged here and kept for the other devices first.

The uploaded changes pile up in the folder. **Compact now** (next to the refresh link) folds them into one snapshot and deletes the files every device has already applied. This also happens automatically after enough uploads. A device that was away for a long time simply takes the snapshot.

**Upload changes automatically**, in **WebDAV Config**, uploads the working set and the scheduled transactions as you change them. It does not download.

## Encryption

**Settings and credentials:** the shared settings are sent without the WebDAV password, and comparison and preview views do not show it. A password in a copy that an older version uploaded is ignored. Taking settings from elsewhere keeps the password on this device, as long as the server URL and user name are the same; otherwise enter it again in **WebDAV Config**. An empty settings list is not uploaded, and a list that is empty or damaged is not applied: your settings stay as they are, and an error is shown.

In **WebDAV Config** you can switch on **Encrypt synced transactions**. The files of the working set and the scheduled transactions are then encrypted with a passphrase before they leave the device (the shared settings are not). Use the same passphrase on every device; it is kept on the device only.

If the folder already holds files when you switch encryption on, or is encrypted when you switch it off, Cashier offers to convert every file in the folder. Do this on one device while the others are not syncing; afterwards set the same on the others. A device whose setting does not match the folder refuses to sync and says so. Starting a conversion again after an interruption is safe.

## Actions

- **Upload** — sends the checked items to the WebDAV folder. The shared settings replace the copy there.
- **Download** — gets the checked items from the WebDAV folder. The shared settings replace the ones on this device, so a confirmation is asked first. The working set and the scheduled transactions are merged instead. After the working set, a **Reload Ledger** button appears.
- **Diff** — shows a line-by-line comparison between the shared settings here and in the folder.
- **Preview Local** / **Preview Remote** — shows the shared settings on either side, without changing anything.

The working set and the scheduled transactions are merged rather than compared, so Diff and Preview don't include them.

## Setting up a WebDAV server

Any WebDAV server works, but the simplest option is [RClone](https://rclone.org/), which can expose local storage or many cloud providers as a WebDAV endpoint without Cashier ever handling your cloud credentials directly:

```
rclone serve webdav <source> --allow-origin "*"
```

`<source>` is any storage remote RClone supports — a local folder or a configured cloud provider.

If the file listing looks stale, add a short `--dir-cache-time`, e.g. `--dir-cache-time 10s`.
