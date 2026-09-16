import { IsIn, IsInt, IsPositive, Max } from 'class-validator';
import { IMAGE_MIME_TYPES, MAX_UPLOAD_SIZE_BYTES } from '../../media/media.constants';

/** POST /admin/news/images/upload-intent — картинка к новости платформы: только изображения, тот же потолок размера. */
export class NewsImageUploadIntentDto {
  @IsIn(Array.from(IMAGE_MIME_TYPES))
  declaredMimeType!: string;

  @IsInt()
  @IsPositive()
  @Max(MAX_UPLOAD_SIZE_BYTES)
  sizeBytes!: number;
}
