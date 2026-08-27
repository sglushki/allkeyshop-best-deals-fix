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

The validation response advertised `list_score` as supported, so an initial compatibility patch translated `deal_score` to `list_score`. Live testing showed that the resulting catalogue request returned HTTP 404 even with `type=game`, so that mapping was discarded rather than treated as a successful fix.

## Remaining API capability

Valid `CatalogV2` responses still expose offer-level fields including:

```text
offers.price
offers.deal_score
offers.official_offer_reduction_percent
```

The catalogue request also accepts:

```text
deal_score_min
deal_score_max
```

This leaves enough of the original ranking contract intact to reconstruct the missing sort on the client.

## Why not sort candidates by price?

A previous experimental implementation fetched candidate records with `sort_field=price&sort_order=asc`. That creates an avoidable sampling bias toward cheap products, and its error path also fell back to price sorting. The result could therefore look exactly like **Cheapest Games** even when Best Deals reconstruction had failed.

Version 0.4 removes both behaviors:

- candidate acquisition uses the supported, neutral `id` sort;
- reconstruction failures are surfaced instead of silently returning price-sorted data.

## Reconstruction algorithm

1. Intercept the frontend request only when it targets AllKeyShop's `CatalogV2` endpoint and requests `sort_field=deal_score`.
2. Preserve all active catalogue filters from the original URL.
3. Binary-search `deal_score_min` between 0 and 1 to find the highest threshold that still leaves a useful candidate pool.
4. Fetch the bounded candidate pages using `sort_field=id`.
5. Compute each catalogue item's score as the maximum finite `offers[].deal_score` value across its products.
6. De-duplicate merged items using the API merge key when available.
7. Sort descending by the returned deal score.
8. Slice the requested page and return a synthetic JSON `Response` matching the catalogue's expected shape.

## Failure behavior

The script deliberately does not fall back to `price asc`. Returning an unrelated sort under the **Best Deals** label is worse than exposing a diagnosable failure.

During threshold probing, HTTP 404 is interpreted as an empty result set because the catalogue endpoint can use 404 for filtered queries with no matches. Other non-success statuses remain fatal.

## Bounded network behavior

The full catalogue is large, so the script does not crawl every page. It uses a target candidate pool, a fixed number of threshold probes, a maximum page count, and bounded concurrency. This concentrates requests on the highest-scoring slice of the catalogue while keeping the workaround practical for an interactive page.

## Non-goals

The project does not bypass authentication, merchant redirects, regional controls, purchase restrictions, or pricing logic. It reconstructs one broken catalogue ordering from values already returned by the site's own API.
