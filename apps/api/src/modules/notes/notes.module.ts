import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { NoteDocument, NoteSchema } from './schemas/note.schema';
import { NoteRepository } from './repository/note.repository';
import { NotesService } from './notes.service';
import { NotesController } from './notes.controller';
import { AuthorizationModule } from '../authorization/authorization.module';
import { CrmModule } from '../crm/crm.module';
import { MediaModule } from '../media/media.module';
import { IdempotencyModule } from '../../shared/idempotency/idempotency.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: NoteDocument.name, schema: NoteSchema }]),
    AuthorizationModule,
    // Lead-существование (getLeadForOrganization) — только через CrmService
    // (ADR-001, module-boundaries.test.ts), не через LeadRepository напрямую.
    CrmModule,
    MediaModule,
    IdempotencyModule,
  ],
  controllers: [NotesController],
  providers: [NoteRepository, NotesService],
})
export class NotesModule {}
