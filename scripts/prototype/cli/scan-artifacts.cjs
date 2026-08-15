const { spawnSync } = require('node:child_process');
const { runCli, trackedFiles } = require('../scan-artifacts.cjs');

try {
  const gitRun = (args) => spawnSync('git', args, { encoding: 'utf8' });
  process.exitCode = runCli(trackedFiles(gitRun), console);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
