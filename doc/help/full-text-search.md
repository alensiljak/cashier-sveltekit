# Full-Text Search

Full-text search across every text file stored in OPFS: `.bean`, `.beancount`, `.toml`, `.yaml`/`.yml`, `.txt`, `.md`, `.cfg`, `.ini`, and `.json`. This covers your Beancount sources, the asset-allocation definition, and any other notes or config files you've synced in.

Type one or more words in the search box. A space separates terms — typing two words finds lines containing **both**, in any order. A term can come from the file name instead of the line — e.g. `checking 2026` finds `Checking` postings inside a file named `2026.bean`, even though "2026" never appears on that line.

That same filename matching can widen a search more than you want, since a term is free to come from either place — `2026` in that example would also match a line dated `2026-…` in an unrelated file. To pin a term to the file name only, give it one of these prefixes:

- `file:` — e.g. `file:2026`
- `path:` — same as `file:`, e.g. `path:2026`

`checking file:2026` only matches "checking" lines inside files whose name contains "2026", not lines that merely mention 2026.

Each result shows the file name, the `line:column` of the match, and the matching line, both with your terms highlighted.

## Jumping to a record

When a matching line belongs to a transaction, the result opens that [transaction's detail](/help/transaction-detail) view. Otherwise, when it mentions an account or commodity that exists in your ledger, it opens that [account's transactions](/help/account-transactions) or [commodity detail](/help/commodity-detail) page instead. Lines that match none of these are shown for reference only.
