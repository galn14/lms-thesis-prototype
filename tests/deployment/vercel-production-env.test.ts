const {
  compareVercelProductionEnvironment,
  pullVercelProductionEnvironment,
  runCli: runVercelCli,
} = require('../../scripts/prototype/vercel-production-env.cjs');

const vercelValidEnvironment = () => ({
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

const serializeEnvironment = (environment: Record<string, string>) =>
  Object.entries(environment).map(([name, value]) => `${name}=${value}`).join('\n');

describe('Vercel Production environment validation', () => {
  test('accepts an exact required environment match without returning values', () => {
    expect(compareVercelProductionEnvironment(vercelValidEnvironment(), vercelValidEnvironment())).toEqual({
      valid: true,
      errors: [],
    });
  });

  test('reports required-value mismatches by variable name without revealing either value', () => {
    const local = vercelValidEnvironment();
    const production = {
      ...vercelValidEnvironment(),
      ['DEMO_SHARED' + '_PASSWORD']: 'different-' + 'private-value',
    };
    const result = compareVercelProductionEnvironment(local, production);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Vercel Production value does not match local release environment: DEMO_SHARED_PASSWORD');
    expect(result.errors.join('\n')).not.toContain(local.DEMO_SHARED_PASSWORD);
    expect(result.errors.join('\n')).not.toContain(production.DEMO_SHARED_PASSWORD);
  });

  test('rejects missing variables and provider credentials in Vercel Production', () => {
    const production = {
      ...vercelValidEnvironment(),
      CRON_SECRET: '',
      ['OPENROUTER' + '_API_KEY']: 'private-' + 'provider-value',
    };
    const result = compareVercelProductionEnvironment(vercelValidEnvironment(), production);
    expect(result.errors).toContain('Missing required environment variable: CRON_SECRET');
    expect(result.errors).toContain('Provider API key environment variable is not allowed: OPENROUTER_API_KEY');
    expect(result.errors.join('\n')).not.toContain('private-provider-value');
  });

  test('requires an existing linked Vercel project before pulling Production values', () => {
    expect(() => pullVercelProductionEnvironment({
      environment: vercelValidEnvironment(),
      run: jest.fn(),
      readFile: () => { throw new Error('missing'); },
      makeTempDirectory: jest.fn(),
      removeDirectory: jest.fn(),
      cwd: '/repo',
      vercelCliPath: '/repo/node_modules/vercel/dist/index.js',
    })).toThrow('Run the pinned Vercel CLI link command before release');
  });

  test.each([
    'not-json',
    '{}',
    '{"orgId":"org_1"}',
    '{"projectId":"prj_1"}',
  ])('rejects an invalid Vercel project link: %s', projectLink => {
    expect(() => pullVercelProductionEnvironment({
      environment: vercelValidEnvironment(),
      run: jest.fn(),
      readFile: () => projectLink,
      makeTempDirectory: jest.fn(),
      removeDirectory: jest.fn(),
      cwd: '/repo',
      vercelCliPath: '/repo/node_modules/vercel/dist/index.js',
    })).toThrow('Run the pinned Vercel CLI link command before release');
  });

  test('pulls Production values with the pinned CLI and always removes the temporary directory', () => {
    const removeDirectory = jest.fn();
    const run = jest.fn(() => ({ status: 0 }));
    const production = vercelValidEnvironment();
    expect(pullVercelProductionEnvironment({
      environment: vercelValidEnvironment(),
      run,
      readFile: (path: string) => path.endsWith('project.json')
        ? '{"orgId":"org_1","projectId":"prj_1"}'
        : serializeEnvironment(production),
      makeTempDirectory: () => '/tmp/prototype-release-test',
      removeDirectory,
      cwd: '/repo',
      vercelCliPath: '/repo/node_modules/vercel/dist/index.js',
    })).toEqual({ valid: true, errors: [] });
    expect(run).toHaveBeenCalledWith(
      process.execPath,
      [
        '/repo/node_modules/vercel/dist/index.js',
        'env', 'pull', '/tmp/prototype-release-test/production.env',
        '--environment=production', '--yes',
      ],
      expect.objectContaining({ cwd: '/repo' })
    );
    expect(removeDirectory).toHaveBeenCalledWith('/tmp/prototype-release-test');
  });

  test('cleans the temporary directory and fails closed when the CLI fails', () => {
    const removeDirectory = jest.fn();
    expect(() => pullVercelProductionEnvironment({
      environment: vercelValidEnvironment(),
      run: () => ({ status: 7 }),
      readFile: () => '{"orgId":"org_1","projectId":"prj_1"}',
      makeTempDirectory: () => '/tmp/prototype-release-test',
      removeDirectory,
      cwd: '/repo',
      vercelCliPath: '/repo/node_modules/vercel/dist/index.js',
    })).toThrow('Unable to read the linked Vercel Production environment');
    expect(removeDirectory).toHaveBeenCalledWith('/tmp/prototype-release-test');
  });

  test('cleans the temporary directory and fails closed on a process spawn error', () => {
    const removeDirectory = jest.fn();
    expect(() => pullVercelProductionEnvironment({
      environment: vercelValidEnvironment(),
      run: () => ({ status: null, error: new Error('spawn failed') }),
      readFile: () => '{"orgId":"org_1","projectId":"prj_1"}',
      makeTempDirectory: () => '/tmp/prototype-release-test',
      removeDirectory,
      cwd: '/repo',
      vercelCliPath: '/repo/node_modules/vercel/dist/index.js',
    })).toThrow('Unable to read the linked Vercel Production environment');
    expect(removeDirectory).toHaveBeenCalledWith('/tmp/prototype-release-test');
  });

  test('preserves validation details while removing temporary Production values', () => {
    const removeDirectory = jest.fn();
    const production = {
      ...vercelValidEnvironment(),
      ['DEMO_SHARED' + '_PASSWORD']: 'different-' + 'production-value',
    };

    try {
      pullVercelProductionEnvironment({
        environment: vercelValidEnvironment(),
        run: () => ({ status: 0 }),
        readFile: (path: string) => path.endsWith('project.json')
          ? '{"orgId":"org_1","projectId":"prj_1"}'
          : serializeEnvironment(production),
        makeTempDirectory: () => '/tmp/prototype-release-test',
        removeDirectory,
        cwd: '/repo',
        vercelCliPath: '/repo/node_modules/vercel/dist/index.js',
      });
      throw new Error('expected validation to fail');
    } catch (error) {
      expect(error).toMatchObject({
        message: 'Vercel Production environment validation failed',
        validationErrors: [
          'Vercel Production value does not match local release environment: DEMO_SHARED_PASSWORD',
        ],
      });
    }
    expect(removeDirectory).toHaveBeenCalledWith('/tmp/prototype-release-test');
  });

  test('CLI reports a missing project without exposing environment values', () => {
    const logger = { error: jest.fn(), log: jest.fn() };
    expect(runVercelCli(vercelValidEnvironment(), logger)).toBe(1);
    expect(logger.error).toHaveBeenCalledWith(
      'Run the pinned Vercel CLI link command before release'
    );
    expect(logger.log).not.toHaveBeenCalled();
  });
});
