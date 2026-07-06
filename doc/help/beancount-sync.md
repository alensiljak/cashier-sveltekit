# Beancount Sync

Open Beancount Sync compares your device's full ledger book — every `*.bean`/`*.toml` file, including `cashier.bean` — against a trusted peer's copy, file by file, and lets you pull the peer's changes.

## Prerequisites

You need at least one trusted peer online. Set that up on the **Peer Sync** page first (device name, room, pairing) if you haven't already; this page reuses the same trust list.

## Picking a peer

Select a trusted, online peer from the list. The page then scans your local files and asks the peer for its file list.

## Reading the file list

Each file shows its status compared to the last time you synced with this peer. Every comparison — including whether the two sides are already byte-identical — is based on content hashes, never file timestamps, so clock skew or a resync that rewrites the same content can never produce a false status:

- **Local newer** — you changed this file since the last sync; skipped by default, but you can still choose **Pull** to overwrite it with the peer's copy.
- **Remote newer** — the peer changed (or added) this file; default action is **Pull**.
- **Conflict** — both sides changed since the last sync. Choose **Pull** to overwrite your copy, or **Skip** to leave it.
- No badge — unchanged since the last sync, including when both sides already hold identical content.

**Preview** shows a line-by-line comparison between your copy and the peer's, when both sides have the file. If it turns out the two are already identical, a **Mark as identical** button appears there too, fast-forwarding this file's synced baseline without waiting for the next scan.

## Applying changes

Tap **Pull N files** to download every file currently marked **Pull**. This overwrites the local copy (or removes it, if the peer deleted the file) and cannot be undone. Files marked **Skip** or **Conflict** are left alone.

**Caution:** `cashier.bean` holds this device's own pending quick-entry transactions. Pulling it replaces the whole file with the peer's copy — any entries you added here since the last sync that aren't also on the peer are lost, since this is a whole-file copy, not a merge. Use **Preview**/**Diff** on that row before pulling if you're not sure the two sides agree.

If the peer goes offline mid-session, the page keeps showing your local files but can't classify their status until the peer reconnects.
