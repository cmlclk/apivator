import { AgentError, ApiError, NetworkError } from '@apivator/core';
import { translate } from '../i18n';

/** Mesajı kullanıcıya olduğu gibi gösterilecek hata (beklenmeyen hatalar genel bir mesajla gizlenir). */
export class UserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UserError';
  }
}

export function errorMessage(error: unknown): string {
  if (
    error instanceof ApiError ||
    error instanceof NetworkError ||
    error instanceof AgentError ||
    error instanceof UserError
  )
    return error.message;
  return translate('common', 'unexpectedError');
}

export function fieldError(error: unknown, field: string): string | undefined {
  return error instanceof ApiError ? error.fieldError(field) : undefined;
}
