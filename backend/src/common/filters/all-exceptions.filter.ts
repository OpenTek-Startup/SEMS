import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

// Catches every error and returns one consistent JSON shape.
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  constructor(private readonly isProduction = false) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    // originalUrl keeps the full path (incl. the /api prefix); request.url
    // can be shortened by Express routers.
    const path = request.originalUrl ?? request.url;
    const isHttp = exception instanceof HttpException;
    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const error =
      exception instanceof HttpException
        ? exception.getResponse()
        : 'Internal server error';

    if (status >= 500) {
      // Unexpected failures: keep the stack trace so they can be debugged.
      const stack = exception instanceof Error ? exception.stack : String(exception);
      this.logger.error(`${request.method} ${path} -> ${status}`, stack);
    } else {
      this.logger.warn(`${request.method} ${path} -> ${status}`);
    }

    response.status(status).json({
      success: false,
      statusCode: status,
      path,
      timestamp: new Date().toISOString(),
      // Never leak internal error details to clients in production.
      error: !isHttp && this.isProduction ? 'Internal server error' : error,
    });
  }
}
