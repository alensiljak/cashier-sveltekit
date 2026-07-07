# Beancount Sync

Open Beancount Sync compares your device's full ledger book — every `*.bean`/`*.toml` file, including `cashier.bean` — against a trusted peer's copy, file by file, and lets you pull the peer's changes.

## Prerequisites

You need a trusted peer, and you need to be **connected** — toggle **Connect** on the **Peer Sync** page first (device name, room, pairing) if you haven't already; this page reuses the same room connection and trust list, but doesn't join on its own. Until you're connected, this page shows a **Connect via Peer Sync** prompt instead of a peer list.

## Picking a peer

Your local files start scanning as soon as the page opens, before you've picked a peer — on a large book, hashing every file can take a moment, so this gets it out of the way early.

Every trusted peer currently online is also scanned in the background, so the peer list shows each one's live status before you select it: a badge for conflicts needing a decision, one for files ready to **Pull**, or **synced** once nothing differs. Tap a peer to make it active.

## Reading the file list

Each file shows its status compared to the last time you synced with this peer. Every comparison — including whether the two sides are already byte-identical — is based on content hashes, never file timestamps, so clock skew or a resync that rewrites the same content can never produce a false status:

- **Local newer** — you changed this file since the last sync; skipped by default, but you can still choose **Pull** to overwrite it with the peer's copy.
- **Remote newer** — the peer changed (or added) this file; default action is **Pull**.
- **Conflict** — both sides changed since the last sync. Choose **Pull** to overwrite your copy, or **Skip** to leave it.
- No badge — unchanged since the last sync, including when both sides already hold identical content.

Use the toolbar menu's **Show differences only** to collapse the tree down to files that actually need a decision, hiding unchanged files and any folder left with no differing descendant; folders that do have one stay expanded so nothing's buried. Switch back with **Show all files**.

**Preview** shows what applying the row's current selection would do — overwrite, create, or delete the local file for **Pull**, no change for **Skip** — with a line-by-line comparison against the peer's copy where both sides have the file. If it turns out the two are already identical, a **Mark as identical** button appears there too, fast-forwarding this file's synced baseline without waiting for the next scan.

## Applying changes

Tap **Pull N files** to download every file currently marked **Pull**. This overwrites the local copy (or removes it, if the peer deleted the file) and cannot be undone. Files marked **Skip** or **Conflict** are left alone.

**Caution:** `cashier.bean` holds this device's own pending quick-entry transactions. Pulling it replaces the whole file with the peer's copy — any entries you added here since the last sync that aren't also on the peer are lost, since this is a whole-file copy, not a merge. Use **Preview** on that row before pulling if you're not sure the two sides agree.

If the peer goes offline mid-session, the page keeps showing your local files but can't classify their status until the peer reconnects.
