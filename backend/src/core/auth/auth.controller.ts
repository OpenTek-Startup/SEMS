import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CookieOptions, Request, Response } from 'express';
import { readCookie, REFRESH_COOKIE, REFRESH_COOKIE_PATH } from './auth-rules';
import { AuthService, type SignInResult } from './auth.service';
import type { AuthContext, ClientInfo } from './auth.types';
import { AllowPendingPasswordChange, CurrentAuth, Public } from './decorators';
import { ChangePasswordDto } from './dto/change-password.dto';
import { LoginDto } from './dto/login.dto';

function clientInfo(req: Request): ClientInfo {
  return {
    ipAddress: req.ip ?? null,
    userAgent: req.headers['user-agent']?.slice(0, 255) ?? null,
  };
}

/**
 * /api/auth — contract shared with the frontend:
 *   POST /auth/login            { email, password } -> { accessToken, expiresIn, user } + refresh cookie
 *   POST /auth/refresh          (cookie)            -> { accessToken, expiresIn, user } + new cookie
 *   POST /auth/logout           (cookie)            -> { signedOut: true }, cookie cleared
 *   GET  /auth/me               Bearer              -> user
 *   POST /auth/change-password  Bearer { currentPassword, newPassword } -> user
 * All of them need the school (X-Tenant in development, subdomain in production),
 * except a platform Super Admin, who signs in with no school.
 */
@Controller('auth')
export class AuthController {
  private readonly secureCookie: boolean;

  constructor(
    private readonly auth: AuthService,
    config: ConfigService,
  ) {
    // Browsers only send Secure cookies over HTTPS; local development is HTTP.
    this.secureCookie = config.get<string>('nodeEnv') === 'production';
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.login(dto.email, dto.password, clientInfo(req));
    return this.respond(res, result);
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = readCookie(req.headers.cookie, REFRESH_COOKIE);
    const result = await this.auth.refresh(token, clientInfo(req));
    return this.respond(res, result);
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = readCookie(req.headers.cookie, REFRESH_COOKIE);
    await this.auth.logout(token, clientInfo(req));
    res.clearCookie(REFRESH_COOKIE, this.cookieOptions());
    return { signedOut: true };
  }

  @Get('me')
  @AllowPendingPasswordChange()
  me(@CurrentAuth() auth: AuthContext) {
    return this.auth.userView(auth.userId);
  }

  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  @AllowPendingPasswordChange()
  changePassword(
    @CurrentAuth() auth: AuthContext,
    @Body() dto: ChangePasswordDto,
    @Req() req: Request,
  ) {
    return this.auth.changePassword(auth, dto.currentPassword, dto.newPassword, clientInfo(req));
  }

  /** Refresh token -> httpOnly cookie (JavaScript can never read it); the rest -> JSON. */
  private respond(res: Response, result: SignInResult) {
    res.setHeader('Cache-Control', 'no-store');
    res.cookie(REFRESH_COOKIE, result.refreshToken, {
      ...this.cookieOptions(),
      maxAge: this.auth.sessionMaxAgeMs,
    });
    return { accessToken: result.accessToken, expiresIn: result.expiresIn, user: result.user };
  }

  private cookieOptions(): CookieOptions {
    return {
      httpOnly: true,
      secure: this.secureCookie,
      sameSite: 'lax',
      path: REFRESH_COOKIE_PATH,
    };
  }
}
