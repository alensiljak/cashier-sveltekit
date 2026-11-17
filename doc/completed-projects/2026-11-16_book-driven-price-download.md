# Book-driven Price Download

Reuse the Beancount `price` commodity metadata (the `bean-price` convention) as the single source of truth for which commodities get downloaded and by which provider, instead of inventing another tagging scheme. Builds on [Price Download](../completed-projects/2026-11-15_price-download.md).

Status: **brainstorm / design — nothing implemented.**

## Background

The book already tags downloadable commodities:

```beancount
commodity AUD
  price: "EUR:ecbrates/AUD-EUR"

commodity PROP
  apir: "..."
  price: "AUD:alens.pricedl.beanprice.vanguard_au_detail/PROP"
```

Format: `QUOTE_CCY:source/SYMBOL`, comma-separated for fallbacks, `^` before the symbol means inverted. `source` is a Python module path in `bean-price`; in Cashier it becomes a **nickname** resolved to one of our `PriceProvider`s. Commodities without a `price` tag are intentionally not downloaded.

## Decisions

1. **`price` meta drives the plan.** Only tagged commodities are downloaded in this mode.
2. **Nicknames map `source` → provider id.** Shared setting (all devices behave the same), e.g. `{ "ecbrates": "ecb-frankfurter", "alens.pricedl.beanprice.vanguard_au_detail": "vanguard-au" }`. Defaults shipped for the ECB nickname.
3. **Providers say how they use the spec.** The `SYMBOL` part is not uniform:
   - **ECB (pair providers):** `AUD-EUR` is only _validated_ against the commodity and the `QUOTE_CCY` (mismatch → warning row, not downloaded). The commodity is already a currency and ECB serves everything against EUR; the actual rate lookup is by commodity.
   - **Vanguard (metadata-matching providers):** the symbol (`PROP`) is _ignored_; the commodity is matched through its `apir` metadata via the existing `resolveCovered`. Safer than trusting a symbol that matches nothing else.
     This is a provider capability, not special-casing in the page.
     **Each provider decides what to do with the passed symbol** — the page only hands it over. For currencies only an accurate rate for the pair matters: if the provider's inverse already works as the regular one, the provider value is kept verbatim (no inversion), which settles the direction question below.
4. **Batch per provider.** One request per provider for all its commodities (one ECB call), not per commodity.
5. **Reuse the existing pipeline**: writer, target file, overwrite/append mode, direction rule (provider-native, engine inverts; the written direction may follow the meta's intended direction, to be settled during implementation).
6. **First `price` entry only for v1.** Fallback chains are deferred.
7. **v1 scope: currencies only.** Vanguard/securities follow once the currency path works.
8. **The old `/prices/download` page stays** until the new mode proves itself.

## Coverage: nothing falls through the cracks

The new dashboard classifies every commodity in the book:

| State               | Meaning                                                                                              |
| ------------------- | ---------------------------------------------------------------------------------------------------- |
| **Mapped**          | Has `price` tag, nickname resolves to a provider that covers it. Downloaded.                         |
| **Unmapped source** | Has `price` tag but nickname has no provider. Shown with the offending nickname and a way to map it. |
| **Invalid**         | Tag present but malformed, or symbol/quote mismatch (ECB). Shown with the reason.                    |
| **Untagged**        | No `price` tag. Not downloaded; listed so a newly added commodity is noticed.                        |

**Ignore list (decided):** a shared setting `prices.ignored` holds commodities acknowledged as deliberately not priced. Ignored ones move to a collapsed "Ignored" section the user can review at will. The prominent "Untagged" list therefore only surfaces commodities that were introduced and not yet either tagged or acknowledged.

**Provider visibility (decided):** the dashboard shows which registered providers take part in the full download (those with at least one nickname mapped) and which are registered but not mapped to any nickname, so adding a provider later makes the gap obvious.

## Nickname mapping UI (settings)

One screen, two panels:

- **Sources found in the book**: every distinct `source` in `price` tags, with count of commodities using it, and a provider dropdown to map it (this is the "which classes do I have" view).
- **Available providers**: the registry, each with its id, name, kind, and nickname(s) assigned. Makes the mapping easy to see from both sides.

Unmapped sources are highlighted. Mapping can also be done inline from the dashboard's "Unmapped source" rows.

## Dashboard

New page (e.g. `/prices/book`):

- Summary counts per state above.
- Per-provider groups listing their commodities, with last downloaded fixing.
- **Download all** button → plan grouped by provider → existing writer → existing status/"reload book" note.

## Later: default-provider fallback for new commodities

If the mode works, add a simplified model for commodities that will not carry a Beancount `price` tag (or use a different tag):

- A default provider per kind (`fx` → ECB, later `securities`), as a shared setting.
- A Cashier-native tag/rule consulted when no `price` tag exists, e.g. a `cashier-price: "nickname"` meta key, or automatic assignment of any currency to the default fx provider.
- The coverage lists above then show where a commodity's provider comes from (tag / default / none).

Not designed in detail until the tag-driven path is proven.

## Implementation outline

1. `parsePriceMeta(meta)` — pure parser with tests (`QUOTE:source/SYMBOL`, `^`, comma lists).
2. Provider interface: declare spec handling (`pair` vs `metadata`), optional per-commodity validation.
3. Settings: `prices.nicknames` (JSON map) + defaults, shared.
4. Plan builder: classify commodities into the four states, group by provider (reads `commodities` + `meta` already returned by `ledger.worker.ts`).
5. Dashboard page + nickname mapping panel.
6. Wire "Download all" into `downloadPrices` per provider group.

## Open questions

- Should nickname mapping live only in settings, or also be editable inline on the dashboard (leaning yes).
