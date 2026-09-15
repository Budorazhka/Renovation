import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { LibraryItemDocument, LibraryItemSchema } from './schemas/library-item.schema';
import { LibraryFolderDocument, LibraryFolderSchema } from './schemas/library-folder.schema';
import { LibraryItemRepository } from './repository/library-item.repository';
import { LibraryFolderRepository } from './repository/library-folder.repository';
import { LibraryService } from './library.service';
import { LibraryController } from './library.controller';
import { AuthorizationModule } from '../authorization/authorization.module';
import { MediaModule } from '../media/media.module';
import { IdempotencyModule } from '../../shared/idempotency/idempotency.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: LibraryItemDocument.name, schema: LibraryItemSchema },
      { name: LibraryFolderDocument.name, schema: LibraryFolderSchema },
    ]),
    AuthorizationModule,
    MediaModule,
    IdempotencyModule,
  ],
  controllers: [LibraryController],
  providers: [LibraryItemRepository, LibraryFolderRepository, LibraryService],
})
export class LibraryModule {}
