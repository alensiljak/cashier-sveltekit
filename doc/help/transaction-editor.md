# Journal Entry

This screen is used for creating a new transaction or editing an existing one.

## Top fields

- **Date** — shown formatted; tap it to open the native date picker, or use the arrows on either side to shift by one day.
- **Payee** — read-only; tapping it opens [Payees](/help/payees) in selection mode so you can pick an existing payee (or type a new one).
- **Note** — a free-text field.

## Status flags

Two buttons mark the transaction's Beancount flag:

- **!** — incomplete / needs review.
- **\*** — complete. Disabled while any posting has no account set.

If a posting is missing its account, a "Has uncategorized postings" notice appears and the flag is forced to `!`. If the postings for a currency don't sum to zero, an "unbalanced" notice appears next to the flags.

## Postings

The Postings panel shows a running sum of all posting amounts, for a quick balance check.

Above the posting list:

- **+** — adds a new, empty posting.
- **Reorder** (up/down arrows) — opens a drag-to-reorder screen for the postings; confirm with the checkmark button.
- **Delete** (trash) — opens a screen listing postings with a delete button on each (asks for confirmation).

Each posting row has:

- **Account** — read-only; tapping it opens [Accounts](/help/accounts) in selection mode.
- A pencil button that opens an advanced editor for cost and price/lot details.
- A sign-toggle button (+/-) that flips the amount's sign.
- **Amount** — tapping it selects the whole value so typing a new number replaces it outright; a calculator button next to it opens a calculator to compute the value instead.
- **Currency** — automatically uppercased as you type.

## Saving

Tap the checkmark button (bottom-right) to save the transaction and return to the previous screen. The transaction does **not** need to balance to zero to save — the unbalanced notice is informational only.

Use the toolbar menu (⋮) **Validate** item to check for missing accounts, unbalanced amounts, syntax errors, and accounts that don't exist in your full ledger; results are shown in a dialog.
