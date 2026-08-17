import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';

import { Client } from 'pg';

import {
  loadAuxiliaryMigrations,
  migrateAuxiliaryDatabase,
} from '@/lib/prototype/auxiliary-migrator';
import { assertSameDatabaseTarget } from '@/lib/prototype/database-identity';
import { resetPrototypeDatabase } from '@/lib/prototype/reset';

const integrationEnabled = process.env.RUN_PROTOTYPE_DB_INTEGRATION === 'true';
const integrationDescribe = integrationEnabled ? describe : describe.skip;
const SCHEMA_PREFIX = 'prototype_integration_';

function requiredUrl(name: 'DATABASE_URL' | 'DATABASE_URL_UNPOOLED'): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for prototype database integration tests`);
  return value;
}

function withSchema(connectionString: string, schema: string, prisma: boolean): string {
  const parsed = new URL(connectionString);
  parsed.searchParams.delete('schema');
  parsed.searchParams.delete('options');
  if (prisma) parsed.searchParams.set('schema', schema);
  else parsed.searchParams.set('options', `-csearch_path=${schema},public`);
  return parsed.toString();
}

function runPrismaMigrations(connectionString: string): void {
  const result = spawnSync('npx', ['prisma', 'migrate', 'deploy'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DATABASE_URL: connectionString,
      DATABASE_URL_UNPOOLED: connectionString,
    },
    encoding: 'utf8',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Isolated Prisma migration failed with exit ${result.status ?? 'unknown'}`);
  }
}

