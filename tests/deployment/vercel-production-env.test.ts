const {
  CONFIG_ENV_NAMES,
  SENSITIVE_ENV_NAMES,
  assertLinkedProject,
  listVercelProductionMetadata,
  upsertVercelProductionEnvironment,
  runCli: runVercelCli,
} = require('../../scripts/prototype/vercel-production-env.cjs');

const vercelValidEnvironment = (): Record<string, string> => ({
  PROTOTYPE_MODE: 'true',
  NEXT_PUBLIC_PROTOTYPE_MODE: 'true',
  PROTOTYPE_INSTALLATION_ID: '11111111-1111-4111-8111-111111111111',
  DATABASE_URL: 'postgresql://role:secret@ep-demo-pooler.region.aws.neon.tech/database',
  AUX_POSTGRES_URL: 'postgresql://role:secret@ep-demo-pooler.region.aws.neon.tech/database',
  DATABASE_URL_UNPOOLED: 'postgresql://role:secret@ep-demo.region.aws.neon.tech/database',
  NEXTAUTH_SECRET: 'nextauth-secret-for-tests',
  NEXTAUTH_URL: 'https://prototype.example.test',
  CREDENTIAL_ENCRYPTION_SECRET: 'credential-secret-for-tests',
  CRON_SECRET: 'cron-secret-for-tests',
  DEMO_SHARED_PASSWORD: 'shared-password-for-tests',
});

const linkedProject = () => '{"orgId":"org_1","projectId":"prj_1"}';

describe('Vercel Production environment failure modes', () => {
  test('never forwards local-only or provider credentials to the Vercel CLI process', () => {
    const run = jest.fn((_command: string, _args: string[], _options: { env: Record<string, string> }) => ({ status: 0 }));
    const environment = {
      ...vercelValidEnvironment(),
      READINESS_HMAC_KEY: 'local-only',
      NEON_API_KEY: 'neon-local-only',
      OPENAI_API_KEY: '',
      PATH: '/bin',
    };
    expect(() => upsertVercelProductionEnvironment({
      environment, run, readFile: linkedProject, cwd: '/repo', vercelCliPath: '/repo/vercel.js',
    })).toThrow('Vercel Production metadata');

    for (const [, , options] of run.mock.calls) {
      expect(options.env).not.toHaveProperty('NEON_API_KEY');
      expect(options.env).not.toHaveProperty('READINESS_HMAC_KEY');
      expect(options.env).not.toHaveProperty('OPENAI_API_KEY');
      expect(options.env).not.toHaveProperty('DEMO_SHARED_PASSWORD');
      expect(options.env.PATH).toBe('/bin');
      expect(options.env.VERCEL_SKIP_UPDATE_CHECK).toBe('1');
    }
  });

  test('stops the upsert on CLI failure and names only the failed variable', () => {
    expect(() => upsertVercelProductionEnvironment({
      environment: vercelValidEnvironment(),
      run: () => ({ status: 1 }),
      readFile: linkedProject,
      cwd: '/repo', vercelCliPath: '/repo/vercel.js',
    })).toThrow('Unable to upsert Vercel Production variable: PROTOTYPE_MODE');

    expect(() => upsertVercelProductionEnvironment({
      environment: vercelValidEnvironment(),
      run: () => ({ status: null, error: new Error('spawn failed') }),
      readFile: linkedProject,
      cwd: '/repo', vercelCliPath: '/repo/vercel.js',
    })).toThrow('Unable to upsert Vercel Production variable: PROTOTYPE_MODE');
  });

  test('rejects invalid local values before touching the Vercel project link', () => {
    const readFile = jest.fn();
    expect(() => upsertVercelProductionEnvironment({
      environment: {}, run: jest.fn(), readFile, cwd: '/repo', vercelCliPath: '/repo/vercel.js',
    })).toThrow('Local prototype environment is invalid');
    expect(readFile).not.toHaveBeenCalled();
  });

  test.each([
    'not-json',
    '{}',
    '{"orgId":"org_1"}',
    '{"projectId":"prj_1"}',
  ])('rejects an invalid Vercel project link: %s', projectLink => {
    expect(() => assertLinkedProject(projectLink))
      .toThrow('Run the pinned Vercel CLI link command before release');
    expect(() => listVercelProductionMetadata({
      environment: vercelValidEnvironment(),
      run: jest.fn(),
      readFile: () => projectLink,
      cwd: '/repo', vercelCliPath: '/repo/vercel.js',
    })).toThrow('Run the pinned Vercel CLI link command before release');
  });

  test('requires an existing project link before listing metadata', () => {
    expect(() => listVercelProductionMetadata({
      environment: vercelValidEnvironment(),
      run: jest.fn(),
      readFile: () => { throw new Error('missing'); },
      cwd: '/repo', vercelCliPath: '/repo/vercel.js',
    })).toThrow('missing');
  });

  test.each([
    [{ status: 1 }, 'Unable to inspect Vercel Production environment metadata'],
    [{ status: null, error: new Error('spawn failed') }, 'Unable to inspect Vercel Production environment metadata'],
    [{ status: 0, stdout: 'not-json' }, 'Vercel Production metadata returned invalid JSON'],
    [{ status: 0, stdout: '{"key":"value"}' }, 'Vercel Production metadata must be a JSON array'],
  ])('fails closed when the metadata listing is unusable (%#)', (result, expectedError) => {
    expect(() => listVercelProductionMetadata({
      environment: vercelValidEnvironment(),
      run: () => result,
      readFile: linkedProject,
      cwd: '/repo', vercelCliPath: '/repo/vercel.js',
    })).toThrow(expectedError as string);
  });

  test('attaches validation details without exposing any environment value', () => {
    const incomplete = [{ id: 'env_0', key: CONFIG_ENV_NAMES[0], type: 'encrypted', target: ['production'], updatedAt: 1 }];
    try {
      listVercelProductionMetadata({
        environment: vercelValidEnvironment(),
        run: () => ({ status: 0, stdout: JSON.stringify(incomplete) }),
        readFile: linkedProject,
        cwd: '/repo', vercelCliPath: '/repo/vercel.js',
      });
      throw new Error('expected the metadata validation to fail');
    } catch (error) {
      const failure = error as Error & { validationErrors?: string[] };
      expect(failure.message).toBe('Vercel Production environment metadata validation failed');
      expect(failure.validationErrors).toEqual(
        expect.arrayContaining([`Missing Vercel Production metadata: ${SENSITIVE_ENV_NAMES[0]}`])
      );
      expect(failure.validationErrors!.join('\n')).not.toContain('shared-password-for-tests');
    }
  });

  test('CLI fails closed on an unlinked repository without exposing environment values', () => {
    const logger = { error: jest.fn(), log: jest.fn() };
    expect(runVercelCli(vercelValidEnvironment(), logger)).toBe(1);
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.log).not.toHaveBeenCalled();
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain('shared-password-for-tests');
  });
});

export {};
