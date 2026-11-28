import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NextFunction, Request, Response } from 'express';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';

/**
 * Global HTTP setup shared by main.ts and the e2e tests, so tests run
 * against exactly the same prefix, validation and response shapes.
 */
export function configureApp(app: INestApplication): void {
  const config = app.get(ConfigService);

  const production = config.get<string>('nodeEnv') === 'production';

  // Security headers on every API response (NFR-SEC). The API only returns
  // JSON: it is never framed, never sniffed as another type, and holds one
  // user's school data, so browsers and proxies must not cache it.
  (app.getHttpAdapter().getInstance() as { disable?: (setting: string) => void }).disable?.('x-powered-by');
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', 'no-store');
    if (production) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
  });

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
    new AllExceptionsFilter(production),
  );

  // Allow the Next.js frontend to call the API
  app.enableCors({
    origin: config.get<string>('frontendUrl'),
    credentials: true,
  });
}
