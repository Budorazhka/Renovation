import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

/** Папка личной библиотеки сотрудника (см. LibraryItemDocument). У общих материалов папок нет — как и в легаси. */
@Schema({ collection: 'library_folders', timestamps: { createdAt: 'createdAt', updatedAt: false } })
export class LibraryFolderDocument extends Document {
  declare _id: Types.ObjectId;

  @Prop({ required: true, type: Types.ObjectId })
  organizationId!: Types.ObjectId;

  @Prop({ required: true, type: Types.ObjectId })
  ownerPositionId!: Types.ObjectId;

  @Prop({ required: true, trim: true, maxlength: 120 })
  name!: string;

  /** Родительская папка; не задана — корень библиотеки. */
  @Prop({ type: Types.ObjectId, required: false })
  parentId?: Types.ObjectId;

  declare createdAt: Date;
}

export const LibraryFolderSchema = SchemaFactory.createForClass(LibraryFolderDocument);

LibraryFolderSchema.index({ organizationId: 1, ownerPositionId: 1, parentId: 1, name: 1 });
