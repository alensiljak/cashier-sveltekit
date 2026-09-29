# Importing Bank Statements in Cashier

## Goal

To import bank statements directly in Cashier. The reason is that rustledger only supports a very simple CSV import without any ability to transform the records. Implementing another importer in Python, with Beancount, broadens the surface for maintenance.

## To Do

- [ ] modify payees
- [ ] match categories / accounts
  - [ ] fix ibkr importer interest vs dividends choice
- [ ] booking date vs value date: banks dates often lag
- [ ] deduplication
- [ ] save importer configuration in Settings (or JSON in OPFS)
  - [ ] support backup
  - [ ] support sync

## Design

- import presents the transactions before writing to the (CRDT) store. The whole batch can be scraped without leaving trace in the store.
- the whole statement is imported to CRDT store as one transaction.