integrationDescribe('prototype database from an empty isolated schema', () => {
  jest.setTimeout(180_000);

  it('migrates, seeds, validates pgvector, and repeats idempotently', async () => {
    const pooledBase = requiredUrl('DATABASE_URL');
    const directBase = requiredUrl('DATABASE_URL_UNPOOLED');
    assertSameDatabaseTarget(pooledBase, directBase, 'DATABASE_URL', 'DATABASE_URL_UNPOOLED');
    const schema = `${SCHEMA_PREFIX}${randomUUID().replaceAll('-', '')}`;
    if (!new RegExp(`^${SCHEMA_PREFIX}[a-f0-9]{32}$`).test(schema)) {
      throw new Error('Refusing to use an unsafe integration schema name');
    }
    const prismaDirect = withSchema(directBase, schema, true);
    const scopedDirect = withSchema(directBase, schema, false);
    // Neon's pooler rejects the "options" startup parameter, so a disposable
    // search_path cannot be routed through it. The pooled role is therefore
    // filled by the direct endpoint here; the real pooled endpoint runs on the
    // public schema without that parameter and is covered by the smoke test.
    const scopedPooled = withSchema(directBase, schema, false);
    const installationId = randomUUID();
    const administrationClient = new Client({ connectionString: directBase });
    await administrationClient.connect();

    try {
      // Extensions are database-global objects. Install them explicitly in public
      // before creating the disposable schema, and never attach them to its lifecycle.
      await administrationClient.query('CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public');
      await administrationClient.query('CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public');
      const extensionNamespaces = await administrationClient.query(`
        SELECT extname, namespace.nspname
        FROM pg_extension extension
        JOIN pg_namespace namespace ON namespace.oid = extension.extnamespace
        WHERE extname IN ('pgcrypto', 'vector')
        ORDER BY extname
      `);
      expect(extensionNamespaces.rows).toEqual([
        { extname: 'pgcrypto', nspname: 'public' },
        { extname: 'vector', nspname: 'public' },
      ]);
      await administrationClient.query(`CREATE SCHEMA ${schema}`);
      const emptyResult = await administrationClient.query(
        `SELECT COUNT(*)::int AS count FROM pg_class WHERE relnamespace = $1::regnamespace`,
        [schema]
      );
      expect(emptyResult.rows[0].count).toBe(0);

      runPrismaMigrations(prismaDirect);
      // Migration 001 only installs database-global extensions. Record its exact
      // checked-in checksum in the isolated ledger so the migrator safely skips
      // executing that DDL under the disposable search_path.
      const [extensionMigration] = await loadAuxiliaryMigrations();
      expect(extensionMigration.version).toBe(1);
      const extensionChecksum = createHash('sha256')
        .update(extensionMigration.sql)
        .digest('hex');
      const ledgerClient = new Client({ connectionString: scopedDirect });
      await ledgerClient.connect();
      try {
        const currentSchema = await ledgerClient.query('SELECT current_schema() AS schema');
        expect(currentSchema.rows[0].schema).toBe(schema);
        await ledgerClient.query(`
          CREATE TABLE prototype_aux_migrations (
            version INTEGER PRIMARY KEY,
            name TEXT NOT NULL UNIQUE,
            checksum CHAR(64) NOT NULL,
            applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          )
        `);
        await ledgerClient.query(
          `INSERT INTO prototype_aux_migrations (version, name, checksum) VALUES ($1, $2, $3)`,
          [extensionMigration.version, extensionMigration.name, extensionChecksum]
        );
      } finally {
        await ledgerClient.end();
      }
      const firstMigration = await migrateAuxiliaryDatabase({
        DATABASE_URL: scopedPooled,
        AUX_POSTGRES_URL: scopedPooled,
        DATABASE_URL_UNPOOLED: scopedDirect,
        PROTOTYPE_INSTALLATION_ID: installationId,
      });
      expect(firstMigration).toEqual({
        applied: [2, 3, 4, 5, 6, 7, 8],
        skipped: [1],
      });
      const resetEnvironment = {
        PROTOTYPE_MODE: 'true',
        PROTOTYPE_INSTALLATION_ID: installationId,
        DEMO_SHARED_PASSWORD: 'integration-only-shared-password',
        DATABASE_URL: scopedPooled,
        AUX_POSTGRES_URL: scopedPooled,
        DATABASE_URL_UNPOOLED: scopedDirect,
      };
      await expect(resetPrototypeDatabase({ environment: resetEnvironment })).resolves.toEqual(
        expect.objectContaining({ resetVersion: 1 })
      );

      runPrismaMigrations(prismaDirect);
      const secondMigration = await migrateAuxiliaryDatabase({
        DATABASE_URL: scopedPooled,
        AUX_POSTGRES_URL: scopedPooled,
        DATABASE_URL_UNPOOLED: scopedDirect,
        PROTOTYPE_INSTALLATION_ID: installationId,
      });
      expect(secondMigration).toEqual({ applied: [], skipped: [1, 2, 3, 4, 5, 6, 7, 8] });
      await expect(resetPrototypeDatabase({ environment: resetEnvironment })).resolves.toEqual(
        expect.objectContaining({ resetVersion: 2 })
      );

      const verificationClient = new Client({ connectionString: scopedPooled });
      await verificationClient.connect();
      try {
        const counts = await verificationClient.query(`
          SELECT
            (SELECT COUNT(*)::int FROM app_user) AS users,
            (SELECT COUNT(*)::int FROM assignments) AS assignments,
            (SELECT COUNT(*)::int FROM assignment_submissions) AS submissions,
            (SELECT COUNT(*)::int FROM assignment_answers) AS answers,
            (SELECT COUNT(*)::int FROM acs_grading_results) AS grading_results
        `);
        expect(counts.rows[0]).toEqual({
          users: 22,
          assignments: 6,
          submissions: 54,
          answers: 108,
          grading_results: 108,
        });
        const roles = await verificationClient.query(
          `SELECT id, name FROM enumeration WHERE category = 'ROLE' ORDER BY id`
        );
        expect(roles.rows).toEqual([
          { id: 1, name: 'STUDENT' },
          { id: 2, name: 'TEACHER' },
          { id: 3, name: 'ADMIN' },
        ]);
        const extension = await verificationClient.query(
          `SELECT extversion FROM pg_extension WHERE extname = 'vector'`
        );
        expect(extension.rowCount).toBe(1);
        const evidence = await verificationClient.query(`
          SELECT matched_chunks->'per_question_scores'->0 AS score
          FROM pds_comparisons
          ORDER BY id
          LIMIT 1
        `);
        expect(evidence.rows[0].score).toEqual(expect.objectContaining({
          question_index: 0,
          semantic_score: expect.any(Number),
          lexical_score: expect.any(Number),
          combined_score: expect.any(Number),
        }));
        expect(Object.values(evidence.rows[0].score).every(Number.isFinite)).toBe(true);
      } finally {
        await verificationClient.end();
      }
    } finally {
      await administrationClient.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      try {
        const preservedExtensions = await administrationClient.query(`
          SELECT extname, namespace.nspname
          FROM pg_extension extension
          JOIN pg_namespace namespace ON namespace.oid = extension.extnamespace
          WHERE extname IN ('pgcrypto', 'vector')
          ORDER BY extname
        `);
        expect(preservedExtensions.rows).toEqual([
          { extname: 'pgcrypto', nspname: 'public' },
          { extname: 'vector', nspname: 'public' },
        ]);
      } finally {
        await administrationClient.end();
      }
    }
  });
});
