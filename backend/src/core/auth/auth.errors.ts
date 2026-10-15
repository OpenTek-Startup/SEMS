import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  UnauthorizedException,
} from '@nestjs/common';

/**
 * Auth errors carry a stable `code` next to the human message, so the
 * frontend can react (e.g. PASSWORD_CHANGE_REQUIRED -> change-password page)
 * without parsing text. Response body: { success:false, ..., error: { code, message } }.
 */
export type AuthErrorCode =
  | 'NOT_SIGNED_IN'
  | 'INVALID_CREDENTIALS'
  | 'TOKEN_INVALID'
  | 'TOKEN_EXPIRED'
  | 'WRONG_SCHOOL'
  | 'SESSION_ENDED'
  | 'SESSION_EXPIRED'
  | 'SESSION_IDLE'
  | 'REFRESH_TOKEN_MISSING'
  | 'REFRESH_TOKEN_INVALID'
  | 'REFRESH_TOKEN_REUSED'
  | 'ACCOUNT_DISABLED'
  | 'PASSWORD_CHANGE_REQUIRED'
  | 'WRONG_CURRENT_PASSWORD'
  | 'WEAK_PASSWORD'
  | 'TOO_MANY_ATTEMPTS'
  | 'PERMISSION_DENIED';

export function unauthorized(code: AuthErrorCode, message: string) {
  return new UnauthorizedException({ statusCode: 401, error: 'Unauthorized', code, message });
}

export function forbidden(code: AuthErrorCode, message: string) {
  return new ForbiddenException({ statusCode: 403, error: 'Forbidden', code, message });
}

export function badRequest(code: AuthErrorCode, message: string | string[]) {
  return new BadRequestException({ statusCode: 400, error: 'Bad Request', code, message });
}

export function tooManyAttempts(message: string) {
  return new HttpException(
    { statusCode: 429, error: 'Too Many Requests', code: 'TOO_MANY_ATTEMPTS', message },
    HttpStatus.TOO_MANY_REQUESTS,
  );
}
