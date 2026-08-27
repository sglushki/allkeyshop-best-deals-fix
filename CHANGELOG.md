# Changelog

All notable changes to this project are documented here.

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
- Rewrite from obsolete `sort_field=deal_score` to supported `sort_field=list_score`.
