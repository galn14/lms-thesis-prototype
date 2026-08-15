const { spawnSync } = require('node:child_process');
const { runPrismaMigration } = require('../prisma-migrate.cjs');

try {
  runPrismaMigration({ environment: process.env, run: spawnSync });
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
