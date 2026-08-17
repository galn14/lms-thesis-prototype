// The pinned Vercel CLI reports `env ls --json` as { envs: [...] } and omits the
// record id that the REST API exposes, so these fixtures mirror that shape.
const REQUIRED_NAMES = [
  'PROTOTYPE_MODE',
  'NEXT_PUBLIC_PROTOTYPE_MODE',
  'PROTOTYPE_INSTALLATION_ID',
  'NEXTAUTH_URL',
  'DATABASE_URL',
  'AUX_POSTGRES_URL',
  'DATABASE_URL_UNPOOLED',
  'NEXTAUTH_SECRET',
  'CREDENTIAL_ENCRYPTION_SECRET',
  'CRON_SECRET',
  'DEMO_SHARED_PASSWORD',
];
const CONFIG_NAMES = REQUIRED_NAMES.slice(0, 4);

const remoteRecords = (omitted: string[] = []) => REQUIRED_NAMES
  .filter((key) => !omitted.includes(key))
  .map((key, index) => ({
    key,
    type: CONFIG_NAMES.includes(key) ? 'encrypted' : 'sensitive',
    target: ['production'],
    updatedAt: 1_700_000_000_000 + index,
  }));

const systemFilesystem = (stdoutRecords: unknown[]) => ({
  readFileSync: (file: string) => {
    if (String(file).endsWith('vercel/package.json')) return JSON.stringify({ bin: './dist/vc.js' });
    if (String(file).endsWith('.vercel/project.json')) return '{"orgId":"org_1","projectId":"prj_1"}';
    return JSON.stringify(stdoutRecords);
  },
});

describe('Vercel Production system adapters', () => {
  afterEach(() => {
    jest.resetModules();
    jest.dontMock('node:child_process');
    jest.dontMock('node:fs');
  });

  test('uses the pinned CLI and real system adapters by default', () => {
    const spawnSync = jest.fn(() => ({ status: 0, stdout: JSON.stringify({ envs: remoteRecords() }) }));
    jest.doMock('node:child_process', () => ({ spawnSync }));
    jest.doMock('node:fs', () => systemFilesystem(remoteRecords()));

    const { runCli } = require('../../scripts/prototype/vercel-production-env.cjs');
    const logger = { error: jest.fn(), log: jest.fn() };

    expect(runCli(process.env, logger)).toBe(0);
    expect(logger.log).toHaveBeenCalledWith('Vercel Production environment metadata is valid.');
    expect(logger.error).not.toHaveBeenCalled();

    const [command, args, options] = spawnSync.mock.calls[0] as unknown as [string, string[], { stdio: string }];
    expect(command).toBe(process.execPath);
    expect(args[0]).toMatch(/vercel[/\\]dist[/\\]vc\.js$/);
    expect(args.slice(1)).toEqual(['env', 'ls', 'production', '--json']);
    expect(options.stdio).toBe('pipe');
  });

  test('reports every metadata validation error through the CLI logger', () => {
    jest.doMock('node:child_process', () => ({
      spawnSync: () => ({ status: 0, stdout: JSON.stringify({ envs: remoteRecords(['CRON_SECRET']) }) }),
    }));
    jest.doMock('node:fs', () => systemFilesystem(remoteRecords(['CRON_SECRET'])));

    const { runCli } = require('../../scripts/prototype/vercel-production-env.cjs');
    const logger = { error: jest.fn(), log: jest.fn() };

    expect(runCli(process.env, logger)).toBe(1);
    expect(logger.error).toHaveBeenCalledWith('Vercel Production environment metadata validation failed');
    expect(logger.error).toHaveBeenCalledWith('- Missing Vercel Production metadata: CRON_SECRET');
    expect(logger.log).not.toHaveBeenCalled();
  });

  test('CLI handles non-Error failures without leaking values', () => {
    jest.doMock('node:child_process', () => ({
      spawnSync: () => { throw 'synthetic listing failure'; },
    }));
    jest.doMock('node:fs', () => systemFilesystem(remoteRecords()));

    const { runCli } = require('../../scripts/prototype/vercel-production-env.cjs');
    const logger = { error: jest.fn(), log: jest.fn() };

    expect(runCli(process.env, logger)).toBe(1);
    expect(logger.error).toHaveBeenCalledWith('Vercel Production environment metadata validation failed');
    expect(logger.log).not.toHaveBeenCalled();
  });

  test('fails if the pinned Vercel package has no executable', () => {
    jest.doMock('node:fs', () => ({ readFileSync: () => JSON.stringify({ bin: {} }) }));
    const { resolveVercelCli } = require('../../scripts/prototype/vercel-production-env.cjs');
    expect(() => resolveVercelCli()).toThrow('The pinned Vercel CLI executable could not be resolved');
  });

  test('accepts a string bin entry in the pinned Vercel package manifest', () => {
    jest.doMock('node:fs', () => ({ readFileSync: () => JSON.stringify({ bin: './dist/vc.js' }) }));
    const { resolveVercelCli } = require('../../scripts/prototype/vercel-production-env.cjs');
    expect(resolveVercelCli()).toMatch(/vercel[/\\]dist[/\\]vc\.js$/);
  });
});

export {};
