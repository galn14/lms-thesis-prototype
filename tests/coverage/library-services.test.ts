import {
  cn,
  formatDate,
  formatName,
  formatTime,
  generateRandomColor,
  getInitials,
  isValidEmail,
  slugify,
  truncateText,
} from '@/lib/utils';
import { clearTokenSession, getTokenSession, setTokenSession } from '@/lib/session/token';

describe('general and browser-session utilities', () => {
  it('formats and validates public display values', () => {
    expect(cn('p-2', false && 'hidden', 'p-4')).toBe('p-4');
    expect(formatDate('2026-08-16T00:00:00.000Z')).toContain('2026');
    expect(formatTime('17:30')).toBe('17:30');
    expect(formatName('Demo')).toBe('Demo');
    expect(formatName('Demo', 'Student')).toBe('Demo Student');
    expect(getInitials('Demo Prototype Student')).toBe('DP');
    expect(slugify('Hello, Prototype World!')).toBe('hello-prototype-world');
    expect(truncateText('short', 10)).toBe('short');
    expect(truncateText('prototype', 5)).toBe('proto...');
    expect(isValidEmail('demo@example.test')).toBe(true);
    expect(isValidEmail('invalid')).toBe(false);
    jest.spyOn(Math, 'random').mockReturnValueOnce(0).mockReturnValueOnce(0.999);
    expect(generateRandomColor()).toBe('bg-red-500');
    expect(generateRandomColor()).toBe('bg-gray-500');
  });

  it('is inert on the server and delegates storage in a browser', () => {
    expect(getTokenSession('demo')).toBeNull();
    expect(() => setTokenSession({ name: 'demo', value: 'value' })).not.toThrow();
    expect(() => clearTokenSession(['demo'])).not.toThrow();

    const getItem = jest.fn().mockReturnValue('stored');
    const setItem = jest.fn();
    const removeItem = jest.fn();
    Object.defineProperty(globalThis, 'window', { value: {}, configurable: true });
    Object.defineProperty(globalThis, 'sessionStorage', {
      value: { getItem, setItem, removeItem },
      configurable: true,
    });
    expect(getTokenSession('demo')).toBe('stored');
    setTokenSession({ name: 'demo', value: 'value' });
    clearTokenSession(['demo', 'other']);
    expect(getItem).toHaveBeenCalledWith('demo');
    expect(setItem).toHaveBeenCalledWith('demo', 'value');
    expect(removeItem.mock.calls).toEqual([['demo'], ['other']]);
    Reflect.deleteProperty(globalThis, 'window');
    Reflect.deleteProperty(globalThis, 'sessionStorage');
  });
});

describe('prototype processing guard', () => {
  const previous = process.env.PROTOTYPE_MODE;

  afterAll(() => {
    if (previous === undefined) delete process.env.PROTOTYPE_MODE;
    else process.env.PROTOTYPE_MODE = previous;
  });

  it('returns null outside prototype mode and a stable 503 response inside it', async () => {
    const prototypeMode = await import('@/lib/prototype-mode');
    process.env.PROTOTYPE_MODE = 'false';
    expect(prototypeMode.isPrototypeMode()).toBe(false);
    expect(prototypeMode.prototypeExternalProcessingResponse()).toBeNull();
    process.env.PROTOTYPE_MODE = 'true';
    expect(prototypeMode.isPrototypeMode()).toBe(true);
    const response = prototypeMode.prototypeExternalProcessingResponse()!;
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      success: false,
      code: prototypeMode.PROTOTYPE_EXTERNAL_PROCESSING_DISABLED,
      error: 'External processing is disabled in this prototype',
    });
  });
});

