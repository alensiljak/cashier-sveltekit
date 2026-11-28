# Getting Started

Cashier is a mobile-first app for managing your finances using the Beancount plain-text accounting format. It's part of the Plain-Text Accounting (PTA) ecosystem and is compatible with both Beancount and Ledger (via the built-in Rust Ledger engine).

## Welcome screen

When Cashier has no data yet, it asks how you want to start:

- **Try demo data** — explore the app with a sample book.
- **Import my ledger** — bring in your own Beancount files.
- **Restore from backup** — bring back data and settings from a [Backup](/help/backup) file, for example on a new or cleaned phone. A backup does not hold your Beancount files, so import them as well.
- **Start empty** — begin with a blank book.

## Quick setup

1. **Import or connect your ledger files.** Use [Ledger Import](/help/ledger-import) for a one-time load from your device's file system, or [File System Sync](/help/opfs-sync) to keep a folder on your device continuously in sync with Cashier.
2. **Configure your preferences** in [Settings](/help/settings) — main currency, date formats, and which book file to use.
3. **Start entering transactions.** Use the **+** button on the Home screen, or the New Transaction item in the navigation drawer.

## Where your data lives

Cashier keeps two kinds of data on your device:

- Your Beancount source files, stored in the browser's Origin-Private File System (OPFS) — the same format you'd use with Beancount or Ledger on a desktop.
- Quick device-only transactions, settings, and scheduled transactions, stored in IndexedDB.

Both stay entirely on your device unless you explicitly send them elsewhere, in one of two ways. A [Backup](/help/backup) saves a copy, as the data is at that moment, in a file. [Sync](/help/sync) keeps your devices up to date through WebDAV, S3 or [Peer Sync](/help/peer-sync).

## History

Cashier's predecessor, Cashier I, worked directly with Ledger (`ledger-cli`), the original command-line plain-text accounting tool. This version is a full rewrite as a Svelte-based PWA, using a Rust/WASM ledger engine for full Beancount compatibility.
