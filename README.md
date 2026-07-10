# Sync-Content `BETA` 07-10-2026

Sync-Content is an embedded Sitecore Marketplace app for moving content between
**SitecoreAI** environments with the
[Content Transfer API](https://api-docs.sitecore.com/sai/content-transfer) and
[Item Transfer API](https://api-docs.sitecore.com/sai/item-transfer).

> **Beta:** test on a lower environment with a few small items before moving anything
> significant.

The app is a Next.js application with server-side API routes that act as a restricted proxy to
Sitecore hosts. It can run locally, deploy to a standard Next.js host, and be registered in the
Sitecore Cloud Portal as an embedded Marketplace app.

## What it does

Sync-Content presents a lightweight wizard/dashboard UI around two supported transfer flows:

- **Package from source:** create a package with the Content Transfer API, relay it to the target,
  and import it with the Item Transfer API.
- **Import existing package:** consume a `.raif` blob that already exists on the target with the
  Item Transfer API.

For the source-to-target flow, Sync-Content drives the pipeline as follows:

1. **Authenticate** both environments (OAuth client credentials -> `auth.sitecorecloud.io`)
2. **Initiate** a transfer on the source with your item paths, scope, and merge strategy
3. **Poll** until the source finishes packaging (tolerates the transient 404 — CFW-9663)
4. **Relay chunks** from source to target server-side, keeping the `isMedia` flag paired
   correctly (compressed media vs. encrypted content)
5. **Assemble** the `.raif` file on the target (`/complete`)
6. **Consume** the `.raif` into the target content tree (Item Transfer API)
7. **Verify** the blob landed (`BlobState: Transferred`)

The app also initializes the required `@sitecore-marketplace-sdk/client` package when it is loaded
inside a Sitecore Marketplace iframe. Outside an iframe, local development continues to work as a
normal web app.

## Quick Start

```bash
npm install
npm run dev
```

Open http://localhost:3000, fill in your CM host and client credentials, choose a transfer flow,
review the settings, and run the transfer.

### Getting credentials

For each environment, create an **environment automation client** (client ID + secret) in the
Sitecore Cloud Portal / Deploy app. The token is requested with
`audience=https://api.sitecorecloud.io` and `grant_type=client_credentials`.

## Build And Run

```bash
npm run typecheck
npm run build
npm run start
```

## Deploy Hosting

Deploy this as a normal Next.js app. Sitecore Marketplace embeds your deployed app by URL; it does
not host this repository or require a source-controlled manifest file.

- **Vercel:** import the repo or run `vercel`.
- **Netlify:** import the repo and use the detected Next.js runtime.
- **Other Node hosts:** run `npm run build`, then `npm run start`.

### Environment variables (all optional)

| Variable | Default | Purpose |
| --- | --- | --- |
| `ALLOWED_HOST_SUFFIXES` | `.sitecorecloud.io,.sitecore.io` | Comma-separated host suffixes the server proxy will forward to. Prevents the proxy routes from being used as an open relay. |
| `SITECORE_AUTH_HOST` | `auth.sitecorecloud.io` | OAuth token host. |

## Sitecore Marketplace Configuration

Create and configure the app in **Sitecore Cloud Portal > App studio**.

Recommended settings for this app:

| Setting | Value |
| --- | --- |
| App name | `Sync-Content` |
| App type | Embedded custom app |
| Deployment URL | Your hosted URL, for example `https://sync-content.example.com` |
| Route URL | `/` |
| App logo | `${DEPLOYMENT_URL}/sync-content-logo.svg` |
| API access | None required for the current implementation |
| Permissions | No pop-ups, clipboard, or downloads required by default |

After activation, install the app in the target organization. For local Marketplace testing, set the
deployment URL to `http://localhost:3000` and run `npm run dev` on the same machine.

This app uses custom environment automation client credentials entered by the user for each source
and target environment. It does not currently use Marketplace built-in authorization for the content
transfer calls, because the transfer workflow requires credentials for both environments selected by
the operator.

The **Import existing package** flow expects the target environment to already know about the
`.raif` blob name supplied in the UI. Sync-Content does not upload local `.raif` files or assume any
undocumented storage contract; it only calls the Item Transfer consume and verification endpoints
through the existing proxy routes.

## Security notes

- **Credentials never leave your browser tab** except to be exchanged for a token - they are
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
| ~~`LatestWin`~~ | **DO NOT USE - blocked by this app.** See Known issues below. |

## Known issues

- **`LatestWin` can crash your environment** (community finding, July 2026 - pending Sitecore
  confirmation). The API docs list it as a valid merge strategy, but the server throws
  `System.InvalidOperationException: Strategy 'LatestWin' is not yet implemented`
  (Sitecore.Kernel) during HttpModule initialization - which can take the whole CM down.
  Sync-Content removes it from the UI and rejects it server-side. A support ticket has
  been raised with Sitecore.
- **Transient 404 on transfer status** right after initiation (Sitecore ref CFW-9663) - the
  app polls through it automatically.
- **Transient 502/503 during consumption** - the CM can briefly return gateway errors while
  it consumes the `.raif`; the app retries automatically.
- **Parent chain must exist on the target** with the same item IDs when using `SingleItem`
  scope, otherwise the transfer completes with errors and the item does not land. Transfer
  parents first or use `ItemAndDescendants` from a common ancestor.

## Credits

- API walkthrough: [The New Way to Migrate Sitecore Content](https://sitecorefoundation.wordpress.com/2026/07/08/the-new-way-to-migrate-sitecore-content-content-transfer-api-and-item-transfer-api-explained/)
  by Chirag Khanna (and his [Postman collection](https://github.com/ckhanna2808/contenttransferitemapi))
- Sitecore changelog: SitecoreAI base image release 1.8.24 (July 7, 2026)

## License

MIT. This tool is not affiliated with or endorsed by Sitecore.
