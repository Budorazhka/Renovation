import { IsIn, IsString, Matches, MaxLength } from 'class-validator';

const TARGET_TYPES = ['development', 'listing'] as const;

/** Тот же принцип, что FavoriteTargetDto: slug ограничен алфавитом публикаций до базы. */
export class MarketplaceSelectionItemDto {
  @IsIn(TARGET_TYPES)
  targetType!: (typeof TARGET_TYPES)[number];

  @IsString()
  @MaxLength(200)
  @Matches(/^[a-z0-9-]+$/, { message: 'slug: допустимы строчные латинские буквы, цифры и дефис' })
  slug!: string;
}
