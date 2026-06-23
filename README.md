# OneOf Listing Assistant

A phone-first inventory intake, eBay publishing, and listing optimization system.

The live PWA is deployed with GitHub Pages. Product photos and metadata remain local in IndexedDB until the user exports the workspace or explicitly publishes through the secure companion API.

## Current capabilities

### Phone intake

- Import multiple product photos or use the phone camera.
- Group adjacent photos by capture time.
- Classify and review product batches.
- Track when imported copies have been verified and the originals are safe to remove manually.

### Listing workbench

- Create a seller-defined SKU.
- Build an 80-character eBay title.
- Store category, condition, description, item specifics, quantity, price, minimum price, and package measurements.
- Store merchant-location and business-policy IDs.
- Preview the exact metadata sent to the publishing API.

### eBay publisher

- Validate readiness before publishing.
- Send product metadata and local image files to the secure API.
- Upload images to eBay Picture Services through the Media API.
- Create the Inventory API item, create an offer, and publish the listing.
- Retain the returned offer ID, listing ID, URL, and errors in the local workspace.

### Listing optimizer

- Store impressions, views, watchers, sales, listing age, and returns.
- Diagnose discovery versus conversion problems.
- Prioritize changes in this order:
  1. category and item specifics;
  2. title;
  3. primary photo;
  4. condition, description, and shipping;
  5. offer to watchers;
  6. price review.
- Log one-change-at-a-time experiments with a seven-day review window.

## Architecture

```text
GitHub Pages PWA
  ├─ IndexedDB product/photo workspace
  ├─ listing editor and payload preview
  ├─ publisher queue
  └─ optimizer rule engine
           │ multipart/form-data
           ▼
ASP.NET Core companion API
  ├─ eBay user-token boundary
  ├─ Media API image upload
  ├─ Inventory API item/offer/publish flow
  └─ server-side optimizer endpoint
```

The static PWA must never contain eBay access tokens, refresh tokens, or client secrets. They belong in the server process or a managed secret store.

## Run the PWA locally

No front-end build step is required.

```bash
python3 -m http.server 8080
```

Open `http://localhost:8080`.

## Run the API locally

The server requires .NET 8.

```bash
cd server/OneOf.Lister.Api
cp appsettings.example.json appsettings.Development.json
export Ebay__UserAccessToken='YOUR_TEMPORARY_SANDBOX_USER_TOKEN'
dotnet run
```

Complete the Sandbox merchant-location address and eBay business-policy IDs in `appsettings.Development.json`. Then enter the API URL shown by ASP.NET Core in **Settings → Backend connection** inside the PWA.

## GitHub Pages deployment

The workflow deploys only the static PWA files from `main`. The ASP.NET Core API must be deployed separately to a service capable of protecting environment variables, such as Azure App Service, Azure Container Apps, Fly.io, Render, or another HTTPS host.

## Security status

The current server milestone uses a manually supplied short-lived eBay User access token from configuration. It is suitable for Sandbox integration work. Before production use, add:

- OAuth authorization-code consent;
- encrypted refresh-token storage;
- automatic access-token renewal;
- authenticated access to the OneOf API;
- durable database/object storage;
- rate limiting and audit logging.

## Next slices

1. Import current eBay listings and map them to OneOf SKUs.
2. Pull Traffic Report analytics on a schedule.
3. Generate and approve revision plans.
4. Apply safe title, description, photo-order, and price revisions through the Inventory API.
5. Add cloud sync between phone and desktop.
