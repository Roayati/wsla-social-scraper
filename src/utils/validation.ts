import { badRequest } from './errors';

const USERNAME_PATTERN = /^(?!.*\.\.)(?!.*\.$)[a-zA-Z0-9._]{1,30}$/;

export function normalizeUsername(input: string | null): string {
  if (!input) {
    throw badRequest('Invalid username', 'The username query parameter is required.');
  }

  const normalized = input.trim().replace(/^@+/, '');

  if (!normalized) {
    throw badRequest('Invalid username', 'The username query parameter cannot be empty.');
  }

  if (!USERNAME_PATTERN.test(normalized)) {
    throw badRequest(
      'Invalid username',
      'Instagram usernames may contain letters, numbers, periods, and underscores, up to 30 characters.'
    );
  }

  return normalized;
}

export function normalizeLimit(input: string | null): number {
  if (input === null || input.trim() === '') {
    return 5;
  }

  const parsed = Number.parseInt(input, 10);

  if (!Number.isFinite(parsed) || Number.isNaN(parsed)) {
    throw badRequest('Invalid limit', 'The limit query parameter must be an integer between 1 and 12.');
  }

  if (parsed < 1 || parsed > 12) {
    throw badRequest('Invalid limit', 'The limit query parameter must be between 1 and 12.');
  }

  return parsed;
}
