import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection, Types } from 'mongoose';
import { runInTransaction } from '../../shared/transactions/run-in-transaction';
import { PositionRepository } from './repository/position.repository';
import { PositionAssignmentRepository } from './repository/position-assignment.repository';
import { PositionProfileRepository, type PositionProfileFields } from './repository/position-profile.repository';
import { AuthService } from '../identity/auth.service';
import { MediaService } from '../media/media.service';
import { AppException } from '../../shared/errors/app-exception';
import { ErrorCode } from '../../shared/errors/error-codes';
import type { PositionDocument, FixedRole } from './schemas/position.schema';
import type { TeamUserStatus } from './team-user-status';
import { OWNER_PLACEHOLDER_NAME, OrganizationsService, occupantDisplayName } from './organizations.service';

/**
 * `[technical decision — 25.08.2026, обновлено 26.08.2026]`, НЕ owner
 * decision: ERP-фронтенд (apps/erp-web/src/services/teamApi.ts) ожидает
 * широкий TeamUser-объект. Большинство полей резолвится из Identity/
 * Position напрямую; HR-профильные поля (phone/telegram/birthDate/skills/
 * vk/instagram/website/aboutMe/aboutCompany/department/city/hireDate) —
 * из отдельной коллекции position_profiles (PositionProfileRepository,
 * honest gap закрыт 26.08.2026) — этих полей физически НЕТ ни в одном
 * ADR/domain-model.md, position_profiles — technical decision этого
 * прохода, не расширение специфицированной domain-модели.
 *
 * occupancyHistory — намеренно пустой массив, не полная история: Position
 * не хранит массив прошлых занятий, только текущий активный
 * PositionAssignment через отдельный запрос; закрытые (endedAt задан)
 * assignment существуют в БД, но агрегация их в массив для каждой позиции
 * — отдельное расширение за пределы минимального adapter, честно не
 * реализовано здесь.
 */
export interface TeamUserView {
  id: string;
  platformUserId: string;
  teamId: string;
  name: string;
  role: FixedRole;
  position: string;
  managerId: string | null;
  loginEmail: string;
  email: string;
  status: 'active' | 'blocked' | 'invited';
  skills: string[];
  permissionOverrides: Record<string, string>;
  positionId: string;
  parentPositionId: string | null;
  vacant: boolean;
  occupancyHistory: never[];
  avatarUrl?: string;
  phone?: string;
  hireDate?: string;
  birthDate?: string;
  department?: string;
  city?: string;
  telegram?: string;
  aboutMe?: string;
  aboutCompany?: string;
  whatsapp?: string;
  vk?: string;
  instagram?: string;
  website?: string;
}

