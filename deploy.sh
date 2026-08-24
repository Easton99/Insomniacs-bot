#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

echo "Pulling latest..."
git pull

echo "Building image..."
docker compose build

echo "Syncing database schema..."
docker compose run --rm bot npx prisma db push --skip-generate

echo "Restarting bot..."
docker compose up -d

echo "Done."
docker compose logs --tail 20
