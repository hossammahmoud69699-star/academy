import { CanActivate, ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Db, err } from '../common/support';

export const IS_PUBLIC = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC, true);
export const ROLES = 'roles';
export const Roles = (...roles: string[]) => SetMetadata(ROLES, roles);

export interface AuthUser {
  id: string;
  role: string;
  sessionId: string;
  deviceId: string | null;
}

/** يتحقق من التوكن ثم من حالة الجلسة والمستخدم والجهاز في قاعدة البيانات في كل طلب (لإبطال فوري). */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private jwt: JwtService, private db: Db, private reflector: Reflector) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()])) return true;
    const req = ctx.switchToHttp().getRequest();
    const h: string | undefined = req.headers.authorization;
    if (!h?.startsWith('Bearer ')) throw err(401, 'UNAUTHENTICATED', 'يلزم تسجيل الدخول');

    let payload: { sub: string; sid: string };
    try {
      payload = await this.jwt.verifyAsync(h.slice(7));
    } catch {
      throw err(401, 'INVALID_TOKEN', 'الجلسة غير صالحة أو منتهية');
    }

    const { rows } = await this.db.query(
      `select s.id as sid, s.user_id, s.device_id, u.status as ustatus, r.code as role, d.status as dstatus
         from user_sessions s
         join users u on u.id = s.user_id
         join roles r on r.id = u.role_id
         left join devices d on d.id = s.device_id
        where s.id = $1 and s.user_id = $2 and s.revoked_at is null and s.expires_at > now()`,
      [payload.sid, payload.sub],
    );
    const row = rows[0];
    if (!row) throw err(401, 'SESSION_REVOKED', 'تم إنهاء الجلسة');
    if (row.ustatus !== 'active') throw err(403, 'ACCOUNT_SUSPENDED', 'الحساب موقوف');
    if (row.device_id && row.dstatus !== 'active') throw err(401, 'DEVICE_REVOKED', 'تم إلغاء ربط هذا الجهاز');

    req.user = { id: row.user_id, role: row.role, sessionId: row.sid, deviceId: row.device_id } as AuthUser;
    return true;
  }
}

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<string[]>(ROLES, [ctx.getHandler(), ctx.getClass()]);
    if (!roles || roles.length === 0) return true;
    const user: AuthUser | undefined = ctx.switchToHttp().getRequest().user;
    if (!user || !roles.includes(user.role)) throw err(403, 'FORBIDDEN', 'ليست لديك صلاحية لهذا الإجراء');
    return true;
  }
}
