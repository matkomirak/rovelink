#!/bin/sh
set -eu

: "${DATABASE_URL:?DATABASE_URL must be set}"
: "${JWT_SECRET:?JWT_SECRET must be set}"
: "${ENCRYPTION_KEY:?ENCRYPTION_KEY must be set}"

echo "Applying database schema..."
attempt=1
max_attempts="${DB_MIGRATION_ATTEMPTS:-30}"

until npm run db:push; do
  if [ "$attempt" -ge "$max_attempts" ]; then
    echo "Database schema setup failed after $attempt attempts." >&2
    exit 1
  fi

  attempt=$((attempt + 1))
  echo "Database not ready yet; retrying schema setup in 2 seconds ($attempt/$max_attempts)..."
  sleep 2
done

echo "Seeding bootstrap data..."
npm run db:seed

echo "Starting Rovelink..."
exec node dist/index.js
