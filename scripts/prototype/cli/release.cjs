const { spawnSync } = require('node:child_process');
const { runPrototypeRelease } = require('../release.cjs');

try {
  runPrototypeRelease({ run: spawnSync, logger: console });
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
