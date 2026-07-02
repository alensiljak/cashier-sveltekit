# Transaction

A read-only view of a single transaction, resolved by file and line — mainly reached by tapping a transaction result on the [Search](/help/search) page.

Works for a transaction in **any** `.bean` file, including ones pulled in via `include` that the app doesn't otherwise expose an editor for.

## Editing

Only transactions in `cashier.bean` — the on-device file the app writes to — can be edited. For those, an **Edit** button opens the transaction in the [Transaction Editor](/help/transaction-editor). Transactions from any other file are shown for reference only, since the app has no safe way to write changes back into files it didn't create.
