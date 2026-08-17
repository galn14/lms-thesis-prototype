type RunResult = { status: number | null; stdout?: string; error?: Error };
type SpawnRun = (command: string, args: string[], options?: Record<string, unknown>) => RunResult;

const HEAD = 'abc123def456abc123def456abc123def456abcd';
const INSTALLATION_ID = '11111111-1111-4111-8111-111111111111';

const releaseEnvironment = (): Record<string, string> => ({
  PROTOTYPE_MODE: 'true',
  NEXT_PUBLIC_PROTOTYPE_MODE: 'true',
  PROTOTYPE_INSTALLATION_ID: INSTALLATION_ID,
  DATABASE_URL: 'postgresql://role:secret@ep-demo-pooler.region.aws.neon.tech/database',
  AUX_POSTGRES_URL: 'postgresql://role:secret@ep-demo-pooler.region.aws.neon.tech/database',
  DATABASE_URL_UNPOOLED: 'postgresql://role:secret@ep-demo.region.aws.neon.tech/database',
  NEXTAUTH_SECRET: 'nextauth-secret-for-tests-0123456789',
  NEXTAUTH_URL: 'https://prototype.vercel.app',
  CREDENTIAL_ENCRYPTION_SECRET: 'credential-secret-for-tests-0123456789',
  CRON_SECRET: 'cron-secret-for-tests-0123456789',
  DEMO_SHARED_PASSWORD: 'shared-password-for-tests',
  READINESS_HMAC_KEY: 'readiness-hmac-for-tests-0123456789',
  NEON_API_KEY: 'neon-api-key',
  NEON_PROJECT_ID: 'neon-project',
  NEON_PRODUCTION_BRANCH_ID: 'br_production',
});

const GIT_TABLE: Record<string, string> = {
  'status --porcelain': '',
  'log --format=%h %s': 'abc chore: configure Neon and Vercel deployment\n',
  'remote get-url origin': 'https://github.com/example/lms-thesis-prototype.git',
  'rev-parse HEAD': HEAD,
  'ls-remote origin refs/heads/main': `${HEAD}\trefs/heads/main`,
  'log origin/main --format=%h %s': 'abc chore: configure Neon and Vercel deployment\n',
  'ls-tree -r --full-tree HEAD': '100644 blob deadbeef\tapp/page.tsx\n',
};

const gitRunner = (): jest.Mock => jest.fn((command: string, args: string[]) =>
  command === 'git' ? { status: 0, stdout: GIT_TABLE[args.join(' ')] ?? '' } : { status: 0, stdout: '' });