describe('credential encryption', () => {
  const originalEnv = process.env;

  afterEach(() => {
    process.env = originalEnv;
    jest.resetModules();
  });

  it('round-trips encrypted values, supports fallback secret, and masks display values', async () => {
    process.env = { ...originalEnv, CREDENTIAL_ENCRYPTION_SECRET: 'encryption-secret-for-tests' };
    const crypto = await import('@/lib/crypto');
    const encrypted = crypto.encryptSecret('prototype-api-key');
    expect(encrypted).not.toContain('prototype-api-key');
    expect(crypto.decryptSecret(encrypted)).toBe('prototype-api-key');
    expect(crypto.maskSecret('abc')).toBe('••••');
    expect(crypto.maskSecret('prototype-api-key')).toBe('••••••••-key');

    process.env = { ...originalEnv, NEXTAUTH_SECRET: 'fallback-secret-for-tests' };
    delete process.env.CREDENTIAL_ENCRYPTION_SECRET;
    jest.resetModules();
    const fallbackCrypto = await import('@/lib/crypto');
    expect(fallbackCrypto.decryptSecret(fallbackCrypto.encryptSecret('demo'))).toBe('demo');
  });

  it('fails closed when the secret is absent or the key changed', async () => {
    process.env = { ...originalEnv };
    delete process.env.CREDENTIAL_ENCRYPTION_SECRET;
    delete process.env.NEXTAUTH_SECRET;
    const crypto = await import('@/lib/crypto');
    expect(() => crypto.encryptSecret('demo')).toThrow('Missing CREDENTIAL_ENCRYPTION_SECRET');

    // Both ciphertexts encrypt "demo" under "first-key-for-tests". Decrypting
    // them with the rotated key yields random bytes, which crypto-js surfaces
    // either as an empty string or by throwing. They are fixed rather than
    // freshly encrypted because AES salting makes the failure mode random per
    // ciphertext, which would otherwise make this test flaky.
    process.env.CREDENTIAL_ENCRYPTION_SECRET = 'second-key-for-tests';
    const decryptsToEmpty = 'U2FsdGVkX1+Pt71ASL6DDMfrVkFmB3nRZVZh1JJsa7E=';
    const throwsMalformedUtf8 = 'U2FsdGVkX18u9wyluGdVtptIUVhT7mrybEKsvJmLsaE=';
    expect(() => crypto.decryptSecret(decryptsToEmpty)).toThrow('Failed to decrypt secret');
    expect(() => crypto.decryptSecret(throwsMalformedUtf8)).toThrow('Failed to decrypt secret');

    process.env.CREDENTIAL_ENCRYPTION_SECRET = 'first-key-for-tests';
    expect(crypto.decryptSecret(decryptsToEmpty)).toBe('demo');
    expect(crypto.decryptSecret(throwsMalformedUtf8)).toBe('demo');
  });
});

describe('admin authorization', () => {
  afterEach(() => jest.resetModules());

  const load = async (session: unknown, user: unknown) => {
    jest.doMock('next-auth', () => ({ getServerSession: jest.fn().mockResolvedValue(session) }));
    jest.doMock('@/auth', () => ({ authOptions: {} }));
    jest.doMock('@/lib/prisma', () => ({ prisma: { app_user: { findUnique: jest.fn().mockResolvedValue(user) } } }));
    return import('@/lib/auth/require-admin');
  };

  it('returns 401 without a user id', async () => {
    const { requireAdmin } = await load(null, null);
    const result = await requireAdmin();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(401);
  });

  it.each([
    [null],
    [{ id: 7, nama_lengkap: 'Teacher', app_user_role: [{ is_active: true, enumeration: { name: 'teacher' } }] }],
    [{ id: 7, nama_lengkap: 'Inactive', app_user_role: [{ is_active: false, enumeration: { name: 'ADMIN' } }] }],
  ])('returns 403 for a non-admin database result', async user => {
    const { requireAdmin } = await load({ user: { id: '7' } }, user);
    const result = await requireAdmin();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(403);
  });

  it('returns the normalized active admin', async () => {
    const { requireAdmin } = await load(
      { user: { id: '7' } },
      { id: 7, nama_lengkap: 'Demo Admin', app_user_role: [{ is_active: true, enumeration: { name: 'ADMIN' } }] },
    );
    await expect(requireAdmin()).resolves.toEqual({ ok: true, user: { id: '7', name: 'Demo Admin' } });
  });
});

describe('audit and feature access services', () => {
  afterEach(() => jest.resetModules());

  it('normalizes audit defaults and never breaks the caller on persistence failure', async () => {
    const insertAuditLog = jest.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('offline'));
    jest.doMock('@/lib/db2/admin-repo', () => ({ insertAuditLog }));
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const { logAudit } = await import('@/lib/audit');
    await logAudit({ actorUserId: null, action: 'view' });
    expect(insertAuditLog).toHaveBeenCalledWith({ actor_user_id: null, actor_name: null, action: 'view', entity_type: null, entity_id: null, details: {} });
    await expect(logAudit({ actorUserId: '7', actorName: 'Admin', action: 'edit', entityType: 'course', entityId: '2', details: { safe: true } })).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledWith('[audit] failed to record event', 'edit', expect.any(Error));
    error.mockRestore();
  });

  it.each([
    ['ai_grading', 'AI grading'],
    ['plagiarism', 'plagiarism detection'],
  ] as const)('explains disabled %s access and allows enabled courses', async (feature, label) => {
    const isScopeEnabled = jest.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    jest.doMock('@/lib/db2/admin-repo', () => ({ isScopeEnabled }));
    const { canUseFeature } = await import('@/lib/feature-access');
    await expect(canUseFeature('course-1', feature)).resolves.toEqual({ allowed: false, reason: `This course is not enabled for ${label}` });
    await expect(canUseFeature('course-1', feature)).resolves.toEqual({ allowed: true });
  });
});
