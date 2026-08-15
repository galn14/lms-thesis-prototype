const { runCli } = require('../validate-env.cjs');

process.exitCode = runCli(process.env, console);
