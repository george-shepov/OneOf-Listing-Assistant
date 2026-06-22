# OneOf Listing Assistant — POC

A local-first progressive web app for turning a cluttered phone photo stream into organized product batches and listing-ready work items.

## What the POC does

### Phone intake

- Select multiple photos from the phone library or take a new product photo.
- Store imported copies locally in IndexedDB.
- Auto-group adjacent photos using a configurable capture-time window.
- Classify a batch as product, personal, inbox, draft-ready, or archived.
- Record SKU, target marketplace, condition/identification notes, and cleanup approval.
- Track which imported originals are safe to remove from the phone after verification.

### Desktop review

- Review product batches in a larger card workspace.
- Search and filter by title, SKU, notes, and status.
- Convert a product batch into a listing-draft checklist.
- Edit the same data model used by the phone view.

### Device handoff

The POC stores data locally. Use **Settings → Export workspace** on one device and **Import workspace** on another. The export includes metadata and image copies.

## Important iPhone limitation

A normal website or installed PWA cannot silently delete or reorganize originals in Apple Photos. It can only access photos the user explicitly selects. Therefore, this POC:

1. imports a local copy;
2. verifies and organizes that copy;
3. marks the original as **safe to delete**;
4. leaves final deletion to the user.

A production companion can add either:

- a small native iOS app using PhotoKit, with explicit delete confirmation; or
- an Apple Shortcut that receives an approved cleanup list and guides the user through deletion/album assignment.

## Run locally

No build step is required.

```bash
python3 -m http.server 8080
```

Open `http://localhost:8080`.

## Deploy

The included GitHub Actions workflow deploys the repository as a static GitHub Pages site after changes reach `main`. In repository settings, select **Pages → Source → GitHub Actions** if Pages is not already enabled.

## POC boundaries

- No eBay authentication or API calls yet.
- No computer-vision classification yet; grouping uses timestamps and user review.
- No cloud synchronization or user accounts yet.
- Image export files can become large because they include the imported copies.

## Recommended next slices

1. Add cloud sync with Supabase or an ASP.NET Core API and object storage.
2. Add multimodal product/personal classification and OCR for part numbers and hallmarks.
3. Add duplicate/near-duplicate detection using perceptual hashes or embeddings.
4. Add eBay category, item-specific, price, and draft creation integrations.
5. Add a native iOS/Shortcut cleanup bridge only after imported-copy verification is reliable.
