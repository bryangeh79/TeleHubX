import { SetMetadata } from '@nestjs/common';

/** 标记 route 不需要 JWT。 */
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
