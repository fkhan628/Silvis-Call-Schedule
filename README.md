# Silvis-Call-Schedule

Daily **primary + backup** trauma / acute-care surgery call schedule generator (React PWA) for the six-surgeon
**Silvis Surgical Care** group at MercyOne Genesis Medical Center - Silvis. Sibling of the Davenport app
([Call-Schedule-App](https://github.com/fkhan628/Call-Schedule-App)): same stack, build pipeline, Supabase data
layer and safety features; a different shift model (one 24-hour day at a time, 07:00 -> 07:00, one primary and one
backup per day) and a per-surgeon rules engine.

- **Live:** https://fkhan628.github.io/Silvis-Call-Schedule/
- **Docs:** [CLAUDE.md](CLAUDE.md) (conventions), [docs/SILVIS-BUILD-GUIDE.md](docs/SILVIS-BUILD-GUIDE.md) (architecture),
  [docs/SILVIS-CALL-RULES.md](docs/SILVIS-CALL-RULES.md) (the rules), [docs/silvis-seed.json](docs/silvis-seed.json) (the data),
  [sql/schema.sql](sql/schema.sql) (Supabase schema + RLS).

## Build

Edit only `index-source.html` and the plain-JS modules (`config.js`, `rules.js`, `generator.js`, `east-feed.js`,
`helpers.js`, `app-styles.js`). `index.html` and `APP_VERSION` are CI-owned: a push to `main` runs the tests,
bumps the version, transpiles `index.html` and commits it back with `[skip ci]`; GitHub Pages redeploys.

```
npm install
npm test && node build.js     # the pre-push gate: every suite in package.json's test chain, then the build
npm run smoke                 # for any change to index-source.html (Playwright smoke harness; needs Chromium + network)
```

`npm test` runs every suite in `package.json`'s test chain - the same suites CI runs step by step - and ends with the
generator regression; `test/ci.test.js` asserts that the chain, the workflow steps and the workflow paths filter stay
aligned (no suite count is stated here on purpose: it changes with every added suite). `build.js` writes
`index.html` locally as a byproduct - `git restore index.html` before committing, never commit it by hand. On a loaded
machine the wall-clock gates can be raised locally with `SILVIS_RULES_BUDGET_MS` (rules, default 5000 ms) and
`SILVIS_GEN_BUDGET_MS` (the generator regression, default 10000 ms, and the holidays suite, default 4000 ms, share it);
both are printed when set and CI keeps the defaults.

## Contact data

None lives in this repository or in any anon-readable table (see the build guide, section 3.1).
