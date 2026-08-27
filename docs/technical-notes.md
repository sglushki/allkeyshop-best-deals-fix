# Technical notes

## Incident summary

The AllKeyShop catalogue remained functional under normal sorts such as **Cheapest games**, but switching to **Best deals** returned an empty result state.

The browser network trace showed that both requests target the same `CatalogV2` endpoint with the same catalogue filters. The material difference is the sort field.

### Working request

```text
sort_field=price
sort_order=asc
```

Response: HTTP 200.

### Failing request

```text
sort_field=deal_score
sort_order=desc
```

Response: HTTP 400.

The API validation message reports `deal_score` as invalid and advertises these supported sort fields:

```text
id
list_score
name
popularity_score
price
random
rating
release_date
relevance
```

That makes the failure an API-contract regression rather than a catalogue-filtering problem.

## Why intercept `fetch`?

There are several possible ways to work around the regression:

1. scrape and re-render catalogue cards;
2. call the API independently and build a parallel UI;
3. intercept the broken request and repair the obsolete parameter.

The third option has the smallest maintenance surface. AllKeyShop continues to own rendering, pagination, filters, localization, and navigation. The userscript changes one request field immediately before the application's normal network call.

## Matching rules

A request is rewritten only when all of the following are true:

- host is `www.allkeyshop.com`;
- path matches `/api/<version>/vakrs_catalogv2.php`;
- `action=CatalogV2`;
- `sort_field=deal_score`.

Everything else returns `null` from the pure transformer and flows through the native `fetch` implementation.

## Why `list_score`?

The API itself reports `list_score` as supported after rejecting `deal_score`, making it the strongest server-side compatibility candidate visible from the failing request.

This is intentionally treated as a compatibility hypothesis rather than proof that both fields have identical ranking semantics.

## Fallback design

The catalogue response still exposes offer-level fields including `offers[].deal_score`. If `list_score` does not reproduce the intended ranking, a future version can:

1. request valid catalogue pages using supported sorting;
2. retain the user's active filters, locale, currency, and activation country;
3. read returned offer-level deal scores;
4. compute one comparable score per product;
5. sort the collected result set client-side;
6. render or inject the ordered results without depending on the removed server-side sort field.

That path is more invasive and should only be used if the narrow compatibility mapping is insufficient.

## Non-goals

This project does not attempt to bypass authentication, purchase restrictions, merchant redirects, regional controls, or pricing logic. It only restores a broken catalogue sort request.
