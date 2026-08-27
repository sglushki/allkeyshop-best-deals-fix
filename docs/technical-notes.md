# Technical notes

## Failure

The catalogue works with supported sort fields such as:

```text
sort_field=price
sort_order=asc
```

The Best Deals control sends:

```text
sort_field=deal_score
sort_order=desc
```

The API responds with HTTP 400 and reports that `deal_score` is not a supported sort field.

The validation response lists `list_score` as a supported field, but the same catalogue request with `sort_field=list_score` returns HTTP 404. Removing `deal_score_min` and `deal_score_max` does not change that result.

## Data used by the replacement ranking

Valid catalogue responses include:

```text
offers.price
offers.stock_status
offers.official_offer_reduction_percent
```

For a current price `P` and discount ratio `D`:

```text
referencePrice = P / (1 - D)
score = D^2 * log2(referencePrice + 1)
```

Free offers, invalid discounts, and explicitly out-of-stock offers are excluded.

## Sampling

The active Games catalogue contains thousands of pages, so the userscript does not crawl the complete result set.

Price-sorted pages are sampled with geometric spacing. The first twelve pages are always included, followed by progressively wider page intervals through the end of the active result set. Additional leading pages are collected from popularity, rating, release date, and random sorts.

Candidate requests keep the user's active filters and remove the non-working `deal_score_min` and `deal_score_max` parameters.

## Response handling

Candidates are de-duplicated using `_merge_key` when available. Each item's strongest in-stock offer is scored. The ranked slice for the requested page is placed into a JSON response matching the existing `CatalogV2` shape.

The site continues to render its own catalogue cards, merchant names, links, filters, and pagination controls.

## Cache

A ranking is cached for five minutes using the active filter state as the key. Page number and sort parameters are excluded from the key so moving between reconstructed pages reuses the same candidate set.

## Failure behavior

The script does not substitute `price asc` or another unrelated sort if reconstruction fails. Errors remain visible in the console and the request rejects.

## Scope

The userscript changes catalogue ordering only. It does not modify authentication, merchant redirects, region checks, prices, or checkout behavior.
