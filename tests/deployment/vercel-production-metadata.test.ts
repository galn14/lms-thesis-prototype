const os = require('node:os');

const {
  CONFIG_ENV_NAMES,
  SENSITIVE_ENV_NAMES,
  normalizeVercelMetadata,
  validateVercelProductionMetadata,
  listVercelProductionMetadata,
  upsertVercelProductionEnvironment,
} = require('../../scripts/prototype/vercel-production-env.cjs');

const completeEnvironment = (): Record<string, string> => ({
  PROTOTYPE_MODE: 'true', NEXT_PUBLIC_PROTOTYPE_MODE: 'true',
  PROTOTYPE_INSTALLATION_ID: '11111111-1111-4111-8111-111111111111',
  NEXTAUTH_URL: 'https://prototype.test',
  DATABASE_URL: 'postgresql://role:secret@ep-demo-pooler.region.aws.neon.tech/database',
  AUX_POSTGRES_URL: 'postgresql://role:secret@ep-demo-pooler.region.aws.neon.tech/database',
  DATABASE_URL_UNPOOLED: 'postgresql://role:secret@ep-demo.region.aws.neon.tech/database',
  NEXTAUTH_SECRET: 'nextauth-secret-for-tests', CREDENTIAL_ENCRYPTION_SECRET: 'credential-secret-for-tests',
  CRON_SECRET: 'cron-secret-for-tests', DEMO_SHARED_PASSWORD: 'shared-password-for-tests',
});

const remoteRecords = () => [...CONFIG_ENV_NAMES, ...SENSITIVE_ENV_NAMES].map((key, index) => ({
  key,
  type: SENSITIVE_ENV_NAMES.includes(key) ? 'sensitive' : 'encrypted',
  target: ['production'], updatedAt: 1_700_000_000_000 + index,
}));

describe('Vercel Production metadata synchronization', () => {
  test('classifies public configuration separately from secrets', () => {
    expect(CONFIG_ENV_NAMES).toEqual([
      'PROTOTYPE_MODE', 'NEXT_PUBLIC_PROTOTYPE_MODE', 'PROTOTYPE_INSTALLATION_ID', 'NEXTAUTH_URL',
    ]);
    expect(SENSITIVE_ENV_NAMES).toEqual([
      'DATABASE_URL', 'AUX_POSTGRES_URL', 'DATABASE_URL_UNPOOLED', 'NEXTAUTH_SECRET',
      'CREDENTIAL_ENCRYPTION_SECRET', 'CRON_SECRET', 'DEMO_SHARED_PASSWORD',
    ]);
  });

  test('upserts config as non-sensitive and secrets as sensitive using stdin', () => {
    const run = jest.fn((_command: string, args: string[]) => args.includes('ls')
      ? ({ status: 0, stdout: JSON.stringify(remoteRecords()) })
      : ({ status: 0 }));
    upsertVercelProductionEnvironment({
      environment: completeEnvironment(), run,
      readFile: () => '{"orgId":"org","projectId":"project"}',
      cwd: '/repo', vercelCliPath: '/vercel.js',
    });
    for (const [, args, options] of (run.mock.calls as unknown as Array<[string, string[], { input: string }]>).filter((call) => call[1].includes('add'))) {
      const name = args[3];
      expect(args).toContain(CONFIG_ENV_NAMES.includes(name) ? '--no-sensitive' : '--sensitive');
      expect(options.input).toBe(completeEnvironment()[name]);
      expect(args.join(' ')).not.toContain(options.input);
    }
  });

  test('normalizes the alternate field names and shapes the Vercel API may return', () => {
    expect(normalizeVercelMetadata([
      { name: 'CRON_SECRET', type: 'sensitive', target: 'production', updated_at: 1_700_000_000_000 },
      {},
    ])).toEqual([
      { key: '', visibility: 'config', target: [], updatedAt: 0 },
      { key: 'CRON_SECRET', visibility: 'sensitive', target: ['production'], updatedAt: 1_700_000_000_000 },
    ]);
  });

  test('reads the process environment when no adapters are supplied', () => {
    // Run outside this repository: it is linked to a real Vercel project, and
    // the default spawner would otherwise query the live environment.
    const cwd = jest.spyOn(process, 'cwd').mockReturnValue(os.tmpdir());
    try {
      expect(() => listVercelProductionMetadata()).toThrow();
    } finally {
      cwd.mockRestore();
    }
  });

  test('lists metadata without pulling values and normalizes stable fields', () => {
    const run = jest.fn((_command: string, _args: string[]) => ({ status: 0, stdout: JSON.stringify(remoteRecords()) }));
    const metadata = listVercelProductionMetadata({
      environment: completeEnvironment(), run,
      readFile: () => '{"orgId":"org","projectId":"project"}',
      cwd: '/repo', vercelCliPath: '/vercel.js',
    });
    expect(run.mock.calls[0][1]).toEqual(['/vercel.js', 'env', 'ls', 'production', '--json']);
    expect(JSON.stringify(metadata)).not.toContain('shared-password-for-tests');
    expect(metadata.find((item: { key: string }) => item.key === 'PROTOTYPE_MODE')).toEqual({ key: 'PROTOTYPE_MODE', visibility: 'config', target: ['production'], updatedAt: 1700000000000 });
  });

  test('requires the exact allowlist, visibility, production target, and updated timestamps', () => {
    const metadata = normalizeVercelMetadata(remoteRecords());
    expect(validateVercelProductionMetadata(metadata)).toEqual({ valid: true, errors: [] });
    const invalid = normalizeVercelMetadata([
      ...remoteRecords().filter((record) => record.key !== 'CRON_SECRET'),
      { key: 'OPENAI_API_KEY', type: 'sensitive', target: ['production'], updatedAt: 1 },
      { key: 'CRON_SECRET', type: 'encrypted', target: ['preview'], updatedAt: 0 },
    ]);
    const errors = validateVercelProductionMetadata(invalid).errors.join('\n');
    expect(errors).toContain('Provider API key');
    expect(errors).toContain('CRON_SECRET');
    expect(errors).toContain('sensitive');
    expect(errors).toContain('Production');
    expect(errors).toContain('updatedAt');
  });

  test('fails closed for list errors and invalid JSON', () => {
    const base = { environment: completeEnvironment(), readFile: () => '{"orgId":"org","projectId":"project"}', cwd: '/repo', vercelCliPath: '/vercel.js' };
    expect(() => listVercelProductionMetadata({ ...base, run: () => ({ status: 1 }) })).toThrow('metadata');
    expect(() => listVercelProductionMetadata({ ...base, run: () => ({ status: 0, stdout: 'invalid' }) })).toThrow('invalid JSON');
  });
});

export {};
