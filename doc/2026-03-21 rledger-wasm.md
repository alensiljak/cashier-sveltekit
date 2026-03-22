# RustLedger WASM Implementation

The route `/rledger` contains a demo page for RustLedger WASM integration.

## TODO

- [x] Add text area on top with the editable Beancount source.
- [x] Add a button to import the current Journal into the text area, as the ledger source.
- [x] Add an indicator for each demo that shows the source, to confirm when it was run from WASM or JS fallback.
- [x] Add 'validate' section with a button for manuall validation and display for validation result.
- [x] Ensure that WASM functions can be called. It seems that only JS Fallback is executed every time.
