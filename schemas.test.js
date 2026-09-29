const { registerBodySchema } = require('./schemas');

describe('registerBodySchema username validation', () => {
  const validBase = {
    email: 'alice@example.com',
    password: 'correct-horse-battery-staple',
  };

  it('accepts alphanumeric usernames', () => {
    const result = registerBodySchema.safeParse({
      ...validBase,
      username: 'alice123',
    });
    expect(result.success).toBe(true);
  });

  it('accepts usernames containing hyphens', () => {
    const result = registerBodySchema.safeParse({
      ...validBase,
      username: 'alice-bob',
    });
    expect(result.success).toBe(true);
  });

  it('rejects usernames with XSS special characters', () => {
    for (const username of ['alice<script>', 'alice>', 'alice&bob', 'alice"bob']) {
      const result = registerBodySchema.safeParse({ ...validBase, username });
      expect(result.success).toBe(false);
    }
  });

  it('rejects usernames with control or unicode characters', () => {
    for (const username of ['alice\u0000bob', 'alice\nbob', 'älice']) {
      const result = registerBodySchema.safeParse({ ...validBase, username });
      expect(result.success).toBe(false);
    }
  });

  it('rejects usernames that are too short', () => {
    const result = registerBodySchema.safeParse({ ...validBase, username: 'a' });
    expect(result.success).toBe(false);
  });

  it('rejects usernames that are too long', () => {
    const result = registerBodySchema.safeParse({
      ...validBase,
      username: 'a'.repeat(31),
    });
    expect(result.success).toBe(false);
  });
});
