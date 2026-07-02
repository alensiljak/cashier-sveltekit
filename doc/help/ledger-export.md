# Ledger Export

Export Ledger from OPFS copies Beancount files the other direction from Import: Cashier's private storage (OPFS) is the source of truth, and the whole directory structure is written out to your local file system.

`.cashier/` (Cashier's internal binary cache and hash) and `cashier.bean` (the on-device transaction store) are never exported — they're app-local bookkeeping, not part of your book.

## Steps

1. On browsers that support the File System Access API (Chrome, Edge, and similar), click **Select Destination** and choose a folder. Files are written into it, overwriting anything at a matching path — nothing else there is deleted.
2. On browsers without that support (Firefox does not implement it at all, on any platform), the button instead reads **Export as ZIP**. Everything is packed into a single ZIP archive and handed to the browser's normal download mechanism; where it lands depends on your browser's own download settings, not on Cashier.
3. **Rescan** refreshes the file list and total size shown before exporting, useful after making further changes without leaving the page.
4. Click **Export to Folder** / **Export as ZIP** to run the export.
