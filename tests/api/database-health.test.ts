import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/require-admin';
import { checkDatabaseHealth } from '@/lib/db-utils';
import { GET } from '@/app/api/db/health/route';

jest.mock('@/lib/auth/require-admin', () => ({
  requireAdmin: jest.fn(),
}));

jest.mock('@/lib/db-utils', () => ({
  checkDatabaseHealth: jest.fn(),
}));

const mockRequireAdmin = requireAdmin as jest.MockedFunction<typeof requireAdmin>;
const mockCheckDatabaseHealth = checkDatabaseHealth as jest.MockedFunction<
  typeof checkDatabaseHealth
>;

describe('database health route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRequireAdmin.mockResolvedValue({
      ok: true,
      user: { id: '1', name: 'Prototype Admin' },
    });
  });

  it('returns the admin guard response without querying the database', async () => {
    const response = NextResponse.json(
      { success: false, error: 'Unauthorized' },
      { status: 401 }
    );
    mockRequireAdmin.mockResolvedValue({ ok: false, response });

    expect(await GET()).toBe(response);
    expect(mockCheckDatabaseHealth).not.toHaveBeenCalled();
  });

  it('returns only a generic success status to an admin', async () => {
    mockCheckDatabaseHealth.mockResolvedValue({
      connected: true,
      timestamp: '2026-08-15T00:00:00.000Z',
    });

    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'success' });
  });

  it('does not expose database error details when disconnected', async () => {
    mockCheckDatabaseHealth.mockResolvedValue({
      connected: false,
      error: 'password authentication failed for demo_admin',
      timestamp: '2026-08-15T00:00:00.000Z',
    });

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toEqual({ status: 'error', message: 'Database unavailable' });
    expect(JSON.stringify(body)).not.toContain('password authentication');
  });

  it('does not expose thrown database error details', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    mockCheckDatabaseHealth.mockRejectedValue(new Error('postgresql://user:secret@host/db'));

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ status: 'error', message: 'Internal server error' });
    expect(JSON.stringify(body)).not.toContain('postgresql://');
    expect(consoleSpy).toHaveBeenCalledWith('Database health check failed');
    consoleSpy.mockRestore();
  });
});
