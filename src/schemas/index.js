import { z } from 'zod';
import { ApiError } from '../utils.js';

export const RESERVED_USERNAMES = [
  'admin',
  'root',
  'support',
  'api',
  'system',
  'administrator',
  'moderator',
  'help',
  'security',
  'billing',
  'postmaster',
  'webmaster',
  'hostmaster',
  'abuse',
  'noreply',
  'no-reply',
  'mailer-daemon',
  'www',
  'ftp',
  'mail',
  'smtp',
  'localhost',
  'official',
  'staff',
  'team',
];

const reservedUsernameSet = new Set(RESERVED_USERNAMES.map((name) => name.toLowerCase()));

export const registerBodySchema = z.object({
  username: z
    .string()
    .min(3)
    .max(32)
    .regex(/^[a-zA-Z0-9_-]+$/, 'Username may only contain letters, numbers, underscores, and hyphens.')
    .refine((value) => !reservedUsernameSet.has(value.toLowerCase()), {
      message: 'This username is reserved.',
    }),
  email: z.string().email(),
  password: z.string().min(8),
});

export function validateRegisterBody(body) {
  const result = registerBodySchema.safeParse(body);
  if (!result.success) {
    const reserved = result.error.issues.some(
      (issue) => issue.message === 'This username is reserved.'
    );
    if (reserved) {
      throw new ApiError('FORBIDDEN', 'This username is reserved.');
    }
    throw new ApiError('BAD_REQUEST', result.error.issues[0]?.message ?? 'Invalid request body.');
  }
  return result.data;
}
