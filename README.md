# cashier-sveltekit

Cashier progressive-web-application (PWA) implementation with SvelteKit.

For previous versions of cashier, see [Cashier](https://github.com/alensiljak/cashier) and Cashier-Blazor.

## Introduction

Cashier is a personal finance app. It includes a full Beancount engine running offline on your device.

Architectural decisions and guidelines are documented in [`doc/architecture.md`](doc/architecture.md).

## Palette

```scss
Primary: #076461, Blue Stone
Secondary: #92140c, Sangria
Tertiary: #ffd700, Gold
Surface: #1d1f20, Shark

$colour1: #1d1f20; // dark jungle green
$colour2: #d0cd94; // tan
$colour3: #ffd700; // gold
$colour4: #92140c; // sangria, alt: 09814a spanish viridian
$colour5: #076461; // tropical rain forest
```

## Publish

To build and deploy the app to production manually, run:

```sh
npm run publish
```

The end-to-end (E2E) tests are excluded and need to be run manually, separately.

```sh
npm run test
```

### CI/CD

`.github/workflows/ci-deploy.yml` runs lint, type-check and unit tests on every PR and push to `main`.
Deployment to Netlify production does **not** happen automatically — trigger it manually from the
Actions tab (`CI & Deploy` workflow → "Run workflow"), which re-runs the tests first, then deploys.
It authenticates via the `NETLIFY_AUTH_TOKEN` and `NETLIFY_SITE_ID` repository secrets (Settings →
Secrets and variables → Actions) rather than a local Netlify login — get a token from Netlify (User
settings → Applications → Personal access tokens) and the site ID from Site settings → General. The
manual `npm run deploy` / `npm run publish` scripts still work locally with a `netlify login` session
or a local `NETLIFY_AUTH_TOKEN`.

## Development

To use a yet-unpublished version of rustledger, compile the WASM and reference with

```json
d:/src/rustledger/crates/rustledger-wasm/pkg
```

## Related Projects

- RustLedger, [repo](https://github.com/rustledger/rustledger/)
- Beancount
- Ledger-CLI
