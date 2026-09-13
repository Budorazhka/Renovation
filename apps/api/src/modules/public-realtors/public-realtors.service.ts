import { Injectable, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { OrganizationsService } from '../organizations/organizations.service';
import { RealtorReviewsService } from '../realtor-reviews/realtor-reviews.service';
import { MediaService } from '../media/media.service';
import type { FixedRole, PositionDocument } from '../organizations/schemas/position.schema';
import type { OrganizationType } from '../organizations/schemas/organization.schema';
import type { PositionProfileDocument } from '../organizations/schemas/position-profile.schema';

export interface PublicRealtorProfile {
  id: string;
  name: string;
  fixedRole: FixedRole;
  organizationName: string;
  organizationType: OrganizationType;
  city: string | null;
  aboutMe: string | null;
  avatarUrl: string | null;
  socials: { telegram: string | null; whatsapp: string | null; instagram: string | null; website: string | null };
  rating: { average: number; count: number } | null;
}

/**
 * N-13 (owner decision 14.09.2026): "риэлтор" — занятая Position с
 * клиентской ролью (owner/director/rop/manager, см.
 * PositionRepository.listPublicRealtors) в организации типа
 * agency/independent_realtor. Не отдельный флаг согласия на человеке —
 * тип организации выбирается один раз при `POST /organizations/register`.
 *
 * Публикуются только профессионально-контактные поля PositionProfile
 * (aboutMe/city/соцсети) — HR-поля (hireDate/birthDate/department/skills)
 * НЕ входят в публичную проекцию намеренно, это внутренние данные найма,
 * не публичный профиль. Телефон — отдельным rate-limited reveal-эндпоинтом
 * (PublicRealtorsController), не в этой проекции: та же причина, что у
 * buyer-requests (owner decision 14.09.2026), плюс защита от массового
 * скрапинга контактов всей команды агентства одним запросом листинга.
 *
 * "Рейтинг"/"бейджи"/"стаж"/"число сделок" из демо marketplace-web
 * (RealtorsPage.tsx) сюда намеренно НЕ перенесены за исключением
 * агрегированного рейтинга по реальным одобренным отзывам — остальное
 * (бейджи "ТОП-1 Батуми" и т.п., стаж, число сделок) не имеет опоры ни в
 * одной коллекции и было бы визуальным обещанием несуществующих данных
 * (PRODUCT.md).
 */
@Injectable()
export class PublicRealtorsService {
  constructor(
    private readonly organizationsService: OrganizationsService,
    private readonly realtorReviewsService: RealtorReviewsService,
    private readonly mediaService: MediaService,
  ) {}

  async listPublic(params: { cursor?: Types.ObjectId; city?: string; limit: number }): Promise<{ items: PublicRealtorProfile[]; nextCursor: string | null }> {
    const positions = await this.organizationsService.listPublicRealtorPositions({ cursor: params.cursor, city: params.city, limit: params.limit + 1 });
    const hasMore = positions.length > params.limit;
    const pagePositions = hasMore ? positions.slice(0, params.limit) : positions;
    const items = await this.toProfiles(pagePositions);
    const nextCursor = hasMore ? pagePositions[pagePositions.length - 1]!._id.toString() : null;
    return { items, nextCursor };
  }

  async getPublic(positionId: Types.ObjectId): Promise<PublicRealtorProfile> {
    const position = await this.organizationsService.getPublicRealtorPosition(positionId);
    if (!position) {
      throw new NotFoundException('Realtor not found');
    }
    const [profile] = await this.toProfiles([position]);
    return profile!;
  }

  async revealPhone(positionId: Types.ObjectId): Promise<{ phone: string }> {
    const position = await this.organizationsService.getPublicRealtorPosition(positionId);
    if (!position) {
      throw new NotFoundException('Realtor not found');
    }
    const [profile] = await this.organizationsService.getPositionProfilesByIds([positionId]);
    if (!profile?.phone) {
      throw new NotFoundException('Phone not published for this realtor');
    }
    return { phone: profile.phone };
  }

  private async toProfiles(positions: PositionDocument[]): Promise<PublicRealtorProfile[]> {
    if (positions.length === 0) return [];

    const positionIds = positions.map((p) => p._id);
    const organizationIds = [...new Set(positions.map((p) => p.organizationId))];

    const [profiles, organizations, stats] = await Promise.all([
      this.organizationsService.getPositionProfilesByIds(positionIds),
      this.organizationsService.listPublicOrganizations(organizationIds),
      this.realtorReviewsService.getApprovedStats(positionIds),
    ]);

    const profileByPositionId = new Map<string, PositionProfileDocument>(profiles.map((p) => [p.positionId.toString(), p]));
    const organizationById = new Map(organizations.map((o) => [o.id.toString(), o]));

    const avatarUrlEntries = await Promise.all(
      positions
        .filter((p) => p.avatarAssetId)
        .map(async (p) => {
          const url = await this.resolveAvatarUrl(p.avatarAssetId!, p.organizationId);
          return [p._id.toString(), url] as const;
        }),
    );
    const avatarUrlByPositionId = new Map(avatarUrlEntries.filter((entry): entry is [string, string] => entry[1] !== null));

    return positions.map((position) => {
      const idStr = position._id.toString();
      const profile = profileByPositionId.get(idStr);
      const organization = organizationById.get(position.organizationId.toString());
      const rating = stats.get(idStr);
      return {
        id: idStr,
        name: position.currentOccupantName ?? '',
        fixedRole: position.fixedRole,
        organizationName: organization?.name ?? '',
        organizationType: organization?.type ?? 'agency',
        city: profile?.city ?? null,
        aboutMe: profile?.aboutMe ?? null,
        avatarUrl: avatarUrlByPositionId.get(idStr) ?? null,
        socials: {
          telegram: profile?.telegram ?? null,
          whatsapp: profile?.whatsapp ?? null,
          instagram: profile?.instagram ?? null,
          website: profile?.website ?? null,
        },
        rating: rating ? { average: Math.round(rating.averageRating * 10) / 10, count: rating.reviewCount } : null,
      };
    });
  }

  /** Тот же принцип, что TeamService.resolveAvatarUrl — 'card' variant, null тихо на любой сбой (аватар не критичен). */
  private async resolveAvatarUrl(assetId: Types.ObjectId, organizationId: Types.ObjectId): Promise<string | null> {
    const asset = await this.mediaService.getAssetForOwnerScope(assetId, { type: 'organization', organizationId });
    if (!asset || asset.status !== 'verified') return null;
    const cardVariant = asset.variants.find((v) => v.type === 'card');
    if (!cardVariant) return null;
    return this.mediaService.getVariantUrl(cardVariant);
  }
}
