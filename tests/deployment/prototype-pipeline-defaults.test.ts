const os = require('node:os');

const {
  createReadinessManifest,
  verifyReadinessManifest,
  fileDigest,
} = require('../../scripts/prototype/readiness.cjs');
const { validateDeploymentEnvironment } = require('../../scripts/prototype/local-env.cjs');
const { createNeonBackupBranch, readNeonBackupBranch } = require('../../scripts/prototype/neon-backup.cjs');
const { upsertVercelProductionEnvironment } = require('../../scripts/prototype/vercel-production-env.cjs');
const { signIn, productionSmokeTest } = require('../../scripts/prototype/smoke.cjs');
const {
  repositoryState,
  createPreparationAdapters,
  createDeploymentAdapters,
} = require('../../scripts/prototype/runtime.cjs');

const hmacEnvironment = { READINESS_HMAC_KEY: 'e'.repeat(32) };

const releaseEnvironment = (): Record<string, string> => ({
  PROTOTYPE_MODE: 'true',
  NEXT_PUBLIC_PROTOTYPE_MODE: 'true',
  PROTOTYPE_INSTALLATION_ID: '11111111-1111-4111-8111-111111111111',
  DATABASE_URL: 'postgresql://role:secret@ep-demo-pooler.region.aws.neon.tech/database',
  AUX_POSTGRES_URL: 'postgresql://role:secret@ep-demo-pooler.region.aws.neon.tech/database',
  DATABASE_URL_UNPOOLED: 'postgresql://role:secret@ep-demo.region.aws.neon.tech/database',
  NEXTAUTH_SECRET: 'nextauth-secret-for-tests-0123456789',
  NEXTAUTH_URL: 'https://prototype.vercel.app',
  CREDENTIAL_ENCRYPTION_SECRET: 'credential-secret-for-tests-0123456789',
  CRON_SECRET: 'cron-secret-for-tests-0123456789',
  DEMO_SHARED_PASSWORD: 'shared-password-for-tests',
});

