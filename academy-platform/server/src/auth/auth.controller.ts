import { Body, Controller, HttpCode, Post, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { env } from '../common/support';
import { AuthService } from './auth.service';
import { ForgotDto, LoginDto, RefreshDto, RegisterDto, ResetDto } from './dto';
import { Public } from './guards';

const loginLimit = () => Number(process.env.LOGIN_THROTTLE_LIMIT ?? 10);

@Controller('auth')
export class AuthController {
  constructor(private auth: AuthService) {}

  @Public() @Post('register') @Throttle({ default: { limit: loginLimit, ttl: 60_000 } })
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto);
  }

  @Public() @Post('login') @HttpCode(200) @Throttle({ default: { limit: loginLimit, ttl: 60_000 } })
  login(@Body() dto: LoginDto, @Req() req: any) {
    return this.auth.login(dto, req.ip, req.headers['user-agent']);
  }

  @Public() @Post('refresh') @HttpCode(200)
  refresh(@Body() dto: RefreshDto) {
    return this.auth.refresh(dto.refreshToken);
  }

  @Post('logout') @HttpCode(204)
  async logout(@Req() req: any) {
    await this.auth.logout(req.user.sessionId);
  }

  /** استجابة موحدة سواء وُجد الحساب أم لا. الرمز لا يُعاد إلا في بيئة التطوير. */
  @Public() @Post('forgot-password') @HttpCode(200) @Throttle({ default: { limit: loginLimit, ttl: 60_000 } })
  async forgot(@Body() dto: ForgotDto) {
    const token = await this.auth.createResetToken(dto.identifier);
    // TODO(المرحلة 8): إرسال الرمز عبر SMS/بريد. حاليًا يُكشف في التطوير فقط.
    const expose = process.env.DEV_EXPOSE_RESET_TOKEN === 'true' && process.env.NODE_ENV !== 'production';
    return { ok: true, ...(expose && token ? { devResetToken: token } : {}) };
  }

  @Public() @Post('reset-password') @HttpCode(200)
  async reset(@Body() dto: ResetDto) {
    await this.auth.resetPassword(dto.token, dto.newPassword);
    return { ok: true };
  }
}
