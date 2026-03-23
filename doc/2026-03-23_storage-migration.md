# Storage Migration

## Rationale

By adding Rust Ledger in WASM to Cashier, full Beancount functionality has been achieved on all (but particularly mobile) devices.
Taking that into consideration, the need for a JSON storage in IndexedDB makes less sense, in comparison.
With a fast Rust parser, it should be easy and convenient to

- store all transactions in a .beancount file in OPFS
- parse the transactions quickly and provide any information on the ledger
- extract individual transactions for editing
- formatting the full content for storage in OPFS
- export of the device ledger (.bean file)

## Tasks

- [ ] Store ledger in a .bean file in OPFS
