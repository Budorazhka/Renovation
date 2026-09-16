import { Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { Types } from 'mongoose';
import { SessionRepository } from './repository/session.repository';
import type { ProductAudience } from './schemas/session.schema';

const SESSION_COOKIE_NAME = 'baza_session';
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 дней — конкретное число подлежит уточнению per-продукт на C-05, не финализировано этим первым проходом

export interface CreatedSession {
  token: string; // сырой токен — отдаётся клиенту ОДИН раз, сервер хранит только hash
  expiresAt: Date;
}

/**
 * ADR-004: host-only cookie, session хранит только tokenHash.
 * productAudience определяется вызывающим кодом (auth controller) по
 * origin запроса — этот сервис НЕ читает productAudience из тела запроса.
 */
@Injectable()
export class SessionService {
  constructor(private readonly sessionRepository: SessionRepository) {}

  private hashToken(rawToken: string): string {
    return createHash('sha256').update(rawToken).digest('hex');
  }

  async createSession(params: {
    identityId: Types.ObjectId;
    productAudience: ProductAudience;
    ipAddress?: string;
    userAgent?: string;
  }): Promise<CreatedSession> {
    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = this.hashToken(rawToken);
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

    await this.sessionRepository.create({
      identityId: params.identityId,
      productAudience: params.productAudience,
      tokenHash,
      expiresAt,
      ipAddress: params.ipAddress,
      userAgent: params.userAgent,
    });

    return { token: rawToken, expiresAt };
  }

  /**
   * Извлекает и валидирует активную сессию по host-only cookie запроса.
   * Не принимает productAudience от клиента как параметр выбора — вызывающий
   * код (per-продукт middleware) явно указывает, КАКОЙ audience он ожидает
   * на этом origin, не клиент решает.
   */
  async getActiveSessionFromRequest(
    req: FastifyRequest,
    expectedAudience: ProductAudience,
  ): Promise<{ identityId: string } | null> {
    const rawToken = this.parseCookie(req.headers.cookie, SESSION_COOKIE_NAME);
    if (!rawToken) return null;

    const tokenHash = this.hashToken(rawToken);
    const session = await this.sessionRepository.findActiveByTokenHash(tokenHash, expectedAudience);
    if (!session) return null;

    return { identityId: session.identityId.toString() };
  }

  /**
   * НЕ req.cookies (Fastify-декорированное удобство от @fastify/cookie
   * plugin) — найдено реальным сетевым E2E-прогоном (не unit/integration-
   * тестами): любой NestMiddleware на FastifyAdapter получает СЫРОЙ
   * Node.js req, не тот же FastifyRequest, что видят route handlers/guards
   * (подтверждено maintainer'ом NestJS, GitHub issue nestjs/nest#8837 —
   * @fastify/middie compat-слой отдаёт middleware unwrapped объект).
   * req.headers.cookie (стандартный HTTP-заголовок) — единственный
   * надёжный источник здесь, парсится вручную.
   *
   * Это устраняет ЧТЕНИЕ cookie внутри одного middleware — та же проблема
   * также затрагивала WRITE стороны: mutation req.tenantContext/
   * req.adminContext внутри TenantContextMiddleware/AdminContextMiddleware
   * не долетала до Guard'ов дальше по цепочке (тот же root cause —
   * middleware и guard видели РАЗНЫЕ объекты). ОБНОВЛЕНО (проверено по
   * текущему коду 2026-08-30): фикс ПРИМЕНЁН — TenantContextMiddleware/
   * AdminContextMiddleware/CorrelationIdMiddleware/
   * MarketplaceAccountContextMiddleware зарегистрированы как нативные
   * Fastify onRequest hooks в main.api.ts, минуя @fastify/middie
   * (`app.getHttpAdapter().getInstance().addHook('onRequest', ...)`), не
   * через AppModule.configure(). Этот cookie-парсинг фикс остаётся нужен
   * сам по себе независимо от того фикса, не откатывать.
   */
  private parseCookie(cookieHeader: string | undefined, name: string): string | undefined {
    if (!cookieHeader) return undefined;
    for (const pair of cookieHeader.split(';')) {
      const separatorIndex = pair.indexOf('=');
      if (separatorIndex === -1) continue;
      const key = pair.slice(0, separatorIndex).trim();
      if (key === name) {
        return decodeURIComponent(pair.slice(separatorIndex + 1).trim());
      }
    }
    return undefined;
  }

  /**
   * POST /auth/logout: идемпотентно — мусорный/уже отозванный токен просто
   * не находит совпадения по tokenHash (updateOne с 0 modifiedCount), не
   * бросает. Вызывающий код (AuthController) не обязан заранее знать,
   * валиден ли токен ещё.
   */
  async revokeSession(rawToken: string): Promise<void> {
    await this.sessionRepository.revokeByTokenHash(this.hashToken(rawToken));
  }

  /** Смена пароля: закрыть все остальные сессии человека, текущую оставить. Возвращает, сколько закрыто. */
  async revokeOtherSessions(identityId: Types.ObjectId, currentRawToken: string): Promise<number> {
    return this.sessionRepository.revokeAllForIdentityExceptToken(identityId, this.hashToken(currentRawToken));
  }

  async revokeAllErpSessions(identityId: Types.ObjectId): Promise<void> {
    await this.sessionRepository.revokeAllForIdentity(identityId, 'erp');
  }

  /**
   * AdminAccountService.deactivateAdminAccount: деактивация аккаунта должна
   * немедленно обесценить уже выданные admin-audience сессии этой identity —
   * иначе AdminGuard продолжал бы пускать по старому cookie до истечения
   * TTL сессии (AdminContextMiddleware фильтрует по AdminAccount.status
   * только на момент запроса, но сама сессия оставалась бы активной).
   * Не трогает marketplace/erp-сессии того же человека — тот же ADR-004
   * принцип изоляции audience, что revokeAllErpSessions выше.
   */
  async revokeAllAdminSessions(identityId: Types.ObjectId): Promise<void> {
    await this.sessionRepository.revokeAllForIdentity(identityId, 'admin');
  }

  /**
   * Извлекает сырой токен из cookie запроса без валидации по БД — нужен
   * AuthController.logout ДО решения, есть ли активная сессия вообще
   * (сам revokeSession делает поиск по hash, здесь только парсинг cookie).
   */
  getRawTokenFromRequest(req: FastifyRequest): string | undefined {
    return this.parseCookie(req.headers.cookie, SESSION_COOKIE_NAME);
  }

  static readonly COOKIE_NAME = SESSION_COOKIE_NAME;
}
