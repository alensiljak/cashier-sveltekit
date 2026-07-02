# Search

Full-text search across every text file stored in OPFS: `.bean`, `.beancount`, `.toml`, `.yaml`/`.yml`, `.txt`, `.md`, `.cfg`, `.ini`, and `.json`. This covers your Beancount sources, the asset-allocation definition, and any other notes or config files you've synced in.

Type one or more words in the search box. A space separates terms — typing two words finds lines containing **both**, in any order.

Each result shows the file name, the `line:column` of the match, and the matching line with your terms highlighted.

## Jumping to a record

When a matching line belongs to a transaction, the result opens that [transaction's detail](/help/transaction-detail) view. Otherwise, when it mentions an account or commodity that exists in your ledger, it opens that [account's transactions](/help/account-transactions) or [commodity detail](/help/commodity-detail) page instead. Lines that match none of these are shown for reference only.
