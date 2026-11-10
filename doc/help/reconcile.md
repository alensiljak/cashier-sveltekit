# Reconcile Account

Reconciling checks that your book agrees with a bank (or other) statement. When it does, Cashier saves a Beancount `balance` assertion so the check is repeated every time the ledger loads.

Open it from **Reconcile** in the main menu, or from the ⋮ menu on an [Account Transactions](/help/account-transactions) page, which pre-selects that account.

## How it works

1. **Pick the account**, then enter the statement's **closing date**, **closing balance** and **currency**.
2. Cashier shows three figures:
   - **Book balance** — the account's balance from all transactions dated on or before the closing date, from your books and from this device.
   - **Statement balance** — what you entered.
   - **Difference** — statement minus book. Green means zero.
3. Below, the **transactions since the last balance assertion** are listed (or since the first transaction, if there is no earlier assertion). Tick each one you can see on the statement. The **Remaining difference** at the bottom shows what is still unexplained.
4. When the **Difference** reaches zero, tap the ✓ button to save a balance assertion.

## Finding the cause of a difference

- Transactions flagged `!` (not yet reviewed) are marked with an amber border.
- If the ticked transactions add up to the statement but the book still differs, the unticked ones are in your book and **not** on the statement — duplicates, wrong-account entries or things that haven't cleared. Fix them, then come back.
- If something on the statement is missing from the list, it hasn't been entered yet. Add it with [Quick Entry](/help/quick-entry), or use an [importer](/help/importers).

## Good to know

- **Ticks are not saved.** They only help you work through the list; the saved assertion is the lasting result. Changing the account, date or currency clears them.
- **The assertion is dated the day after** the closing date, because Beancount checks balances at the start of the day. See [Balance Assertion](/help/account-transactions).
- **You can only save when the book itself matches.** Ticking transactions never changes the book balance, so the save button appears only when the Difference is zero.
- The assertion goes into the working set. Later reconciliations start from it, so they only have to explain newer transactions.
