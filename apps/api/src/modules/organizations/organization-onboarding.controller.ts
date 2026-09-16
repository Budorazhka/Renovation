import { Body, Controller, HttpCode, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { SessionService } from '../identity/session.service';
import { OrganizationsService } from './organizations.service';
import { RegisterOrganizationDto } from './dto/register-organization.dto';
import { IpRateLimitGuard } from '../../shared/rate-limit/ip-rate-limit.guard';
import { RateLimit } from '../../shared/rate-limit/rate-limit.decorator';

/**
 * Публичный (без TenantGuard) onboarding-путь — намеренно отдельный
 * контроллер, а не метод на OrganizationsController: тот целиком
 * class-guarded `@UseGuards(TenantGuard, PermissionGuard)` (требует уже
 * существующий tenant context), а у только что зарегистрированной Identity
 * (после POST /auth/register) организации ещё нет — TenantGuard всегда
 * отклонил бы этот запрос. НЕ используется реальная сессионная cookie для
 * идентификации вызывающего (её ещё не существует на этом шаге) — вместо
 * этого DTO повторно принимает login/password для подтверждения владения
 * Identity (AuthService.verifyCredentialsForOnboarding).
 *
 * Закрывает реальный, найденный E2E-прогоном D-07 gap: OrganizationsService.
 * createOrganizationWithOwner раньше вызывался ТОЛЬКО из unit-тестов, не
 * было ни одного HTTP-пути создать организацию — единственным способом
 * пройти "Developer owner входит в ERP" была прямая запись в MongoDB.
 */
@Controller('organizations')
export class OrganizationOnboardingController {
  constructor(
    private readonly organizationsService: OrganizationsService,
  ) {}

  /**
   * Rate limit по IP (security review) — этот путь тоже принимает
   * login+password (verifyCredentialsForOnboarding, см. докстринг класса) и
   * без лимита был бы ещё одним неограниченным auth-подобным вектором,
   * помимо /auth/login.
   */
  @Post('register')
  @HttpCode(201)
  @UseGuards(IpRateLimitGuard)
  @RateLimit({ keyPrefix: 'org-register', limit: 5, windowSeconds: 60 })
  async register(
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Body() dto: RegisterOrganizationDto,
  ): Promise<{ organizationId: string; positionId: string; identityId: string }> {
    const result = await this.organizationsService.registerOrganizationOwner({
      login: dto.login,
      password: dto.password,
      type: dto.type,
      name: dto.name,
      ownerName: dto.ownerName,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    // Тот же cookie-паттерн, что AuthController.login (ADR-004 host-only,
    // httpOnly, secure только в production) — клиенту не нужен отдельный
    // POST /auth/login сразу после регистрации организации.
    reply.setCookie(SessionService.COOKIE_NAME, result.sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      expires: result.sessionExpiresAt,
    });

    return {
      organizationId: result.organizationId.toString(),
      positionId: result.positionId.toString(),
      identityId: result.identityId.toString(),
    };
  }
}
