# Settings

The Settings page configures the ledger book, currency, date formats, and other application-wide preferences. Changed fields show a small revert icon next to them until saved.

## General

- **Main Currency** — the currency code used as the default across the app (e.g. `EUR`, `USD`). If your book file already uses a currency and none is set yet, it's detected automatically. When the loaded book uses one or more currencies, they're listed below the field for reference.
- **Long Date Format** — the format used for full dates shown throughout the app (e.g. `D MMM YYYY`, `YYYY-MM-DD`).
- **Short Date Format** — a shorter date format used where space is tight (e.g. `MMM DD`, `D/M`).

## Ledger Configuration

[Import Ledger files](/help/ledger-import) first, then choose the resulting file as the **Book file** — this is the ledger file the app reads from and writes to. Use **Select** to pick it from the app's storage.

## Asset Allocation

- **Definition file** — the file holding your [Asset Allocation](/help/asset-allocation) targets. Use **Create** (if none is set yet) or **Edit** to open it in the editor, or **Select** to point to an existing file.
- **Investment account root** — the top-level account under which investment/asset accounts live (e.g. `Assets:Investments`), used to identify which accounts feed into the Asset Allocation report.

## Forecast

Tap **Forecast Settings** to configure the separate forecasting options.

## Device Settings

These apply only to this device and aren't included in exports or backups.

- **Enable ledger cache** — keeps a local cache of parsed ledger data for faster loading. Turn it off if you suspect the cache is causing stale data to show.

## Toolbar menu

- **OPFS Storage** — opens [File Storage](/help/opfs-file-storage) to browse the app's private storage directly.
- **JSON Editor** — edits the raw settings as JSON, for advanced or bulk changes.
- **WebDAV Config** — sets the WebDAV folder URL and credentials used by [WebDAV Backup](/help/webdav-backup).

Tap the checkmark button to save your changes.

## Restoring settings

If you've backed up your settings previously, restore them from the [Backup](/help/backup) screen.
