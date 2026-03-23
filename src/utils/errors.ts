export class AppError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly details?: string
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export function badRequest(message: string, details?: string): AppError {
  return new AppError(message, 400, details);
}

export function unauthorized(message = 'Unauthorized', details?: string): AppError {
  return new AppError(message, 401, details);
}

export function notFound(message = 'Route not found', details?: string): AppError {
  return new AppError(message, 404, details);
}

export function internalError(message = 'Internal server error', details?: string): AppError {
  return new AppError(message, 500, details);
}

export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) {
    return error;
  }

  if (error instanceof Error) {
    return internalError('Scraper request failed', error.message);
  }

  return internalError('Scraper request failed');
}
