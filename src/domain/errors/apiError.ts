export type ErrorCode =
  | 'BAD_REQUEST'
  | 'VALIDATION_ERROR'
  | 'NOT_FOUND'
  | 'UPSTREAM_ERROR'
  | 'INTERNAL_ERROR';

export class ApiError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly statusCode: number,
    public readonly meta?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function badRequest(message: string, meta?: Record<string, unknown>): ApiError {
  return new ApiError('BAD_REQUEST', message, 400, meta);
}

export function validationError(message: string, meta?: Record<string, unknown>): ApiError {
  return new ApiError('VALIDATION_ERROR', message, 400, meta);
}

export function notFound(message: string, meta?: Record<string, unknown>): ApiError {
  return new ApiError('NOT_FOUND', message, 404, meta);
}

export function upstreamError(message: string, meta?: Record<string, unknown>): ApiError {
  return new ApiError('UPSTREAM_ERROR', message, 502, meta);
}

export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) {
    return error;
  }

  if (error instanceof Error) {
    return new ApiError('INTERNAL_ERROR', error.message, 500);
  }

  return new ApiError('INTERNAL_ERROR', 'Unexpected error', 500);
}
