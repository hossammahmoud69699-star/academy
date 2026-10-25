import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AdminController } from './admin/admin.controller';
import { AuthController } from './auth/auth.controller';
import { AuthService } from './auth/auth.service';
import { AuthGuard, RolesGuard } from './auth/guards';
import { AuditService, Db, env } from './common/support';
import { MeController } from './users/me.controller';

@Global()
@Module({
  imports: [
    ThrottlerModule.forRootAsync({
      useFactory: () => [{ ttl: 60_000, limit: Number(process.env.THROTTLE_LIMIT ?? 120) }],
    }),
    JwtModule.registerAsync({
      global: true,
      useFactory: () => ({
        secret: env('JWT_ACCESS_SECRET'),
        signOptions: { expiresIn: Number(env('ACCESS_TOKEN_TTL_SECONDS', '900')) },
      }),
    }),
  ],
  controllers: [AuthController, AdminController, MeController],
  providers: [
    Db,
    AuditService,
    AuthService,
    // الترتيب مهم: تحديد المعدل ← المصادقة ← الأدوار
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
  exports: [Db, AuditService],
})
export class AppModule {}
