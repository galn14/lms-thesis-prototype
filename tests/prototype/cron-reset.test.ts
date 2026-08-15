const resetPrototypeDatabase = jest.fn();

jest.mock('@/lib/prototype/reset', () => {
  class ResetInProgressError extends Error {}
  return {
    resetPrototypeDatabase,
    ResetInProgressError,
  };
});

import { GET } from '@/app/api/cron/reset/route';
import { ResetInProgressError } from '@/lib/prototype/reset';

describe('GET /api/cron/reset', () => {
  const previousSecret = process.env.CRON_SECRET;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.CRON_SECRET = 'cron-secret-for-tests';
  });

  afterAll(() => {
    if (previousSecret === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = previousSecret;
  });

  it.each([undefined, 'Bearer wrong-secret', 'Basic cron-secret-for-tests'])(
    'rejects an invalid authorization header',
    async (authorization) => {
      const headers = authorization ? { authorization } : undefined;
      const response = await GET(new Request('https://prototype.invalid/api/cron/reset', { headers }));

      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ success: false, code: 'UNAUTHORIZED' });
      expect(resetPrototypeDatabase).not.toHaveBeenCalled();
    }
  );

  it('rejects requests when CRON_SECRET is not configured', async () => {
    delete process.env.CRON_SECRET;
    const response = await GET(new Request('https://prototype.invalid/api/cron/reset', {
      headers: { authorization: 'Bearer anything' },
    }));

    expect(response.status).toBe(401);
    expect(resetPrototypeDatabase).not.toHaveBeenCalled();
  });

  it('runs the reset for the exact bearer secret', async () => {
    resetPrototypeDatabase.mockResolvedValue({
      resetVersion: 7,
      completedAt: '2026-08-15T17:00:00.000Z',
    });
    const response = await GET(new Request('https://prototype.invalid/api/cron/reset', {
      headers: { authorization: 'Bearer cron-secret-for-tests' },
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      resetVersion: 7,
      completedAt: '2026-08-15T17:00:00.000Z',
    });
  });

  it('maps a held advisory lock to RESET_IN_PROGRESS', async () => {
    resetPrototypeDatabase.mockRejectedValue(new ResetInProgressError());
    const response = await GET(new Request('https://prototype.invalid/api/cron/reset', {
      headers: { authorization: 'Bearer cron-secret-for-tests' },
    }));

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ success: false, code: 'RESET_IN_PROGRESS' });
  });

  it('does not leak reset errors', async () => {
    resetPrototypeDatabase.mockRejectedValue(new Error('database connection contains credentials'));
    const response = await GET(new Request('https://prototype.invalid/api/cron/reset', {
      headers: { authorization: 'Bearer cron-secret-for-tests' },
    }));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ success: false, code: 'RESET_FAILED' });
  });
});
