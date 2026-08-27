# Changelog

## 0.5.1 - 2026-08-27

### Changed

- Simplified source comments and project documentation.
- Reduced default console output; detailed ranking output is now behind the `DEBUG` flag.
- Avoided repeated deal-score calculation during candidate sorting.
- Added a screenshot of the restored Best Deals view.

## 0.5.0 - 2026-08-27

### Changed

- Replaced the remaining `deal_score` path with local ranking based on current price and `official_offer_reduction_percent`.
- Added geometric price-page sampling plus popularity, rating, release-date, and random samples.
- Added a five-minute ranking cache keyed by active catalogue filters.

### Added

- Reference-price inference from current price and discount percentage.
- Ranking formula: `discountRatio^2 * log2(referencePrice + 1)`.
- Tests for discount normalization, scoring, de-duplication, and geometric page sampling.

## 0.4.0 - 2026-08-27

### Changed

- Replaced the `deal_score -> list_score` experiment with local ordering of `offers[].deal_score`.
- Removed the fallback to `price asc`.

### Added

- Candidate collection and synthetic `CatalogV2` responses.
- Tests for request matching, filter preservation, and ranking behavior.

## 0.3.1 - 2026-08-27

### Changed

- Moved request logic into testable source modules.
- Added a build step for the installable userscript.

### Added

- Node test suite.
- GitHub Actions CI.
- Technical notes and reproduction screenshots.

## 0.3.0 - 2026-08-27

### Added

- Initial userscript and `deal_score -> list_score` compatibility experiment.
