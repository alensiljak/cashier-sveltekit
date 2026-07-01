# Scheduled Transaction Edit

This screen creates or edits a scheduled transaction. It has two parts, stacked on one page: a transaction template on top, and schedule settings below.

## Transaction template

The top section is the same [Transaction Editor](/help/transaction-editor) used for regular journal entries — payee, postings, accounts, and amounts all work the same way. This transaction is a template: it's not saved to the journal directly, but is used to create a journal entry each time the schedule fires (see [Scheduled Transaction Actions](/help/scx-actions)).

The template's **Date** field doubles as the schedule's next-due date — whatever date is set here when you save becomes the date this scheduled transaction is next due.

## Schedule settings

Below the template, a **Schedule** section controls the recurrence:

- **Repayment** — a toggle for loan or credit-card payoff transactions. When enabled, the amount is auto-calculated: the app looks up the current balance of the template's Liabilities posting and sets that posting's amount to bring the balance to zero, then leaves the other posting to balance automatically. This only works if the template has a Liabilities posting to calculate from. The recalculation happens when the forecast is refreshed, not immediately when you save here.
- **Repeats** — choose **Never** for a one-off scheduled transaction, or **Every ...** to set a recurrence in days, weeks, or months.
- **Ends** — choose **Never** for an open-ended schedule, or **On ...** to pick a date after which the schedule stops.
- **Remarks** — a free-text note shown alongside this entry in the [Scheduled Transactions](/help/scheduled-transactions) list.

## Saving

Tap the checkmark button (bottom-right) to save. There's no separate confirmation to balance the transaction to zero before saving, same as the regular Transaction Editor.
