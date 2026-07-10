# cashier-sveltekit

Cashier progressive-web-application (PWA) implementation with SvelteKit.

For previous versions of cashier, see [Cashier](https://github.com/alensiljak/cashier) and Cashier-Blazor.

## Introduction

Cashier is a personal finance app. It includes a full Beancount engine running offline on your device.

## Palette

Primary: #076461, Blue Stone
Secondary: #92140c, Sangria
Tertiary: #ffd700, Gold
Surface: #1d1f20, Shark

$colour1: #1d1f20; // dark jungle green
$colour2: #d0cd94; // tan
$colour3: #ffd700; // gold
$colour4: #92140c; // sangria, alt: 09814a spanish viridian
$colour5: #076461; // tropical rain forest

## Publish

Run `npm run publish` to build and deploy the app to production.

## Development

To use a yet-unpublished version of rustledger, compile the WASM and reference with

```json
d:/src/rustledger/crates/rustledger-wasm/pkg
```

## References

- [BQL](https://rustledger.github.io/reference/bql.html)

## Related Projects

- Ledger-CLI
- Beancount
- RustLedger
