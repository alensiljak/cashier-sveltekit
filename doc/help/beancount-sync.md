# Beancount Sync

Open Beancount Sync compares your device's full ledger book — every `*.bean`/`*.toml` file, not just `cashier.bean` — against a trusted peer's copy, file by file, and lets you pull the peer's changes.

## Prerequisites

You need at least one trusted peer online. Set that up on the **Peer Sync** page first (device name, room, pairing) if you haven't already; this page reuses the same trust list.

## Picking a peer

Select a trusted, online peer from the list. The page then scans your local files and asks the peer for its file list.

## Reading the file list

Each file shows its status compared to the last time you synced with this peer:

- **Local newer** — you changed this file since the last sync; nothing to pull, never pushed in this version.
- **Remote newer** — the peer changed (or added) this file; default action is **Pull**.
- **Conflict** — both sides changed since the last sync. Choose **Pull** to overwrite your copy, **Skip** to leave it, or tap **Verify** first.
- No badge — unchanged since the last sync.

**Verify** asks both devices to compute a checksum of the file's actual content without transferring it. If the checksums match, the file is marked synced without needing a pull. If they differ, it stays a conflict.

**Diff** shows a line-by-line comparison between your copy and the peer's, when both sides have the file.

## Applying changes

Tap **Pull N files** to download every file currently marked **Pull**. This overwrites the local copy (or removes it, if the peer deleted the file) and cannot be undone. Files marked **Skip** or **Conflict** are left alone.

If the peer goes offline mid-session, the page keeps showing your local files but can't classify their status until the peer reconnects.
