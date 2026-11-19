import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { parseCorsOrigins } from './config/env.validation';

/**
 * main.ts 與測試共用的 app 設定（trust proxy、CORS、ValidationPipe）。
 * 回傳實際套用的 CORS allowlist 方便 log。
 */
export function configureApp(app: NestExpressApplication): {
  corsOrigins: string[];
} {
  // 正式環境所有請求都經過 Caddy 反向代理（一層）：信任一層 proxy 的 X-Forwarded-For，
  // req.ip 才會是真實 client IP，@nestjs/throttler 的「每 IP」限制才不會變成全體共用。
  // 前提：後端 port 不可直接對外開放，否則 client 可自行偽造 X-Forwarded-For。
  app.set('trust proxy', 1);

  const corsOrigins = parseCorsOrigins(process.env.CORS_ORIGINS);
  app.enableCors({
    origin: corsOrigins,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Device-Id'],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  return { corsOrigins };
}
