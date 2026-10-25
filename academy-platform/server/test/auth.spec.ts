import { INestApplication } from '@nestjs/common';
import * as argon2 from 'argon2';
import { Pool } from 'pg';
import request from 'supertest';

// قاعدة اختبار مخصصة: يجب أن ينتهي اسمها بـ _test لأن الاختبارات تمسح المخطط بالكامل.
const TEST_URL = process.env.TEST_DATABASE_URL;
const { migrate } = require('../scripts/migrate');

const PW = 'Str0ng#Pass1';
let app: INestApplication;
let pool: Pool;
let http: () => any;

const devA = { deviceFingerprint: 'fp-A', deviceModel: 'Redmi 9' };
const devB = { deviceFingerprint: 'fp-B', deviceModel: 'Galaxy A12' };

async function insertUser(roleId: number, phone: string, name = 'مستخدم') {
  const hash = await argon2.hash(PW, { type: argon2.argon2id });
  const r = await pool.query(
    'insert into users(role_id, full_name, phone, password_hash) values ($1,$2,$3,$4) returning id',
    [roleId, name, phone, hash],
  );
  return r.rows[0].id as string;
}
const login = (identifier: string, extra: object = {}, password = PW) =>
  http().post('/auth/login').send({ identifier, password, ...extra });

beforeAll(async () => {
  if (!TEST_URL || !/_test$/.test(new URL(TEST_URL).pathname.slice(1))) {
    throw new Error('عيّن TEST_DATABASE_URL لقاعدة اسمها ينتهي بـ _test');
  }
  Object.assign(process.env, {
    DATABASE_URL: TEST_URL,
    JWT_ACCESS_SECRET: 'test-secret-test-secret-test-secret',
    REFRESH_TOKEN_PEPPER: 'test-pepper',
    ACCESS_TOKEN_TTL_SECONDS: '900',
    THROTTLE_LIMIT: '100000',
    LOGIN_THROTTLE_LIMIT: '100000',
    DEV_EXPOSE_RESET_TOKEN: 'true',
    NODE_ENV: 'test',
  });
  pool = new Pool({ connectionString: TEST_URL });
  await pool.query('drop schema public cascade; create schema public;');
  await migrate(TEST_URL);
  const { createApp } = require('../src/app.factory');
  app = await createApp(false);
  await app.init();
  http = () => request(app.getHttpServer());
});

afterAll(async () => {
  await app?.close();
  await pool?.end();
});

beforeEach(async () => {
  await pool.query(
    'truncate users, devices, user_sessions, login_attempts, password_resets, audit_logs restart identity cascade',
  );
});

describe('التسجيل وكلمة المرور', () => {
  it('يسجل طالبًا ويخزن كلمة المرور بـ Argon2id', async () => {
    const r = await http().post('/auth/register').send({ fullName: 'أحمد علي', identifier: '+20 100 000 0009', password: PW });
    expect(r.status).toBe(201);
    expect(r.body.phone).toBe('01000000009');
    const row = await pool.query('select password_hash from users where phone = $1', ['01000000009']);
    expect(row.rows[0].password_hash.startsWith('$argon2id$')).toBe(true);
    expect(JSON.stringify(r.body)).not.toContain('password');
  });

  it('يرفض التكرار والهاتف غير الصالح', async () => {
    await insertUser(4, '01000000010');
    const dup = await http().post('/auth/register').send({ fullName: 'اسم طويل', identifier: '01000000010', password: PW });
    expect(dup.status).toBe(409);
    const bad = await http().post('/auth/register').send({ fullName: 'اسم طويل', identifier: '12345', password: PW });
    expect(bad.status).toBe(400);
  });
});

