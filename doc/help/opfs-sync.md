# Sync OPFS ↔ Filesystem

This screen keeps a folder on your local file system and Cashier's private storage (OPFS) in sync, in either direction, file by file. It requires the File System Access API, needed for direct, ongoing access to a folder on disk. Chrome, Edge and other Chromium-based browsers support it; in Brave, first enable it at `brave://flags/#file-system-access-api` and relaunch.

## Setup

1. Click **Select Directory** and choose the folder containing your journal file(s).
2. Grant write permission when prompted — without it, only Filesystem → OPFS updates are possible; the page shows a warning until you click **Reconnect** or re-pick the directory with write access.
3. Adjust **File Spec** if needed — a comma-separated list of glob patterns (default `*.bean, *.toml`).
4. Click **Scan** to compare files on both sides.

## Resolving changes

The scan produces a table with your OPFS copy of each file on the left and the filesystem copy on the right. The middle column shows the action that will be taken:

- **→** copies the OPFS version to the filesystem.
- **←** copies the filesystem version to OPFS.
- **✕** a conflict — the copies differ and both changed since the last sync, or they were never synced; skipped by default.
- **–** skipped — no action.

Click the middle icon on any row to cycle through the available actions if you want to override the default direction (for example, to resolve a conflict manually or force a direction).

Click **Sync N files** to apply the changes. Conflicted files are skipped unless you've manually chosen a direction for them.

After a sync completes, click **Reload Ledger** to make Cashier re-read the updated files.
