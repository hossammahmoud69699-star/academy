import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { AuditService, Db, EG_PHONE, env, err, hashRefresh, newToken, normalizeIdentifier, sha256 } from '../common/support';
import { LoginDto, RegisterDto } from './dto';

const LOCK_AFTER = 5;
const LOCK_MINUTES = 15;

@Injectable()
export class AuthService {
  private dummyHash?: Promise<string>;

  constructor(private db: Db, private jwt: JwtService, private audit: AuditService) {}

  private findUser(identifier: string) {
    const n = normalizeIdentifier(identifier);
    return this.db
      .query(
        `select u.*, r.code as role from users u join roles r on r.id = u.role_id
          where u.status <> 'deleted' and (u.phone = $1 or u.email = $2::citext)`,
        [n.phone ?? null, n.email ?? null],
      )
      .then((r) => r.rows[0]);
  }

  async register(dto: RegisterDto) {
    const n = normalizeIdentifier(dto.identifier);
    if (n.phone && !EG_PHONE.test(n.phone)) throw err(400, 'INVALID_PHONE', 'رقم الهاتف غير صالح');
    if (n.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(n.email)) throw err(400, 'INVALID_EMAIL', 'البريد الإلكتروني غير صالح');
    const hash = await argon2.hash(dto.password, { type: argon2.argon2id });
    try {
      const { rows } = await this.db.query(
        `insert into users(role_id, full_name, phone, email, password_hash, grade_id)
         values (4, $1, $2, $3, $4, $5) returning id, full_name, phone, email`,
        [dto.fullName.trim(), n.phone ?? null, n.email ?? null, hash, dto.gradeId ?? null],
      );
      await this.audit.log('user.register', rows[0].id, 'user', rows[0].id);
      return rows[0];
    } catch (e: any) {
      if (e.code === '23505') throw err(409, 'ALREADY_EXISTS', 'الحساب مسجل مسبقًا');
      if (e.code === '23503') throw err(400, 'INVALID_GRADE', 'الصف الدراسي غير موجود');
      throw e;
    }
  }

  async login(dto: LoginDto, ip: string, userAgent?: string) {
    const user = await this.findUser(dto.identifier);

    // فك القفل المنتهي
    if (user?.locked_until && new Date(user.locked_until) <= new Date()) {
      await this.db.query('update users set failed_logins = 0, locked_until = null where id = $1', [user.id]);
      user.failed_logins = 0;
      user.locked_until = null;
    }
    if (user?.locked_until) {
      await this.recordAttempt(dto.identifier, user.id, ip, false, 'locked');
      throw err(429, 'ACCOUNT_LOCKED', 'تم تقييد الحساب مؤقتًا بسبب محاولات متكررة، حاول لاحقًا');
    }

    // مقارنة وهمية لتقليل الفرق الزمني عند عدم وجود المستخدم
    this.dummyHash ??= argon2.hash('dummy-password', { type: argon2.argon2id });
    const ok = await argon2.verify(user?.password_hash ?? (await this.dummyHash), dto.password).catch(() => false);
    if (!user || !ok) {
      await this.recordAttempt(dto.identifier, user?.id ?? null, ip, false, 'bad_credentials');
      if (user) {
        await this.db.query(
          `update users set failed_logins = failed_logins + 1,
                  locked_until = case when failed_logins + 1 >= $2 then now() + ($3 || ' minutes')::interval else locked_until end
            where id = $1`,
          [user.id, LOCK_AFTER, String(LOCK_MINUTES)],
        );
        await this.audit.log('login.fail', user.id, 'user', user.id, ip);
      }
      throw err(401, 'BAD_CREDENTIALS', 'بيانات الدخول غير صحيحة');
    }
    if (user.status !== 'active') throw err(403, 'ACCOUNT_SUSPENDED', 'الحساب موقوف');

    const isStudent = user.role === 'student';
    if (isStudent && !dto.deviceFingerprint) throw err(400, 'DEVICE_REQUIRED', 'معرّف الجهاز مطلوب');

    const refreshToken = newToken();
    const result = await this.bindAndOpenSession(user, dto, ip, userAgent, isStudent, refreshToken);

    if (result.mismatch) {
      await this.recordAttempt(dto.identifier, user.id, ip, false, 'device_mismatch');
      await this.audit.log('login.device_mismatch', user.id, 'user', user.id, ip);
      throw err(403, 'DEVICE_MISMATCH', 'هذا الحساب مرتبط بجهاز آخر. تواصل مع الدعم لإلغاء الربط');
    }
    await this.recordAttempt(dto.identifier, user.id, ip, true);
    return {
      accessToken: await this.signAccess(user.id, result.sessionId),
      refreshToken,
      user: { id: user.id, fullName: user.full_name, role: user.role },
    };
  }

  private async bindAndOpenSession(
    user: any, dto: LoginDto, ip: string, userAgent: string | undefined, isStudent: boolean, refreshToken: string,
  ): Promise<{ mismatch: true } | { mismatch: false; sessionId: string; deviceId: string | null }> {
    try {
      return await this.openSessionTx(user, dto, ip, userAgent, isStudent, refreshToken);
    } catch (e: any) {
      // سباق: طلبان متزامنان من جهازين مختلفين، الفهرس الفريد يمنع الثاني
      if (e.code === '23505' && e.constraint === 'devices_one_active_per_user') return { mismatch: true };
      throw e;
    }
  }

