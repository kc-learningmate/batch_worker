import { NestFactory } from '@nestjs/core';
import { config } from 'dotenv';
import { WorkerModule } from './worker.module';

async function bootstrap() {
  config();
  await NestFactory.createApplicationContext(WorkerModule);
}
// eslint-disable-next-line @typescript-eslint/no-floating-promises
bootstrap();
