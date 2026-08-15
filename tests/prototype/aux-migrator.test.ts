import {
  AuxiliaryMigration,
  applyAuxiliaryMigrations,
  loadAuxiliaryMigrations,
  migrateAuxiliaryDatabase,
} from '@/lib/prototype/auxiliary-migrator';

function createMigration(version: number, name: string, sql: string): AuxiliaryMigration {
  return { version, name, sql };
}

function createClient(
  appliedRows: Array<Record<string, unknown>> = [],
  markerRows: Array<Record<string, unknown>> = [{
    installation_id: '11111111-1111-4111-8111-111111111111',
    schema_version: 1,
  }]
) {
  return {
    query: jest.fn(async (sql: string, _parameters?: readonly unknown[]) => {
      if (sql.includes('SELECT version, name, checksum')) {
        return { rows: appliedRows, rowCount: appliedRows.length };
      }
      if (sql.includes('SELECT installation_id::text')) {
        return {
          rows: markerRows,
          rowCount: markerRows.length,
        };
      }
      return { rows: [], rowCount: 0 };
    }),
  };
}

describe('applyAuxiliaryMigrations', () => {
  const installationId = '11111111-1111-4111-8111-111111111111';
  const migrations = [
    createMigration(1, '001_extensions.sql', 'CREATE EXTENSION IF NOT EXISTS vector;'),
    createMigration(2, '002_tables.sql', 'CREATE TABLE IF NOT EXISTS sample (id INTEGER);'),
  ];

  it('applies ordered migrations, records them, and initializes the safety marker', async () => {
    const client = createClient();

    const result = await applyAuxiliaryMigrations(client, migrations, installationId);

    expect(result).toEqual({ applied: [1, 2], skipped: [] });
    const sqlCalls = client.query.mock.calls.map(([sql]) => String(sql));
    expect(sqlCalls.indexOf(migrations[0].sql)).toBeLessThan(sqlCalls.indexOf(migrations[1].sql));
    expect(sqlCalls.some((sql) => sql.includes('INSERT INTO prototype_aux_migrations'))).toBe(true);
    expect(sqlCalls.some((sql) => sql.includes('INSERT INTO prototype_metadata'))).toBe(true);
  });

  it('skips migrations with matching checksums', async () => {
    const firstRunClient = createClient();
    await applyAuxiliaryMigrations(firstRunClient, migrations, installationId);
    const ledgerInserts = firstRunClient.query.mock.calls.filter(([sql]) =>
      String(sql).includes('INSERT INTO prototype_aux_migrations')
    );
    const appliedRows = ledgerInserts.map(([, parameters]) => {
      const values = parameters ?? [];
      return { version: values[0], name: values[1], checksum: values[2] };
    });
    const secondRunClient = createClient(appliedRows);

    const result = await applyAuxiliaryMigrations(secondRunClient, migrations, installationId);

    expect(result).toEqual({ applied: [], skipped: [1, 2] });
    expect(secondRunClient.query).not.toHaveBeenCalledWith(migrations[0].sql);
    expect(secondRunClient.query).not.toHaveBeenCalledWith(migrations[1].sql);
  });

  it('refuses a modified migration that was already recorded', async () => {
    const client = createClient([{ version: 1, name: '001_extensions.sql', checksum: 'wrong' }]);

    await expect(applyAuxiliaryMigrations(client, migrations, installationId)).rejects.toThrow(
      'checksum mismatch'
    );
  });

  it.each([
    [[createMigration(0, '000_bad.sql', 'SELECT 1')]],
    [[createMigration(2, '002_second.sql', 'SELECT 2'), createMigration(1, '001_first.sql', 'SELECT 1')]],
  ])('refuses unordered or non-positive migrations', async (invalidMigrations) => {
    await expect(
      applyAuxiliaryMigrations(createClient(), invalidMigrations, installationId)
    ).rejects.toThrow('strictly increasing');
  });

  it.each([
    [[], 'Failed to initialize prototype_metadata'],
    [[{ installation_id: '22222222-2222-4222-8222-222222222222', schema_version: 1 }], 'different prototype installation'],
    [[{ installation_id: installationId, schema_version: 2 }], 'schema version'],
  ])('refuses an unsafe metadata marker', async (markerRows, expectedMessage) => {
    await expect(
      applyAuxiliaryMigrations(createClient([], markerRows), migrations, installationId)
    ).rejects.toThrow(expectedMessage);
  });

  it('loads the checked-in SQL migrations in version order', async () => {
    const loaded = await loadAuxiliaryMigrations();

    expect(loaded[0].name).toBe('001_extensions.sql');
    expect(loaded.at(-1)?.name).toBe('008_prototype_metadata.sql');
    expect(loaded.map((migration) => migration.version)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it.each([
    [{ PROTOTYPE_INSTALLATION_ID: installationId }, 'DATABASE_URL_UNPOOLED'],
    [{ DATABASE_URL_UNPOOLED: 'postgresql://prototype.invalid/database' }, 'PROTOTYPE_INSTALLATION_ID'],
    [{ DATABASE_URL_UNPOOLED: 'postgresql://prototype.invalid/database', PROTOTYPE_INSTALLATION_ID: installationId }, 'DATABASE_URL'],
  ])('validates migration runner environment', async (environment, message) => {
    await expect(migrateAuxiliaryDatabase(environment)).rejects.toThrow(message);
  });

  it.each([
    [{
      DATABASE_URL: 'postgresql://ep-demo-pooler.region.aws.neon.tech/database',
      AUX_POSTGRES_URL: 'postgresql://ep-other-pooler.region.aws.neon.tech/database',
      DATABASE_URL_UNPOOLED: 'postgresql://ep-demo.region.aws.neon.tech/database',
      PROTOTYPE_INSTALLATION_ID: installationId,
    }, 'same pooled database URL'],
    [{
      DATABASE_URL: 'postgresql://ep-demo-pooler.region.aws.neon.tech/database',
      AUX_POSTGRES_URL: 'postgresql://ep-demo-pooler.region.aws.neon.tech/database',
      DATABASE_URL_UNPOOLED: 'postgresql://ep-other.region.aws.neon.tech/database',
      PROTOTYPE_INSTALLATION_ID: installationId,
    }, 'same Neon branch and database'],
  ])('refuses an inconsistent database target before connecting', async (environment, message) => {
    await expect(migrateAuxiliaryDatabase(environment)).rejects.toThrow(message);
  });

  it('commits a migration runner transaction using the supplied client', async () => {
    const coreClient = createClient();
    const client = {
      ...coreClient,
      connect: jest.fn(async () => undefined),
      end: jest.fn(async () => undefined),
    };
    const result = await migrateAuxiliaryDatabase(
      {
        DATABASE_URL_UNPOOLED: 'postgresql://prototype.invalid/direct',
        DATABASE_URL: 'postgresql://prototype.invalid/direct',
        PROTOTYPE_INSTALLATION_ID: installationId,
      },
      { client, migrations }
    );

    expect(result.applied).toEqual([1, 2]);
    expect(client.query).toHaveBeenCalledWith('BEGIN');
    expect(client.query).toHaveBeenCalledWith('COMMIT');
    expect(client.end).toHaveBeenCalledTimes(1);
  });

  it('rolls back and closes the migration client after failure', async () => {
    const coreClient = createClient([], []);
    const client = {
      ...coreClient,
      connect: jest.fn(async () => undefined),
      end: jest.fn(async () => undefined),
    };

    await expect(migrateAuxiliaryDatabase(
      {
        DATABASE_URL_UNPOOLED: 'postgresql://prototype.invalid/direct',
        DATABASE_URL: 'postgresql://prototype.invalid/direct',
        PROTOTYPE_INSTALLATION_ID: installationId,
      },
      { client, migrations }
    )).rejects.toThrow('Failed to initialize');
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    expect(client.end).toHaveBeenCalledTimes(1);
  });

  it('uses process environment and checked-in migrations when arguments are omitted', async () => {
    const previous = {
      DATABASE_URL: process.env.DATABASE_URL,
      DATABASE_URL_UNPOOLED: process.env.DATABASE_URL_UNPOOLED,
      PROTOTYPE_INSTALLATION_ID: process.env.PROTOTYPE_INSTALLATION_ID,
    };
    process.env.DATABASE_URL = 'postgresql://prototype.invalid/database';
    process.env.DATABASE_URL_UNPOOLED = 'postgresql://prototype.invalid/database';
    process.env.PROTOTYPE_INSTALLATION_ID = installationId;
    const coreClient = createClient();
    const client = {
      ...coreClient,
      connect: jest.fn(async () => undefined),
      end: jest.fn(async () => undefined),
    };

    try {
      const result = await migrateAuxiliaryDatabase(undefined, { client });
      expect(result).toEqual({ applied: [1, 2, 3, 4, 5, 6, 7, 8], skipped: [] });
    } finally {
      for (const [name, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  });
});
