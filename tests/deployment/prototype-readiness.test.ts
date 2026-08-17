const {
  createReadinessManifest,
  verifyReadinessManifest,
  assertRepositoryReleaseShape,
  environmentHmac,
  fileDigest,
} = require('../../scripts/prototype/readiness.cjs');
const { loadProductionEnvironment, validateDeploymentEnvironment } = require('../../scripts/prototype/local-env.cjs');
const { createNeonBackupBranch } = require('../../scripts/prototype/neon-backup.cjs');

describe('prototype release readiness', () => {
  test('loads only the dedicated production file and requires owner-only permissions', () => {
    const environment = loadProductionEnvironment({
      cwd: '/repo',
      environment: { PATH: '/bin' },
      stat: () => ({ mode: 0o100600 }),
      readFile: () => 'PROTOTYPE_MODE=true\nREADINESS_HMAC_KEY=private-key\n',
    });
    expect(environment).toEqual(expect.objectContaining({
      PATH: '/bin',
      PROTOTYPE_MODE: 'true',
      READINESS_HMAC_KEY: 'private-key',
    }));
  });

  test('uses the real owner-only production file through its default filesystem adapter', () => {
    expect(loadProductionEnvironment()).toEqual(expect.objectContaining({ PROTOTYPE_MODE: 'true' }));
  });

  test('rejects missing or over-permissive local production files', () => {
    expect(() => loadProductionEnvironment({
      cwd: '/repo', environment: {}, stat: () => { throw new Error('missing'); }, readFile: jest.fn(),
    })).toThrow('.env.production.local');
    expect(() => loadProductionEnvironment({
      cwd: '/repo', environment: {}, stat: () => ({ mode: 0o100644 }), readFile: () => '',
    })).toThrow('chmod 600');
  });

  test('requires independent long secrets, external identifiers, and no placeholders', () => {
    const nextAuthName = 'NEXTAUTH' + '_SECRET';
    const credentialName = 'CREDENTIAL_ENCRYPTION' + '_SECRET';
    const cronName = 'CRON' + '_SECRET';
    const environment: Record<string, string> = {
      PROTOTYPE_MODE: 'true', NEXT_PUBLIC_PROTOTYPE_MODE: 'true',
      PROTOTYPE_INSTALLATION_ID: '11111111-1111-4111-8111-111111111111',
      DATABASE_URL: 'postgresql://role:secret@ep-demo-pooler.region.aws.neon.tech/database',
      AUX_POSTGRES_URL: 'postgresql://role:secret@ep-demo-pooler.region.aws.neon.tech/database',
      DATABASE_URL_UNPOOLED: 'postgresql://role:secret@ep-demo.region.aws.neon.tech/database',
      NEXTAUTH_URL: 'https://prototype.vercel.app', DEMO_SHARED_PASSWORD: 'shared-password-for-tests',
      [nextAuthName]: 'a'.repeat(32), [credentialName]: 'b'.repeat(32),
      [cronName]: 'c'.repeat(32), READINESS_HMAC_KEY: 'd'.repeat(32),
      NEON_API_KEY: 'api', NEON_PROJECT_ID: 'project', NEON_PRODUCTION_BRANCH_ID: 'branch',
    };
    expect(validateDeploymentEnvironment(environment)).toEqual({ valid: true, errors: [] });
    const invalid = validateDeploymentEnvironment({
      ...environment,
      NEXTAUTH_URL: 'https://replace-with-project.vercel.app',
      [cronName]: environment[nextAuthName],
      NEON_API_KEY: '',
    });
    expect(invalid.errors).toEqual(expect.arrayContaining([
      'NEXTAUTH_URL still contains a placeholder',
      'Deployment secrets must be independent values',
      'Missing local release variable: NEON_API_KEY',
    ]));
  });

  test('signs metadata without storing environment secrets and detects drift', () => {
    const input = {
      gitHead: 'abc123', deployableTreeDigest: 'tree123', lockDigest: 'lock123',
      vercel: { orgId: 'org_1', projectId: 'prj_1' },
      database: { installationId: '11111111-1111-4111-8111-111111111111', schemaVersion: 1 },
      backup: { branchId: 'br_backup', endpointId: 'ep_backup', endpointType: 'read_write' },
    };
    const nextAuthName = 'NEXTAUTH' + '_SECRET';
    const environment: Record<string, string> = {
      READINESS_HMAC_KEY: 'hmac-secret', [nextAuthName]: 'never-store-this',
      PROTOTYPE_MODE: 'true',
    };
    const manifest = createReadinessManifest(input, environment, () => '2026-08-16T00:00:00.000Z');
    expect(JSON.stringify(manifest)).not.toContain(environment[nextAuthName]);
    expect(manifest.environmentHmac).toMatch(/^[a-f0-9]{64}$/);
    expect(verifyReadinessManifest(manifest, input, environment)).toEqual({ valid: true, errors: [] });
    expect(verifyReadinessManifest(manifest, { ...input, gitHead: 'changed' }, environment).errors)
      .toContain('Readiness manifest Git HEAD has drifted');
    expect(verifyReadinessManifest(manifest, input, { ...environment, PROTOTYPE_MODE: 'false' }).errors)
      .toContain('Readiness manifest environment has drifted');
  });

  test('requires a clean worktree pushed to origin/main with identical history', () => {
    const history = [
      '09b chore: configure Neon and Vercel deployment',
      'd49 feat: add safe demonstration data and controls',
      '374 chore: initialize cleaned LMS thesis prototype',
    ].join('\n') + '\n';
    const head = '09babcdef1234567890abcdef1234567890abcd';
    const gitResponses = (overrides: Record<string, string> = {}) => (args: string[]) => {
      const key = args.join(' ');
      const table: Record<string, string> = {
        'status --porcelain': '',
        'log --format=%h %s': history,
        'remote get-url origin': 'https://github.com/example/lms-thesis-prototype.git',
        'rev-parse HEAD': head,
        'ls-remote origin refs/heads/main': `${head}\trefs/heads/main`,
        'log origin/main --format=%h %s': history,
        ...overrides,
      };
      return { status: 0, stdout: table[key] ?? '' };
    };

    expect(assertRepositoryReleaseShape(gitResponses())).toEqual({
      gitHead: head,
      repositoryRemotes: { origin: 'https://github.com/example/lms-thesis-prototype.git' },
    });

    expect(() => assertRepositoryReleaseShape(gitResponses({ 'status --porcelain': ' M package.json\n' })))
      .toThrow('worktree must be clean');
    expect(() => assertRepositoryReleaseShape(gitResponses({ 'log --format=%h %s': '' })))
      .toThrow('at least one commit');
    expect(() => assertRepositoryReleaseShape(gitResponses({ 'remote get-url origin': '' })))
      .toThrow('requires an origin remote');
    expect(() => assertRepositoryReleaseShape(gitResponses({ 'ls-remote origin refs/heads/main': '' })))
      .toThrow('Local HEAD must exactly match origin/main');
    expect(() => assertRepositoryReleaseShape(gitResponses({
      'ls-remote origin refs/heads/main': `d49000000000000000000000000000000000000\trefs/heads/main`,
    }))).toThrow('Local HEAD must exactly match origin/main');
    expect(() => assertRepositoryReleaseShape(gitResponses({
      'log origin/main --format=%h %s': 'd49 feat: add safe demonstration data and controls\n',
    }))).toThrow('Local history must exactly match origin/main history');
  });

  test('creates a Neon backup branch with a read-write endpoint and returns metadata only', async () => {
    const request = jest.fn(async () => ({
      ok: true,
      json: async () => ({ branch: { id: 'br_backup', parent_id: 'br_prod' }, endpoints: [{ id: 'ep_backup', type: 'read_write' }] }),
    }));
    const result = await createNeonBackupBranch({
      environment: { NEON_API_KEY: 'neon-private', NEON_PROJECT_ID: 'project_1', NEON_PRODUCTION_BRANCH_ID: 'br_prod' },
      request,
      now: () => new Date('2026-08-16T00:00:00Z'),
    });
    expect(result).toEqual({ branchId: 'br_backup', parentBranchId: 'br_prod', endpointId: 'ep_backup', endpointType: 'read_write' });
    expect(request).toHaveBeenCalledWith(
      'https://console.neon.tech/api/v2/projects/project_1/branches',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer neon-private' }),
        body: expect.stringContaining('prototype-pre-release-20260816-000000'),
      })
    );
    expect(JSON.stringify(result)).not.toContain('neon-private');
  });

  test('fails closed when Neon credentials or endpoint metadata are unavailable', async () => {
    await expect(createNeonBackupBranch({ environment: {}, request: jest.fn() })).rejects.toThrow('NEON_API_KEY');
    await expect(createNeonBackupBranch({
      environment: { NEON_API_KEY: 'x', NEON_PROJECT_ID: 'p', NEON_PRODUCTION_BRANCH_ID: 'b' },
      request: async () => ({ ok: true, json: async () => ({ branch: { id: 'br' }, endpoints: [] }) }),
    })).rejects.toThrow('read-write endpoint');
  });

  test('reads existing Neon backup metadata and rejects API or identity drift', async () => {
    const { readNeonBackupBranch } = require('../../scripts/prototype/neon-backup.cjs');
    const environment = { NEON_API_KEY: 'api', NEON_PROJECT_ID: 'project' };
    await expect(readNeonBackupBranch({
      environment, branchId: 'br_backup',
      request: async () => ({ ok: true, json: async () => ({ branch: { id: 'br_backup', parent_id: 'br_prod' } }) }),
    })).resolves.toEqual({ branchId: 'br_backup', parentBranchId: 'br_prod' });
    await expect(readNeonBackupBranch({
      environment, branchId: 'br_backup', request: async () => ({ ok: false }),
    })).rejects.toThrow('unavailable');
    await expect(readNeonBackupBranch({
      environment, branchId: 'br_backup',
      request: async () => ({ ok: true, json: async () => ({ branch: { id: 'br_other' } }) }),
    })).rejects.toThrow('drifted');
    await expect(readNeonBackupBranch({ environment, branchId: '', request: jest.fn() }))
      .rejects.toThrow('branch ID');
  });

  test('reports every readiness field drift and fails closed without an HMAC key', () => {
    expect(() => environmentHmac({})).toThrow('READINESS_HMAC_KEY');
    const input = {
      gitHead: 'head', deployableTreeDigest: 'tree', lockDigest: 'lock',
      vercel: { projectId: 'project' }, database: { schemaVersion: 1 }, backup: { branchId: 'branch' },
    };
    const environment = { READINESS_HMAC_KEY: 'key' };
    const manifest = createReadinessManifest(input, environment);
    const current = {
      gitHead: 'other', deployableTreeDigest: 'other', lockDigest: 'other',
      vercel: { projectId: 'other' }, database: { schemaVersion: 2 }, backup: { branchId: 'other' },
    };
    expect(verifyReadinessManifest(manifest, current, environment).errors).toHaveLength(6);
    expect(verifyReadinessManifest({ ...manifest, environmentHmac: 'short' }, input, environment).errors)
      .toContain('Readiness manifest environment has drifted');
    expect(verifyReadinessManifest(manifest, input, {}).errors)
      .toContain('Readiness manifest environment has drifted');
    expect(fileDigest('/lock', () => Buffer.from('lock'))).toMatch(/^[a-f0-9]{64}$/);
  });

  test('fails closed for Git process errors and nonzero status', () => {
    expect(() => assertRepositoryReleaseShape(() => ({ status: 1, stdout: '' }))).toThrow('Git readiness check');
    expect(() => assertRepositoryReleaseShape(() => ({ status: 0, stdout: ' M file\n', error: new Error('git failed') })))
      .toThrow('git failed');
    expect(() => assertRepositoryReleaseShape()).toThrow('worktree must be clean');
  });
});

export {};
