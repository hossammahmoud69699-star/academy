import { HttpException, Injectable, OnModuleDestroy } from '@nestjs/common';
import { Pool, PoolClient, QueryResultRow } from 'pg';
import { createHash, randomBytes } from 'crypto';

export function env(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined || v === '') throw new Error(`متغير البيئة ${name} مطلوب`);
  return v;
}

export function err(status: number, code: string, message: string): HttpException {
  return new HttpException({ code, message }, status);
}

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
export const newToken = () => randomBytes(48).toString('base64url');

export function hashRefresh(token: string): string {
  return sha256(env('REFRESH_TOKEN_PEPPER') + token);
}

/** يطبّع الهاتف المصري (+20/0020/مسافات) أو البريد الإلكتروني. */
export function normalizeIdentifier(raw: string): { phone?: string; email?: string } {
  const v = raw.trim();
  if (v.includes('@')) return { email: v.toLowerCase() };
  let p = v.replace(/[\s-]/g, '');
  if (p.startsWith('+20')) p = '0' + p.slice(3);
  else if (p.startsWith('0020')) p = '0' + p.slice(4);
  return { phone: p };
}

export const EG_PHONE = /^01[0125]\d{8}$/;

@Injectable()
export class Db implements OnModuleDestroy {
  readonly pool = new Pool({ connectionString: env('DATABASE_URL'), max: 10 });

  query<T extends QueryResultRow = any>(text: string, params: any[] = []) {
    return this.pool.query<T>(text, params);
  }

  async tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const c = await this.pool.connect();
    try {
      await c.query('begin');
      const r = await fn(c);
      await c.query('commit');
      return r;
    } catch (e) {
      await c.query('rollback').catch(() => undefined);
      throw e;
    } finally {
      c.release();
    }
  }

  onModuleDestroy() {
    return this.pool.end();
  }
}

@Injectable()
export class AuditService {
  constructor(private readonly db: Db) {}

  /** لا تمرّر كلمات مرور أو رموزًا داخل meta. */
  async log(action: string, actorId: string | null, entityType?: string, entityId?: string, ip?: string, meta?: object) {
    await this.db.query(
      'insert into audit_logs(actor_id, action, entity_type, entity_id, ip, meta) values ($1,$2,$3,$4,$5,$6)',
      [actorId, action, entityType ?? null, entityId ?? null, ip ?? null, meta ? JSON.stringify(meta) : null],
    );
  }
}
