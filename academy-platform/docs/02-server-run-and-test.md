# تشغيل الخادم واختباره (المرحلة 2)

> **حالة التحقق:** شُغّلت الاختبارات فعليًا في GitHub Codespaces على PostgreSQL 16 (Docker) وكانت النتيجة **17 passed من 17**. ظهر خطآن في التشغيل الأول (نوع TypeScript في `support.ts`، واستعلام تدقيق في `resetPassword`) وأُصلحا. يمكنك إعادة التشغيل بـ `bash run-tests.sh`.

المتطلبات: Node 20+ (جُرّب إعداد Node 22)، وPostgreSQL 14+.

## الخيار أ: Docker

```bash
cd academy-platform
docker compose -f infra/docker-compose.yml up -d postgres
docker compose -f infra/docker-compose.yml exec postgres psql -U academy -c "create database academy_test"
cp .env.example .env     # عدّل الأسرار بقيم عشوائية
cd server && npm install
```

## الخيار ب: PostgreSQL مثبّت مباشرة

```bash
psql -U postgres -c "create user academy with password 'change_me' createdb"
psql -U postgres -c "create database academy owner academy"
psql -U postgres -c "create database academy_test owner academy"
cd academy-platform && cp .env.example .env
cd server && npm install
```

## التشغيل

```bash
set -a; source ../.env; set +a      # تحميل المتغيرات
npm run migrate
npm run seed                         # حسابات محلية وهمية 01000000001..04
npm run start:dev
```

## الاختبارات

```bash
set -a; source ../.env; set +a
npm test
```

الاختبارات تمسح مخطط `academy_test` وتعيد بناءه، وترفض العمل إن لم ينتهِ اسم القاعدة بـ `_test`.

## ما تغطيه الاختبارات (17 اختبارًا، كلها ناجحة)

التسجيل وتجزئة Argon2id · الدخول الصحيح/الخاطئ · القفل بعد 5 محاولات وفكّه · عدم تسريب كلمة المرور للسجلات · ربط جهاز واحد · رفض جهاز ثانٍ · إلغاء الربط وإبطال الجلسة · سباق دخول متزامن · أدوار admin/content_manager/teacher/student · توكن مزوَّر · تدوير refresh · الخروج · إيقاف الحساب · استعادة كلمة المرور (مرة واحدة، منتهية، موحّدة الاستجابة).

## نقاط API

| المسار | الوصف | الصلاحية |
|---|---|---|
| POST /auth/register | تسجيل طالب | عام |
| POST /auth/login | دخول (الطالب يرسل deviceFingerprint) | عام |
| POST /auth/refresh | تدوير refresh token | عام |
| POST /auth/logout | إنهاء الجلسة | مسجّل |
| POST /auth/forgot-password / reset-password | استعادة كلمة المرور | عام |
| GET /me، GET /me/devices | بياناتي وأجهزتي | مسجّل |
| GET /admin/students?q=&page= | بحث الطلاب | admin, content_manager |
| GET /admin/students/:id/devices | أجهزة طالب | admin, content_manager |
| POST /admin/devices/:id/revoke | إلغاء ربط جهاز | admin, content_manager |
| POST /admin/students/:id/suspend / activate | إيقاف/تفعيل | admin, content_manager |

## قيود معروفة

- إرسال رمز الاستعادة عبر SMS/بريد غير منفّذ بعد (المرحلة 8). `DEV_EXPOSE_RESET_TOKEN` للتطوير فقط.
- التحقق من الهاتف/البريد (OTP) غير منفّذ بعد.
- معرّف الجهاز يُرسله التطبيق ويمكن تزويره من جهاز معدّل؛ سيُدعَّم بـ Play Integrity في مرحلة Android.
- أُدخلت حزم بإصدارات `^` لم تُثبَّت هنا، فقد تظهر فروق إصدارات عند أول `npm install` (خاصة `@nestjs/throttler` v6 ودعم `limit` كدالة).
