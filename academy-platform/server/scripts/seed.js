// بيانات تجريبية محلية فقط: أرقام وهمية وكلمة مرور تجريبية. يرفض العمل في الإنتاج.
const { Client } = require('pg');
const argon2 = require('argon2');

(async () => {
  if (process.env.NODE_ENV === 'production') { console.error('ممنوع تشغيل seed في الإنتاج'); process.exit(1); }
  if (!process.env.DATABASE_URL) { console.error('DATABASE_URL غير معرّف'); process.exit(1); }
  const pw = process.env.SEED_PASSWORD || 'LocalTest#2026';
  const hash = await argon2.hash(pw, { type: argon2.argon2id });
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  try {
    await c.query(`insert into academic_grades(name_ar, sort_order) values
      ('الصف الأول الثانوي',1),('الصف الثاني الثانوي',2),('الصف الثالث الثانوي',3) on conflict do nothing`);
    const g = (await c.query("select id from academic_grades order by sort_order limit 1")).rows[0].id;
    const users = [
      [1, 'مدير تجريبي', '01000000001', 'admin@example.test', null],
      [2, 'مدير محتوى تجريبي', '01000000002', 'content@example.test', null],
      [3, 'مدرس تجريبي', '01000000003', 'teacher@example.test', null],
      [4, 'طالب تجريبي', '01000000004', 'student@example.test', g],
    ];
    for (const [role, name, phone, email, grade] of users) {
      await c.query(
        `insert into users(role_id, full_name, phone, email, password_hash, grade_id, phone_verified_at)
         values ($1,$2,$3,$4,$5,$6, now()) on conflict (phone) do nothing`,
        [role, name, phone, email, hash, grade],
      );
    }
    console.log('seed تم. الحسابات: 01000000001..04 — كلمة المرور من SEED_PASSWORD أو الافتراضية المحلية في الكود');
  } finally { await c.end(); }
})().catch((e) => { console.error(e.message); process.exit(1); });