describe('prototype release runtime adapters', () => {
  const backup = { branchId: 'br_backup', endpointId: 'ep_backup', endpointType: 'read_write' };

  let files: Record<string, string>;
  let writeFileSync: jest.Mock;
  let chmodSync: jest.Mock;
  let queryRows: Array<Record<string, unknown>>;
  let connectError: Error | null;
  let clientEnd: jest.Mock;
  let clientConfig: Record<string, unknown>;
  let createNeonBackupBranch: jest.Mock;
  let readNeonBackupBranch: jest.Mock;
  let productionSmokeTest: jest.Mock;
  let upsertVercelProductionEnvironment: jest.Mock;
  let listVercelProductionMetadata: jest.Mock;

  const loadRuntime = () => require('../../scripts/prototype/runtime.cjs');

  beforeEach(() => {
    jest.resetModules();
    files = {
      'package-lock.json': '{"lockfileVersion":3}',
      '.vercel/project.json': '{"orgId":"org_1","projectId":"prj_1"}',
    };
    writeFileSync = jest.fn();
    chmodSync = jest.fn();
    queryRows = [{ installation_id: INSTALLATION_ID, schema_version: '4' }];
    connectError = null;
    clientEnd = jest.fn(async () => undefined);
    clientConfig = {};
    createNeonBackupBranch = jest.fn(async () => backup);
    readNeonBackupBranch = jest.fn(async () => ({ branchId: backup.branchId }));
    productionSmokeTest = jest.fn(async () => ({ healthy: true }));
    upsertVercelProductionEnvironment = jest.fn();
    listVercelProductionMetadata = jest.fn();

    jest.doMock('node:fs', () => ({
      readFileSync: (file: string) => {
        const key = Object.keys(files).find((name) => String(file).endsWith(name));
        if (!key) throw new Error(`ENOENT: ${file}`);
        return files[key];
      },
      writeFileSync,
      chmodSync,
    }));
    jest.doMock('pg', () => ({
      Client: class {
        constructor(config: Record<string, unknown>) { clientConfig = config; }
        async connect() { if (connectError) throw connectError; }
        async query() { return { rows: queryRows }; }
        end = clientEnd;
      },
    }));
    jest.doMock('../../scripts/prototype/neon-backup.cjs', () => ({ createNeonBackupBranch, readNeonBackupBranch }));
    jest.doMock('../../scripts/prototype/smoke.cjs', () => ({ productionSmokeTest }));
    jest.doMock('../../scripts/prototype/vercel-production-env.cjs', () => ({
      upsertVercelProductionEnvironment,
      listVercelProductionMetadata,
      resolveVercelCli: () => '/repo/node_modules/vercel/dist/index.js',
      vercelProcessEnvironment: (environment: Record<string, string>) => ({ PATH: environment.PATH ?? '/bin' }),
    }));
  });

  afterEach(() => {
    jest.dontMock('node:fs');
    jest.dontMock('pg');
    jest.dontMock('../../scripts/prototype/neon-backup.cjs');
    jest.dontMock('../../scripts/prototype/smoke.cjs');
    jest.dontMock('../../scripts/prototype/vercel-production-env.cjs');
  });

  describe('repository and project inspection', () => {
    test('digests the deployable tree and dependency lock from a pushed clean worktree', () => {
      const { repositoryState } = loadRuntime();
      expect(repositoryState(gitRunner())).toEqual({
        gitHead: HEAD,
        deployableTreeDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
        lockDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
      });
    });

    test('fails closed on Git inspection errors and nonzero exits', () => {
      const { repositoryState } = loadRuntime();
      const failing = (command: string, args: string[]) => args[0] === 'ls-tree'
        ? { status: 1, stdout: '' }
        : { status: 0, stdout: GIT_TABLE[args.join(' ')] ?? '' };
      expect(() => repositoryState(failing as SpawnRun)).toThrow('Unable to inspect Git release state');

      const spawnFailure = (command: string, args: string[]) => args[0] === 'ls-tree'
        ? { status: 0, stdout: '', error: new Error('spawn git failed') }
        : { status: 0, stdout: GIT_TABLE[args.join(' ')] ?? '' };
      expect(() => repositoryState(spawnFailure as SpawnRun)).toThrow('spawn git failed');
    });

    test('requires a complete Vercel project link', () => {
      const { linkedVercelProject } = loadRuntime();
      expect(linkedVercelProject()).toEqual({ orgId: 'org_1', projectId: 'prj_1' });

      files['.vercel/project.json'] = '{"orgId":"org_1"}';
      expect(() => linkedVercelProject()).toThrow('The Vercel project link is incomplete');

      delete files['.vercel/project.json'];
      expect(() => linkedVercelProject()).toThrow('The local repository is not linked to a Vercel project');
    });
  });

  describe('database marker', () => {
    test('returns the marker and always closes the connection', async () => {
      const { databaseMarker } = loadRuntime();
      const environment = releaseEnvironment();
      await expect(databaseMarker(environment)).resolves.toEqual({
        installationId: INSTALLATION_ID,
        schemaVersion: 4,
      });
      expect(clientConfig).toEqual({
        connectionString: environment.DATABASE_URL,
        ssl: { rejectUnauthorized: false },
      });
      expect(clientEnd).toHaveBeenCalledTimes(1);
    });

    test('rejects a missing marker, a drifted installation, and an unreachable database', async () => {
      const { databaseMarker } = loadRuntime();
      queryRows = [];
      await expect(databaseMarker(releaseEnvironment())).rejects.toThrow('Prototype database marker is missing');
      expect(clientEnd).toHaveBeenCalledTimes(1);

      queryRows = [{ installation_id: '22222222-2222-4222-8222-222222222222', schema_version: '4' }];
      await expect(databaseMarker(releaseEnvironment())).rejects.toThrow('installation marker has drifted');
      expect(clientEnd).toHaveBeenCalledTimes(2);

      connectError = new Error('connection refused');
      await expect(databaseMarker(releaseEnvironment())).rejects.toThrow('connection refused');
      expect(clientEnd).toHaveBeenCalledTimes(2);
    });
  });

  describe('preparation adapters', () => {
    const adaptersFor = (run: jest.Mock, logger = { log: jest.fn(), error: jest.fn() }) => {
      const { createPreparationAdapters } = loadRuntime();
      return { adapters: createPreparationAdapters(releaseEnvironment(), { run, logger }), logger };
    };

    test('runs the repository, environment, and Vercel metadata steps without shelling out', async () => {
      const run = gitRunner();
      const { adapters, logger } = adaptersFor(run);

      await adapters.runStep({ id: 'assert-repository' });
      await adapters.runStep({ id: 'validate-environment' });
      await adapters.runStep({ id: 'validate-vercel-production' });

      expect(listVercelProductionMetadata).toHaveBeenCalledWith({ environment: expect.any(Object), run });
      expect(logger.log).toHaveBeenCalledWith('[prepare:prototype] assert-repository');
      expect(run).not.toHaveBeenCalledWith('npm', expect.anything(), expect.anything());
    });

    test('reports every deployment environment error at once', async () => {
      const { createPreparationAdapters } = loadRuntime();
      const adapters = createPreparationAdapters(
        { ...releaseEnvironment(), NEON_API_KEY: '', NEXTAUTH_URL: 'https://replace-me.vercel.app' },
        { run: gitRunner(), logger: { log: jest.fn(), error: jest.fn() } },
      );
      await expect(adapters.runStep({ id: 'validate-environment' })).rejects.toThrow(
        /Deployment environment validation failed:[\s\S]*NEXTAUTH_URL still contains a placeholder[\s\S]*NEON_API_KEY/
      );
    });

    test('shells out with the release environment and flags the integration step', async () => {
      const run = gitRunner();
      const { adapters } = adaptersFor(run);

      await adapters.runStep({ id: 'lint' });
      expect(run).toHaveBeenCalledWith('npm', ['run', 'lint'], expect.objectContaining({
        stdio: 'inherit', env: expect.objectContaining({ PROTOTYPE_MODE: 'true' }),
      }));

      await adapters.runStep({ id: 'database-integration' });
      const integration = run.mock.calls.find(([, args]) => args.includes('tests/integration/prototype-database.integration.test.ts'));
      expect((integration![2] as { env: Record<string, string> }).env.RUN_PROTOTYPE_DB_INTEGRATION).toBe('true');
    });

    test('fails closed on unknown steps, nonzero exits, and spawn errors', async () => {
      const { adapters } = adaptersFor(gitRunner());
      await expect(adapters.runStep({ id: 'unknown-step' })).rejects.toThrow('Unknown preparation step: unknown-step');

      const failing = jest.fn(() => ({ status: 3 }));
      const { adapters: failingAdapters } = adaptersFor(failing as unknown as jest.Mock);
      await expect(failingAdapters.runStep({ id: 'build' })).rejects.toThrow('Prototype build failed (exit 3)');

      const unknownExit = jest.fn(() => ({ status: null }));
      const { adapters: unknownAdapters } = adaptersFor(unknownExit as unknown as jest.Mock);
      await expect(unknownAdapters.runStep({ id: 'build' })).rejects.toThrow('Prototype build failed (exit unknown)');

      const spawnError = jest.fn(() => ({ status: null, error: new Error('spawn npm failed') }));
      const { adapters: spawnAdapters } = adaptersFor(spawnError as unknown as jest.Mock);
      await expect(spawnAdapters.runStep({ id: 'build' })).rejects.toThrow('spawn npm failed');
    });

    test('delegates the Vercel sync, Neon backup, and database verification', async () => {
      const run = gitRunner();
      const { adapters } = adaptersFor(run);

      await adapters.syncVercelEnvironment();
      expect(upsertVercelProductionEnvironment).toHaveBeenCalledWith({ environment: expect.any(Object), run });
      await expect(adapters.createBackup()).resolves.toEqual(backup);
      await expect(adapters.verifyDatabase()).resolves.toEqual({ installationId: INSTALLATION_ID, schemaVersion: 4 });
    });

    test('writes an owner-only manifest that never contains a secret value', async () => {
      const run = gitRunner();
      const { adapters } = adaptersFor(run);
      const database = { installationId: INSTALLATION_ID, schemaVersion: 4 };

      await adapters.runStep({ id: 'assert-repository' });
      await adapters.writeManifest({ backup, database });

      const [file, contents, options] = writeFileSync.mock.calls[0];
      expect(String(file)).toContain('.prototype-readiness.json');
      expect(options).toEqual({ mode: 0o600 });
      expect(chmodSync).toHaveBeenCalledWith(file, 0o600);

      const manifest = JSON.parse(contents as string);
      expect(manifest).toMatchObject({
        version: 1, mode: 'prototype', gitHead: HEAD,
        vercel: { orgId: 'org_1', projectId: 'prj_1' }, database, backup,
      });
      expect(manifest.environmentHmac).toMatch(/^[a-f0-9]{64}$/);
      for (const secret of ['shared-password-for-tests', 'c'.repeat(32), 'd'.repeat(32)]) {
        expect(contents as string).not.toContain(secret);
      }
    });

    test('re-inspects the repository when the manifest is written without a prior assertion', async () => {
      const run = gitRunner();
      const { adapters } = adaptersFor(run);
      await adapters.writeManifest({ backup, database: { installationId: INSTALLATION_ID, schemaVersion: 4 } });
      expect(JSON.parse(writeFileSync.mock.calls[0][1] as string).gitHead).toBe(HEAD);
    });
  });

  describe('deployment adapters', () => {
    const validManifest = (overrides: Record<string, unknown> = {}) => {
      const { createPreparationAdapters } = loadRuntime();
      const adapters = createPreparationAdapters(releaseEnvironment(), {
        run: gitRunner(), logger: { log: jest.fn(), error: jest.fn() },
      });
      return adapters.writeManifest({ backup, database: { installationId: INSTALLATION_ID, schemaVersion: 4 } })
        .then(() => {
          const manifest = { ...JSON.parse(writeFileSync.mock.calls[0][1] as string), ...overrides };
          files[".prototype-readiness.json"] = JSON.stringify(manifest);
          return manifest;
        });
    };

    const deploymentAdapters = (run: jest.Mock) => {
      const { createDeploymentAdapters } = loadRuntime();
      return createDeploymentAdapters(releaseEnvironment(), { run, request: jest.fn() });
    };

    test('accepts a manifest that still matches the repository, database, and backup', async () => {
      await validManifest();
      const adapters = deploymentAdapters(gitRunner());
      await expect(adapters.verifyReadiness()).resolves.toBeUndefined();
      expect(readNeonBackupBranch).toHaveBeenCalledWith(expect.objectContaining({ branchId: 'br_backup' }));
    });

    test('refuses to deploy when the manifest has drifted', async () => {
      await validManifest({ gitHead: 'a'.repeat(40) });
      const adapters = deploymentAdapters(gitRunner());
      await expect(adapters.verifyReadiness()).rejects.toThrow(
        /Prototype is not deployment-ready:[\s\S]*Git HEAD has drifted/
      );
    });

    test('reads the current production deployment and tolerates its absence', async () => {
      const missing = jest.fn(() => ({ status: 1, stdout: '' }));
      await expect(deploymentAdapters(missing as unknown as jest.Mock).currentProduction()).resolves.toBeNull();

      const present = jest.fn(() => ({ status: 0, stdout: '{"id":"dpl_previous"}' }));
      await expect(deploymentAdapters(present as unknown as jest.Mock).currentProduction()).resolves.toBe('dpl_previous');
      expect(present).toHaveBeenCalledWith(
        process.execPath,
        ['/repo/node_modules/vercel/dist/index.js', 'inspect', 'https://prototype.vercel.app', '--json'],
        expect.objectContaining({ stdio: 'pipe', env: { PATH: expect.any(String) } }),
      );

      const idless = jest.fn(() => ({ status: 0, stdout: '{}' }));
      await expect(deploymentAdapters(idless as unknown as jest.Mock).currentProduction()).resolves.toBeNull();
    });

    test('deploys to production and fails closed on unusable CLI output', async () => {
      // The deploy payload carries no hostname, so the adapter reports the
      // NEXTAUTH_URL production alias for the smoke test to target.
      const deployed = jest.fn(() => ({ status: 0, stdout: '{"id":"dpl_new"}' }));
      await expect(deploymentAdapters(deployed as unknown as jest.Mock).deployProduction())
        .resolves.toEqual({ id: 'dpl_new', url: 'https://prototype.vercel.app' });
      expect(deployed).toHaveBeenCalledWith(
        process.execPath,
        ['/repo/node_modules/vercel/dist/index.js', 'deploy', '--prod', '--yes', '--json'],
        expect.objectContaining({ stdio: 'pipe' }),
      );

      // A payload without an identifier falls back to inspecting the alias.
      const idless = jest.fn((_command: string, args: string[]) => args.includes('inspect')
        ? ({ status: 0, stdout: '{"id":"dpl_inspected"}' })
        : ({ status: 0, stdout: '{}' }));
      await expect(deploymentAdapters(idless as unknown as jest.Mock).deployProduction())
        .resolves.toEqual({ id: 'dpl_inspected', url: 'https://prototype.vercel.app' });

      const unresolvable = jest.fn((_command: string, args: string[]) => args.includes('inspect')
        ? ({ status: 1, stdout: '' })
        : ({ status: 0, stdout: '{"uid":"dpl_uid"}' }));
      await expect(deploymentAdapters(unresolvable as unknown as jest.Mock).deployProduction())
        .resolves.toEqual({ id: 'dpl_uid', url: 'https://prototype.vercel.app' });

      const invalid = jest.fn(() => ({ status: 0, stdout: 'not-json' }));
      await expect(deploymentAdapters(invalid as unknown as jest.Mock).deployProduction())
        .rejects.toThrow('Vercel Production deployment returned invalid metadata');

      const failed = jest.fn(() => ({ status: 1, stdout: '' }));
      await expect(deploymentAdapters(failed as unknown as jest.Mock).deployProduction())
        .rejects.toThrow('Vercel Production deployment failed');

      const crashed = jest.fn(() => ({ status: null, error: new Error('spawn vercel failed') }));
      await expect(deploymentAdapters(crashed as unknown as jest.Mock).deployProduction())
        .rejects.toThrow('spawn vercel failed');
    });

    test('runs the smoke test against the new deployment', async () => {
      const adapters = deploymentAdapters(gitRunner());
      await expect(adapters.smokeTest({ url: 'prototype.vercel.app' })).resolves.toEqual({ healthy: true });
      expect(productionSmokeTest).toHaveBeenCalledWith(
        { url: 'prototype.vercel.app' }, expect.objectContaining({ PROTOTYPE_MODE: 'true' }), expect.any(Function),
      );
    });

    test('allows an alias rollback only while the schema version is unchanged', async () => {
      await validManifest();
      const adapters = deploymentAdapters(gitRunner());
      await adapters.verifyReadiness();

      await expect(adapters.migrationsCompatible()).resolves.toBe(true);
      queryRows = [{ installation_id: INSTALLATION_ID, schema_version: '5' }];
      await expect(adapters.migrationsCompatible()).resolves.toBe(false);
    });

    test('promotes a previous deployment and fails closed when the promotion fails', async () => {
      const promoted = jest.fn(() => ({ status: 0 }));
      await expect(deploymentAdapters(promoted as unknown as jest.Mock).promoteDeployment('dpl_previous'))
        .resolves.toBeUndefined();
      expect(promoted).toHaveBeenCalledWith(
        process.execPath,
        ['/repo/node_modules/vercel/dist/index.js', 'promote', 'dpl_previous', '--yes'],
        expect.objectContaining({ stdio: 'inherit' }),
      );

      const rejected = jest.fn(() => ({ status: 1 }));
      await expect(deploymentAdapters(rejected as unknown as jest.Mock).promoteDeployment('dpl_previous'))
        .rejects.toThrow('Prototype alias rollback failed (exit 1)');
    });
  });
});

export {};
