#!/usr/bin/env sh
set -eu

if [ "$#" -ne 1 ] || [ ! -f "$1" ]; then
  echo "Aufruf: ./scripts/restore.sh /pfad/zum/backup.dump" >&2
  exit 1
fi

if [ -f ./.env ]; then
  set -a
  . ./.env
  set +a
fi

docker compose stop audiobook-randomizer import-worker
trap 'docker compose start audiobook-randomizer import-worker >/dev/null 2>&1 || true' EXIT

docker compose exec -T postgres pg_restore \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" \
  --clean \
  --if-exists \
  --single-transaction \
  --no-owner < "$1"

docker compose run --rm migrate
docker compose start audiobook-randomizer import-worker
trap - EXIT
echo "Backup wiederhergestellt."
