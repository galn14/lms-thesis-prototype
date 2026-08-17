const PREPARE_STEPS = Object.freeze([
  { id: 'assert-repository', mutating: false },
  { id: 'validate-environment', mutating: false },
  { id: 'production-audit', mutating: false },
  { id: 'test', mutating: false },
  { id: 'coverage', mutating: false },
  { id: 'lint', mutating: false },
  { id: 'typecheck', mutating: false },
  { id: 'build', mutating: false },
  { id: 'secret-scan', mutating: false },
  { id: 'artifact-scan', mutating: false },
  { id: 'sync-vercel-environment', mutating: true },
  { id: 'validate-vercel-production', mutating: true },
  { id: 'create-neon-backup', mutating: true },
  { id: 'database-integration', mutating: true },
  { id: 'migrate-prisma', mutating: true },
  { id: 'migrate-auxiliary', mutating: true },
  { id: 'reset-and-seed', mutating: true },
  { id: 'verify-database', mutating: true },
  { id: 'write-readiness-manifest', mutating: true },
]);

async function runPrototypePreparation(adapters) {
  let backup;
  let database;
  for (const step of PREPARE_STEPS) {
    if (step.id === 'sync-vercel-environment') await adapters.syncVercelEnvironment();
    else if (step.id === 'create-neon-backup') backup = await adapters.createBackup();
    else if (step.id === 'verify-database') database = await adapters.verifyDatabase();
    else if (step.id === 'write-readiness-manifest') await adapters.writeManifest({ backup, database });
    else await adapters.runStep(step);
  }
  return { backup, database };
}

async function runPrototypeDeployment(adapters) {
  await adapters.verifyReadiness();
  const previous = await adapters.currentProduction();
  const deployment = await adapters.deployProduction();
  const smoke = await adapters.smokeTest(deployment);
  if (!smoke.healthy) {
    if (!(await adapters.migrationsCompatible())) {
      throw new Error('Automatic alias rollback is unsafe because database migrations are incompatible');
    }
    if (previous) await adapters.promoteDeployment(previous);
    throw new Error(smoke.error || 'Production smoke test failed; previous deployment alias restored');
  }
  return deployment;
}

module.exports = { PREPARE_STEPS, runPrototypePreparation, runPrototypeDeployment };
