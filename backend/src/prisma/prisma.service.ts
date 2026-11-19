import { INestApplication, Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * Schema 由 Prisma migration 管理（`prisma migrate deploy`），
 * 不再於啟動時以 raw SQL 建表。
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  async onModuleInit() {
    await this.$connect();
  }

  async enableShutdownHooks(app: INestApplication) {
    app.enableShutdownHooks();
  }
}
