# Beancount Infrastructure Files

The purpose of the project is to fetch and store the infrastructure Beancount files locally.
The infrastructure files are:

- config.bean
- commodities.bean
- accounts.bean

Cashier server contains new endpoints:

```
/infrastructure/config
/infrastructure/commodities
/infrastructure/accounts
```

These endpoints return the content of these files.
The files should be stored in OPFS in the browser.
They will be used later, to feed RustLedger WASM along with the local transactions.

## Tasks

- [x] Add a new option to the Sync page, to synchronize all infrastructure files. This can later be separated into individual files, if required.
- [x] Store the synced files into OPFS. Simply overwrite. These files will never be modified in Cashier.
- [x] Extract plain text from the JSON response.
- [x] Create a page that lists all files in OPFS storage.
- [x] modify the sync to use one endpoint `/infrastructure` with a parameter `file_path`.
