# Fakduai Warehouse Simulator

Static isometric warehouse simulator for the Fakduai Lab AI Logistics Workshop.

## Deployment

Pushes to `main` deploy the contents of `public/` to the Cloudflare Pages project `fakduai-warehouse-simulator`.

Required GitHub Actions secrets:

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN` with **Account → Cloudflare Pages → Edit** permission

The workflow checks for the Pages project and creates `fakduai-warehouse-simulator` with `main` as the production branch when it does not exist, then deploys the static site.
