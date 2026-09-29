const { z } = require('zod');

const usernameSchema = z
  .string()
  .min(3, { message: 'Username must be at least 3 characters' })
  .max(30, { message: 'Username must be at most 30 characters' })
  .regex(/^[a-z0-9-]+$/i, {
    message: 'Username may only contain letters, numbers, and hyphens',
  });

const registerBodySchema = z.object({
  username: usernameSchema,
  email: z.string().email(),
  password: z.string().min(8),
});

module.exports = {
  usernameSchema,
  registerBodySchema,
};
