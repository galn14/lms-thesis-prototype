const { spawnSync } = require('node:child_process');
const { readFileSync } = require('node:fs');
const { runCli, trackedFiles } = require('../scan-secrets.cjs');

try {
  const gitRun = (args) => spawnSync('git', args, { encoding: 'utf8' });
  process.exitCode = runCli(trackedFiles(gitRun, readFileSync), console);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
