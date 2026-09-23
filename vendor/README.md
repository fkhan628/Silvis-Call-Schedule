# vendor/ - the three runtime libraries, served from this repo

Prompt 16 B8 (2026-09-23). Until then the app loaded React and ReactDOM from unpkg (`react@18`, a floating
major) and supabase-js from jsdelivr's `+esm` bundle (no version at all - whatever `latest` was that day). Each
file below is the exact byte sequence the npm registry publishes for the version named, copied out of the
package tarball (not a CDN's copy - the CDN copies were fetched too and hashed identical). `test/ci.test.js`
section 8 pins every sha256 below and fails the deploy gate on any drift; `.gitattributes` marks `vendor/**
-text` so no checkout ever eol-converts them. The loader in `index-source.html` serves them through the same
`?v=APP_VERSION` cache-bust as the modules, so a bump reaches every client on the next deploy.

| file | package | version | source (tarball : path inside it) | sha256 |
|---|---|---|---|---|
| `react.production.min.js` | `react` | 18.3.1 | https://registry.npmjs.org/react/-/react-18.3.1.tgz : `package/umd/react.production.min.js` | `d949f1c3687aedadcedac85261865f29b17cd273997e7f6b2bfc53b2f9d4c4dd` |
| `react-dom.production.min.js` | `react-dom` | 18.3.1 | https://registry.npmjs.org/react-dom/-/react-dom-18.3.1.tgz : `package/umd/react-dom.production.min.js` | `35f4f974f4b2bcd44da73963347f8952e341f83909e4498227d4e26b98f66f0d` |
| `supabase.js` | `@supabase/supabase-js` | 2.117.1 | https://registry.npmjs.org/@supabase/supabase-js/-/supabase-js-2.117.1.tgz : `package/dist/umd/supabase.js` | `dff1e545f4f35bd42895cd6f46431e56137dd13031e46a9759c446447c11a567` |

Why these versions: `react@18` on unpkg resolved to 18.3.1 on 2026-09-23 (the last 18.x; React 19 drops the
UMD builds the classic-runtime build relies on). The jsdelivr `+esm` URL resolved to supabase-js 2.117.1 the
same day (`x-jsd-version: 2.117.1`) - the app's four SDK calls (`createClient`, `channel().on("postgres_changes")`,
`subscribe`, `removeChannel`; every read and write goes through the REST wrapper in `config.js`) are unchanged
across 2.x, so pinning the version already being served changes nothing but the source of the bytes.

The supabase UMD declares a global `var supabase` (non-configurable), which is why the app had used the ESM
import: `config.js` declares its own REST wrapper under that name. `config.js` now captures
`window.supabase.createClient` into `window._supabaseSDK` at its top and declares the wrapper with `var`
(a legal redeclaration; a `const` would be a SyntaxError). Nothing in this folder is edited: the files are the
upstream bytes.

Babel is NOT here: `build.js` transpiles the JSX at build time and the served `index.html` carries no Babel
(`@babel/standalone` was never loaded at runtime - checked 2026-09-23, zero `babel` references in the built page).

## Bumping a library

1. Download the tarball from `https://registry.npmjs.org/<name>/-/<name>-<version>.tgz` (scoped:
   `https://registry.npmjs.org/@scope/<name>/-/<name>-<version>.tgz`), extract, copy the file named above.
2. `sha256sum vendor/<file>`; update the row above AND the `VENDORED` table in `test/ci.test.js` (both must agree
   with the bytes, or `npm test` fails).
3. `npm test && node build.js`, then `npm run smoke` - the smoke asserts no request leaves for unpkg / jsdelivr and
   that the three files are fetched from `vendor/` with `?v=APP_VERSION`.
4. A push touching `vendor/**` is a deploy (it is in build.yml's paths filter): CI runs the suites, bumps APP_VERSION
   and rebuilds `index.html`.

React 19 is not a drop-in (no UMD build; the classic runtime would need a different loader) - a deliberate project,
not a bump.
