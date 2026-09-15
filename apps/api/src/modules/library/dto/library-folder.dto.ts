import { IsMongoId, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/** GET /library/folders?parentId= — папки личной библиотеки на одном уровне; без parentId — корень. */
export class ListLibraryFoldersDto {
  @IsOptional()
  @IsMongoId()
  parentId?: string;
}

/** POST /library/folders — папка личной библиотеки; без parentId — в корне. */
export class CreateLibraryFolderDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsMongoId()
  parentId?: string;
}
