import { Controller, Get, Param } from '@nestjs/common';
import { MarketplaceSelectionsService } from './marketplace-selections.service';

/**
 * ПУБЛИЧНЫЙ контроллер — без guard'а совсем, тот же принцип, что
 * PublicSelectionsController у CRM-подборок агента: доступ к подборке
 * покупателя по `publicToken` из ссылки `/my-selection/:token` — «открывается
 * по ссылке» из решения владельца (N-11, roadmap-2026-09.md).
 *
 * В отличие от dev-selections здесь нет markViewed/sent->viewed: у подборки
 * покупателя нет получателя-клиента, чей просмотр нужно отследить агенту —
 * владелец делится ссылкой добровольно (с партнёром/семьёй), просмотр
 * никому не нужно фиксировать.
 */
@Controller('public/marketplace-selections')
export class PublicMarketplaceSelectionsController {
  constructor(private readonly service: MarketplaceSelectionsService) {}

  @Get(':token')
  async getByToken(@Param('token') token: string) {
    return this.service.getPublic(token);
  }
}
