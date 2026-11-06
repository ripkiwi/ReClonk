# Deploying ReClonk to clonk.kiwikode.dev

The game is a static site. `npm run build` (Vite) writes it to `dist/`, and Cloudflare Workers serves that folder
as static assets on `clonk.kiwikode.dev`. This is the same setup as kiwikode.dev itself, but as its own Worker
(`reclonk`), so the game deploys on its own schedule and can't break the main site.

## How it works

```
push to main ──► Cloudflare Workers Builds ──► npm run build ──► npx wrangler deploy ──► https://clonk.kiwikode.dev
other branches ─► same build ─────────────────────────────────► preview link
```

- `wrangler.jsonc` is the single source of truth: the Worker name, the domain and the asset folder.
- `"custom_domain": true` makes Cloudflare create the DNS record for `clonk.kiwikode.dev` and issue its TLS
  certificate on the first deploy. `.dev` is on the HSTS preload list, so browsers only ever use HTTPS; the
  certificate is what makes that work, and Cloudflare renews it.
- `public/_headers` sets the security headers (CSP, HSTS) and long caching for Vite's hashed `/assets/` files.

## One-time setup (Cloudflare dashboard)

1. Workers & Pages > Create > Workers > Import a repository, and pick `ripkiwi/reclonk`.
2. Project name: `reclonk` (must match `name` in `wrangler.jsonc`).
3. Build command: `npm run build`. Deploy command: `npx wrangler deploy`. Root directory: `/`.
4. Under Settings > Build, turn on builds for non-production branches if you want preview links.
5. Save and deploy. After the first deploy, Settings > Domains & Routes lists `clonk.kiwikode.dev`.

No DNS records need adding by hand. If a `clonk` record already exists in the kiwikode.dev zone, delete it first,
or the custom domain can't be attached.

## Deploy by hand (optional)

```bash
npm run build
npx wrangler login
npx wrangler deploy
```

## Embedding on kiwikode.dev

To list the game on kiwikode.dev's Fun & Games page in an iframe, kiwikode's `public/_headers` needs
`https://clonk.kiwikode.dev` added to its `frame-src`. This repo already allows being framed by kiwikode.dev.
A plain link needs no changes.
