import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { JWT_SECRET_MIN_LENGTH } from './config/env.validation';
import { PrismaService } from './prisma/prisma.service';

function assertJwtSecret() {
  const secret = process.env.JWT_ACCESS_SECRET;
  if (!secret || secret.length < JWT_SECRET_MIN_LENGTH) {
    throw new Error(
      `環境變數 JWT_ACCESS_SECRET 必須存在且至少 ${JWT_SECRET_MIN_LENGTH} 個字元`,
    );
  }
}

async function bootstrap() {
  // ConfigModule 的 validate 會在建立 app 時先擋一次；這裡在 listen 前再確認一次
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  assertJwtSecret();

  const prismaService = app.get(PrismaService);
  await prismaService.enableShutdownHooks(app);

  const { corsOrigins } = configureApp(app);

  const swaggerConfig = new DocumentBuilder()
    .setTitle('RemindMe API')
    .setDescription('RemindMe 雲端 API 文件')
    .setVersion('0.2.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, document, {
    swaggerOptions: { persistAuthorization: true },
  });

  // 不指定 host：監聽所有介面（容器內由 Caddy 透過 Docker 網路連入）
  const server = await app.listen(process.env.PORT ?? 3000);
  const address = server.address();
  const port =
    typeof address === 'object' && address
      ? address.port
      : (process.env.PORT ?? 3000);
  console.log(`RUNTIME_PORT=${port}`);
  console.log(`CORS_ORIGINS=${corsOrigins.join(',')}`);
}

bootstrap().catch((err: unknown) => {
  console.error(
    '[bootstrap] 啟動失敗：',
    err instanceof Error ? err.message : err,
  );
  process.exit(1);
});