describe('تسجيل الدخول والقفل', () => {
  it('ينجح بالبيانات الصحيحة ويفشل بالخاطئة', async () => {
    await insertUser(4, '01000000011');
    expect((await login('01000000011', devA)).status).toBe(200);
    expect((await login('01000000011', devA, 'wrong-pass')).status).toBe(401);
    expect((await login('01099999999', devA)).status).toBe(401);
  });

  it('يقفل الحساب بعد 5 محاولات فاشلة حتى مع كلمة المرور الصحيحة', async () => {
    await insertUser(4, '01000000012');
    for (let i = 0; i < 5; i++) await login('01000000012', devA, 'bad-password');
    const r = await login('01000000012', devA);
    expect(r.status).toBe(429);
    expect(r.body.code).toBe('ACCOUNT_LOCKED');
  });

  it('يفك القفل بعد انتهاء المدة', async () => {
    const id = await insertUser(4, '01000000013');
    await pool.query("update users set failed_logins = 5, locked_until = now() - interval '1 minute' where id = $1", [id]);
    expect((await login('01000000013', devA)).status).toBe(200);
  });

  it('لا يسجل كلمة المرور في سجل التدقيق أو المحاولات', async () => {
    await insertUser(4, '01000000014');
    await login('01000000014', devA, 'SecretWrong#1');
    const dump = JSON.stringify((await pool.query('select * from audit_logs')).rows) + JSON.stringify((await pool.query('select * from login_attempts')).rows);
    expect(dump).not.toContain('SecretWrong#1');
  });
});

describe('ربط الجهاز', () => {
  it('يرفض جهازًا ثانيًا، ثم يسمح بعد إلغاء الربط ويبطل جلسة الجهاز القديم', async () => {
    await insertUser(4, '01000000020');
    const admin = await insertUser(1, '01000000021', 'مدير');
    const a = await login('01000000020', devA);
    expect(a.status).toBe(200);

    const b = await login('01000000020', devB);
    expect(b.status).toBe(403);
    expect(b.body.code).toBe('DEVICE_MISMATCH');

    const adminTok = (await login('01000000021')).body.accessToken;
    const student = (await pool.query("select id from users where phone = '01000000020'")).rows[0].id;
    const devs = await http().get(`/admin/students/${student}/devices`).set('Authorization', `Bearer ${adminTok}`);
    expect(devs.status).toBe(200);
    expect(devs.body).toHaveLength(1);

    const rev = await http().post(`/admin/devices/${devs.body[0].id}/revoke`).set('Authorization', `Bearer ${adminTok}`);
    expect(rev.status).toBe(200);

    // جلسة الجهاز القديم لم تعد صالحة (الـ access token لم ينتهِ لكن الجلسة أُبطلت)
    expect((await http().get('/me').set('Authorization', `Bearer ${a.body.accessToken}`)).status).toBe(401);
    expect((await http().post('/auth/refresh').send({ refreshToken: a.body.refreshToken })).status).toBe(401);

    expect((await login('01000000020', devB)).status).toBe(200);
    const audit = await pool.query("select action from audit_logs where actor_id = $1 and action = 'device.revoke'", [admin]);
    expect(audit.rowCount).toBe(1);
  });

  it('الطالب يلزمه معرّف جهاز', async () => {
    await insertUser(4, '01000000022');
    const r = await login('01000000022');
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('DEVICE_REQUIRED');
  });

  it('تسجيل دخول متزامن من جهازين لا ينتج جهازين نشطين', async () => {
    await insertUser(4, '01000000023');
    await Promise.all([login('01000000023', devA), login('01000000023', devB)]);
    const n = await pool.query("select count(*)::int c from devices where status = 'active'");
    expect(n.rows[0].c).toBe(1);
  });
});

