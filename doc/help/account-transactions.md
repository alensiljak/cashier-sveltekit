# Account Transactions

This page shows one account's details and every transaction posted to it, newest first.

The header shows the account's parent group, its current balance, and any metadata set on the account's `open` directive (each value has a copy button).

If any of the listed transactions only exist on this device and haven't been synced into the ledger yet, a **Local records** notice appears and those rows are highlighted with an amber border.

Tap a transaction to open [Transaction Actions](/help/xact-actions), where you can view, edit, duplicate, schedule, or delete it.

Use the toolbar menu (⋮) for:

- **Balance Adjustment** — record a transaction that brings this account's balance to a target amount.
- **Balance Assertion** — enter the balance the account should have on a date. It is saved as a Beancount `balance` assertion in the working set. The assertion is checked against the balance at the **start** of that date (before any transactions dated that day), and applies to every transaction dated earlier. If the ledger disagrees, validation reports a failed assertion.
