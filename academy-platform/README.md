# منصة الأكاديمية التعليمية (Android + لوحة ويب + Backend)

## حالة المشروع

| المرحلة | الحالة |
|---|---|
| 1. المعمارية والهيكل ومخطط DB | مكتوبة — تفاصيل التحقق في تقرير المرحلة |
| 2. الخادم والمصادقة | **مكتملة ومُختبرة:** 17 من 17 اختبارًا نجحت على PostgreSQL 16 (انظر `docs/02-server-run-and-test.md`) |
| 3. تطبيق Android (دخول + رئيسية) | الكود مكتوب، **لم يُبنَ بعد** (انظر `docs/03-android-and-ci.md`) |
| 4–10 | لم تبدأ |

## الملفات الحالية

- `docs/01-architecture.md` — القرارات التقنية والتدفقات وحدود الحماية
- `server/db/migrations/001_init.sql` — مخطط قاعدة البيانات الكامل
- `.env.example` — متغيرات البيئة (بدون أسرار)
- `infra/docker-compose.yml` — PostgreSQL وMinIO للتطوير المحلي

## تشغيل قاعدة البيانات محليًا

```bash
cp .env.example .env
docker compose -f infra/docker-compose.yml up -d postgres
psql postgres://academy:change_me@localhost:5432/academy -v ON_ERROR_STOP=1 -f server/db/migrations/001_init.sql
```

## ما يحتاج إعدادًا خارجيًا لاحقًا

حساب Firebase (FCM)، تخزين كائنات خاص (R2/B2 أو MinIO محليًا)، بوابة دفع إن لزم، واستضافة مع HTTPS. بعضها مدفوع عند الإنتاج.
