# Ledger Cache

Ledger Serialization is a developer utility for inspecting and controlling Cashier's ledger cache — a binary snapshot of your parsed ledger that lets the app skip expensive re-parsing and booking on future loads.

## Ledger instance

A status indicator shows whether the ledger is currently loaded in memory, and how many directives it holds. Tap **Load** to load it if it isn't already.

- **Serialize → OPFS** — parses and books your ledger (if not already loaded), then writes a binary snapshot of it to OPFS, along with a hash of the source files it was built from.
- **Deserialize ← OPFS** — restores the ledger instance from the cached binary snapshot instead of re-parsing your source files, if a cached snapshot exists.
- **Reset instance** — frees the in-memory ledger instance without touching the cache on disk.

## OPFS cache

This section reports on the cached snapshot itself:

- **Cache size** — size of the cached binary file, if one exists.
- **Current hash** — a hash computed from the `.bean` files currently in OPFS.
- **Cached hash** — the hash that was stored alongside the cache when it was last serialized.
- **Status** — shown once both hashes are available: **Cache is current** when they match, or **Cache is stale — re-serialize** when your source files have changed since the cache was built.

Use **Hash source files** to recompute the current hash from your `.bean` files without serializing. Use **Delete cache** to remove the cached snapshot and its hash from OPFS and free the in-memory instance — the next load falls back to parsing your source files from scratch.
