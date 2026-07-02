# Beancount Sync

Open Beancount Sync compares your device's full ledger book — every `*.bean`/`*.toml` file, including `cashier.bean` — against a trusted peer's copy, file by file, and lets you pull the peer's changes.

## Prerequisites

You need at least one trusted peer online. Set that up on the **Peer Sync** page first (device name, room, pairing) if you haven't already; this page reuses the same trust list.

## Picking a peer

Select a trusted, online peer from the list. The page then scans your local files and asks the peer for its file list.

## Reading the file list

Each file shows its status compared to the last time you synced with this peer:

- **Local newer** — you changed this file since the last sync; nothing to pull, never pushed in this version. If the peer still has a copy, you can **Verify** it in case the content actually matches.
- **Remote newer** — the peer changed (or added) this file; default action is **Pull**. **Verify** first if you suspect the two sides only differ by timestamp.
- **Conflict** — both sides changed since the last sync. Choose **Pull** to overwrite your copy, **Skip** to leave it, or tap **Verify** first.
- No badge — unchanged since the last sync.

**Verify** asks both devices to compute a checksum of the file's actual content without transferring it. If the checksums match, the file is marked synced without needing a pull or push; the badge disappears. If they differ, the status is unchanged. A bulk **Verify** bar near the top of the page lets you run this over every **Conflict**, every non-conflict **Newer** row, or **All** of them at once — pick whichever scope you need; per-file **Verify** buttons remain for one-off checks. Checksumming is cheap on a LAN but adds up over the internet on a large book, so start with the smallest scope that covers your case.

**Preview** shows a line-by-line comparison between your copy and the peer's, when both sides have the file. If it turns out the two are already identical, a **Mark as identical** button appears there too — same effect as **Verify**, without a second round trip to hash what the preview already loaded.

## Applying changes

Tap **Pull N files** to download every file currently marked **Pull**. This overwrites the local copy (or removes it, if the peer deleted the file) and cannot be undone. Files marked **Skip** or **Conflict** are left alone.

**Caution:** `cashier.bean` holds this device's own pending quick-entry transactions. Pulling it replaces the whole file with the peer's copy — any entries you added here since the last sync that aren't also on the peer are lost, since this is a whole-file copy, not a merge. Use **Preview**/**Diff** on that row before pulling if you're not sure the two sides agree.

If the peer goes offline mid-session, the page keeps showing your local files but can't classify their status until the peer reconnects.
