#!/usr/bin/env bash
set -euo pipefail

public_ip="${1:?usage: configure-production.sh <public-ip>}"
app_dir="${NOTEFLOW_APP_DIR:-/opt/noteflow}"
root_env="${app_dir}/.env"
server_env="${app_dir}/server/.env"

set_env() {
  local file="$1"
  local key="$2"
  local value="$3"
  local escaped
  escaped="$(printf '%s' "$value" | sed 's/[&|]/\\&/g')"
  if grep -q "^${key}=" "$file"; then
    sed -i "s|^${key}=.*|${key}=${escaped}|" "$file"
  else
    printf '%s=%s\n' "$key" "$value" >> "$file"
  fi
}

cd "$app_dir"
umask 077

if [[ ! -f "$server_env" ]]; then
  printf 'Missing %s\n' "$server_env" >&2
  exit 1
fi

if [[ -f "$root_env" ]]; then
  db_password="$(sed -n 's/^POSTGRES_PASSWORD=//p' "$root_env" | head -n 1)"
  jwt_secret="$(sed -n 's/^JWT_SECRET=//p' "$root_env" | head -n 1)"
else
  db_password=""
  jwt_secret=""
  : > "$root_env"
fi

[[ -n "$db_password" ]] || db_password="$(openssl rand -hex 32)"
[[ -n "$jwt_secret" ]] || jwt_secret="$(openssl rand -hex 48)"

set_env "$root_env" COMPOSE_PROJECT_NAME noteflow
set_env "$root_env" POSTGRES_DB noteflow
set_env "$root_env" POSTGRES_USER noteflow
set_env "$root_env" POSTGRES_PASSWORD "$db_password"
set_env "$root_env" JWT_SECRET "$jwt_secret"
set_env "$root_env" ENVIRONMENT production

set_env "$server_env" PORT 8080
set_env "$server_env" ENVIRONMENT production
set_env "$server_env" CORS_ORIGIN "https://${public_ip}"
set_env "$server_env" FRONTEND_BASE_URL "https://${public_ip}"
set_env "$server_env" AUTH_COOKIE_SECURE true
set_env "$server_env" DB_HOST postgres
set_env "$server_env" DB_PORT 5432
set_env "$server_env" DB_USER noteflow
set_env "$server_env" DB_PASSWORD "$db_password"
set_env "$server_env" DB_NAME noteflow
set_env "$server_env" JWT_SECRET "$jwt_secret"
set_env "$server_env" REDIS_ADDR redis:6379
set_env "$server_env" REDIS_PASSWORD ""
set_env "$server_env" REDIS_DB 0
set_env "$server_env" MEM0_HISTORY_DB_PATH /app/data/mem0/history.db
set_env "$server_env" ATTACHMENT_STORAGE_ROOT /app/data/attachments

chmod 600 "$root_env" "$server_env"

sed "s/__PUBLIC_IP__/${public_ip}/g" deploy/nginx-bootstrap.conf > /etc/nginx/sites-available/noteflow
if [[ -L /etc/nginx/sites-enabled/default || -f /etc/nginx/sites-enabled/default ]]; then
  mv /etc/nginx/sites-enabled/default /etc/nginx/sites-available/default.disabled
fi
ln -sfn /etc/nginx/sites-available/noteflow /etc/nginx/sites-enabled/noteflow
nginx -t
systemctl reload nginx

docker compose -f docker-compose.yml -f docker-compose.prod.yml config --quiet

printf 'Production configuration prepared for https://%s\n' "$public_ip"
