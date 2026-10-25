#!/usr/bin/env bash
# يشغّل قاعدة البيانات ويجهّز الإعدادات ويشغّل اختبارات الخادم بأمر واحد.
set -e
cd "$(dirname "$0")"

if [ ! -f .env ]; then
  cp .env.example .env
  for k in JWT_ACCESS_SECRET REFRESH_TOKEN_PEPPER CODE_HMAC_SECRET; do
    sed -i "s|^$k=.*|$k=$(openssl rand -hex 32)|" .env
  done
fi

docker compose -f infra/docker-compose.yml up -d postgres
echo "انتظار قاعدة البيانات..."
until docker compose -f infra/docker-compose.yml exec -T postgres pg_isready -U academy >/dev/null 2>&1; do sleep 2; done
docker compose -f infra/docker-compose.yml exec -T postgres psql -U academy -d postgres -c "create database academy_test" 2>/dev/null || true

cd server
npm install
set -a; . ../.env; set +a
npm test
