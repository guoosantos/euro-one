#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$HOME/euro-one"
SERVER_DIR="$APP_DIR/server"
DOMAIN="rastreamento.eurosolucoes.tech"
NGCONF="/etc/nginx/conf.d/euro-one.conf"
WEBROOT="/var/www/euro-one/dist"
TS="$(date +%Y%m%d-%H%M%S)"

cd "$APP_DIR"

echo "== 1) iptables loopback p/ 3001 (idempotente) =="
sudo iptables -C OUTPUT -o lo -p tcp --dport 3001 -j ACCEPT 2>/dev/null || sudo iptables -I OUTPUT 1 -o lo -p tcp --dport 3001 -j ACCEPT
sudo iptables -C INPUT  -i lo -p tcp --sport 3001 -j ACCEPT 2>/dev/null || sudo iptables -I INPUT  1 -i lo -p tcp --sport 3001 -j ACCEPT
if ! command -v netfilter-persistent >/dev/null 2>&1; then
  sudo apt-get update -y
  sudo apt-get install -y iptables-persistent
fi
sudo netfilter-persistent save >/dev/null || true
sudo netfilter-persistent reload >/dev/null || true

echo "== 2) nginx vhost correto (com backup) =="
sudo mkdir -p "$WEBROOT"
sudo test -f "$NGCONF" && sudo cp -a "$NGCONF" "$NGCONF.bak.$TS" || true

sudo tee "$NGCONF" >/dev/null <<'EOF'
limit_req_zone $binary_remote_addr zone=login_limit:10m rate=10r/m;

server {
  listen 80;
  server_name rastreamento.eurosolucoes.tech;
  return 301 https://$host$request_uri;
}

server {
  listen 443 ssl http2;
  server_name rastreamento.eurosolucoes.tech;

  ssl_certificate     /etc/letsencrypt/live/rastreamento.eurosolucoes.tech/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/rastreamento.eurosolucoes.tech/privkey.pem;

  root /var/www/euro-one/dist;
  index index.html;

  client_max_body_size 20m;

  add_header X-Content-Type-Options nosniff always;
  add_header X-Frame-Options SAMEORIGIN always;
  add_header Referrer-Policy strict-origin-when-cross-origin always;

  location = /health { proxy_pass http://127.0.0.1:3001; }
  location = /ready  { proxy_pass http://127.0.0.1:3001; }

  location /api/ {
    proxy_pass http://127.0.0.1:3001;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }

  location / {
    try_files $uri $uri/ /index.html;
  }
}
EOF

sudo nginx -t
sudo systemctl reload nginx

echo "== 3) corrigir mergeById duplicado (se existir) =="
FILE="$SERVER_DIR/routes/proxy.js"
cp -a "$FILE" "$FILE.bak.fix.$TS"

python3 - <<'PY'
import re, pathlib, sys
p = pathlib.Path("server/routes/proxy.js")
s = p.read_text(encoding="utf-8", errors="replace")
m = list(re.finditer(r"function\s+mergeById\s*\(", s))
if len(m) < 2:
    print("OK: mergeById sem duplicidade.")
    sys.exit(0)
start = m[1].start()
brace = s.find("{", start)
if brace == -1:
    print("ERRO: nao achei { da 2a funcao"); sys.exit(1)
depth = 0; end = None
for i in range(brace, len(s)):
    c = s[i]
    if c == "{": depth += 1
    elif c == "}":
        depth -= 1
        if depth == 0:
            end = i + 1
            break
if end is None:
    print("ERRO: nao achei fechamento da 2a funcao"); sys.exit(1)
new = s[:start].rstrip() + "\n\n" + s[end:].lstrip()
p.write_text(new, encoding="utf-8")
print(f"REMOVIDA 2a mergeById ({start}-{end})")
PY

CNT="$(grep -c "function mergeById" "$FILE" || true)"
if [ "${CNT:-0}" -ne 1 ]; then
  echo "ERRO: ainda tem duplicidade, restaurando backup..."
  cp -a "$FILE.bak.fix.$TS" "$FILE"
  exit 1
fi

echo "== 4) subir/restart PM2 =="
pm2 restart euro-one-api >/dev/null 2>&1 || true
pm2 restart euro-one >/dev/null 2>&1 || true
pm2 save >/dev/null 2>&1 || true

echo "== 5) smoke tests =="
echo "-- portas:"
sudo ss -lntp | egrep "(:80|:443|:3001)" || true

echo "-- backend:"
curl -sS -i http://127.0.0.1:3001/health | head -n 12 || true
curl -sS -i http://127.0.0.1:3001/ready  | head -n 12 || true

echo "-- nginx (Host forced):"
curl -k -sS -i https://127.0.0.1/health -H "Host: rastreamento.eurosolucoes.tech" | head -n 15 || true
curl -k -sS -i https://127.0.0.1/ready  -H "Host: rastreamento.eurosolucoes.tech" | head -n 15 || true

echo "== 6) logs curtos =="
pm2 logs euro-one-api --lines 25 --nostream 2>/dev/null || true
