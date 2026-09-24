# Fakduai Warehouse Simulator

Static isometric warehouse simulator for the Fakduai Lab AI Logistics Workshop.

## AGV job queue

The simulator can claim jobs created by the n8n chat workflow from the Google Sheet `Transactions` tab. Jobs move through `PENDING`, `RUNNING`, and `COMPLETED`; inventory is updated only after the AGV animation finishes.

Setup files:

- `google-apps-script/Code.gs`
- `n8n/Fakduai-Warehouse-Chatbot-v4-Direct-Sheets.json`
- `AGV_QUEUE_SETUP.md`

## Deployment

Pushes to `main` deploy the contents of `public/` to the Cloudflare Pages project `fakduai-warehouse-simulator`.

Required GitHub Actions secrets:

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN` with **Account → Cloudflare Pages → Edit** permission

The workflow deploys the static site to the existing `fakduai-warehouse-simulator` Pages project.
