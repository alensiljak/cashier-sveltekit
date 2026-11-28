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

These apply only to this device and aren't included in exports or in the settings shared between devices. The [Backup](/help/backup) file can carry them (and, if you choose, the credentials, encrypted).

- **Enable ledger cache** — keeps a local cache of parsed ledger data for faster loading. Turn it off if you suspect the cache is causing stale data to show.

- **HTTP Proxy** — the endpoint used for outgoing requests to sources that block CORS (some [price providers](/help/price-download), the Mistral transcription API in [Voice mode](/help/voice-entry)). Leave the **Proxy URL** empty to use the app's own same-origin `/api/proxy` endpoint; set a full URL (e.g. `https://your-worker.workers.dev/api/proxy`) to use your own deployment. The **API key** is sent as the `X-Proxy-Key` header and is only needed when the proxy is protected. Both values are stored on this device only and are never exported or synced.

## Reset Stores

Resets an **empty** transaction store, which discards the traces of deleted records. This is shared: your other devices follow the next time they sync.

## Destroy Stores

Deletes a transaction store's records **and history** on this device only, so that you can start over from sync or from a [Backup](/help/backup). It works also when the store is not empty. It deletes nothing on other devices or in remote storage. Live Peer Sync is disconnected, and every other Cashier tab or window has to be closed first.

**Only data in a backup or another copy can be recovered.** Without sync and without a backup, the data is permanently lost. The dialog offers a backup of the store first. Check that the file was saved: the app cannot tell.

What you can get back:

- **S3 or WebDAV** — the next sync downloads what the storage still holds, including this device's own uploads. Changes that were never uploaded are not there.
- **Peer Sync** — another device can send back what it has, when it is online.
- **A backup** — what was in it when it was made. If you then sync, anything in the backup that was never synced reaches your other devices too.

A mistake that was already synced comes back with the next sync, because it is part of the shared history.

**Scheduled transactions in older backup files:** these files (backup format 1 or 2, shown when you choose the file) hold them as a list, without their history. After restoring such a list, a sync can bring back deleted entries, or let old versions replace newer edits, also on other devices. If sync has your current data, don't restore them from such a file; sync instead. Newer backup files keep the history and do not have this problem.

## Toolbar menu

- **OPFS Storage** — opens [File Storage](/help/opfs-file-storage) to browse the app's private storage directly.
- **JSON Editor** — edits the raw settings as JSON, for advanced or bulk changes.
- **Speech Settings** — opens the [speech configuration](/help/voice-entry) used by Quick Entry's Voice mode: the transcription engine (built-in browser recognition or Mistral Voxtral), the language, and the Mistral API key.
- **WebDAV Config** — sets the WebDAV folder URL and credentials used by [WebDAV Backup](/help/webdav-backup).

Tap the checkmark button to save your changes.

## Restoring settings

If you've backed up your settings previously, restore them from the [Backup](/help/backup) screen.
