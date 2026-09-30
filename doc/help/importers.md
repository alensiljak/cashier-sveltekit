# Importers

Importers turn a bank statement (a CSV export) into transactions, so you no longer have to enter every card payment by hand. Nothing is written until you accept the reviewed list, and transactions you already entered are recognised and left alone.

The idea: enter by hand only what you would otherwise forget (a rare purchase, a split), and let the import fill in the routine ones. If you entered a purchase yourself, the import finds it and marks it as a **Match** instead of adding it twice.

## The flow

1. **Importers** (Data menu) lists the supported formats. **Edit** the importer's settings once: at least the bank account the file belongs to.
2. Tap **Import file** and choose the CSV. The format is recognised from the file's content, so the file name doesn't matter.
3. The **review** screen lists every transaction in the file, exactly as it would be saved. Rows that already exist are marked **Match** and unticked.
4. Tick what you want, fix payees and accounts with rules (below), then tap **Accept**. The ticked transactions are added to the working set in one batch and the journal opens.

**Cancel** discards the review and writes nothing. The review survives leaving the page (to edit a rule, or to look at something in the journal) and reloading it, and is cleared when you accept or cancel.

## The review screen

- **Checkbox** — whether the row will be imported. Rows that match a recorded transaction start unticked; everything else starts ticked.
- **Match ›** — appears on rows that match a recorded transaction. Tap it to see the recorded transaction in full, including its postings, so you can check the match is right.
- **Details ›** — what the bank sent and what the rules did: the original payee, payment reference, value date, original amount and exchange rate for foreign-currency payments, the ISIN for distributions, and which rules changed the payee or account. None of this is saved on the transaction.
- **Apply rules** — turn off to see the raw records, as the bank sent them. Turn on again to bring the rules back.
- **Unmatched only** — hides the rows that match a recorded transaction, so you see just what is new.
- A **⚠** on a row means it is still on the placeholder account (`Expenses:Uncategorized`) and is flagged `!` for review.

## What gets saved

Plain transactions, nothing extra:

- the date (the bank's booking date, see below), the payee, the payment reference as the narration, and two postings — the receiving account first;
- the `!` flag while the account is still the placeholder, `*` once a rule has given it a real account;
- for distributions only, an `isin` tag on the transaction, so reports can link it to the security.

Anything else the bank provides is shown in Details and then dropped. Import the same file again if you ever want to look at it.

## Dates

A bank statement has two dates besides the day you actually paid:

- **Booking date** — when the bank posted the transaction to your account. This is the date the importer saves.
- **Value date** — the date from which the amount counts for your balance and interest. For card payments it is usually the day the payment was processed, and it is often a day earlier than the booking date, or the same.

Both lag the real purchase, especially over a weekend: you pay on Friday, the value date is Saturday, the booking date is Sunday. That is why matching allows a few days of slack.

## Finding duplicates

A statement row **matches** a recorded transaction when:

- it touches the same account with the **same amount and currency**, and
- the dates are within **3 days** of each other.

Some details:

- Matching is one-to-one: a recorded transaction can absorb only one row, and the closest date is paired first. Two identical purchases on the same day only both match if both are already recorded.
- The payee never decides whether something is a duplicate, only which of several equal candidates a row pairs with. So "Ikea" matches "IKEA WIEN NORD".
- The other account of a transaction is ignored, because that is what you change later.
- Recorded transactions include both your Beancount files and the working set.

What it cannot do: match one recorded transaction against several statement rows. If you entered a single €11.31 purchase that the bank shows as €9.38 plus €1.93, neither row matches. Delete your entry and import the two rows, or split your entry into two transactions. Do not use one transaction with two postings on the bank account.

## Rules

Rules set the **payee** and the **account** of imported rows. One ordered list per importer:

```json
{ "match": "hofer", "payee": "Hofer", "account": "Expenses:Groceries" }
```

- `match` is a case-insensitive regular expression, tested against the original payee and the payment reference. Shorten it to cover more (`hofer` covers `Hofer Dankt`).
- `payee` and `account` are both optional; a rule can set either or both. `"disabled": true` keeps a rule in the list but ignores it.
- **For each field, the first enabled matching rule that sets it wins.** Put specific rules above general ones. A rule that sets only the payee does not stop a later rule from setting the account.
- Rules match the original names from the bank, not the rewritten payee. So `Lidl DANKT` can be groceries and `Lidl Oesterreich GmbH` electricity, even if both are renamed to `Lidl`.
- Rules apply to distributions too. Use this to send a bond fund to an interest account: `{ "match": "VUCP\\.AS", "account": "Income:Investment:Interest:N26" }`.

**Creating and changing rules:**

- On the review screen, open a row's **Details** and tap **New rule…**. The pattern is prefilled from the row; the page shows how many rows in the file it would match. If a rule already changed the row, its **Edit rule #N** button is shown too.
- **Importers → Rules (N)** lists all rules: drag to reorder (saved when you drop), tap to edit, trash icon to delete, **+** to add a blank one.
- New rules go to the **top** of the list, so they win over older ones.
- After saving, the review is rebuilt with the new rules. Your ticks, and which panes were open, stay as they were.

## Distributions

Cash dividends and interest from an investment account are recognised by the ISIN in the payment reference.

- The ISIN is mapped to the commodity symbol from the `isin` metadata on your commodity directives; `isinToSymbol` in the settings overrides it.
- The payee comes from `dividendPayee` (default `{symbol} distribution`), the account from `dividendAccount` (default `Income:Dividends:{symbol}`). The account template does not have to contain `{symbol}` — the `isin` tag on the transaction identifies the security.
- The card statement does not say if the payer paid in another currency. If the payment was converted, the original amount only exists in your broker's report.

## Settings

**Edit** on an importer's card shows its settings as JSON. **Load defaults** puts the template back. **Reset** deletes the importer's settings, including its rules. Settings are stored with the other app settings, so they are part of a [backup](/help/backup) and of the settings sync between devices.

| Key                                | Meaning                                                                      |
| ---------------------------------- | ---------------------------------------------------------------------------- |
| `account`                          | The bank account the file belongs to.                                        |
| `currency`                         | Account currency (default `EUR`).                                            |
| `defaultExpense`, `defaultIncome`  | Account for payments no rule categorised (default: the placeholder account). |
| `dividendAccount`, `dividendPayee` | Templates for distributions, see above.                                      |
| `isinToSymbol`                     | ISIN → symbol overrides.                                                     |
| `rules`                            | The rule list.                                                               |

## Tips

- Import every few days rather than at month end; it is repeatable, and recent purchases are easier to categorise.
- For ambiguous shops (supermarkets, DIY stores), pick the most common category as the rule, or enter the rare purchase by hand when it happens: the import will match it.
- Work through the **⚠** rows: make a rule for each new payee, and the next import needs fewer.
