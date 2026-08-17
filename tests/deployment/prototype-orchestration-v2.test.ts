const {
  PREPARE_STEPS,
  runPrototypePreparation,
  runPrototypeDeployment,
} = require('../../scripts/prototype/orchestration.cjs');

describe('two-stage prototype release orchestration', () => {
  test('runs every non-mutating gate before any external or database mutation', async () => {
    const calls: string[] = [];
    const adapters = {
      runStep: jest.fn(async (step: { id: string }) => { calls.push(step.id); }),
      syncVercelEnvironment: jest.fn(async () => { calls.push('sync-vercel-environment'); }),
      createBackup: jest.fn(async () => { calls.push('create-neon-backup'); return { branchId: 'br', endpointId: 'ep', endpointType: 'read_write' }; }),
      verifyDatabase: jest.fn(async () => { calls.push('verify-database'); return { installationId: 'id', schemaVersion: 1 }; }),
      writeManifest: jest.fn(async () => { calls.push('write-readiness-manifest'); }),
    };
    await runPrototypePreparation(adapters);
    const firstMutation = calls.indexOf('sync-vercel-environment');
    expect(calls.slice(0, firstMutation)).toEqual(PREPARE_STEPS.filter((step: { mutating: boolean }) => !step.mutating).map((step: { id: string }) => step.id));
    expect(calls).toEqual([
      'assert-repository', 'validate-environment', 'production-audit', 'test', 'coverage',
      'lint', 'typecheck', 'build', 'secret-scan', 'artifact-scan',
      'sync-vercel-environment', 'validate-vercel-production', 'create-neon-backup',
      'database-integration', 'migrate-prisma', 'migrate-auxiliary', 'reset-and-seed',
      'verify-database', 'write-readiness-manifest',
    ]);
  });

  test('stops preparation at the first failing gate before mutation', async () => {
    const syncVercelEnvironment = jest.fn();
    await expect(runPrototypePreparation({
      runStep: async (step: { id: string }) => { if (step.id === 'lint') throw new Error('lint failed'); },
      syncVercelEnvironment,
      createBackup: jest.fn(), verifyDatabase: jest.fn(), writeManifest: jest.fn(),
    })).rejects.toThrow('lint failed');
    expect(syncVercelEnvironment).not.toHaveBeenCalled();
  });

  test('deploys, smoke tests, and does not roll back a healthy deployment', async () => {
    const calls: string[] = [];
    const result = await runPrototypeDeployment({
      verifyReadiness: async () => calls.push('verify-readiness'),
      currentProduction: async () => { calls.push('current-production'); return 'dpl_old'; },
      deployProduction: async () => { calls.push('deploy-production'); return { id: 'dpl_new', url: 'https://new.example' }; },
      smokeTest: async () => { calls.push('smoke-test'); return { healthy: true }; },
      migrationsCompatible: async () => true,
      promoteDeployment: jest.fn(),
    });
    expect(result).toEqual({ id: 'dpl_new', url: 'https://new.example' });
    expect(calls).toEqual(['verify-readiness', 'current-production', 'deploy-production', 'smoke-test']);
  });

  test('rolls the alias back only when smoke fails and migrations are compatible', async () => {
    const promoteDeployment = jest.fn();
    await expect(runPrototypeDeployment({
      verifyReadiness: async () => undefined,
      currentProduction: async () => 'dpl_old',
      deployProduction: async () => ({ id: 'dpl_new', url: 'https://new.example' }),
      smokeTest: async () => ({ healthy: false, error: 'login failed' }),
      migrationsCompatible: async () => true,
      promoteDeployment,
    })).rejects.toThrow('login failed');
    expect(promoteDeployment).toHaveBeenCalledWith('dpl_old');

    promoteDeployment.mockClear();
    await expect(runPrototypeDeployment({
      verifyReadiness: async () => undefined,
      currentProduction: async () => 'dpl_old',
      deployProduction: async () => ({ id: 'dpl_new', url: 'https://new.example' }),
      smokeTest: async () => ({ healthy: false }),
      migrationsCompatible: async () => false,
      promoteDeployment,
    })).rejects.toThrow('Automatic alias rollback is unsafe');
    expect(promoteDeployment).not.toHaveBeenCalled();
  });

  test('reports a generic smoke failure and tolerates no previous deployment', async () => {
    const promoteDeployment = jest.fn();
    await expect(runPrototypeDeployment({
      verifyReadiness: async () => undefined,
      currentProduction: async () => null,
      deployProduction: async () => ({ id: 'dpl_new', url: 'https://new.example' }),
      smokeTest: async () => ({ healthy: false }),
      migrationsCompatible: async () => true,
      promoteDeployment,
    })).rejects.toThrow('Production smoke test failed');
    expect(promoteDeployment).not.toHaveBeenCalled();
  });
});
