import { Body, Controller, Get, HttpCode, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { Types } from 'mongoose';
import { AppException } from '../../shared/errors/app-exception';
import { ErrorCode } from '../../shared/errors/error-codes';
import { AuthService } from './auth.service';
import { SessionService } from './session.service';
import { resolveProductAudienceFromHeaders, resolveProductAudienceFromOrigin } from './resolve-product-audience';
import { LoginRequestDto } from './dto/login-request.dto';
import { RegisterRequestDto } from './dto/register-request.dto';
import { ChangePasswordRequestDto } from './dto/change-password-request.dto';
import { IpRateLimitGuard } from '../../shared/rate-limit/ip-rate-limit.guard';
import { RateLimit } from '../../shared/rate-limit/rate-limit.decorator';

/**
 * OpenAPI `/auth/login` (security: [] — публичный, гость без сессии).
 * ADR-004: единый endpoint для всех трёх продуктов, audience резолвится
 * из Origin-заголовка, не из тела запроса.
 */
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly sessionService: SessionService,
  ) {}

  /**
   * Rate limit по IP (security review: до этого /auth/login был единственным
   * публичным auth-эндпоинтом вообще без анти-abuse защиты — credential
   * stuffing + DoS через argon2id, 64МБ памяти на попытку). 10/60с — выше,
   * чем на reveal-contact (5/60с), потому что легитимный пользователь может
   * несколько раз опечататься в пароле подряд, а строгий лимит на listing-
   * ключ (RedisRateLimitGuard) здесь неприменим — тут только IP.
   */
  @Post('login')
  @HttpCode(200)
  @UseGuards(IpRateLimitGuard)
  @RateLimit({ keyPrefix: 'auth-login', limit: 10, windowSeconds: 60 })
  async login(
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Body() dto: LoginRequestDto,
  ): Promise<{ identityId: string; requires2fa: boolean }> {
    const audience = resolveProductAudienceFromOrigin(req.headers.origin);

    const result = await this.authService.login({
      login: dto.login,
      password: dto.password,
      audience,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    // ADR-004 host-only cookie: без `domain` (браузер по умолчанию
    // ограничивает cookie точным host запроса, не поддоменом/родительским
    // доменом) — `secure` только в production (dev идёт по http://localhost,
    // браузер отклоняет `secure` cookie на не-HTTPS origin).
    reply.setCookie(SessionService.COOKIE_NAME, result.sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      expires: result.sessionExpiresAt,
    });

    return { identityId: result.identityId.toString(), requires2fa: result.requires2fa };
  }

  /**
   * OpenAPI `/auth/register` (security: [] — публичный). Не создаёт сессию
   * (нет cookie в ответе) — клиент вызывает /auth/login отдельно после
   * успешной регистрации, тот же паттерн, что типичный register→login
   * two-step flow, не auto-login сразу после создания аккаунта (проще
   * рассуждать о том, что 201 Created только создал ресурс, не выполнил
   * побочную авторизационную операцию).
   */
  @Post('register')
  @UseGuards(IpRateLimitGuard)
  @RateLimit({ keyPrefix: 'auth-register', limit: 5, windowSeconds: 60 })
  async register(@Body() dto: RegisterRequestDto): Promise<{ identityId: string }> {
    const identityId = await this.authService.registerIdentity({ login: dto.login, password: dto.password });
    return { identityId: identityId.toString() };
  }

  /**
   * Read-only session probe for product clients. Audience is resolved from the
   * configured origin (ADR-004) — из Origin, а при его отсутствии из хоста
   * запроса; a missing, expired,
   * revoked, or wrong-audience cookie is intentionally indistinguishable from
   * a guest and returns the same `{ authenticated: false }` body.
   */
  @Get('session')
  @HttpCode(200)
  async checkSession(@Req() req: FastifyRequest): Promise<{ authenticated: boolean }> {
    // Единственный маршрут, куда браузер приходит same-origin GET, то есть без
    // Origin: фронт по умолчанию ходит в API через свой же прокси. Отсюда и
    // резолв по хосту, см. resolve-product-audience.ts.
    const audience = resolveProductAudienceFromHeaders({
      origin: req.headers.origin,
      host: req.headers.host,
      forwardedProto: req.headers['x-forwarded-proto'] as string | undefined,
    });
    const session = await this.sessionService.getActiveSessionFromRequest(req, audience);
    return { authenticated: session !== null };
  }

  /**
   * Не в узкой OpenAPI-спеке v1-first-vertical-slice.yaml до этого прохода
   * (см. docs/operations/admin-control-plane.md "Не реализовано" п.4) —
   * закрывает честный пробел: SessionService.revokeSession существовал, но
   * не был подключен ни к одному HTTP-маршруту ни для одного audience.
   *
   * Идемпотентен: отсутствие cookie или уже отозванный/несуществующий
   * токен — тот же 200 {loggedOut:true}, не 401/404 (logout не должен
   * палить, была ли сессия вообще валидна — тот же non-disclosure принцип,
   * что уже применяется к login()). Cookie всегда очищается в ответе,
   * даже если сессию в БД искать было не по чему.
   */
  /**
   * Смена своего пароля. Работает со своей же сессией и требует текущий
   * пароль — отдельного права не нужно (тот же принцип, что /auth/logout).
   * Rate limit по IP: перебор текущего пароля здесь так же возможен, как на
   * /auth/login, и стоит столько же процессорного времени (argon2id).
   */
  @Post('change-password')
  @HttpCode(200)
  @UseGuards(IpRateLimitGuard)
  @RateLimit({ keyPrefix: 'auth-change-password', limit: 10, windowSeconds: 60 })
  async changePassword(
    @Req() req: FastifyRequest,
    @Body() dto: ChangePasswordRequestDto,
  ): Promise<{ changed: true; revokedSessions: number }> {
    const audience = resolveProductAudienceFromHeaders({
      origin: req.headers.origin,
      host: req.headers.host,
      forwardedProto: req.headers['x-forwarded-proto'] as string | undefined,
    });
    const session = await this.sessionService.getActiveSessionFromRequest(req, audience);
    if (!session) {
      throw new AppException(ErrorCode.AUTH_NO_SESSION, 'No active session');
    }

    const { revokedSessions } = await this.authService.changePassword({
      identityId: new Types.ObjectId(session.identityId),
      currentPassword: dto.currentPassword,
      newPassword: dto.newPassword,
      currentSessionToken: this.sessionService.getRawTokenFromRequest(req),
    });

    return { changed: true, revokedSessions };
  }

  @Post('logout')
  @HttpCode(200)
  async logout(
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<{ loggedOut: true }> {
    const rawToken = this.sessionService.getRawTokenFromRequest(req);
    if (rawToken) {
      await this.sessionService.revokeSession(rawToken);
    }

    reply.clearCookie(SessionService.COOKIE_NAME, { path: '/' });

    return { loggedOut: true };
  }
}
