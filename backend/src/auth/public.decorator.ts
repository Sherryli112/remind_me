import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/** 標記不需要登入即可存取的路由（全域 JwtAuthGuard 會略過）。 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
