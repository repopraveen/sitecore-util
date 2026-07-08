# Content Courier 📦 `BETA`

**You pick it. We move it.**

> ⚠ **Beta:** not yet tested for all scenarios. Try it on a lower environment with a few
> small items before moving anything significant.

An open-source UI for moving content between **SitecoreAI** environments using the new
[Content Transfer API](https://api-docs.sitecore.com/sai/content-transfer) and
[Item Transfer API](https://api-docs.sitecore.com/sai/item-transfer) — an interim replacement
for the retired **Package Designer** (removed July 7, 2026) until Sitecore ships its official
content migration app on the Marketplace.

Run it locally, deploy it to Vercel/Netlify, or register it as a Sitecore Marketplace
standalone app.

## What it does

Content Courier drives the full DEV → QA (or any env → env) transfer pipeline behind a simple
guided UI:

1. **Authenticate** both environments (OAuth client credentials → `auth.sitecorecloud.io`)
2. **Initiate** a transfer on the source with your item paths, scope, and merge strategy
3. **Poll** until the source finishes packaging (tolerates the transient 404 — CFW-9663)
4. **Relay chunks** from source to target server-side, keeping the `isMedia` flag paired
   correctly (compressed media vs. encrypted content)
5. **Assemble** the `.raif` file on the target (`/complete`)
6. **Consume** the `.raif` into the target content tree (Item Transfer API)
7. **Verify** the blob landed (`BlobState: Transferred`)

## Quick start (local)

```bash
npm install
npm run dev
```

Open http://localhost:3000, fill in your source/target CM hosts and client credentials, add
item paths, and hit **Start transfer**.

### Getting credentials

For each environment, create an **environment automation client** (client ID + secret) in the
Sitecore Cloud Portal / Deploy app. The token is requested with
`audience=https://api.sitecorecloud.io` and `grant_type=client_credentials`.

## Deploy

**Vercel:** `vercel` (or import the repo at vercel.com). Zero config needed.

**Netlify:** import the repo — the Next.js runtime is detected automatically.

### Environment variables (all optional)

| Variable | Default | Purpose |
| --- | --- | --- |
| `ALLOWED_HOST_SUFFIXES` | `.sitecorecloud.io,.sitecore.io` | Comma-separated host suffixes the server proxy will forward to. Prevents the proxy routes from being used as an open relay. |
| `SITECORE_AUTH_HOST` | `auth.sitecorecloud.io` | OAuth token host. |

## Security notes

- **Credentials never leave your browser tab** except to be exchanged for a token — they are
  kept in `sessionStorage` and sent only to this app's own API routes, which forward them to
  Sitecore's auth server. Nothing is persisted server-side.
- The API routes are a thin CORS proxy restricted to allowlisted Sitecore hosts. If you host a
  public instance, be aware anyone who can reach it can proxy to *their own* Sitecore
  environments through it (with their own credentials) — deploy behind auth if that matters
  to you.
- Chunk binaries are relayed server-side and never stored.

## Scope & merge strategy reference

| Scope | Meaning |
| --- | --- |
| `SingleItem` | Only the specified item |
| `ItemAndDescendants` | The item plus its entire subtree |

| MergeStrategy | Meaning |
| --- | --- |
| `OverrideExistingItem` | Incoming item replaces an existing one |
| `KeepExistingItem` | Existing item wins; incoming skipped |
| `OverrideExistingTree` | Replace the whole subtree (pair with `ItemAndDescendants`) |
| ~~`LatestWin`~~ | **DO NOT USE — blocked by this app.** See Known issues below. |

## Known issues

- **`LatestWin` can crash your environment** (community finding, July 2026 — pending Sitecore
  confirmation). The API docs list it as a valid merge strategy, but the server throws
  `System.InvalidOperationException: Strategy 'LatestWin' is not yet implemented`
  (Sitecore.Kernel) during HttpModule initialization — which can take the whole CM down.
  Content Courier removes it from the UI and rejects it server-side. A support ticket has
  been raised with Sitecore.
- **Transient 404 on transfer status** right after initiation (Sitecore ref CFW-9663) — the
  app polls through it automatically.
- **Transient 502/503 during consumption** — the CM can briefly return gateway errors while
  it consumes the `.raif`; the app retries automatically.
- **Parent chain must exist on the target** with the same item IDs when using `SingleItem`
  scope, otherwise the transfer completes with errors and the item does not land. Transfer
  parents first or use `ItemAndDescendants` from a common ancestor.

## Registering as a Marketplace app (optional)

The app sends `frame-ancestors` headers allowing it to be embedded in the Sitecore Cloud
Portal. Register it in **Developer Studio** as a **Standalone** extension point pointing at
your deployed URL.

## Credits

- API walkthrough: [The New Way to Migrate Sitecore Content](https://sitecorefoundation.wordpress.com/2026/07/08/the-new-way-to-migrate-sitecore-content-content-transfer-api-and-item-transfer-api-explained/)
  by Chirag Khanna (and his [Postman collection](https://github.com/ckhanna2808/contenttransferitemapi))
- Sitecore changelog: SitecoreAI base image release 1.8.24 (July 7, 2026)

## License

MIT — use it, fork it, improve it. This tool is not affiliated with or endorsed by Sitecore.
