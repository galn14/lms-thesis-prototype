const { loadProductionEnvironment } = require('../local-env.cjs');
const { runPrototypeDeployment } = require('../orchestration.cjs');
const { createDeploymentAdapters } = require('../runtime.cjs');

(async () => {
  const environment = loadProductionEnvironment();
  const deployment = await runPrototypeDeployment(createDeploymentAdapters(environment));
  console.log(`Production deployment passed smoke tests: ${deployment.url}`);
})().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
