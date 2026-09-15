import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

/**
 * Библиотека материалов CRM (легаси-блок «Библиотека» в ERP и вкладка файлов
 * чек-листа стадии лида — раньше писали в старый сервер чужого продукта).
 *
 *  - `organization` — общие материалы организации (презентации, регламенты)
 *    по продукту воронки; видят все сотрудники, загружают и удаляют роли
 *    с `library_item.create/delete` scope `organization`.
 *  - `personal` — личная библиотека сотрудника с папками; как личная
 *    заметка, видна и меняется только своему владельцу (`ownerPositionId`),
 *    даже owner организации чужую не видит.
 *
 * Содержимое файла — MediaAsset (purpose `library_file`, приватный бакет);
 * здесь ссылка и имя, которое видел пользователь. Удаление записи не
 * удаляет MediaAsset: файл мог быть прикреплён к лиду.
 */
export type LibraryScope = 'organization' | 'personal';

export const LIBRARY_SCOPES: readonly LibraryScope[] = ['organization', 'personal'] as const;

export type LibraryProductType = 'sales' | 'network' | 'owner' | 'agent';

export const LIBRARY_PRODUCT_TYPES: readonly LibraryProductType[] = ['sales', 'network', 'owner', 'agent'] as const;

@Schema({ collection: 'library_items', timestamps: { createdAt: 'createdAt', updatedAt: false } })
export class LibraryItemDocument extends Document {
  declare _id: Types.ObjectId;

  @Prop({ required: true, type: Types.ObjectId })
  organizationId!: Types.ObjectId;

  @Prop({ required: true, enum: LIBRARY_SCOPES })
  scope!: LibraryScope;

  /** Владелец личного материала; у общих материалов не задан. */
  @Prop({ type: Types.ObjectId, required: false })
  ownerPositionId?: Types.ObjectId;

  /** Продукт воронки общего материала; не задан — материал для всех продуктов. */
  @Prop({ enum: LIBRARY_PRODUCT_TYPES, required: false })
  productType?: LibraryProductType;

  /** Папка личной библиотеки; не задана — корень. */
  @Prop({ type: Types.ObjectId, required: false })
  folderId?: Types.ObjectId;

  @Prop({ required: true, type: Types.ObjectId })
  assetId!: Types.ObjectId;

  @Prop({ required: true, trim: true, maxlength: 255 })
  fileName!: string;

  @Prop({ required: true })
  mimeType!: string;

  @Prop({ required: true })
  sizeBytes!: number;

  @Prop({ required: true, type: Types.ObjectId })
  createdByPositionId!: Types.ObjectId;

  declare createdAt: Date;
}

export const LibraryItemSchema = SchemaFactory.createForClass(LibraryItemDocument);

LibraryItemSchema.index({ organizationId: 1, scope: 1, productType: 1, _id: -1 });
LibraryItemSchema.index({ organizationId: 1, ownerPositionId: 1, folderId: 1, _id: -1 });
