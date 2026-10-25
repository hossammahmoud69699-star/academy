import { Controller, DefaultValuePipe, Get, HttpCode, Param, ParseIntPipe, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { Roles } from '../auth/guards';
import { AuditService, Db, err } from '../common/support';

const STAFF = ['admin', 'content_manager'];

@Controller('admin')
@Roles(...STAFF)
export class AdminController {
  constructor(private db: Db, private audit: AuditService) {}

  @Get('students')
  async students(
    @Query('q') q = '',
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('pageSize', new DefaultValuePipe(20), ParseIntPipe) pageSize: number,
  ) {
    const size = Math.min(Math.max(pageSize, 1), 100);
    const like = `%${q.replace(/[\\%_]/g, '\\$&')}%`;
    const { rows } = await this.db.query(
      `select u.id, u.full_name, u.phone, u.email, u.status, u.grade_id, u.last_login_at, count(*) over() as total
         from users u
        where u.role_id = 4 and u.status <> 'deleted'
          and ($1 = '' or u.full_name ilike $2 or u.phone ilike $2 or u.email::text ilike $2)
        order by u.created_at desc limit $3 offset $4`,
      [q, like, size, (Math.max(page, 1) - 1) * size],
    );
    return { total: rows[0] ? Number(rows[0].total) : 0, page, pageSize: size, items: rows.map(({ total, ...r }) => r) };
  }

  @Get('students/:id/devices')
  async devices(@Param('id', ParseUUIDPipe) id: string) {
    const { rows } = await this.db.query(
      'select id, model, os_version, app_version, status, bound_at, revoked_at, last_seen_at from devices where user_id = $1 order by bound_at desc',
      [id],
    );
    return rows;
  }

  @Post('devices/:id/revoke') @HttpCode(200)
  async revokeDevice(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    const r = await this.db.tx(async (c) => {
      const d = await c.query(
        "update devices set status = 'revoked', revoked_at = now(), revoked_by = $2 where id = $1 and status = 'active' returning user_id",
        [id, req.user.id],
      );
      if (!d.rows[0]) return null;
      await c.query("update user_sessions set revoked_at = now(), revoked_reason = 'device_revoked' where device_id = $1 and revoked_at is null", [id]);
      return d.rows[0];
    });
    if (!r) throw err(404, 'NOT_FOUND', 'الجهاز غير موجود أو ملغى مسبقًا');
    await this.audit.log('device.revoke', req.user.id, 'device', id, req.ip, { userId: r.user_id });
    return { ok: true };
  }

  @Post('students/:id/suspend') @HttpCode(200)
  async suspend(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    await this.setStatus(id, 'suspended', req);
    await this.db.query("update user_sessions set revoked_at = now(), revoked_reason = 'suspended' where user_id = $1 and revoked_at is null", [id]);
    return { ok: true };
  }

  @Post('students/:id/activate') @HttpCode(200)
  async activate(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    await this.setStatus(id, 'active', req);
    return { ok: true };
  }

  private async setStatus(id: string, status: 'active' | 'suspended', req: any) {
    const r = await this.db.query(
      "update users set status = $2 where id = $1 and role_id = 4 and status <> 'deleted' returning id",
      [id, status],
    );
    if (!r.rows[0]) throw err(404, 'NOT_FOUND', 'الطالب غير موجود');
    await this.audit.log(`user.${status === 'active' ? 'activate' : 'suspend'}`, req.user.id, 'user', id, req.ip);
  }
}
