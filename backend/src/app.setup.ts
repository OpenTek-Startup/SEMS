import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';

/**
 * Global HTTP setup shared by main.ts and the e2e tests, so tests run
 * against exactly the same prefix, validation and response shapes.
 */
export function configureApp(app: INestApplication): void {
  const config = app.get(ConfigService);

  // All routes are prefixed with /api
  app.setGlobalPrefix('api');

  // Validate & strip request bodies against DTOs
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Consistent success/error response shapes
  app.useGlobalInterceptors(new TransformInterceptor());
  app.useGlobalFilters(
    new AllExceptionsFilter(config.get<string>('nodeEnv') === 'production'),
  );

  // Allow the Next.js frontend to call the API
  app.enableCors({
    origin: config.get<string>('frontendUrl'),
    credentials: true,
  });
}
