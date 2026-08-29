# OwBrand Phase 2 setup

## 1. Database
Run `supabase/migrations/20260816_phase2.sql` after the foundation schema. It creates the private `owbrand-media` bucket, upload/read/delete policies, product asset analysis/versioning and media jobs.

## 2. Environment
Add:
- `IMAGE_PROVIDER_URL`
- `IMAGE_PROVIDER_API_KEY`
- `IMAGE_PROVIDER`
- `VIDEO_PROVIDER_URL`
- `VIDEO_PROVIDER_API_KEY`
- `VIDEO_PROVIDER`

The provider contracts are intentionally server-only. Each image provider must accept JSON and return `{ assets: [{ url, metadata? }] }`. Each video provider must accept JSON and return `{ jobId, status, outputUrl?, metadata? }`.

## 3. Product workflow
1. Open Products.
2. Create/select a product.
3. Upload ordinary JPG/PNG/WebP product images.
4. OwBrand stores originals in a private bucket using signed uploads.
5. Click Analyze to send the image to Gemini Vision for structured product understanding.
6. Use the analyzed source asset as the reference for photo/video generation.

## 4. Production hardening still required
- Put media generation behind a durable worker/queue for long-running jobs.
- Add provider-specific webhook/polling adapters.
- Add image moderation, OCR validation and packaging/logo consistency checks.
- Add generated-asset gallery/version compare and approval UI.
- Add automatic cleanup/retention policies for unused originals.
