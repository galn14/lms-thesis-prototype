const { resolveVercelCli } = require('./vercel-production-env.cjs');

const nodeCommand = process.execPath;
const npmCommand = 'npm';
const vercelCli = resolveVercelCli();

const RELEASE_STEPS = Object.freeze([
  {
    id: 'validate-environment',
    command: nodeCommand,
    args: ['scripts/prototype/cli/validate-env.cjs'],
  },
  {
    id: 'validate-vercel-production',
    command: nodeCommand,
    args: ['scripts/prototype/cli/validate-vercel-production.cjs'],
  },
  {
    id: 'database-integration',
    command: npmCommand,
    args: [
      'test',
      '--',
      '--runInBand',
      'tests/integration/prototype-database.integration.test.ts',
    ],
    env: { RUN_PROTOTYPE_DB_INTEGRATION: 'true' },
  },
  {
    id: 'migrate-prisma',
    command: nodeCommand,
    args: ['scripts/prototype/cli/prisma-migrate.cjs'],
  },
  {
    id: 'migrate-auxiliary',
    command: nodeCommand,
    args: ['--import', 'tsx', 'scripts/prototype/migrate-auxiliary.ts'],
  },
  {
    id: 'reset-and-seed',
    command: nodeCommand,
    args: ['--import', 'tsx', 'scripts/prototype/reset.ts'],
  },
  {
    id: 'test',
    command: npmCommand,
    args: ['test', '--', '--runInBand'],
  },
  {
    id: 'coverage',
    command: npmCommand,
    args: ['run', 'test:coverage'],
  },
  { id: 'lint', command: npmCommand, args: ['run', 'lint'] },
  { id: 'typecheck', command: npmCommand, args: ['run', 'typecheck'] },
  { id: 'build', command: npmCommand, args: ['run', 'build'] },
  { id: 'secret-scan', command: npmCommand, args: ['run', 'scan:secrets'] },
  { id: 'artifact-scan', command: npmCommand, args: ['run', 'scan:artifacts'] },
  {
    id: 'deploy-production',
    command: nodeCommand,
    args: [vercelCli, 'deploy', '--prod'],
  },
]);

function runPrototypeRelease({ run, logger }) {
  for (const step of RELEASE_STEPS) {
    logger.log(`\n[release:prototype] ${step.id}`);
    const result = run(step.command, step.args, {
      cwd: process.cwd(),
      env: { ...process.env, ...(step.env ?? {}) },
      stdio: 'inherit',
    });

    if (result.error) {
      throw result.error;
    }
    if (result.status !== 0) {
      throw new Error(
        `Release step failed: ${step.id} (exit ${result.status ?? 'unknown'})`
      );
    }
  }
}

module.exports = { RELEASE_STEPS, runPrototypeRelease };