describe('release pipeline default adapters and absent values', () => {
  test('validates a completely empty deployment environment without throwing', () => {
    const result = validateDeploymentEnvironment({});
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      'NEXTAUTH_SECRET must contain at least 32 bytes',
      'Missing local release variable: NEON_API_KEY',
    ]));
    expect(result.errors).not.toContain('NEXTAUTH_URL still contains a placeholder');
  });

  test('canonicalizes array manifest fields and detects their drift', () => {
    const input = { gitHead: 'head', backups: [{ branchId: 'br_one' }, { branchId: 'br_two' }] };
    const manifest = createReadinessManifest(input, hmacEnvironment);
    expect(verifyReadinessManifest(manifest, input, hmacEnvironment)).toEqual({ valid: true, errors: [] });
    expect(verifyReadinessManifest(manifest, { ...input, backups: [] }, hmacEnvironment).errors)
      .toContain('Readiness manifest Neon backups have drifted');
  });

  test('rejects manifests whose signature is absent, truncated, or forged', () => {
    const input = { gitHead: 'head' };
    const manifest = createReadinessManifest(input, hmacEnvironment);

    const { signature, ...unsigned } = manifest;
    expect(verifyReadinessManifest(unsigned, input, hmacEnvironment).errors)
      .toContain('Readiness manifest signature is invalid');
    expect(verifyReadinessManifest({ ...manifest, signature: 'short' }, input, hmacEnvironment).errors)
      .toContain('Readiness manifest signature is invalid');
    expect(verifyReadinessManifest({ ...manifest, signature: 'f'.repeat(signature.length) }, input, hmacEnvironment).errors)
      .toContain('Readiness manifest signature is invalid');
    expect(verifyReadinessManifest({ ...manifest, version: 2, mode: 'production' }, input, hmacEnvironment).errors)
      .toEqual(expect.arrayContaining([
        'Readiness manifest version is unsupported',
        'Readiness manifest mode must be prototype',
      ]));
  });

  test('digests a file through its default filesystem reader', () => {
    expect(fileDigest('package-lock.json')).toMatch(/^[a-f0-9]{64}$/);
  });

  test('falls back to the requested parent branch when Neon omits it', async () => {
    await expect(createNeonBackupBranch({
      environment: { NEON_API_KEY: 'key', NEON_PROJECT_ID: 'project', NEON_PRODUCTION_BRANCH_ID: 'br_parent' },
      request: async () => ({
        ok: true,
        json: async () => ({ branch: { id: 'br_backup' }, endpoints: [{ id: 'ep_backup', type: 'read_write' }] }),
      }),
    })).resolves.toEqual({
      branchId: 'br_backup',
      parentBranchId: 'br_parent',
      endpointId: 'ep_backup',
      endpointType: 'read_write',
    });
  });

  test('reports an unsuccessful Neon backup response', async () => {
    await expect(createNeonBackupBranch({
      environment: { NEON_API_KEY: 'key', NEON_PROJECT_ID: 'project', NEON_PRODUCTION_BRANCH_ID: 'br_parent' },
      request: async () => ({ ok: false }),
    })).rejects.toThrow('Neon pre-release backup creation failed');
  });

  test('reads Neon credentials from the process environment by default', async () => {
    const originalEnvironment = process.env;
    process.env = { ...originalEnvironment };
    delete process.env.NEON_API_KEY;
    try {
      await expect(createNeonBackupBranch()).rejects.toThrow('NEON_API_KEY');
      await expect(readNeonBackupBranch()).rejects.toThrow('NEON_API_KEY');
    } finally {
      process.env = originalEnvironment;
    }
  });

  test('treats a manifest without an environment HMAC as drifted', () => {
    expect(verifyReadinessManifest({}, {}, hmacEnvironment).errors)
      .toContain('Readiness manifest environment has drifted');
  });

  test('reads the release environment and project link from the process by default', () => {
    const originalEnvironment = process.env;
    process.env = { ...originalEnvironment, ...releaseEnvironment() };
    // Redirect the working directory away from this repository. A valid process
    // environment gets past local validation, so the default filesystem reader
    // runs next and must find no project link — otherwise the default spawner
    // would push these fixture values to the real Vercel project.
    const cwd = jest.spyOn(process, 'cwd').mockReturnValue(os.tmpdir());
    try {
      expect(() => upsertVercelProductionEnvironment()).toThrow(/project\.json|link command/);
    } finally {
      cwd.mockRestore();
      process.env = originalEnvironment;
    }
  });

  test('falls back to the global fetch implementation for smoke requests', async () => {
    const originalFetch = global.fetch;
    global.fetch = jest.fn(async () => ({ ok: false })) as unknown as typeof global.fetch;
    try {
      await expect(signIn('https://prototype.test', 'demo_teacher', 'x')).resolves.toBe(false);
      await expect(productionSmokeTest({ url: 'prototype.test' }, { CRON_SECRET: 'cron-for-tests', DEMO_SHARED_PASSWORD: 'password-for-tests' }))
        .resolves.toEqual({ healthy: false, error: 'Production login page is unavailable' });
    } finally {
      global.fetch = originalFetch;
    }
  });

  test('inspects the repository through the real Git adapter by default', () => {
    const cwd = jest.spyOn(process, 'cwd').mockReturnValue(os.tmpdir());
    try {
      expect(() => repositoryState()).toThrow('Git readiness check failed: status');
    } finally {
      cwd.mockRestore();
    }
  });

  test('builds preparation adapters on the default runner and console logger', async () => {
    const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      const adapters = createPreparationAdapters({});
      await expect(adapters.runStep({ id: 'validate-environment' }))
        .rejects.toThrow('Deployment environment validation failed');
      expect(log).toHaveBeenCalledWith('[prepare:prototype] validate-environment');
    } finally {
      log.mockRestore();
    }
  });

  test('builds deployment adapters on the pinned CLI and global fetch by default', () => {
    const adapters = createDeploymentAdapters({ NEXTAUTH_URL: 'https://prototype.vercel.app' });
    expect(typeof adapters.deployProduction).toBe('function');
    expect(typeof adapters.smokeTest).toBe('function');
  });
});

export {};
