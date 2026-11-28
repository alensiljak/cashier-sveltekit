# Sync

Sync keeps your devices up to date with each other by exchanging changes, again and again. The Sync page shows the channels you use and whether they have changes to exchange. Choose the channels in [Settings](/help/settings), under **Sync**.

- [WebDAV Sync](/help/webdav-sync) — through a folder on a WebDAV server.
- **S3** — through a bucket in S3-compatible storage.
- [Peer Sync](/help/peer-sync) — directly between two devices that are online at the same time.

## Sync is not a backup

|                       | Sync                           | [Backup](/help/backup)                       |
| --------------------- | ------------------------------ | -------------------------------------------- |
| What it is            | an ongoing exchange of changes | a copy of your data as it was at one moment  |
| Where the data goes   | WebDAV, S3 or another device   | a file that you keep                         |
| A deletion or mistake | spreads to your other devices  | does not change a file you saved before it   |
| What you use it for   | working on several devices     | keeping a copy, or setting up a device again |
| Credentials           | never sent                     | only if you ask for it, encrypted            |

A synced server or bucket is not a backup, even though it holds your data: mistakes reach it too, and clean-up removes old history. Make a [Backup](/help/backup) if you want something to go back to.
