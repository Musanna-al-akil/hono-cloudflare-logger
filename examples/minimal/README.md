# Minimal Example

## Run

Build the package at the repository root first; the example installs it as a
copy (see `.npmrc`), the way a consumer would get it from npm.

```bash
npm run build
cd examples/minimal
npm install
npm run dev
```

`npm run check` type-checks the example and bundles it with `wrangler deploy --dry-run`.

Then open `http://127.0.0.1:8787/`. Every request writes one access entry
(`info`, `warning` for 4xx, `error` for 5xx) with the matched route and
`req.cf.colo` / `req.cf.country`.
