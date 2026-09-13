import { NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { PublicRealtorsService } from './public-realtors.service';
import type { OrganizationsService } from '../organizations/organizations.service';
import type { RealtorReviewsService } from '../realtor-reviews/realtor-reviews.service';
import type { MediaService } from '../media/media.service';

function buildService(overrides: {
  organizationsService?: Partial<OrganizationsService>;
  realtorReviewsService?: Partial<RealtorReviewsService>;
  mediaService?: Partial<MediaService>;
} = {}) {
  const organizationsService = {
    listPublicRealtorPositions: jest.fn().mockResolvedValue([]),
    getPublicRealtorPosition: jest.fn().mockResolvedValue(null),
    getPositionProfilesByIds: jest.fn().mockResolvedValue([]),
    listPublicOrganizations: jest.fn().mockResolvedValue([]),
    ...overrides.organizationsService,
  };
  const realtorReviewsService = {
    getApprovedStats: jest.fn().mockResolvedValue(new Map()),
    ...overrides.realtorReviewsService,
  };
  const mediaService = {
    getAssetForOwnerScope: jest.fn().mockResolvedValue(null),
    getVariantUrl: jest.fn(),
    ...overrides.mediaService,
  };
  return new PublicRealtorsService(organizationsService as never, realtorReviewsService as never, mediaService as never);
}

function makePosition(overrides: Record<string, unknown> = {}) {
  return {
    _id: new Types.ObjectId(),
    organizationId: new Types.ObjectId(),
    fixedRole: 'manager',
    status: 'occupied',
    currentOccupantName: 'Георгий Т.',
    avatarAssetId: undefined,
    ...overrides,
  };
}

describe('PublicRealtorsService.listPublic', () => {
  it('limit+1 обрезается в nextCursor, тот же паттерн, что публичные списки в других модулях', async () => {
    const positions = [makePosition(), makePosition()];
    const organizationsService = { listPublicRealtorPositions: jest.fn().mockResolvedValue(positions) };
    const service = buildService({ organizationsService });

    const result = await service.listPublic({ limit: 1 });

    expect(organizationsService.listPublicRealtorPositions).toHaveBeenCalledWith({ cursor: undefined, limit: 2 });
    expect(result.items).toHaveLength(1);
    expect(result.nextCursor).toBe(positions[0]!._id.toString());
  });

  it('собирает организацию, профиль и рейтинг в единую карточку', async () => {
    const position = makePosition();
    const organizationId = position.organizationId;
    const organizationsService = {
      listPublicRealtorPositions: jest.fn().mockResolvedValue([position]),
      getPositionProfilesByIds: jest.fn().mockResolvedValue([
        { positionId: position._id, city: 'Батуми', aboutMe: 'Помогу с выбором', telegram: '@georgi', whatsapp: null, instagram: null, website: null },
      ]),
      listPublicOrganizations: jest.fn().mockResolvedValue([{ id: organizationId, name: 'BAZA Realty', type: 'agency' }]),
    };
    const realtorReviewsService = { getApprovedStats: jest.fn().mockResolvedValue(new Map([[position._id.toString(), { averageRating: 4.666, reviewCount: 3 }]])) };
    const service = buildService({ organizationsService, realtorReviewsService });

    const result = await service.listPublic({ limit: 20 });

    expect(result.items[0]).toEqual({
      id: position._id.toString(),
      name: 'Георгий Т.',
      fixedRole: 'manager',
      organizationName: 'BAZA Realty',
      organizationType: 'agency',
      city: 'Батуми',
      aboutMe: 'Помогу с выбором',
      avatarUrl: null,
      socials: { telegram: '@georgi', whatsapp: null, instagram: null, website: null },
      rating: { average: 4.7, count: 3 },
    });
  });

  it('без отзывов rating: null, а не нулевые значения', async () => {
    const position = makePosition();
    const organizationsService = {
      listPublicRealtorPositions: jest.fn().mockResolvedValue([position]),
      listPublicOrganizations: jest.fn().mockResolvedValue([{ id: position.organizationId, name: 'Org', type: 'agency' }]),
    };
    const service = buildService({ organizationsService });

    const result = await service.listPublic({ limit: 20 });

    expect(result.items[0]!.rating).toBeNull();
  });

  it('резолвит avatarUrl только для верифицированного card-варианта', async () => {
    const assetId = new Types.ObjectId();
    const position = makePosition({ avatarAssetId: assetId });
    const organizationsService = {
      listPublicRealtorPositions: jest.fn().mockResolvedValue([position]),
      listPublicOrganizations: jest.fn().mockResolvedValue([{ id: position.organizationId, name: 'Org', type: 'agency' }]),
    };
    const mediaService = {
      getAssetForOwnerScope: jest.fn().mockResolvedValue({ status: 'verified', variants: [{ type: 'card', assetPath: 'x' }] }),
      getVariantUrl: jest.fn().mockReturnValue('https://cdn.example/card.webp'),
    };
    const service = buildService({ organizationsService, mediaService });

    const result = await service.listPublic({ limit: 20 });

    expect(mediaService.getAssetForOwnerScope).toHaveBeenCalledWith(assetId, { type: 'organization', organizationId: position.organizationId });
    expect(result.items[0]!.avatarUrl).toBe('https://cdn.example/card.webp');
  });
});

describe('PublicRealtorsService.getPublic', () => {
  it('позиция не найдена (не риэлтор/чужая роль/неверифицированная организация) — NotFoundException', async () => {
    const service = buildService();
    await expect(service.getPublic(new Types.ObjectId())).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('PublicRealtorsService.revealPhone', () => {
  it('позиция не найдена — NotFoundException', async () => {
    const service = buildService();
    await expect(service.revealPhone(new Types.ObjectId())).rejects.toBeInstanceOf(NotFoundException);
  });

  it('телефон не заполнен в профиле — NotFoundException, не пустая строка', async () => {
    const position = makePosition();
    const organizationsService = {
      getPublicRealtorPosition: jest.fn().mockResolvedValue(position),
      getPositionProfilesByIds: jest.fn().mockResolvedValue([{ positionId: position._id }]),
    };
    const service = buildService({ organizationsService });

    await expect(service.revealPhone(position._id)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('телефон заполнен — возвращается', async () => {
    const position = makePosition();
    const organizationsService = {
      getPublicRealtorPosition: jest.fn().mockResolvedValue(position),
      getPositionProfilesByIds: jest.fn().mockResolvedValue([{ positionId: position._id, phone: '+995599000001' }]),
    };
    const service = buildService({ organizationsService });

    await expect(service.revealPhone(position._id)).resolves.toEqual({ phone: '+995599000001' });
  });
});
