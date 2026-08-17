jest.mock('@/lib/prototype/database-identity', () => ({
  assertSameDatabaseTarget: jest.fn(() => {
    throw 'non-error database identity failure';
  }),
}));

import { resetPrototypeDatabase } from '@/lib/prototype/reset';

describe('reset database identity error normalization', () => {
  it('does not leak a non-Error value thrown by identity validation', async () => {
    const client = {
      connect: jest.fn(async () => undefined),
      query: jest.fn(async () => ({ rows: [], rowCount: 0 })),
      end: jest.fn(async () => undefined),
    };

    await expect(resetPrototypeDatabase({
      client,
      environment: {
        PROTOTYPE_MODE: 'true',
        PROTOTYPE_INSTALLATION_ID: '11111111-1111-4111-8111-111111111111',
        DEMO_SHARED_PASSWORD: 'coverage-test-password',
        DATABASE_URL: 'postgresql://host/database',
        AUX_POSTGRES_URL: 'postgresql://host/database',
        DATABASE_URL_UNPOOLED: 'postgresql://host/database',
      },
    })).rejects.toThrow('Invalid database target');
    expect(client.connect).not.toHaveBeenCalled();
  });
});
