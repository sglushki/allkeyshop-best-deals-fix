# Contributing

Run the full check before opening a pull request:

```bash
npm run check
```

## Guidelines

- Keep request interception limited to the broken Best Deals catalogue request.
- Preserve active catalogue filters in candidate requests.
- Keep runtime dependencies at zero unless there is a strong reason to add one.
- Add tests for changes to request matching, scoring, sampling, or ranking.
- Update the generated root userscript with `npm run build` after source changes.
- Keep network request counts bounded.
