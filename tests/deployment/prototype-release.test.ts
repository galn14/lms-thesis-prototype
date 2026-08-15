const {
  RELEASE_STEPS,
  runPrototypeRelease,
} = require('../../scripts/prototype/release.cjs');
const {
  runPrismaMigration,
} = require('../../scripts/prototype/prisma-migrate.cjs');

describe('prototype release orchestration', () => {
  test('runs every release phase in the approved order', () => {
    const calls: Array<{ command: string; args: string[]; environment: NodeJS.ProcessEnv }> = [];
    const run = (command: string, args: string[], options: { env: NodeJS.ProcessEnv }) => {
      calls.push({ command, args, environment: options.env });
      return { status: 0 };
    };

    runPrototypeRelease({ run, logger: { log: jest.fn() } });

    expect(calls.map(({ command, args }) => ({ command, args }))).toEqual(
      RELEASE_STEPS.map(({ command, args }: { command: string; args: string[] }) => ({ command, args }))
    );
    expect(calls[2].environment.RUN_PROTOTYPE_DB_INTEGRATION).toBe('true');
    expect(RELEASE_STEPS.map(({ id }: { id: string }) => id)).toEqual([
      'validate-environment',
      'validate-vercel-production',
      'database-integration',
      'migrate-prisma',
      'migrate-auxiliary',
      'reset-and-seed',
      'test',
      'coverage',
      'lint',
      'typecheck',
      'build',
      'secret-scan',
      'artifact-scan',
      'deploy-production',
    ]);
    const deploy = RELEASE_STEPS.at(-1);
    expect(deploy.command).toBe(process.execPath);
    expect(deploy.args[0]).toMatch(/node_modules\/vercel\/.+\.js$/);
    expect(deploy.args.slice(1)).toEqual(['deploy', '--prod']);
  });

  test('stops immediately when a phase fails', () => {
    const calls: string[] = [];
    const run = (_command: string, _args: string[]) => {
      const step = RELEASE_STEPS[calls.length];
      calls.push(step.id);
      return { status: step.id === 'migrate-auxiliary' ? 7 : 0 };
    };

    expect(() =>
      runPrototypeRelease({ run, logger: { log: jest.fn() } })
    ).toThrow(
      'Release step failed: migrate-auxiliary (exit 7)'
    );
    expect(calls).toEqual([
      'validate-environment',
      'validate-vercel-production',
      'database-integration',
      'migrate-prisma',
      'migrate-auxiliary',
    ]);
  });

  test('surfaces process spawn errors immediately', () => {
    const processError = new Error('command unavailable');

    expect(() =>
      runPrototypeRelease({
        run: () => ({ status: null, error: processError }),
        logger: { log: jest.fn() },
      })
    ).toThrow(processError);
  });

  test('reports an unknown exit when a command ends without a status', () => {
    expect(() =>
      runPrototypeRelease({
        run: () => ({ status: null }),
        logger: { log: jest.fn() },
      })
    ).toThrow('Release step failed: validate-environment (exit unknown)');
  });
});

describe('Prisma migration connection', () => {
  test('runs migrate deploy with DATABASE_URL_UNPOOLED as DATABASE_URL', () => {
    let call:
      | {
          command: string;
          args: string[];
          options: { env: Record<string, string> };
        }
      | undefined;
    const run = (
      command: string,
      args: string[],
      options: { env: Record<string, string> }
    ) => {
      call = { command, args, options };
      return { status: 0 };
    };
    const environment = {
      DATABASE_URL: 'postgresql://role:secret@ep-demo-pooler.region.aws.neon.tech/database',
      DATABASE_URL_UNPOOLED: 'postgresql://role:secret@ep-demo.region.aws.neon.tech/database',
    };

    runPrismaMigration({ environment, run });

    expect(call).toBeDefined();
    expect(call?.command).toBe('prisma');
    expect(call?.args).toEqual(['migrate', 'deploy']);
    expect(call?.options.env.DATABASE_URL).toBe(
      environment.DATABASE_URL_UNPOOLED
    );
    expect(call?.options.env.DATABASE_URL).not.toBe(environment.DATABASE_URL);
  });

  test('refuses to migrate without the direct connection URL', () => {
    expect(() =>
      runPrismaMigration({ environment: {}, run: jest.fn() })
    ).toThrow('DATABASE_URL_UNPOOLED is required for Prisma migrations');
  });

  test('refuses a blank direct connection URL', () => {
    expect(() =>
      runPrismaMigration({
        environment: { DATABASE_URL_UNPOOLED: '   ' },
        run: jest.fn(),
      })
    ).toThrow('DATABASE_URL_UNPOOLED is required for Prisma migrations');
  });

  test('refuses to migrate without the pooled URL used to verify identity', () => {
    expect(() =>
      runPrismaMigration({
        environment: {
          DATABASE_URL_UNPOOLED: 'postgresql://role:secret@ep-demo.region.aws.neon.tech/database',
        },
        run: jest.fn(),
      })
    ).toThrow('DATABASE_URL is required to verify the Prisma migration target');
  });

  test('refuses a direct migration URL for another database target', () => {
    expect(() => runPrismaMigration({
      environment: {
        DATABASE_URL: 'postgresql://role:secret@ep-demo-pooler.region.aws.neon.tech/database',
        DATABASE_URL_UNPOOLED: 'postgresql://role:secret@ep-other.region.aws.neon.tech/database',
      },
      run: jest.fn(),
    })).toThrow('same Neon branch and database');
  });

  test('surfaces migration process errors', () => {
    const processError = new Error('prisma unavailable');

    expect(() =>
      runPrismaMigration({
        environment: {
          DATABASE_URL: 'postgresql://host/database',
          DATABASE_URL_UNPOOLED: 'postgresql://host/database',
        },
        run: () => ({ status: null, error: processError }),
      })
    ).toThrow(processError);
  });

  test('fails when Prisma migrate deploy returns a nonzero exit', () => {
    expect(() =>
      runPrismaMigration({
        environment: {
          DATABASE_URL: 'postgresql://host/database',
          DATABASE_URL_UNPOOLED: 'postgresql://host/database',
        },
        run: () => ({ status: 9 }),
      })
    ).toThrow('Prisma migration failed with exit 9');
  });

  test('reports an unknown Prisma exit when no status is available', () => {
    expect(() =>
      runPrismaMigration({
        environment: {
          DATABASE_URL: 'postgresql://host/database',
          DATABASE_URL_UNPOOLED: 'postgresql://host/database',
        },
        run: () => ({ status: null }),
      })
    ).toThrow('Prisma migration failed with exit unknown');
  });
});
