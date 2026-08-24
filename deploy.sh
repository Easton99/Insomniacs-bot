#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

echo "Pulling latest..."
git pull

echo "Building image..."
docker compose build

echo "Running migrations..."
docker compose run --rm bot npx prisma migrate deploy

echo "Restarting bot..."
docker compose up -d

echo "Done."
docker compose logs --tail 20
