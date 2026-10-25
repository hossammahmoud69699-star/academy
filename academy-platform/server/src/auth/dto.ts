import { IsInt, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class RegisterDto {
  @IsString() @MinLength(3) @MaxLength(120) fullName: string;
  @IsString() @MaxLength(120) identifier: string; // هاتف أو بريد
  @IsString() @MinLength(8) @MaxLength(128) password: string;
  @IsOptional() @IsInt() gradeId?: number;
}

export class LoginDto {
  @IsString() @MaxLength(120) identifier: string;
  @IsString() @MinLength(1) @MaxLength(128) password: string;
  @IsOptional() @IsString() @MaxLength(200) deviceFingerprint?: string;
  @IsOptional() @IsString() @MaxLength(120) deviceModel?: string;
  @IsOptional() @IsString() @MaxLength(40) osVersion?: string;
  @IsOptional() @IsString() @MaxLength(40) appVersion?: string;
}

export class RefreshDto {
  @IsString() @MaxLength(200) refreshToken: string;
}

export class ForgotDto {
  @IsString() @MaxLength(120) identifier: string;
}

export class ResetDto {
  @IsString() @MaxLength(200) token: string;
  @IsString() @MinLength(8) @MaxLength(128) newPassword: string;
}
