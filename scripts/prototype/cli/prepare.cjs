const { loadProductionEnvironment } = require('../local-env.cjs');
const { runPrototypePreparation } = require('../orchestration.cjs');
const { createPreparationAdapters } = require('../runtime.cjs');

(async () => {
  const environment = loadProductionEnvironment();
  await runPrototypePreparation(createPreparationAdapters(environment));
  console.log('Prototype preparation passed. Run npm run deploy:prototype to deploy.');
})().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
