#!/bin/sh
set -e
echo "Applying database migrations…"
npx tsx src/db/migrate.ts
echo "Seeding (safe to re-run)…"
npx tsx src/db/seed.ts
exec node server.js
