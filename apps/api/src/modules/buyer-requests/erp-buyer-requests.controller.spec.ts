import { Types } from 'mongoose';
import { ErpBuyerRequestsController } from './erp-buyer-requests.controller';
import type { BuyerRequestsService } from './buyer-requests.service';

function makeRequest(organizationId: Types.ObjectId, positionId: Types.ObjectId) {
  return {
    tenantContext: {
      organizationId: organizationId.toString(),
      positionId: positionId.toString(),
      identityId: new Types.ObjectId().toString(),
    },
  };
}

describe('ErpBuyerRequestsController.respond', () => {
  it('пробрасывает id/organizationId/respondedByPositionId/message из tenantContext и body', async () => {
    const organizationId = new Types.ObjectId();
    const positionId = new Types.ObjectId();
    const buyerRequestId = new Types.ObjectId();
    const respond = jest.fn().mockResolvedValue({ id: 'resp-1', buyerRequestId: buyerRequestId.toString(), message: 'Поможем', updatedAt: '2026-09-13T00:00:00.000Z' });
    const controller = new ErpBuyerRequestsController({ respond } as unknown as BuyerRequestsService);
    const req = makeRequest(organizationId, positionId);

    const result = await controller.respond(req as never, buyerRequestId, { message: 'Поможем' });

    expect(respond).toHaveBeenCalledWith({
      buyerRequestId,
      organizationId,
      respondedByPositionId: positionId,
      message: 'Поможем',
    });
    expect(result).toEqual({ id: 'resp-1', buyerRequestId: buyerRequestId.toString(), message: 'Поможем', updatedAt: '2026-09-13T00:00:00.000Z' });
  });
});

describe('ErpBuyerRequestsController.listMyResponses', () => {
  it('cursor конвертируется в ObjectId, organizationId берётся из tenantContext', async () => {
    const organizationId = new Types.ObjectId();
    const positionId = new Types.ObjectId();
    const listMyResponses = jest.fn().mockResolvedValue({ items: [], nextCursor: null });
    const controller = new ErpBuyerRequestsController({ listMyResponses } as unknown as BuyerRequestsService);
    const req = makeRequest(organizationId, positionId);
    const cursor = new Types.ObjectId();

    await controller.listMyResponses(req as never, { cursor: cursor.toString(), limit: 10 });

    const call = listMyResponses.mock.calls[0]!;
    expect(call[0]).toEqual(organizationId);
    expect((call[1] as { cursor: Types.ObjectId }).cursor.equals(cursor)).toBe(true);
    expect((call[1] as { limit: number }).limit).toBe(10);
  });
});
