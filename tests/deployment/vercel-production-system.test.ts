const productionEnvironment = (): Record<string, string> => ({
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

const serialize = (environment: Record<string, string>) =>
  Object.entries(environment).map(([name, value]) => `${name}=${value}`).join('\n');

describe('Vercel Production system adapters', () => {
  const originalEnvironment = process.env;

  afterEach(() => {
    process.env = originalEnvironment;
    jest.resetModules();
    jest.dontMock('node:child_process');
    jest.dontMock('node:fs');
    jest.dontMock('node:os');
  });

  test('uses the pinned CLI and temporary filesystem adapters by default', () => {
    process.env = { ...originalEnvironment, ...productionEnvironment() };
    const spawnSync = jest.fn(() => ({ status: 0 }));
    const mkdtempSync = jest.fn(() => '/system-temp/release-1');
    const rmSync = jest.fn();
    let remoteEnvironment = productionEnvironment();
    const readFileSync = jest.fn((file: string) => {
      if (file.endsWith('vercel/package.json')) {
        return JSON.stringify({ bin: './dist/vc.js' });
      }
      if (file.endsWith('.vercel/project.json')) {
        return '{"orgId":"org_1","projectId":"prj_1"}';
      }
      return serialize(remoteEnvironment);
    });
    jest.doMock('node:child_process', () => ({ spawnSync }));
    jest.doMock('node:fs', () => ({ mkdtempSync, readFileSync, rmSync }));
    jest.doMock('node:os', () => ({ tmpdir: () => '/system-temp' }));

    const {
      pullVercelProductionEnvironment,
      runCli,
    } = require('../../scripts/prototype/vercel-production-env.cjs');
    expect(pullVercelProductionEnvironment()).toEqual({ valid: true, errors: [] });
    const logger = { error: jest.fn(), log: jest.fn() };
    expect(runCli(process.env, logger)).toBe(0);

    remoteEnvironment = {
      ...productionEnvironment(),
      ['DEMO_SHARED' + '_PASSWORD']: 'different-production-value',
    };
    const invalidLogger = { error: jest.fn(), log: jest.fn() };
    expect(runCli(process.env, invalidLogger)).toBe(1);
    expect(invalidLogger.error).toHaveBeenCalledWith(
      '- Vercel Production value does not match local release environment: DEMO_SHARED_PASSWORD'
    );

    expect(spawnSync).toHaveBeenCalledWith(
      process.execPath,
      expect.arrayContaining(['env', 'pull', '--environment=production', '--yes']),
      expect.objectContaining({ stdio: 'pipe' })
    );
    expect(mkdtempSync).toHaveBeenCalledWith('/system-temp/lms-prototype-release-');
    expect(rmSync).toHaveBeenCalledWith('/system-temp/release-1', {
      recursive: true,
      force: true,
    });
    expect(logger.log).toHaveBeenCalledWith(
      'Vercel Production environment matches the local release environment.'
    );
  });

  test('fails if the pinned Vercel package has no executable', () => {
    jest.doMock('node:fs', () => ({
      mkdtempSync: jest.fn(),
      readFileSync: () => JSON.stringify({ bin: {} }),
      rmSync: jest.fn(),
    }));
    const { resolveVercelCli } = require('../../scripts/prototype/vercel-production-env.cjs');
    expect(() => resolveVercelCli()).toThrow(
      'The pinned Vercel CLI executable could not be resolved'
    );
  });

  test('CLI handles non-Error adapter failures without leaking values', () => {
    process.env = { ...originalEnvironment, ...productionEnvironment() };
    jest.doMock('node:child_process', () => ({ spawnSync: () => ({ status: 0 }) }));
    jest.doMock('node:fs', () => ({
      mkdtempSync: () => '/system-temp/release-2',
      readFileSync: (file: string) => {
        if (file.endsWith('vercel/package.json')) {
          return JSON.stringify({ bin: { vercel: './dist/vc.js' } });
        }
        if (file.endsWith('.vercel/project.json')) {
          return '{"orgId":"org_1","projectId":"prj_1"}';
        }
        return serialize(productionEnvironment());
      },
      rmSync: () => {
        throw 'synthetic cleanup failure';
      },
    }));
    jest.doMock('node:os', () => ({ tmpdir: () => '/system-temp' }));
    const { runCli } = require('../../scripts/prototype/vercel-production-env.cjs');
    const logger = { error: jest.fn(), log: jest.fn() };

    expect(runCli(process.env, logger)).toBe(1);
    expect(logger.error).toHaveBeenCalledWith(
      'Vercel Production environment validation failed'
    );
  });
});
