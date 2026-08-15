jest.mock('pg', () => ({ Client: jest.fn() }));

import { Client } from 'pg';

import { migrateAuxiliaryDatabase } from '@/lib/prototype/auxiliary-migrator';
import { resetPrototypeDatabase } from '@/lib/prototype/reset';

const installationId = '11111111-1111-4111-8111-111111111111';
const pooledUrl = 'postgresql://prototype.invalid/pooled';
const directUrl = 'postgresql://prototype.invalid/direct';

function createRawClient(mode: 'reset' | 'migration') {
  return {
    connect: jest.fn(async () => undefined),
    end: jest.fn(async () => undefined),
    query: jest.fn(async (sql: string) => {
      if (sql.includes('pg_try_advisory_xact_lock')) {
        return { rows: [{ acquired: true }], rowCount: 1 };
      }
      if (sql.includes('SELECT version, name, checksum')) {
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes('SELECT installation_id::text')) {
        return { rows: [{ installation_id: installationId, schema_version: 1 }], rowCount: 1 };
      }
      if (mode === 'reset' && sql.includes('UPDATE prototype_metadata')) {
        return {
          rows: [{ reset_version: '1', completed_at: '2026-08-15T17:00:00.000Z' }],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: null };
    }),
  };
}

describe('native pg client adapters', () => {
  const clientConstructor = jest.mocked(Client);
  const previousEnvironment = {
    NODE_ENV: process.env.NODE_ENV,
    PROTOTYPE_MODE: process.env.PROTOTYPE_MODE,
    PROTOTYPE_INSTALLATION_ID: process.env.PROTOTYPE_INSTALLATION_ID,
    DEMO_SHARED_PASSWORD: process.env.DEMO_SHARED_PASSWORD,
    AUX_POSTGRES_URL: process.env.AUX_POSTGRES_URL,
    DATABASE_URL: process.env.DATABASE_URL,
    DATABASE_URL_UNPOOLED: process.env.DATABASE_URL_UNPOOLED,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.PROTOTYPE_MODE = 'true';
    process.env.PROTOTYPE_INSTALLATION_ID = installationId;
    process.env.DEMO_SHARED_PASSWORD = 'native-client-test-password';
    process.env.AUX_POSTGRES_URL = pooledUrl;
    process.env.DATABASE_URL = pooledUrl;
    process.env.DATABASE_URL_UNPOOLED = pooledUrl;
  });

  afterAll(() => {
    for (const [name, value] of Object.entries(previousEnvironment)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  it.each([
    ['production', { rejectUnauthorized: false }],
    ['test', undefined],
  ])('runs reset through one native client in %s mode', async (nodeEnvironment, expectedSsl) => {
    const rawClient = createRawClient('reset');
    clientConstructor.mockImplementation(() => rawClient as unknown as Client);
    Object.defineProperty(process.env, 'NODE_ENV', {
      value: nodeEnvironment,
      writable: true,
      configurable: true,
    });

    await expect(resetPrototypeDatabase()).resolves.toEqual({
      resetVersion: 1,
      completedAt: '2026-08-15T17:00:00.000Z',
    });
    expect(clientConstructor).toHaveBeenCalledWith({
      connectionString: pooledUrl,
      ssl: expectedSsl,
    });
    expect(rawClient.connect).toHaveBeenCalledTimes(1);
    expect(rawClient.end).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['production', { rejectUnauthorized: false }],
    ['test', undefined],
  ])('runs auxiliary migration through one native client in %s mode', async (nodeEnvironment, expectedSsl) => {
    const rawClient = createRawClient('migration');
    clientConstructor.mockImplementation(() => rawClient as unknown as Client);

    await expect(migrateAuxiliaryDatabase({
      DATABASE_URL_UNPOOLED: directUrl,
      DATABASE_URL: directUrl,
      PROTOTYPE_INSTALLATION_ID: installationId,
      NODE_ENV: nodeEnvironment,
    }, { migrations: [] })).resolves.toEqual({ applied: [], skipped: [] });
    expect(clientConstructor).toHaveBeenCalledWith({
      connectionString: directUrl,
      ssl: expectedSsl,
    });
    expect(rawClient.connect).toHaveBeenCalledTimes(1);
    expect(rawClient.end).toHaveBeenCalledTimes(1);
  });
});
