# WebDAV Backup

WebDAV Backup uploads and downloads your data to/from a WebDAV folder, letting you back up a single device or exchange data between multiple Cashier instances.

Before using it, open **WebDAV Config** from the toolbar menu (also under Settings) and set the folder URL, username, and password/app token.

## Files

Three items can be backed up independently:

- **Local Transactions** — the transactions entered on this device. They are saved as a per-device file, so devices never overwrite each other.
- **Settings**
- **Scheduled Transactions**

Check the ones you want, or use **Select all**. Each item shows the last-modified time on the remote, refreshed automatically or via the refresh icon.

Tap the arrow next to **Local Transactions** to list the files of all devices in the folder. Files from trusted devices are merged into yours on **Download**.

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
