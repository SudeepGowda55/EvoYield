# EvoYield Dashboard

Next.js dashboard for displaying EvoYield fresh allocation and rebalance runs.

## Local development

```bash
npm install
npm run dev
```

## Vercel

Set the Vercel project root directory to:

```text
apps/dashboard
```

The app is static-first and reads `public/data/latest-run.json`, so it deploys without server secrets.
