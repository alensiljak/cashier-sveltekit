# Fast Ledger Load

The goal of this project is to load the full Ledger into memory as fast as possible.
There are two main approach for this:

- Load book from OPFS instead of FileSystem Access
- Cache the parsed book from WASM. Store the binary cache in OPFS.

## Cache Parsed Ledger

A PR is in progress on Rust Ledger's side. [PR Link](https://github.com/rustledger/rustledger/pull/712).

- [ ] Once this is merged, test the performance.
- [ ] use `createSyncAccessHandle()` inside a Web Worker for performance.

## Load from OPFS

- [x] Change the loading mechanism to load the file map from OPFS.
- [ ] The synchronization is only copying the book files from Filesystem to OPFS.
- [ ] It should be possible to select a folder instead of using FileSystem API. This is for browsers that don't support FileSystem API.
