#!/usr/bin/env sh
set -eu

if [ -f ./.env ]; then
  set -a
  . ./.env
  set +a
fi

backup_dir="${1:-./backups}"
mkdir -p "$backup_dir"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
target="$backup_dir/hoerspielbeutel-$timestamp.dump"

docker compose exec -T postgres pg_dump \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" \
  --format custom \
  --no-owner \
  --file - > "$target"

echo "Backup geschrieben: $target"
