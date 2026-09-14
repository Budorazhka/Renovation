import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

/**
 * Личный блокнот менеджера в ERP (легаси-блок «Заметки» на фронте — раньше
 * писал в старый сервер чужого продукта, которого у нас нет). НЕ CRM-
 * сущность: заметка принадлежит ровно одному автору (`authorPositionId`) и
 * видна ТОЛЬКО ему — даже owner/director организации чужую заметку не
 * видит (в отличие от Task, где org-scope роли видят все рабочие задачи).
 */
export type NoteCategory = 'personal' | 'work';

export const NOTE_CATEGORIES: readonly NoteCategory[] = ['personal', 'work'] as const;

@Schema({ collection: 'notes', timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' } })
export class NoteDocument extends Document {
  declare _id: Types.ObjectId;

  @Prop({ required: true, type: Types.ObjectId })
  organizationId!: Types.ObjectId;

  /** Автор и единственный видящий эту заметку — тот же принцип, что personal-задача, только без исключений для org-scope ролей. */
  @Prop({ required: true, type: Types.ObjectId })
  authorPositionId!: Types.ObjectId;

  @Prop({ required: true, trim: true, maxlength: 255 })
  title!: string;

  @Prop({ default: '', maxlength: 20000 })
  content!: string;

  @Prop({ required: true, default: false })
  isPinned!: boolean;

  @Prop({ required: true, enum: NOTE_CATEGORIES, default: 'personal' })
  category!: NoteCategory;

  @Prop({ type: Types.ObjectId, required: false })
  leadId?: Types.ObjectId;

  /** Вложения — тот же паттерн, что TaskDocument.attachments: ссылка на подтверждённый MediaAsset плюс имя, которое видел пользователь при выборе файла. */
  @Prop({
    type: [{ assetId: { type: Types.ObjectId, ref: 'MediaAssetDocument' }, fileName: String }],
    default: [],
  })
  attachments!: Array<{ assetId: Types.ObjectId; fileName: string }>;

  /** conventions.md разд.5 optimistic concurrency — тот же паттерн, что TaskDocument.version. */
  @Prop({ required: true, default: 0 })
  version!: number;

  declare createdAt: Date;
  declare updatedAt: Date;
}

export const NoteSchema = SchemaFactory.createForClass(NoteDocument);

// Каждый запрос фильтруется по {organizationId, authorPositionId} — личный
// блокнот, не org-wide CRM-ресурс; составной индекс покрывает и list, и get.
NoteSchema.index({ organizationId: 1, authorPositionId: 1, _id: -1 });
NoteSchema.index({ organizationId: 1, authorPositionId: 1, leadId: 1 });
