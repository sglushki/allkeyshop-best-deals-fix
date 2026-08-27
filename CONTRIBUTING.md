# Contributing

Contributions should keep the patch narrowly scoped and easy to audit.

## Local workflow

```bash
npm run check
```

This rebuilds the installable userscript and runs the regression tests.

## Design rules

- Prefer pure request transformations over DOM scraping.
- Do not add third-party runtime dependencies.
- Preserve AllKeyShop request parameters unless a change is required for the compatibility fix.
- New request-matching behavior must include tests.
- Treat `list_score` as a compatibility mapping, not a proven semantic equivalent of historical `deal_score` behavior.
