import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';

export type MessengerPlatform = 'telegram' | 'whatsapp';
export const MESSENGER_PLATFORMS = ['telegram', 'whatsapp'] as const;

export interface DialogLastMessage {
  text: string;
  sentAt: Date;
  fromMe: boolean;
  author: 'client' | 'agent';
}

const DialogLastMessageSchema = new MongooseSchema(
  {
    text: { type: String, required: true },
    sentAt: { type: Date, required: true },
    fromMe: { type: Boolean, required: true },
    author: { type: String, enum: ['client', 'agent'], required: true },
  },
  { _id: false },
);

/**
 * Messenger Dialog representation in BAZA Platform.
 * Connected directly to CRM Entities: Lead, Contact, Deal, and Position.
 */
@Schema({ collection: 'messenger_dialogs', timestamps: true })
export class MessengerDialogDocument extends Document {
  declare _id: Types.ObjectId;

  @Prop({ required: true, type: Types.ObjectId })
  organizationId!: Types.ObjectId;

  @Prop({ required: true, type: Types.ObjectId })
  accountId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: false })
  assignedPositionId?: Types.ObjectId;

  @Prop({ required: true, type: String, enum: MESSENGER_PLATFORMS })
  platform!: MessengerPlatform;

  @Prop({ required: true, trim: true })
  externalChatId!: string;

  @Prop({ required: true, trim: true })
  name!: string;

  @Prop({ required: false, trim: true })
  clientPhone?: string;

  @Prop({ required: false, trim: true })
  clientHandle?: string;

  @Prop({ required: false, trim: true })
  clientCity?: string;

  @Prop({ required: false, trim: true })
  avatarUrl?: string;

  @Prop({ required: true, default: 0 })
  unreadCount!: number;

  @Prop({ required: true, default: false })
  pinned!: boolean;

  @Prop({ type: DialogLastMessageSchema, required: false })
  lastMessage?: DialogLastMessage;

  @Prop({ type: Types.ObjectId, required: false })
  leadId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: false })
  contactId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: false })
  dealId?: Types.ObjectId;

  @Prop({ type: [String], default: [] })
  tags!: string[];

  @Prop({ required: true, default: 0 })
  version!: number;
}

export const MessengerDialogSchema = SchemaFactory.createForClass(MessengerDialogDocument);

MessengerDialogSchema.index({ organizationId: 1, accountId: 1, externalChatId: 1 }, { unique: true });
MessengerDialogSchema.index({ organizationId: 1, assignedPositionId: 1 });
MessengerDialogSchema.index({ organizationId: 1, leadId: 1 });
MessengerDialogSchema.index({ organizationId: 1, contactId: 1 });
MessengerDialogSchema.index({ organizationId: 1, dealId: 1 });
