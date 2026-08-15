const { databaseTargetIdentity } = require('./validate-env.cjs');

function runPrismaMigration({
  environment,
  run,
}) {
  const directUrl = environment.DATABASE_URL_UNPOOLED;
  if (typeof directUrl !== 'string' || directUrl.trim().length === 0) {
    throw new Error('DATABASE_URL_UNPOOLED is required for Prisma migrations');
  }
  const pooledUrl = environment.DATABASE_URL;
  if (typeof pooledUrl !== 'string' || pooledUrl.trim().length === 0) {
    throw new Error('DATABASE_URL is required to verify the Prisma migration target');
  }
  const pooledTarget = databaseTargetIdentity(pooledUrl);
  const directTarget = databaseTargetIdentity(directUrl);
  if (
    pooledTarget.branchHost !== directTarget.branchHost ||
    pooledTarget.database !== directTarget.database
  ) {
    throw new Error(
      'DATABASE_URL and DATABASE_URL_UNPOOLED must identify the same Neon branch and database'
    );
  }

  const result = run('prisma', ['migrate', 'deploy'], {
    cwd: process.cwd(),
    env: { ...environment, DATABASE_URL: directUrl },
    stdio: 'inherit',
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`Prisma migration failed with exit ${result.status ?? 'unknown'}`);
  }
}

module.exports = { runPrismaMigration };
