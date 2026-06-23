# OneOf.Lister.Api

Secure companion API for the static OneOf Listing Assistant PWA.

## Why a backend is required

The GitHub Pages app is public static JavaScript. eBay access tokens, refresh tokens, client secrets, and policy configuration must not be embedded in it. This API receives product metadata and image files, uploads the images to eBay Picture Services, creates the Inventory API item and offer, and publishes the offer.

## Current milestone

Implemented:

- `GET /api/ebay/status`
- `POST /api/ebay/listings/publish` using multipart form data
- eBay Media API image upload
- Inventory API inventory item creation
- Inventory API offer creation and publication
- deterministic optimizer endpoint
- Sandbox/Production endpoint switching

The first milestone accepts a manually generated short-lived eBay User access token through configuration. OAuth consent, encrypted refresh-token storage, current-listing import, Analytics API synchronization, and automatic revisions are the next server slices.

## Run locally

```bash
cd server/OneOf.Lister.Api
cp appsettings.example.json appsettings.Development.json
# Edit non-secret Sandbox settings.
export Ebay__UserAccessToken='YOUR_TEMPORARY_SANDBOX_USER_TOKEN'
dotnet run
```

Use the HTTPS URL shown by ASP.NET Core as the **API base URL** in the PWA Settings screen. For local testing, serve the PWA separately:

```bash
python3 -m http.server 8080
```

## Configuration

Prefer environment variables or a secret manager:

```text
Ebay__Environment=Sandbox
Ebay__UserAccessToken=...
Ebay__MerchantLocationKey=ONEOF_HOME
Ebay__FulfillmentPolicyId=...
Ebay__PaymentPolicyId=...
Ebay__ReturnPolicyId=...
```

Never commit a client secret, user token, or refresh token.
