# OPFS Storage

## Goals

- [x] Use OPFS for storage.
- [x] Store all Beancount files.
- [ ] Base all logic on Beancount files.

## Specifics

- Git sync of the ledger repository.
- import the whole directory via `showDirectoryPicker()`
- fallback to `<input webkitdirectory>`
- use Rust Ledger to parse the ledger
