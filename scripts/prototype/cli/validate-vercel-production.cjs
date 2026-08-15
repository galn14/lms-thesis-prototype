const { runCli } = require('../vercel-production-env.cjs');

process.exitCode = runCli(process.env, console);
