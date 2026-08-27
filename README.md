# AllKeyShop Best Deals Fix

A browser userscript that reconstructs AllKeyShop's broken **Best Deals** catalogue sort from deal-score data the site still returns.

![Broken Best Deals catalogue state](docs/assets/best-deals-broken.png)

## What this project demonstrates

This project began as a production-debugging exercise. The catalogue worked under normal sort modes, but **Best Deals** consistently returned an empty state. Network inspection isolated the failure to an API-contract regression: the frontend still requests `sort_field=deal_score`, while the current `CatalogV2` endpoint no longer accepts that field for server-side sorting.

A first compatibility hypothesis mapped the removed field to the API-advertised `list_score`, but live testing showed that request also failed. The current implementation therefore reconstructs the missing behavior client-side instead of substituting an unrelated sort.

## Root cause

The frontend emits:

```text
sort_field=deal_score&sort_order=desc
```

The current API rejects that request. At the same time, valid catalogue responses still expose:

```text
offers[].deal_score
deal_score_min
deal_score_max
```

That means the ranking signal still exists even though direct server-side sorting by it does not.

## Approach

When the user selects **Best Deals**, the userscript:

1. intercepts only the broken `CatalogV2` request;
2. preserves the user's filters, locale, currency, platform, and activation country;
3. probes `deal_score_min` to find a manageable pool of high-scoring products;
4. fetches those candidates using the supported, neutral `id` sort;
5. reads AllKeyShop's own `offers[].deal_score` values;
6. de-duplicates and sorts candidates locally by that score;
7. returns a synthetic `CatalogV2` response so the existing AllKeyShop UI renders the results normally.

No price-sort fallback is used. If reconstruction fails, the script surfaces the failure instead of presenting **Cheapest Games** as if it were **Best Deals**.

## Architecture

```text
AllKeyShop catalogue UI
        │
        │ fetch(...sort_field=deal_score...)
        ▼
┌──────────────────────────────┐
│ Best Deals interceptor       │
└──────────────┬───────────────┘
               │
               ▼
     probe deal_score_min
               │
               ▼
 fetch high-score candidates
      with sort_field=id
               │
               ▼
 read offers[].deal_score
               │
               ▼
 de-duplicate + local sort
               │
               ▼
 synthetic CatalogV2 response
               │
               ▼
     native AllKeyShop UI
```

## Engineering characteristics

- **Narrow interception:** only the AllKeyShop `CatalogV2` request with `sort_field=deal_score` is handled.
- **Native ranking signal:** the script uses AllKeyShop's own deal scores rather than inventing a replacement formula.
- **Filter preservation:** candidate requests retain the catalogue's active query parameters.
- **Neutral candidate ordering:** candidates are acquired with `sort_field=id`, avoiding the price bias that would result from using `price asc`.
- **Bounded requests:** threshold probing and page/concurrency limits prevent an unbounded crawl of the full catalogue.
- **No deceptive fallback:** errors remain visible instead of silently degrading to an unrelated sort.
- **Idempotent installation:** the wrapper marks the patched `fetch` function to avoid stacking interceptors.
- **Zero runtime dependencies:** the installable userscript is a single generated file.
- **Tested pure logic:** request matching, candidate construction, score extraction, de-duplication, and ordering are covered by Node tests.

## Installation

1. Install Tampermonkey or Violentmonkey.
2. Copy `allkeyshop-best-deals-fix.user.js` into a new userscript.
3. Save it and hard-refresh AllKeyShop.
4. Open the product catalogue.
5. Select **Product type → Games**, then **Sort by → Best Deals**.

The script runs at `document-start` so the interceptor is installed before the catalogue application makes its request.

## Development

Requires Node.js 20 or newer.

```bash
npm run check
```

This builds the root-level installable userscript and runs the test suite.

```text
.
├── allkeyshop-best-deals-fix.user.js
├── src/
│   ├── catalogue-ranking.mjs
│   └── userscript.template.js
├── scripts/
│   └── build.mjs
├── test/
│   └── catalogue-ranking.test.mjs
├── docs/
│   ├── technical-notes.md
│   └── assets/
└── .github/workflows/ci.yml
```

## Verification

With DevTools open, selecting **Best Deals** should produce console output similar to:

```text
[AKS Best Deals Fix] intercepted broken Best Deals request
[AKS Best Deals Fix] probe 1/7 score >= 0.5000 → ... products
[AKS Best Deals Fix] selected threshold: ...
[AKS Best Deals Fix] returning page 1 24 items from ... locally ranked candidates
```

The script also prints the top candidates and their AllKeyShop deal scores with `console.table`.

## Limitations

The implementation depends on two behaviors that are currently exposed by AllKeyShop's catalogue API: `deal_score_min/max` filtering and `offers[].deal_score` in valid responses. If either contract changes, the reconstruction strategy will need to be adapted.

The candidate pool is intentionally bounded rather than crawling the entire catalogue. The threshold search is designed to concentrate requests on the highest-scoring portion of the result set.

## Scope and privacy

The script:

- runs only on `www.allkeyshop.com`;
- does not transmit data to third-party services;
- does not read or store cookies, credentials, or account data;
- does not alter merchant redirects, checkout behavior, regional restrictions, or pricing data.

This is an independent compatibility project and is not affiliated with or endorsed by AllKeyShop.

## License

MIT