describe('الصلاحيات', () => {
  it('يفرض الأدوار على الخادم', async () => {
    await insertUser(1, '01000000030');
    await insertUser(2, '01000000031');
    await insertUser(3, '01000000032');
    await insertUser(4, '01000000033');
    const tok = async (p: string, extra = {}) => (await login(p, extra)).body.accessToken as string;
    const get = (t?: string) => {
      const r = http().get('/admin/students');
      return t ? r.set('Authorization', `Bearer ${t}`) : r;
    };
    expect((await get()).status).toBe(401);
    expect((await get(await tok('01000000030'))).status).toBe(200);
    expect((await get(await tok('01000000031'))).status).toBe(200);
    expect((await get(await tok('01000000032'))).status).toBe(403);
    expect((await get(await tok('01000000033', devA))).status).toBe(403);
  });

  it('توكن مزوّر أو معدّل مرفوض', async () => {
    await insertUser(4, '01000000034');
    const t = (await login('01000000034', devA)).body.accessToken as string;
    const tampered = t.slice(0, -3) + (t.endsWith('aaa') ? 'bbb' : 'aaa');
    expect((await http().get('/me').set('Authorization', `Bearer ${tampered}`)).status).toBe(401);
  });
});

describe('الجلسات', () => {
  it('تدوير refresh token ويبطل القديم', async () => {
    await insertUser(4, '01000000040');
    const l = (await login('01000000040', devA)).body;
    const r1 = await http().post('/auth/refresh').send({ refreshToken: l.refreshToken });
    expect(r1.status).toBe(200);
    expect(r1.body.refreshToken).not.toBe(l.refreshToken);
    expect((await http().post('/auth/refresh').send({ refreshToken: l.refreshToken })).status).toBe(401);
    expect((await http().get('/me').set('Authorization', `Bearer ${r1.body.accessToken}`)).status).toBe(200);
  });

  it('تسجيل الخروج يبطل الجلسة فورًا', async () => {
    await insertUser(4, '01000000041');
    const l = (await login('01000000041', devA)).body;
    expect((await http().post('/auth/logout').set('Authorization', `Bearer ${l.accessToken}`)).status).toBe(204);
    expect((await http().get('/me').set('Authorization', `Bearer ${l.accessToken}`)).status).toBe(401);
  });

  it('إيقاف الحساب يبطل الجلسات القائمة', async () => {
    const sid = await insertUser(4, '01000000042');
    await insertUser(1, '01000000043');
    const s = (await login('01000000042', devA)).body;
    const adm = (await login('01000000043')).body.accessToken;
    expect((await http().post(`/admin/students/${sid}/suspend`).set('Authorization', `Bearer ${adm}`)).status).toBe(200);
    expect((await http().get('/me').set('Authorization', `Bearer ${s.accessToken}`)).status).toBe(401);
    expect((await login('01000000042', devA)).status).toBe(403);
  });
});

describe('استعادة كلمة المرور', () => {
  it('يعمل مرة واحدة ويبطل الجلسات وكلمة المرور القديمة', async () => {
    await insertUser(4, '01000000050');
    const s = (await login('01000000050', devA)).body;
    const f = await http().post('/auth/forgot-password').send({ identifier: '01000000050' });
    expect(f.status).toBe(200);
    const token = f.body.devResetToken as string;
    expect(token).toBeTruthy();

    const NEW = 'N3w#Password9';
    expect((await http().post('/auth/reset-password').send({ token, newPassword: NEW })).status).toBe(200);
    expect((await http().post('/auth/reset-password').send({ token, newPassword: 'An0ther#Pass' })).status).toBe(400);
    expect((await http().get('/me').set('Authorization', `Bearer ${s.accessToken}`)).status).toBe(401);
    expect((await login('01000000050', devA, PW)).status).toBe(401);
    expect((await login('01000000050', devA, NEW)).status).toBe(200);
  });

  it('استجابة موحدة لحساب غير موجود', async () => {
    const r = await http().post('/auth/forgot-password').send({ identifier: '01011111111' });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true });
  });

  it('يرفض رمزًا منتهيًا', async () => {
    await insertUser(4, '01000000051');
    const token = (await http().post('/auth/forgot-password').send({ identifier: '01000000051' })).body.devResetToken;
    await pool.query("update password_resets set expires_at = now() - interval '1 minute'");
    expect((await http().post('/auth/reset-password').send({ token, newPassword: 'N3w#Password9' })).status).toBe(400);
  });
});
