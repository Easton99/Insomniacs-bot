#!/usr/bin/env bash
# Runs ON the VPS. It's the forced command of the GitHub Actions deploy key: that key can run this
# script and nothing else (it used to be a full shell key for `claude`, who has sudo). A copy lives at
# /srv/compose/insomniacs-bot/ci-deploy.sh (git-excluded there). After editing this file, update it:
#   ssh vps-claude 'cp /srv/compose/insomniacs-bot/scripts/vps-deploy.sh /srv/compose/insomniacs-bot/ci-deploy.sh'
#
# The VPS folder is a git clone of this (public) repo. Steps: deploy.sh (reset to origin/main, build,
# prisma db push, restart), then register slash commands globally and clear the old guild copies.
set -euo pipefail

APP=/srv/compose/insomniacs-bot

exec 9>/tmp/insomniacs-bot-deploy.lock
flock -n 9 || { echo "[deploy] another deploy is running"; exit 1; }
# Record this deploy's result for the dashboard's Health page (success or failure, whenever we exit).
trap 'rc=$?; command -v hipphamster-record-deploy >/dev/null && hipphamster-record-deploy insomniacs-bot "$( [ $rc -eq 0 ] && echo ok || echo failed )" "$APP"' EXIT

cd "$APP"
bash deploy.sh
echo "[deploy] Registering slash commands..."
docker compose run --rm -e DISCORD_GUILD_ID= bot node dist/scripts/register-commands.js
docker compose run --rm bot node dist/scripts/clear-guild-commands.js
docker image prune -f >/dev/null 2>&1 || true

echo "[deploy] Health check..."
sleep 5
if [ "$(docker inspect -f '{{.State.Running}}' insomniacs-bot-bot-1 2>/dev/null)" = "true" ]; then
  echo "[deploy] Healthy: bot container running"
  exit 0
fi
echo "[deploy] Bot container is not running" >&2
docker compose logs --tail 50 bot >&2
exit 1
