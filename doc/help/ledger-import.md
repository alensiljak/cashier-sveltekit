# Ledger Import

Import Ledger to OPFS copies Beancount files from a folder on your local file system into Cashier's private storage (OPFS), one-way, from disk into the app.

Use this if your browser doesn't support live file system access, or if you just want a one-time snapshot copy instead of an ongoing two-way link. For a live, two-way link to a folder, use [Sync OPFS ↔ Filesystem](/help/opfs-sync) instead.

## Steps

1. Click **Select Directory** and choose the folder containing your journal file(s). If the page shows **Reconnect**, click it to grant access to the folder you picked earlier.
2. Adjust **File Spec** if needed — a comma-separated list of glob patterns (default `*.bean, *.toml`). Matched files are copied recursively, preserving their folder structure. Folders whose names start with a dot (such as `.git`) are skipped.
3. Click **Scan** to compare the folder with Cashier's storage. Contents decide whether files differ, so a file changed on both sides in the same way is identical. Line endings are ignored.
4. Choose an import mode:
   - **Sync new, modified & deleted** — copies changed files and removes files that were deleted from the source. Files with changes in Cashier are kept unless you tick them (see below).
   - **Re-copy all** — copies every matched file regardless of status, **replacing changes made in Cashier**.
5. Click **Import**.
6. Once done, click **Reload Ledger** to make Cashier re-read the freshly imported files.

## File statuses

- **new** — not in Cashier's storage yet.
- **modified** — changed in the source only.
- **local** — changed in Cashier only, for example by peer sync.
- **conflict** — the two copies differ and both changed since the last import, or there is no earlier import to compare with.
- **identical** — same contents on both sides.
- **deleted** — removed from the source since the last import.

**local** and **conflict** files are kept as they are unless you tick **overwrite**. A file removed from the source but changed in Cashier is a **conflict** too, deleted only if you tick **delete**. Use **diff** to compare before deciding. To bring Cashier's changes back to your folder, use [Ledger Export](/help/ledger-export).

## Browser support

The page says which method your browser supports.

- **File System Access API** (Chrome, Edge, Vivaldi and other Chromium-based browsers): the selected folder is remembered. You may be asked to **Reconnect** on a later visit.
- **File upload** (for example Firefox, or Brave with default settings): select the folder again on each visit. The browser may ask you to "upload" the files, but they stay on your device. In Brave, you can enable the File System Access API at `brave://flags/#file-system-access-api`, then relaunch.
