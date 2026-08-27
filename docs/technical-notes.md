# Technical notes

## Incident summary

AllKeyShop's catalogue continued to work under normal sorts such as **Cheapest Games**, while **Best Deals** returned an empty state under otherwise identical filters.

### Working request

```text
sort_field=price
sort_order=asc
```

Response: HTTP 200.

### Broken request

```text
sort_field=deal_score
sort_order=desc
```

Response: HTTP 400. The API reports `deal_score` as an unsupported server-side sort field.

The validation response advertised `list_score` as supported, but live testing showed `sort_field=list_score` returns HTTP 404 for the same Games catalogue request, both with and without the obsolete deal-score filters.

## Why version 0.4 was insufficient

Version 0.4 attempted to retain AllKeyShop's native ranking signal by reading `offers[].deal_score` and using `deal_score_min/max` to concentrate the candidate set. Live results showed that this did not recreate Best Deals: the output followed neutral catalogue/ID ordering rather than deal quality, indicating that the remaining deal-score values/filter behavior are not sufficient to reproduce the historical sort.

## Version 0.5 ranking model

Valid responses still expose:

```text
offers.price
offers.stock_status
offers.official_offer_reduction_percent
```

The local scorer therefore reconstructs the behavior from those fields.

For an offer with current price `P` and reduction `D` in the range `(0, 1)`:

```text
referencePrice = P / (1 - D)
score = D² × log2(referencePrice + 1)
```

The squared discount term makes percentage reduction the dominant factor. The logarithmic reference-price term differentiates, for example, a 90% reduction on a premium title from the same reduction on a $5 title without allowing MSRP alone to overwhelm the ranking.

Free, undiscounted, invalid, and explicitly out-of-stock offers are excluded.

## Candidate sampling

A complete crawl of the active Games catalogue would require thousands of pages. Version 0.5 uses bounded, multi-strategy sampling instead.

### Price-distribution sample

The first twelve `price asc` pages are always included. Additional pages are chosen with geometric spacing from page 1 to the active catalogue's final page. This gives dense coverage to low prices while still sampling medium and high current-price regions.

### Secondary samples

The script also collects bounded leading pages from:

```text
popularity_score desc
rating desc
release_date desc
random
```

These samples reduce the chance that a strong deal is missed simply because its current price places it far from the beginning of the price-sorted catalogue.

All candidate requests preserve the user's active filters and remove the obsolete `deal_score_min/max` parameters.

## Synthetic response

Candidate items are de-duplicated by API merge key when available. Each item's strongest in-stock offer is scored, items are sorted locally, and the requested slice is returned as a synthetic JSON `Response` in the normal `CatalogV2` shape. The native catalogue UI therefore continues to render the cards, pagination controls, merchant information, and links.

## Cache and request bounds

The reconstructed ranking is cached for five minutes per filter state. Candidate requests are executed with bounded concurrency. Changing a catalogue filter creates a different cache key and therefore a fresh ranking.

## Failure behavior

The script deliberately does not fall back to `price asc`. Returning an unrelated sort under the **Best Deals** label makes a failure look successful and obscures debugging evidence.

## Non-goals

The project does not bypass authentication, merchant redirects, regional controls, purchase restrictions, or pricing logic. It reconstructs one broken catalogue ordering from public values already returned to the browser.