  private openSessionTx(
    user: any, dto: LoginDto, ip: string, userAgent: string | undefined, isStudent: boolean, refreshToken: string,
  ) {
    return this.db.tx(async (c) => {
      let deviceId: string | null = null;
      if (isStudent) {
        const fp = sha256(dto.deviceFingerprint!);
        const active = (await c.query("select id, fingerprint_hash from devices where user_id = $1 and status = 'active' for update", [user.id])).rows[0];
        if (active && active.fingerprint_hash !== fp) {
          return { mismatch: true as const };
        }
        if (active) {
          deviceId = active.id;
          await c.query('update devices set last_seen_at = now(), app_version = $2 where id = $1', [active.id, dto.appVersion ?? null]);
        } else {
          deviceId = (
            await c.query(
              `insert into devices(user_id, fingerprint_hash, model, os_version, app_version, last_seen_at)
               values ($1,$2,$3,$4,$5, now())
               on conflict (user_id, fingerprint_hash) do update
                 set status = 'active', revoked_at = null, revoked_by = null, bound_at = now(), last_seen_at = now(),
                     model = excluded.model, os_version = excluded.os_version, app_version = excluded.app_version
               returning id`,
              [user.id, fp, dto.deviceModel ?? null, dto.osVersion ?? null, dto.appVersion ?? null],
            )
          ).rows[0].id;
          await c.query(
            "insert into audit_logs(actor_id, action, entity_type, entity_id, ip) values ($1,'device.bind','device',$2,$3)",
            [user.id, deviceId, ip],
          );
        }
      }
      const days = Number(env('REFRESH_TOKEN_TTL_DAYS', '30'));
      const s = await c.query(
        `insert into user_sessions(user_id, device_id, refresh_token_hash, ip, user_agent, expires_at)
         values ($1,$2,$3,$4,$5, now() + ($6 || ' days')::interval) returning id`,
        [user.id, deviceId, hashRefresh(refreshToken), ip, userAgent ?? null, String(days)],
      );
      await c.query('update users set failed_logins = 0, locked_until = null, last_login_at = now() where id = $1', [user.id]);
      return { mismatch: false as const, sessionId: s.rows[0].id as string, deviceId };
    });
  }

  /** تدوير refresh token: القديم يتوقف فور الاستخدام. */
  async refresh(token: string) {
    const oldHash = hashRefresh(token);
    const next = newToken();
    const { rows } = await this.db.query(
      `update user_sessions s set refresh_token_hash = $2
         from users u
        where s.refresh_token_hash = $1 and s.revoked_at is null and s.expires_at > now()
          and u.id = s.user_id and u.status = 'active'
          and (s.device_id is null or exists (select 1 from devices d where d.id = s.device_id and d.status = 'active'))
        returning s.id, s.user_id`,
      [oldHash, hashRefresh(next)],
    );
    if (!rows[0]) throw err(401, 'INVALID_REFRESH', 'انتهت الجلسة، سجّل الدخول مجددًا');
    return { accessToken: await this.signAccess(rows[0].user_id, rows[0].id), refreshToken: next };
  }

  async logout(sessionId: string) {
    await this.db.query("update user_sessions set revoked_at = now(), revoked_reason = 'logout' where id = $1 and revoked_at is null", [sessionId]);
  }

  /** يعيد الرمز فقط ليُرسل عبر قناة بريد/رسائل؛ لا يُكتب في السجلات. */
  async createResetToken(identifier: string): Promise<string | null> {
    const user = await this.findUser(identifier);
    if (!user) return null;
    const token = newToken();
    await this.db.tx(async (c) => {
      await c.query('update password_resets set used_at = now() where user_id = $1 and used_at is null', [user.id]);
      await c.query(
        "insert into password_resets(user_id, token_hash, expires_at) values ($1,$2, now() + interval '30 minutes')",
        [user.id, sha256(token)],
      );
    });
    await this.audit.log('password.reset_requested', user.id, 'user', user.id);
    return token;
  }

  async resetPassword(token: string, newPassword: string) {
    const hash = await argon2.hash(newPassword, { type: argon2.argon2id });
    await this.db.tx(async (c) => {
      const r = (
        await c.query(
          'select id, user_id from password_resets where token_hash = $1 and used_at is null and expires_at > now() for update',
          [sha256(token)],
        )
      ).rows[0];
      if (!r) throw err(400, 'INVALID_RESET_TOKEN', 'رمز الاستعادة غير صالح أو منتهي');
      await c.query('update password_resets set used_at = now() where id = $1', [r.id]);
      await c.query('update users set password_hash = $2, failed_logins = 0, locked_until = null where id = $1', [r.user_id, hash]);
      await c.query("update user_sessions set revoked_at = now(), revoked_reason = 'password_reset' where user_id = $1 and revoked_at is null", [r.user_id]);
      await c.query("insert into audit_logs(actor_id, action, entity_type, entity_id) values ($1,'password.reset','user',$2)", [r.user_id, String(r.user_id)]);
    });
  }

  private signAccess(userId: string, sessionId: string) {
    return this.jwt.signAsync({ sub: userId, sid: sessionId });
  }

  private recordAttempt(identifier: string, userId: string | null, ip: string, success: boolean, reason?: string) {
    return this.db.query(
      'insert into login_attempts(identifier, user_id, ip, success, reason) values ($1,$2,$3,$4,$5)',
      [identifier.slice(0, 120), userId, ip || null, success, reason ?? null],
    );
  }
}