@Injectable()
export class TeamService {
  constructor(
    private readonly positionRepository: PositionRepository,
    private readonly positionAssignmentRepository: PositionAssignmentRepository,
    private readonly positionProfileRepository: PositionProfileRepository,
    private readonly authService: AuthService,
    private readonly mediaService: MediaService,
    private readonly organizationsService: OrganizationsService,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  /**
   * GET /team-users (teamApi.list): все позиции организации, занятые
   * позиции обогащены Identity.normalizedLogin занимающего (батчево, не
   * N+1 запросов — findAllByOrganization/findAllActiveByOrganization/
   * findByIds каждый по одному запросу).
   */
  async listForOrganization(organizationId: Types.ObjectId): Promise<TeamUserView[]> {
    const positions = await this.positionRepository.findAllByOrganization(organizationId);
    const assignments = await this.positionAssignmentRepository.findAllActiveByOrganization(organizationId);

    const assignmentByPositionId = new Map(assignments.map((a) => [a.positionId.toString(), a]));
    const identityIds = assignments.map((a) => a.identityId);
    const identities = identityIds.length > 0 ? await this.authService.findByIds(identityIds) : [];
    const identityById = new Map(identities.map((i) => [i.id.toString(), i]));

    // Batch-резолвинг avatarUrl: MVP-масштаб (≤40 позиций на организацию,
    // см. mongodb-schema.md `identities` "Риск роста: линейный, незначителен")
    // — N параллельных lookup'ов приемлемы, тот же принцип, что ensureSelf
    // переиспользует listForOrganization целиком вместо отдельного запроса.
    const positionsWithAvatar = positions.filter((p) => p.avatarAssetId);
    const avatarUrlEntries = await Promise.all(
      positionsWithAvatar.map(async (position) => {
        const url = await this.resolveAvatarUrl(position.avatarAssetId!, position.organizationId);
        return [position._id.toString(), url] as const;
      }),
    );
    const avatarUrlByPositionId = new Map(
      avatarUrlEntries.filter((entry): entry is [string, string] => entry[1] !== null),
    );

    // Один batched запрос ($in), не N — тот же принцип, что findByIds для
    // identities выше (position_profiles может отсутствовать для позиций,
    // созданных до появления этой коллекции — findByPositionId вернул бы
    // null для них, toView трактует отсутствие как "все HR-поля пусты",
    // не ошибка).
    const positionIds = positions.map((p) => p._id);
    const profiles = positionIds.length > 0 ? await this.positionProfileRepository.findByPositionIds(positionIds) : [];
    const profileByPositionId = new Map(profiles.map((p) => [p.positionId.toString(), p]));

    const nameByPositionId = await this.resolvePlaceholderNames(positions);
    return positions.map((position) =>
      this.toView(position, assignmentByPositionId, identityById, avatarUrlByPositionId, profileByPositionId, nameByPositionId),
    );
  }

  /**
   * Владельцы, зарегистрированные до поля «Ваше имя», сидят в должности с
   * заглушкой «Owner». Организацию читаем, только если заглушка есть: у
   * независимого риэлтора её название и есть его имя (occupantDisplayName).
   */
  private async resolvePlaceholderNames(positions: PositionDocument[]): Promise<Map<string, string>> {
    const names = new Map<string, string>();
    const withPlaceholder = positions.filter((p) => p.currentOccupantName?.trim() === OWNER_PLACEHOLDER_NAME);
    for (const position of withPlaceholder) {
      const organization = await this.organizationsService.getOrganizationById(position.organizationId);
      const name = occupantDisplayName(position.currentOccupantName, organization);
      if (name) names.set(position._id.toString(), name);
    }
    return names;
  }

  /**
   * teamApi.ts::uploadAvatar — привязывает уже подтверждённый MediaAsset
   * (клиент прошёл createUploadIntent→PUT→confirmUpload раньше, вне этого
   * вызова) к позиции. expectedOrganizationId проверяется дважды: здесь
   * (позиция принадлежит организации вызывающего) И внутри
   * MediaService.getAssetForOwnerScope при следующем чтении (asset
   * принадлежит той же организации) — оба свои независимые tenant-escape
   * проверки, не дублирование одной и той же.
   */
  async setPositionAvatar(
    positionId: Types.ObjectId,
    organizationId: Types.ObjectId,
    assetId: Types.ObjectId,
  ): Promise<TeamUserView> {
    const position = await this.positionRepository.findByIdForOrganization(positionId, organizationId);
    if (!position) {
      throw new NotFoundException('Position not found');
    }

    const asset = await this.mediaService.getAssetForOwnerScope(assetId, {
      type: 'organization',
      organizationId,
    });
    if (!asset) {
      throw new NotFoundException('Media asset not found');
    }
    if (asset.status !== 'verified') {
      throw new AppException(ErrorCode.VALIDATION_FAILED, 'Media asset is not verified yet');
    }

    await this.positionRepository.setAvatarAsset(positionId, assetId);

    const view = await this.ensureSelf(organizationId, positionId);
    return view!;
  }

  /**
   * null — asset ещё не verified (worker не построил variants) ИЛИ ownerScope
   * не совпал (не должно происходить в норме — avatarAssetId всегда
   * проставляется setPositionAvatar той же организации, но защита не
   * убирается на случай будущей рассинхронизации). 'card' variant — тот же
   * выбор размера, что подошёл бы для профильного аватара (не thumbnail,
   * слишком мелкий для профильной карточки; не detail, избыточен).
   */
  private async resolveAvatarUrl(assetId: Types.ObjectId, organizationId: Types.ObjectId): Promise<string | null> {
    const asset = await this.mediaService.getAssetForOwnerScope(assetId, { type: 'organization', organizationId });
    if (!asset || asset.status !== 'verified') {
      return null;
    }
    const cardVariant = asset.variants.find((v) => v.type === 'card');
    if (!cardVariant) {
      return null;
    }
    return this.mediaService.getVariantUrl(cardVariant);
  }

  /**
   * GET /team-users/:positionId (teamApi.getById) — одна позиция, tenant-
   * scoped единым NOT_FOUND для "не существует" и "чужая организация" (тот
   * же принцип non-disclosure, что findByIdForOrganization везде в этом
   * модуле). closed исключена явно — та же семантика, что findAllByOrganization
   * применяет к list() (см. её комментарий: закрытая позиция значит
   * "удалена", не должна быть видна и по прямому id).
   *
   * В отличие от ensureSelf НЕ перевызывает listForOrganization целиком —
   * резолвит assignment/identity/avatar/profile только для ЭТОЙ одной
   * позиции, не для всех позиций организации. toView — тот же приватный
   * builder "одна PositionDocument → один TeamUserView", что и list()
   * использует внутри своего map(), просто с картами на один элемент.
   */
  async getById(positionId: Types.ObjectId, organizationId: Types.ObjectId): Promise<TeamUserView> {
    const position = await this.positionRepository.findByIdForOrganization(positionId, organizationId);
    if (!position || position.status === 'closed') {
      throw new NotFoundException('Position not found');
    }

    const positionIdStr = positionId.toString();

    const assignment = await this.positionAssignmentRepository.findActiveByPosition(positionId);
    const assignmentByPositionId = new Map<string, { identityId: Types.ObjectId }>();
    const identityById = new Map<string, { normalizedLogin: string; status: string }>();
    if (assignment) {
      assignmentByPositionId.set(positionIdStr, assignment);
      const [identity] = await this.authService.findByIds([assignment.identityId]);
      if (identity) {
        identityById.set(identity.id.toString(), identity);
      }
    }

    const avatarUrlByPositionId = new Map<string, string>();
    if (position.avatarAssetId) {
      const url = await this.resolveAvatarUrl(position.avatarAssetId, position.organizationId);
      if (url) {
        avatarUrlByPositionId.set(positionIdStr, url);
      }
    }

    const profile = await this.positionProfileRepository.findByPositionId(positionId);
    const profileByPositionId = new Map<string, PositionProfileFields>();
    if (profile) {
      profileByPositionId.set(positionIdStr, profile);
    }

    const nameByPositionId = await this.resolvePlaceholderNames([position]);
    return this.toView(position, assignmentByPositionId, identityById, avatarUrlByPositionId, profileByPositionId, nameByPositionId);
  }

  /**
   * teamApi.ts::createAccountSlot(payload) — «Добавить слот менеджера»:
   * вакантная позиция без occupant'а, в отличие от createOccupiedPosition
   * НЕ трогает Identity/PositionAssignment/PositionProfile вообще.
   * Position + её стартовые DEFAULT_ROLE_GRANTS — одной транзакцией через
   * OrganizationsService.createVacantPosition, которая это уже делает (тот
   * же composite-шаг, что createOccupiedPosition переиспользует).
   *
   * `position`/`accessProfile` из payload здесь не участвуют вообще — см.
   * CreateTeamAccountSlotDto комментарий про honest gap.
   */
  async createVacantSlot(params: {
    organizationId: Types.ObjectId;
    fixedRole: FixedRole;
    managerId: Types.ObjectId | null;
  }): Promise<TeamUserView> {
    const positionId = await runInTransaction(this.connection, (session) =>
      this.organizationsService.createVacantPosition({
        organizationId: params.organizationId,
        fixedRole: params.fixedRole,
        parentPositionId: params.managerId ?? undefined,
        session,
      }),
    );

    const view = await this.ensureSelf(params.organizationId, positionId);
    return view!;
  }

  /**
   * teamApi.ts::create(payload) — второй, отдельный от assignOccupant-
   * invite-flow путь создания сотрудника: руководитель сам задаёт пароль
   * (payload.password), человек сразу active (не pending_invite/inviteToken).
   * Composite-команда поверх уже существующих (протестированных):
   * AuthService.registerIdentity → OrganizationsService.createVacantPosition
   * → OrganizationsService.assignOccupant → PositionProfileRepository.create.
   * НЕ единая MongoDB-транзакция через все четыре шага — registerIdentity
   * пишет в Identity-модуль (ADR-001 модульная граница, тот же принцип, что
   * grantErpAccess/revokeAllErpSessions уже применяют по всему этому файлу).
   * `position` (человекочитаемый title, например "Старший менеджер") НЕ
   * хранится — backend знает только fixedRole enum (тот же честный
   * компромисс, что toView уже документирует: position:fixedRole).
   */
  async createOccupiedPosition(params: {
    organizationId: Types.ObjectId;
    actorIdentityId: Types.ObjectId;
    correlationId: string;
    fixedRole: FixedRole;
    managerId: Types.ObjectId | null;
    loginEmail: string;
    password: string;
    occupantDisplayName: string;
    profile: PositionProfileFields;
  }): Promise<TeamUserView> {
    // Identity создаётся ВНЕ транзакции и раньше остальных шагов: `identities`
    // принадлежит Identity-модулю, и запись в неё изнутри транзакции
    // Organizations нарушала бы ADR-001 — тот же принцип, по которому
    // grantErpAccess вынесен за коммит, а assignOccupantByEmail резолвит
    // identity двухфазно.
    const identityId = await this.authService.registerIdentity({ login: params.loginEmail, password: params.password });

    // Всё, что принадлежит Organizations, — одной транзакцией. Раньше это
    // были четыре последовательные команды без общей границы: падение на
    // середине оставляло вакантную позицию со стартовыми грантами, за
    // которой нет человека, или занятую позицию без профиля. Ни то, ни
    // другое не видно из интерфейса как ошибка — выглядит как настоящий
    // состав команды.
    const positionId = await runInTransaction(this.connection, async (session) => {
      const createdPositionId = await this.organizationsService.createVacantPosition({
        organizationId: params.organizationId,
        fixedRole: params.fixedRole,
        parentPositionId: params.managerId ?? undefined,
        session,
      });

      await this.organizationsService.assignOccupant({
        positionId: createdPositionId,
        identityId,
        occupantDisplayName: params.occupantDisplayName,
        actorIdentityId: params.actorIdentityId,
        expectedOrganizationId: params.organizationId,
        correlationId: params.correlationId,
        session,
      });

      await this.positionProfileRepository.create(
        createdPositionId,
        params.organizationId,
        params.profile,
        session,
      );

      return createdPositionId;
    });

    // ProductAccess — коллекция Identity-модуля, поэтому после коммита, а не
    // внутри него (ADR-001). Внутри транзакции assignOccupant этот шаг
    // пропускает и оставляет вызывающему: «после коммита» имеет смысл только
    // здесь. Если шаг упадёт, человек несколько мгновений не сможет войти в
    // ERP — это безопасная сторона отказа, обратная («доступ есть, позиции
    // нет») была бы небезопасной.
    await this.authService.grantErpAccess(identityId);

    const view = await this.ensureSelf(params.organizationId, positionId);
    return view!;
  }

  /**
   * teamApi.ts::update(id, payload) — ТОЛЬКО HR-профильные поля (upsert,
   * см. PositionProfileRepository.upsertFields — позиция могла существовать
   * до появления position_profiles). Роль/менеджер/пароль здесь НЕ меняются
   * (payload.password уже отбрасывается на уровне фронтенда, teamApi.ts
   * комментарий: "Пароль на позиции не живёт") — смена роли/менеджера уже
   * покрыта отдельными move/setStatus endpoint'ами этого контроллера, не
   * дублируется здесь.
   */
  async updateProfile(
    positionId: Types.ObjectId,
    organizationId: Types.ObjectId,
    profile: Partial<PositionProfileFields>,
  ): Promise<TeamUserView> {
    const position = await this.positionRepository.findByIdForOrganization(positionId, organizationId);
    if (!position) {
      throw new NotFoundException('Position not found');
    }

    await this.positionProfileRepository.upsertFields(positionId, organizationId, profile);

    const view = await this.ensureSelf(organizationId, positionId);
    return view!;
  }

  /**
   * Generic lookup одной позиции по positionId (не обязательно "self" —
   * имя метода отражает основной вызывающий случай, POST /team-users/
   * ensure-self, где positionId ВСЕГДА берётся из TenantContext.positionId
   * текущей identity; но метод переиспользуется и для vacate/move
   * HTTP-handler'ов TeamController, где positionId — произвольная позиция
   * из URL-параметра, не обязательно текущего пользователя). Не отдельный
   * специализированный запрос — переиспользует listForOrganization (на
   * MVP-масштабе ≤40 позиций на организацию лишний список не проблема,
   * см. mongodb-schema.md `identities` "Риск роста: линейный, незначителен").
   */
  async ensureSelf(organizationId: Types.ObjectId, positionId: Types.ObjectId): Promise<TeamUserView | null> {
    const views = await this.listForOrganization(organizationId);
    return views.find((v) => v.positionId === positionId.toString()) ?? null;
  }

  /**
   * teamApi.ts::setStatus(id, status) — status в TeamUser описывает
   * СОТРУДНИКА (текущего occupant позиции), не саму Position. 'invited'
   * НЕ поддержан здесь — тот же честный пробел, что mapIdentityStatus:
   * 'invited' достигается только через assignOccupant-invite-flow
   * (pending_invite Identity), не через ручной PATCH .../status — этот
   * endpoint не подменяет собой activate-flow. Vacant-позиция (нет
   * occupant) — 400, не тихий no-op: клиент запросил операцию, которую
   * физически невозможно выполнить (нет Identity, чей status менять).
   */
  async setPositionOccupantStatus(
    positionId: Types.ObjectId,
    organizationId: Types.ObjectId,
    status: TeamUserStatus,
  ): Promise<TeamUserView> {
    if (status === 'invited') {
      throw new AppException(
        ErrorCode.VALIDATION_FAILED,
        `status:'invited' requires an invite-flow, not implemented on this backend`,
      );
    }

    const position = await this.positionRepository.findByIdForOrganization(positionId, organizationId);
    if (!position) {
      throw new NotFoundException('Position not found');
    }

    const assignment = await this.positionAssignmentRepository.findActiveByPosition(positionId);
    if (!assignment) {
      throw new AppException(ErrorCode.VALIDATION_FAILED, 'Position has no active occupant to change status for');
    }

    if (status === 'active') {
      await this.authService.reactivateIdentity(assignment.identityId);
    } else {
      await this.authService.deactivateIdentity(assignment.identityId);
    }

    const view = await this.ensureSelf(organizationId, positionId);
    return view!;
  }

  private toView(
    position: PositionDocument,
    assignmentByPositionId: Map<string, { identityId: Types.ObjectId }>,
    identityById: Map<string, { normalizedLogin: string; status: string }>,
    avatarUrlByPositionId: Map<string, string>,
    profileByPositionId: Map<string, PositionProfileFields>,
    nameByPositionId: Map<string, string> = new Map(),
  ): TeamUserView {
    const positionIdStr = position._id.toString();
    const assignment = assignmentByPositionId.get(positionIdStr);
    const identity = assignment ? identityById.get(assignment.identityId.toString()) : undefined;
    const profile = profileByPositionId.get(positionIdStr);

    return {
      id: positionIdStr,
      platformUserId: assignment?.identityId.toString() ?? '',
      teamId: position.organizationId.toString(),
      name: nameByPositionId.get(positionIdStr) ?? position.currentOccupantName ?? '',
      role: position.fixedRole,
      position: position.fixedRole,
      managerId: position.parentPositionId?.toString() ?? null,
      loginEmail: identity?.normalizedLogin ?? '',
      email: identity?.normalizedLogin ?? '',
      status: identity ? this.mapIdentityStatus(identity.status) : 'active',
      skills: profile?.skills ?? [],
      permissionOverrides: {},
      positionId: positionIdStr,
      parentPositionId: position.parentPositionId?.toString() ?? null,
      vacant: position.status === 'vacant',
      occupancyHistory: [],
      avatarUrl: avatarUrlByPositionId.get(positionIdStr),
      phone: profile?.phone,
      hireDate: profile?.hireDate,
      birthDate: profile?.birthDate,
      department: profile?.department,
      city: profile?.city,
      telegram: profile?.telegram,
      aboutMe: profile?.aboutMe,
      aboutCompany: profile?.aboutCompany,
      whatsapp: profile?.whatsapp,
      vk: profile?.vk,
      instagram: profile?.instagram,
      website: profile?.website,
    };
  }

  /**
   * Identity.status: 'active'|'deactivated'|'pending_invite' (3 значения,
   * ИЗМЕНЕНО invite-flow) → TeamUserStatus: 'active'|'blocked'|'invited'.
   * 'pending_invite' → 'invited' — ТЕПЕРЬ достижимо (assignOccupantByEmail
   * создаёт Identity в этом статусе для новых людей, честный пробел из
   * прошлой версии этого комментария закрыт). 'deactivated' по-прежнему
   * сопоставлено с 'blocked' как ближайшее приближение (нет отдельного
   * "деактивирован администратором" статуса позиции в текущей модели).
   */
  private mapIdentityStatus(status: string): 'active' | 'blocked' | 'invited' {
    if (status === 'active') return 'active';
    if (status === 'pending_invite') return 'invited';
    return 'blocked';
  }
}
