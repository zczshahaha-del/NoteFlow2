#!/usr/bin/env bash
set -euo pipefail

public_ip="${1:?usage: enable-ip-tls.sh <public-ip>}"
app_dir="${NOTEFLOW_APP_DIR:-/opt/noteflow}"

if [[ ! -x /opt/certbot/bin/certbot ]]; then
  python3 -m venv /opt/certbot
  /opt/certbot/bin/pip install --upgrade pip
  /opt/certbot/bin/pip install 'certbot>=5.4,<6'
fi

/opt/certbot/bin/certbot certonly \
  --non-interactive \
  --agree-tos \
  --register-unsafely-without-email \
  --preferred-profile shortlived \
  --webroot \
  --webroot-path /var/www/certbot \
  --ip-address "$public_ip"

sed "s/__PUBLIC_IP__/${public_ip}/g" "${app_dir}/deploy/nginx-https.conf" > /etc/nginx/sites-available/noteflow
install -m 0644 "${app_dir}/deploy/noteflow-cert-renew.service" /etc/systemd/system/noteflow-cert-renew.service
install -m 0644 "${app_dir}/deploy/noteflow-cert-renew.timer" /etc/systemd/system/noteflow-cert-renew.timer

nginx -t
systemctl reload nginx
systemctl daemon-reload
systemctl enable --now noteflow-cert-renew.timer

printf 'TLS enabled for https://%s\n' "$public_ip"
