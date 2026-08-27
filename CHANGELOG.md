# Changelog

All notable changes to this project are documented here.

## 0.4.0 - 2026-08-27

### Changed

- Replaced the unsuccessful `deal_score → list_score` compatibility mapping with client-side reconstruction using AllKeyShop's existing `offers[].deal_score` values.
- Candidate acquisition now uses neutral `id` ordering instead of `price asc`.
- Removed the silent Cheapest Games fallback; reconstruction errors are now surfaced explicitly.
- Updated project architecture, tests, and documentation around the verified API behavior.

### Added

- Adaptive `deal_score_min` threshold probing to keep the candidate pool bounded.
- Local de-duplication and descending deal-score ordering.
- Synthetic `CatalogV2` responses so AllKeyShop's existing catalogue UI can render reconstructed results.
- Tests for request matching, filter preservation, score extraction, de-duplication, and ranking.

## 0.3.1 - 2026-08-27

### Changed

- Refactored URL rewriting into a pure, independently testable module.
- Added a dependency-free build step that generates the installable userscript.
- Added idempotent patch installation and fail-open behavior.
- Reworked project documentation around the debugging evidence, design constraints, and implementation trade-offs.

### Added

- Node test suite covering rewrite scope and parameter preservation.
- GitHub Actions CI.
- Technical notes and reproduction screenshots.
- Contributor guidance.

## 0.3.0 - 2026-08-27

### Added

- Initial compatibility patch for AllKeyShop catalogue `fetch` requests.
- Experimental rewrite from obsolete `sort_field=deal_score` to `sort_field=list_score`.
