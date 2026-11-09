# Fable 5.2 Suggestions

The most useful addition would be **account reconciliation**. The app already covers entry, sync, reports, budget, forecast and import, but nothing closes the loop by confirming that the book agrees with the bank.

This is based on reading the docs, route list and a few services, not a full code audit.

## Top pick: reconciliation

A "reconcile account" flow would have you pick an account, enter the statement's closing balance and date, and see the difference. You tick off or fix the outliers, and the app writes a `balance` assertion when the two agree.

- **Most of the parts exist.** The importer already matches statement rows to recorded transactions ([dedup.ts](/src/lib/importers/dedup.ts)), there is an assert-balance page ([assert-balance](/src/routes/accounts/assert-balance/+page.svelte)), and imported rows carry the `!` flag until categorised.
- **It makes the importer trustworthy.** Today the importer tells you what is new, but not what is in your book and missing from the statement, or whether the end balance agrees.
- **Your own checklist names it.** [fin-app-overview.md](/doc/fin-app-overview.md) lists "easy to reconcile accounts" under minimal friction, and it is not ticked.

### What we gain

- **A checked book, not just a filled one.** Today a missed, doubled or mistyped transaction surfaces only if you happen to notice the balance looks off. Reconciling turns "the numbers look about right" into "the book matched the bank on 31 Oct".
- **Errors are found while they are small.** Each reconciliation leaves a `balance` assertion, so the next one only has to explain the transactions since then. Errors can't hide in months of history.
- **Both directions of mismatch.** The importer shows what is on the statement and missing from the book. Reconciliation adds the reverse (in the book, not on the statement), which catches duplicates, wrong-account postings and entries that never cleared.
- **Assertions stop being a chore.** The assert-balance page exists, but you have to know the right date and amount and type them in. Reconciliation produces assertions as a side effect of a check you want to do anyway, and Beancount validates them on every later load.

### Implementation steps

1. ✅ **Book balance as of a date.** Add a helper next to [existing.ts](/src/lib/importers/existing.ts) that returns an account's balance in one currency before a given date, using a BQL `sum(position)` query with `date < X`. This matches Beancount's start-of-day semantics for `balance`. Keep the difference calculation a pure function so it can be unit-tested.
2. **Find the starting point.** Look up the account's latest balance assertion that passes, if there is one. Transactions after it are the ones still to reconcile. Without an assertion, start from the account's first transaction.
3. **Reconcile page** (`/accounts/reconcile?account=…`). Ask for the statement date, closing balance and currency (reuse the assert-balance form fields). Show the book balance, the statement balance and the difference.
4. **Tick-off list.** List the transactions since the starting point, each with a checkbox. Show the sum of the ticked transactions and the remaining difference, which reaches zero when the ticked set matches the statement. Highlight `!`-flagged rows. Each row opens the transaction so you can fix it and come back.
5. **Keep ticks out of the book.** Archived books are read-only and the working set is the only writable store, so don't write a "cleared" flag into transactions. Store the in-progress reconciliation (account, statement date, ticked ids) as a local draft so you can leave the page and resume. The assertion is the lasting result.
6. **Write the assertion.** When the difference is zero, save a `balance` assertion to the working set. Move the save logic out of [assert-balance](/src/routes/accounts/assert-balance/+page.svelte) into a shared helper that both pages use. Date the assertion the day *after* the statement's closing date, because the assertion is checked at the start of its day.
7. **Importer link.** Extend `findDuplicates` in [dedup.ts](/src/lib/importers/dedup.ts) to also return existing transactions that no imported row matched. In the file's date range, those are "in the book, not on the statement". Show them in [ImportReview.svelte](/src/lib/importers/ImportReview.svelte) and offer "Reconcile" pre-filled with the file's last date. N26 CSV has no balance column, so the closing balance stays a manual entry. Importers whose files carry a balance can pre-fill it later.
8. **Entry points and status.** Add "Reconcile" to the account-transactions page actions. Show "last reconciled on" (the date of the latest assertion) on the account so stale accounts are visible.
9. **Tests.** Unit-test the balance and difference maths, the starting-point lookup and the unmatched-existing output of `findDuplicates`. Add an e2e test on demo data. If the demo book has no account with a statement-style balance to reconcile against, extend the fixtures in `/src/lib/demo/fixtures/`.
10. **Close the loop in the docs.** Tick "easy to reconcile accounts" in [fin-app-overview.md](/doc/fin-app-overview.md) and add the flow to the user docs.

Steps 1–6 give you a usable manual reconciliation. Step 7 is where it joins the importer, and steps 8–10 are polish and coverage.

## Other feature candidates

1. **A generic CSV importer with column mapping.** Only N26 exists ([n26.ts](/src/lib/importers/n26.ts)), so the import feature works for one bank. The IBKR interest-vs-dividend item in [the importers plan](/doc/projects/2026-09-29_importers.md) is also still open.
2. **Rule suggestions from history.** Import rules are written by hand as regexes. The ledger already knows which account each payee usually posts to, so the review screen could pre-fill accounts for unmatched rows or offer one-tap rules.
3. **Budget pace warnings.** The budget shows actual against target but not "at this pace you will overshoot Groceries by 50". This could be a line on the budget card.
4. **Recurring-charge detection.** Scan the ledger for payees that repeat monthly with similar amounts and offer to create a scheduled transaction. This feeds the forecast you already have.
5. **Forecast accuracy.** The one TODO in the code, at [DailyForecastChart.svelte:127](/src/lib/components/DailyForecastChart.svelte#L127), says schedules are not projected into the selected period, so a daily or weekly schedule appears to be under-counted.
6. **Receipt photos.** Capture an image, store it in OPFS and emit a `document` directive or metadata link. This means syncing binaries, so it costs more than the others.
7. **App lock.** A WebAuthn or PIN gate on open; financial data on a phone is currently unprotected beyond the device lock.

## Improvements to what exists

- **Consolidate the sync surface.** There are five separate pages (peer sync, S3, WebDAV, OPFS sync, Beancount sync), and they hold most of the largest files: [s3Sync.ts](/src/lib/services/s3Sync.ts) at about 1,240 lines and [sync/beancount/+page.svelte](/src/routes/sync/beancount/+page.svelte) at about 1,170. A single "Sync" hub showing status per channel would help users, and moving logic out of the pages would help testing.
- ✅ **Lucide deep imports.** About 115 files import from the `@lucide/svelte` barrel. [testing-strategy.md](/doc/testing-strategy.md) already records that this causes a 10x dev-server reload slowdown and forces a global icon mock in tests. The change is mechanical and could be scripted.
- **End-to-end coverage of money paths.** The strategy doc lists the OPFS import/sync round-trip and scheduled-transaction execution as uncovered. Now that demo fixtures exist, they can seed those tests. The doc may be stale, since `backup-restore.spec.ts` and `transaction-entry.spec.ts` exist and it says "No CI yet" while [ci-deploy.yml](/.github/workflows/ci-deploy.yml) is present.
- **Importer settings as raw JSON.** Editing the account and currency through a JSON editor is a rough edge in an otherwise polished flow; a small form for the common keys would fix it.
- **Reminder limits.** Scheduled-transaction reminders only fire while the app is open ([notificationService.ts](/src/lib/services/notificationService.ts)). Periodic Background Sync could improve this on Android, though only on a best-effort basis.

I would do reconciliation first, then the generic CSV importer, since together they make import usable for any bank. If you want, I can draft a plan for either in `/doc/projects/`.
