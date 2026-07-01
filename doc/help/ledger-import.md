# Ledger Import

Import Ledger to OPFS copies Beancount files from a folder on your local file system into Cashier's private storage (OPFS), one-way, from disk into the app.

Use this if your browser doesn't support live file system access, or if you just want a one-time snapshot copy instead of an ongoing two-way link. For a live, two-way link to a folder, use [Sync OPFS ↔ Filesystem](/help/opfs-sync) instead.

## Steps

1. Click **Select Directory** and choose the folder containing your journal file(s). On browsers without folder-picker support, this instead opens a fallback file selector.
2. Adjust **File Spec** if needed — a comma-separated list of glob patterns (default `*.bean, *.toml`). Matched files are copied recursively, preserving their folder structure.
3. Click **Scan** to compare the folder against what was previously imported. Files are reported as new, modified, identical, or deleted (removed from the source since the last import).
4. Choose an import mode:
   - **Sync new, modified & deleted** — copies only changed files and removes files that were deleted from the source.
   - **Re-copy all** — copies every matched file regardless of status.
5. Click **Import**.
6. Once done, click **Reload Ledger** to make Cashier re-read the freshly imported files.
