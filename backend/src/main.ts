import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  configureApp(app);

  const port = app.get(ConfigService).get<number>('port') ?? 3001;
  await app.listen(port);
  Logger.log(
    `YESE backend running on http://localhost:${port}/api`,
    'Bootstrap',
  );
}

void bootstrap();
