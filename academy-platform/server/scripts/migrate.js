// تشغيل ملفات db/migrations/*.sql بالترتيب، وتخطي ما طُبّق سابقًا.
// ملاحظة: كل ملف migration جديد يجب أن يسجّل نفسه: INSERT INTO schema_migrations(version) VALUES ('002_xxx');
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

async function migrate(url) {
  const dir = path.join(__dirname, '..', 'db', 'migrations');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const c = new Client({ connectionString: url });
  await c.connect();
  try {
    const t = await c.query("select to_regclass('public.schema_migrations') as t");
    const applied = new Set();
    if (t.rows[0].t) {
      (await c.query('select version from schema_migrations')).rows.forEach((r) => applied.add(r.version));
    }
    for (const f of files) {
      const version = f.replace(/\.sql$/, '');
      if (applied.has(version)) continue;
      await c.query(fs.readFileSync(path.join(dir, f), 'utf8'));
      console.log('applied', version);
    }
  } finally {
    await c.end();
  }
}

module.exports = { migrate };

if (require.main === module) {
  if (!process.env.DATABASE_URL) { console.error('DATABASE_URL غير معرّف'); process.exit(1); }
  migrate(process.env.DATABASE_URL).catch((e) => { console.error(e.message); process.exit(1); });
}
