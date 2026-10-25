import { Controller, Get, Req } from '@nestjs/common';
import { Db } from '../common/support';

@Controller('me')
export class MeController {
  constructor(private db: Db) {}

  @Get()
  async me(@Req() req: any) {
    const { rows } = await this.db.query(
      `select u.id, u.full_name, u.phone, u.email, u.grade_id, r.code as role
         from users u join roles r on r.id = u.role_id where u.id = $1`,
      [req.user.id],
    );
    return rows[0];
  }

  @Get('devices')
  async devices(@Req() req: any) {
    const { rows } = await this.db.query(
      'select id, model, os_version, status, bound_at, last_seen_at from devices where user_id = $1 order by bound_at desc',
      [req.user.id],
    );
    return rows;
  }
}
