import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { Client } from 'pg';

import { PROTOTYPE_SCHEMA_VERSION } from '@/lib/prototype/reset';
import { assertSameDatabaseTarget } from '@/lib/prototype/database-identity';

export interface AuxiliaryMigration {
  version: number;
  name: string;
  sql: string;
}

interface MigrationQueryResult {
  rows: Array<Record<string, unknown>>;
  rowCount: number | null;
}

export interface AuxiliaryMigrationClient {
  query(sql: string, parameters?: readonly unknown[]): Promise<MigrationQueryResult>;
}

interface AuxiliaryMigrationRunnerClient extends AuxiliaryMigrationClient {
  connect(): Promise<void>;
  end(): Promise<void>;
}

interface AuxiliaryMigrationRunnerOptions {
  client?: AuxiliaryMigrationRunnerClient;
  migrations?: readonly AuxiliaryMigration[];
}

interface AppliedMigration {
  version: number;
  name: string;
  checksum: string;
}

const MIGRATION_LOCK_KEY = 1_842_026_028;
const MIGRATION_FILE_PATTERN = /^(\d{3})_[a-z0-9_]+\.sql$/;

function checksum(sql: string): string {
  return createHash('sha256').update(sql).digest('hex');
}

function validateMigrations(migrations: readonly AuxiliaryMigration[]): void {
  let previousVersion = 0;
  for (const migration of migrations) {
    if (!Number.isInteger(migration.version) || migration.version <= previousVersion) {
      throw new Error('Auxiliary migrations must have strictly increasing positive versions');
    }
    previousVersion = migration.version;
  }
}

export async function loadAuxiliaryMigrations(
  directory = path.join(process.cwd(), 'db', 'aux')
): Promise<AuxiliaryMigration[]> {
  const names = (await fs.readdir(directory))
    .filter((name) => MIGRATION_FILE_PATTERN.test(name))
    .sort((left, right) => left.localeCompare(right));
  const migrations = await Promise.all(names.map(async (name) => {
    return {
      version: Number(name.slice(0, 3)),
      name,
      sql: await fs.readFile(path.join(directory, name), 'utf8'),
    };
  }));
  validateMigrations(migrations);
  return migrations;
}

function createMigrationClient(
  connectionString: string,
  production: boolean
): AuxiliaryMigrationRunnerClient {
  const client = new Client({
    connectionString,
    ssl: production ? { rejectUnauthorized: false } : undefined,
  });
  return {
    connect: () => client.connect(),
    query: async (sql, parameters = []) => {
      const result = await client.query(sql, [...parameters]);
      return {
        rows: result.rows as Array<Record<string, unknown>>,
        rowCount: result.rowCount,
      };
    },
    end: () => client.end(),
  };
}

export async function applyAuxiliaryMigrations(
  client: AuxiliaryMigrationClient,
  migrations: readonly AuxiliaryMigration[],
  installationId: string
): Promise<{ applied: number[]; skipped: number[] }> {
  validateMigrations(migrations);
  await client.query(`
    CREATE TABLE IF NOT EXISTS prototype_aux_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      checksum CHAR(64) NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  const ledgerResult = await client.query(`
    SELECT version, name, checksum
    FROM prototype_aux_migrations
    ORDER BY version
  `);
  const ledger = new Map<number, AppliedMigration>(ledgerResult.rows.map((row) => [
    Number(row.version),
    {
      version: Number(row.version),
      name: String(row.name),
      checksum: String(row.checksum),
    },
  ]));
  const applied: number[] = [];
  const skipped: number[] = [];

  for (const migration of migrations) {
    const expectedChecksum = checksum(migration.sql);
    const existing = ledger.get(migration.version);
    if (existing) {
      if (existing.name !== migration.name || existing.checksum !== expectedChecksum) {
        throw new Error(`Auxiliary migration ${migration.version} checksum mismatch`);
      }
      skipped.push(migration.version);
      continue;
    }
    await client.query(migration.sql);
    await client.query(
      `
        INSERT INTO prototype_aux_migrations (version, name, checksum)
        VALUES ($1, $2, $3)
      `,
      [migration.version, migration.name, expectedChecksum]
    );
    applied.push(migration.version);
  }

  await client.query(
    `
      INSERT INTO prototype_metadata (
        singleton,
        installation_id,
        schema_version,
        reset_version
      )
      VALUES (TRUE, $1::uuid, $2, 0)
      ON CONFLICT (singleton) DO NOTHING
    `,
    [installationId, PROTOTYPE_SCHEMA_VERSION]
  );
  const markerResult = await client.query(`
    SELECT installation_id::text, schema_version
    FROM prototype_metadata
    WHERE singleton = TRUE
  `);
  const marker = markerResult.rows[0];
  if (!marker) throw new Error('Failed to initialize prototype_metadata');
  if (String(marker.installation_id) !== installationId) {
    throw new Error('Database already belongs to a different prototype installation');
  }
  if (Number(marker.schema_version) !== PROTOTYPE_SCHEMA_VERSION) {
    throw new Error('Database prototype schema version does not match this release');
  }
  return { applied, skipped };
}

export async function migrateAuxiliaryDatabase(
  environment: Record<string, string | undefined> = process.env,
  options: AuxiliaryMigrationRunnerOptions = {}
): Promise<{ applied: number[]; skipped: number[] }> {
  const connectionString = environment.DATABASE_URL_UNPOOLED;
  if (!connectionString) throw new Error('DATABASE_URL_UNPOOLED is required for auxiliary migrations');
  const installationId = environment.PROTOTYPE_INSTALLATION_ID;
  if (!installationId) throw new Error('PROTOTYPE_INSTALLATION_ID is required for auxiliary migrations');
  const pooledConnectionString = environment.DATABASE_URL;
  if (!pooledConnectionString) throw new Error('DATABASE_URL is required for auxiliary migrations');
  if (
    environment.AUX_POSTGRES_URL &&
    environment.AUX_POSTGRES_URL.trim() !== pooledConnectionString.trim()
  ) {
    throw new Error('AUX_POSTGRES_URL and DATABASE_URL must use the same pooled database URL');
  }
  assertSameDatabaseTarget(
    pooledConnectionString,
    connectionString,
    'DATABASE_URL',
    'DATABASE_URL_UNPOOLED'
  );
  const client = options.client ?? createMigrationClient(
    connectionString,
    environment.NODE_ENV === 'production'
  );
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [MIGRATION_LOCK_KEY]);
    const migrations = options.migrations ?? await loadAuxiliaryMigrations();
    const result = await applyAuxiliaryMigrations(client, migrations, installationId);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}
