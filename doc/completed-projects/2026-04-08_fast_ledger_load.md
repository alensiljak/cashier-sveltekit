# Fast Ledger Load

The goal of this project is to load the full Ledger into memory as fast as possible.
There are two main approach for this:

- Load book from OPFS instead of FileSystem Access
- Cache the parsed book from WASM. Store the binary cache in OPFS.

## Cache Parsed Ledger

A PR is in progress on Rust Ledger's side. [PR Link](https://github.com/rustledger/rustledger/pull/712).

- [x] Once this is merged, test the performance.
- [x] use `createSyncAccessHandle()` inside a Web Worker for performance.

### Cache Findings

- Deserializing from binary cache is much faster than parsing and booking.
- Deserializing in a Web Worker is faster than on the main thread.

## Load from OPFS

- [x] Change the loading mechanism to load the file map from OPFS.
- [x] The synchronization is only copying the book files from Filesystem to OPFS.
- [x] It should be possible to select a folder instead of using FileSystem API. This is for browsers that don't support FileSystem API.

### OPFS Findings

- Loading files from OPFS is much faster than from Filesystem.
- Loading from filesystem requires constant approvals from the user.

## Web Worker

- Using Web Worker provides synchronous file reading, resulting in faster operations.
- The operations are done in a separate thread, leaving the main thread free for UI updates.
