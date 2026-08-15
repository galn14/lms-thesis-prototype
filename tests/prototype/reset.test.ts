import {
  PROTOTYPE_SCHEMA_VERSION,
  PrototypeResetError,
  ResetInProgressError,
  resetPrototypeDatabase,
} from '@/lib/prototype/reset';

interface QueryResult {
  rows: Array<Record<string, unknown>>;
  rowCount: number;
}

function createClient(options: {
  lockAcquired?: boolean;
  missingLockRow?: boolean;
  installationId?: string;
  schemaVersion?: number;
  missingMetadata?: boolean;
  missingUpdate?: boolean;
  failPattern?: RegExp;
} = {}) {
  const query = jest.fn(async (sql: string): Promise<QueryResult> => {
    if (options.failPattern?.test(sql)) {
      throw new Error('synthetic database failure');
    }
    if (sql.includes('pg_try_advisory_xact_lock')) {
      if (options.missingLockRow) return { rows: [], rowCount: 0 };
      return { rows: [{ acquired: options.lockAcquired ?? true }], rowCount: 1 };
    }
    if (sql.includes('FROM prototype_metadata')) {
      if (options.missingMetadata) return { rows: [], rowCount: 0 };
      return {
        rows: [{
          installation_id: options.installationId ?? '11111111-1111-4111-8111-111111111111',
          schema_version: options.schemaVersion ?? PROTOTYPE_SCHEMA_VERSION,
        }],
        rowCount: 1,
      };
    }
    if (sql.includes('UPDATE prototype_metadata')) {
      if (options.missingUpdate) return { rows: [], rowCount: 0 };
      return {
        rows: [{ reset_version: '3', completed_at: '2026-08-15T17:00:00.000Z' }],
        rowCount: 1,
      };
    }
    return { rows: [], rowCount: 0 };
  });

  return {
    connect: jest.fn(async () => undefined),
    query,
    end: jest.fn(async () => undefined),
  };
}

const validEnvironment = {
  PROTOTYPE_MODE: 'true',
  PROTOTYPE_INSTALLATION_ID: '11111111-1111-4111-8111-111111111111',
  DEMO_SHARED_PASSWORD: 'correct horse battery staple for-tests',
  AUX_POSTGRES_URL: 'postgresql://prototype.invalid/database',
  DATABASE_URL: 'postgresql://prototype.invalid/database',
  DATABASE_URL_UNPOOLED: 'postgresql://prototype.invalid/database',
};

describe('resetPrototypeDatabase', () => {
  it('uses one client and commits a guarded deterministic reset', async () => {
    const client = createClient();
    const result = await resetPrototypeDatabase({ client, environment: validEnvironment });

    expect(client.connect).toHaveBeenCalledTimes(1);
    expect(client.end).toHaveBeenCalledTimes(1);
    expect(client.query).toHaveBeenCalledWith('BEGIN');
    expect(client.query).toHaveBeenCalledWith('COMMIT');
    expect(client.query).not.toHaveBeenCalledWith('ROLLBACK');
    expect(client.query.mock.calls.some(([sql]) => String(sql).includes('TRUNCATE TABLE'))).toBe(true);
    expect(client.query.mock.calls.some(([sql]) =>
      String(sql).includes("SELECT 'course', id::text")
    )).toBe(true);
    expect(result).toEqual({
      resetVersion: 3,
      completedAt: '2026-08-15T17:00:00.000Z',
    });
  });

  it('returns a distinct error when another reset holds the advisory lock', async () => {
    const client = createClient({ lockAcquired: false });

    await expect(
      resetPrototypeDatabase({ client, environment: validEnvironment })
    ).rejects.toBeInstanceOf(ResetInProgressError);
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
  });

  it.each([
    [{ ...validEnvironment, PROTOTYPE_MODE: 'false' }, 'PROTOTYPE_MODE'],
    [{ ...validEnvironment, PROTOTYPE_INSTALLATION_ID: '' }, 'PROTOTYPE_INSTALLATION_ID'],
    [{ ...validEnvironment, PROTOTYPE_INSTALLATION_ID: undefined }, 'PROTOTYPE_INSTALLATION_ID'],
    [{ ...validEnvironment, DEMO_SHARED_PASSWORD: '' }, 'DEMO_SHARED_PASSWORD'],
    [{ ...validEnvironment, AUX_POSTGRES_URL: '', DATABASE_URL: '' }, 'AUX_POSTGRES_URL'],
    [{ ...validEnvironment, AUX_POSTGRES_URL: 'postgresql://other.invalid/database' }, 'same pooled'],
    [{ ...validEnvironment, DATABASE_URL_UNPOOLED: '' }, 'DATABASE_URL_UNPOOLED'],
    [{ ...validEnvironment, DATABASE_URL_UNPOOLED: 'postgresql://different.invalid/database' }, 'same Neon branch'],
  ])('rejects unsafe environment values before connecting', async (environment, fragment) => {
    const client = createClient();

    await expect(resetPrototypeDatabase({ client, environment })).rejects.toThrow(fragment);
    expect(client.connect).not.toHaveBeenCalled();
  });

  it('refuses a database with a different installation marker', async () => {
    const client = createClient({ installationId: '22222222-2222-4222-8222-222222222222' });

    await expect(
      resetPrototypeDatabase({ client, environment: validEnvironment })
    ).rejects.toBeInstanceOf(PrototypeResetError);
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    expect(client.query.mock.calls.some(([sql]) => String(sql).includes('TRUNCATE TABLE'))).toBe(false);
  });

  it('uses DATABASE_URL when the auxiliary pooled alias is absent', async () => {
    const client = createClient();

    await expect(resetPrototypeDatabase({
      client,
      environment: { ...validEnvironment, AUX_POSTGRES_URL: undefined },
    })).resolves.toEqual({
      resetVersion: 3,
      completedAt: '2026-08-15T17:00:00.000Z',
    });
  });

  it('treats a missing advisory-lock result as a concurrent reset', async () => {
    const client = createClient({ missingLockRow: true });

    await expect(
      resetPrototypeDatabase({ client, environment: validEnvironment })
    ).rejects.toBeInstanceOf(ResetInProgressError);
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
  });

  it('refuses a database without a prototype safety marker', async () => {
    const client = createClient({ missingMetadata: true });

    await expect(
      resetPrototypeDatabase({ client, environment: validEnvironment })
    ).rejects.toThrow('safety marker is missing');
    expect(client.query.mock.calls.some(([sql]) => String(sql).includes('TRUNCATE TABLE'))).toBe(false);
  });

  it('refuses a database with a different prototype schema version', async () => {
    const client = createClient({ schemaVersion: PROTOTYPE_SCHEMA_VERSION + 1 });

    await expect(
      resetPrototypeDatabase({ client, environment: validEnvironment })
    ).rejects.toThrow('schema version');
    expect(client.query.mock.calls.some(([sql]) => String(sql).includes('TRUNCATE TABLE'))).toBe(false);
  });

  it('rolls back a transaction failure', async () => {
    const client = createClient({ failPattern: /INSERT INTO enumeration/ });

    await expect(
      resetPrototypeDatabase({ client, environment: validEnvironment })
    ).rejects.toThrow('synthetic database failure');
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    expect(client.query).not.toHaveBeenCalledWith('COMMIT');
  });

  it('rolls back when reset metadata cannot be updated', async () => {
    const client = createClient({ missingUpdate: true });

    await expect(
      resetPrototypeDatabase({ client, environment: validEnvironment })
    ).rejects.toThrow('Failed to update prototype reset metadata');
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
  });
});
