# WebDAV Backup

WebDAV Backup uploads and downloads your data to/from a WebDAV folder, letting you back up a single device or exchange data between multiple Cashier instances.

Before using it, open **WebDAV Config** from the toolbar menu (also under Settings) and set the folder URL, username, and password/app token.

## Files

Three items can be backed up independently:

- **cashier.bean** — your main journal file.
- **Settings**
- **Scheduled Transactions**

Check the ones you want, or use **Select all**. Each item shows the last-modified time on the remote, refreshed automatically or via the refresh icon.

If your local `cashier.bean` has changes newer than what's on the remote, a cloud-upload icon appears next to it as a reminder to back it up.

## Actions

- **Upload** — sends the checked items to the WebDAV folder, overwriting the remote copies.
- **Download** — after a confirmation (since this overwrites local data), pulls the checked items from the WebDAV folder.
- **Diff** — shows a line-by-line comparison between the local and remote versions of the checked items.
- **Preview Local** / **Preview Remote** — shows the raw content of the checked items on either side, without changing anything.

## Setting up a WebDAV server

Any WebDAV server works, but the simplest option is [RClone](https://rclone.org/), which can expose local storage or many cloud providers as a WebDAV endpoint without Cashier ever handling your cloud credentials directly:

```
rclone serve webdav <source> --allow-origin "*"
```

`<source>` is any storage remote RClone supports — a local folder or a configured cloud provider.

If the file listing looks stale, add a short `--dir-cache-time`, e.g. `--dir-cache-time 10s`.
