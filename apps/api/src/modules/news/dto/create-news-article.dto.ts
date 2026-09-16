import { IsBoolean, IsIn, IsInt, IsMongoId, IsOptional, IsString, IsUrl, Matches, MaxLength, Min } from 'class-validator';
import { NEWS_CATEGORIES, type NewsCategory } from '../schemas/news-article.schema';

/** Непустой текст: хотя бы один непробельный символ. */
const NOT_BLANK = /\S/;

/**
 * Содержимое новости — общее для публикации и правки. Ссылка только http(s)
 * с протоколом: её открывают сотрудники всех организаций, `javascript:` и
 * относительные адреса сюда не пролезают. Картинка — заранее загруженный
 * MediaAsset с purpose news_image.
 */
export class NewsArticleContentDto {
  @IsString()
  @Matches(NOT_BLANK)
  @MaxLength(200)
  title!: string;

  @IsString()
  @Matches(NOT_BLANK)
  @MaxLength(10_000)
  body!: string;

  @IsIn(NEWS_CATEGORIES)
  category!: NewsCategory;

  @IsOptional()
  @IsBoolean()
  pinned?: boolean;

  @IsOptional()
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  @MaxLength(2000)
  linkUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  linkLabel?: string;

  @IsOptional()
  @IsMongoId()
  imageAssetId?: string;
}

/**
 * POST /news (новость компании из ERP) и POST /admin/news (новость платформы
 * из админки). sendEmail/sendTelegram — разослать новость получателям на
 * почту и в Telegram; только при публикации, правка повторно не рассылает.
 */
export class CreateNewsArticleDto extends NewsArticleContentDto {
  @IsOptional()
  @IsBoolean()
  sendEmail?: boolean;

  @IsOptional()
  @IsBoolean()
  sendTelegram?: boolean;
}

/** Тело запроса для сверки повтора по Idempotency-Key: только то, что пришло от клиента. */
export function newsIdempotencyBody(dto: CreateNewsArticleDto): Record<string, unknown> {
  return {
    title: dto.title,
    body: dto.body,
    category: dto.category,
    pinned: dto.pinned ?? false,
    linkUrl: dto.linkUrl ?? null,
    linkLabel: dto.linkLabel ?? null,
    imageAssetId: dto.imageAssetId ?? null,
    sendEmail: dto.sendEmail ?? false,
    sendTelegram: dto.sendTelegram ?? false,
  };
}

/**
 * PUT /news/:newsId и PUT /admin/news/:newsId: правка заменяет содержимое
 * целиком — не присланные ссылка, подпись или картинка снимаются.
 * expectedVersion — версия, которую видел редактор (CAS): чужая правка
 * между чтением и сохранением даёт 409, а не молча затирается.
 */
export class UpdateNewsArticleDto extends NewsArticleContentDto {
  @IsInt()
  @Min(0)
  expectedVersion!: number;
}
