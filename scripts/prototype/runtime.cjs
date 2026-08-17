const path = require('node:path');
const { readFileSync, writeFileSync, chmodSync } = require('node:fs');
const { spawnSync } = require('node:child_process');
const { Client } = require('pg');
const {
  assertRepositoryReleaseShape, createReadinessManifest, verifyReadinessManifest, digest,
} = require('./readiness.cjs');
const { validateDeploymentEnvironment } = require('./local-env.cjs');
const {
  upsertVercelProductionEnvironment, listVercelProductionMetadata,
  resolveVercelCli, vercelProcessEnvironment,
} = require('./vercel-production-env.cjs');
const { createNeonBackupBranch, readNeonBackupBranch } = require('./neon-backup.cjs');
const { productionSmokeTest } = require('./smoke.cjs');

const MANIFEST_FILE = '.prototype-readiness.json';

const COMMANDS = Object.freeze({
  'production-audit': ['npm', ['audit', '--omit=dev', '--audit-level=low']],
  test: ['npm', ['test', '--', '--runInBand']],
  coverage: ['npm', ['run', 'test:coverage']],
  lint: ['npm', ['run', 'lint']],
  typecheck: ['npm', ['run', 'typecheck']],
  build: ['npm', ['run', 'build']],
  'secret-scan': ['npm', ['run', 'scan:secrets']],
  'artifact-scan': ['npm', ['run', 'scan:artifacts']],
  'database-integration': ['npm', ['test', '--', '--runInBand', 'tests/integration/prototype-database.integration.test.ts']],
  'migrate-prisma': [process.execPath, ['scripts/prototype/cli/prisma-migrate.cjs']],
  'migrate-auxiliary': [process.execPath, ['--import', 'tsx', 'scripts/prototype/migrate-auxiliary.ts']],
  'reset-and-seed': [process.execPath, ['--import', 'tsx', 'scripts/prototype/reset.ts']],
});

function checkedRun(run, command, args, environment, id, options = {}) {
  const result = run(command, args, { cwd: process.cwd(), env: environment, stdio: 'inherit', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Prototype ${id} failed (exit ${result.status ?? 'unknown'})`);
  return result;
}

function gitOutput(run, args) {
  const result = run('git', args, { cwd: process.cwd(), encoding: 'utf8', stdio: 'pipe' });
  if (result.error || result.status !== 0) throw result.error ?? new Error('Unable to inspect Git release state');
  return result.stdout.trim();
}

function repositoryState(run = spawnSync) {
  assertRepositoryReleaseShape((args) => run('git', args, { cwd: process.cwd(), encoding: 'utf8' }));
  return {
    gitHead: gitOutput(run, ['rev-parse', 'HEAD']),
    deployableTreeDigest: digest(gitOutput(run, ['ls-tree', '-r', '--full-tree', 'HEAD'])),
    lockDigest: digest(readFileSync(path.join(process.cwd(), 'package-lock.json'))),
  };
}

function linkedVercelProject() {
  let project;
  try { project = JSON.parse(readFileSync(path.join(process.cwd(), '.vercel', 'project.json'), 'utf8')); }
  catch { throw new Error('The local repository is not linked to a Vercel project'); }
  if (!project.orgId || !project.projectId) throw new Error('The Vercel project link is incomplete');
  return { orgId: project.orgId, projectId: project.projectId };
}

async function databaseMarker(environment) {
  const client = new Client({ connectionString: environment.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    const result = await client.query('SELECT installation_id::text, schema_version FROM prototype_metadata LIMIT 1');
    const marker = result.rows[0];
    if (!marker) throw new Error('Prototype database marker is missing');
    if (marker.installation_id !== environment.PROTOTYPE_INSTALLATION_ID) throw new Error('Prototype database installation marker has drifted');
    return { installationId: marker.installation_id, schemaVersion: Number(marker.schema_version) };
  } finally { await client.end(); }
}

function createPreparationAdapters(environment, { run = spawnSync, logger = console } = {}) {
  let repository;
  return {
    async runStep(step) {
      logger.log(`[prepare:prototype] ${step.id}`);
      if (step.id === 'assert-repository') { repository = repositoryState(run); return; }
      if (step.id === 'validate-environment') {
        const result = validateDeploymentEnvironment(environment);
        if (!result.valid) throw new Error(`Deployment environment validation failed:\n- ${result.errors.join('\n- ')}`);
        return;
      }
      if (step.id === 'validate-vercel-production') { listVercelProductionMetadata({ environment, run }); return; }
      const command = COMMANDS[step.id];
      if (!command) throw new Error(`Unknown preparation step: ${step.id}`);
      const stepEnvironment = step.id === 'database-integration'
        ? { ...environment, RUN_PROTOTYPE_DB_INTEGRATION: 'true' }
        : environment;
      checkedRun(run, command[0], command[1], stepEnvironment, step.id);
    },
    async syncVercelEnvironment() { upsertVercelProductionEnvironment({ environment, run }); },
    async createBackup() { return createNeonBackupBranch({ environment }); },
    async verifyDatabase() { return databaseMarker(environment); },
    async writeManifest({ backup, database }) {
      const input = { ...(repository ?? repositoryState(run)), vercel: linkedVercelProject(), database, backup };
      const manifest = createReadinessManifest(input, environment);
      const file = path.join(process.cwd(), MANIFEST_FILE);
      writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
      chmodSync(file, 0o600);
    },
  };
}

function parseJsonOutput(result, label) {
  if (result.error || result.status !== 0) throw result.error ?? new Error(`${label} failed`);
  try { return JSON.parse(result.stdout); } catch { throw new Error(`${label} returned invalid metadata`); }
}

function createDeploymentAdapters(environment, { run = spawnSync, request = global.fetch } = {}) {
  const cli = resolveVercelCli();
  const cliEnvironment = vercelProcessEnvironment(environment);
  let manifest;
  return {
    async verifyReadiness() {
      manifest = JSON.parse(readFileSync(path.join(process.cwd(), MANIFEST_FILE), 'utf8'));
      const database = await databaseMarker(environment);
      await readNeonBackupBranch({ environment, branchId: manifest.backup?.branchId, request });
      const current = { ...repositoryState(run), vercel: linkedVercelProject(), database, backup: manifest.backup };
      const result = verifyReadinessManifest(manifest, current, environment);
      if (!result.valid) throw new Error(`Prototype is not deployment-ready:\n- ${result.errors.join('\n- ')}`);
    },
    async currentProduction() {
      const result = run(process.execPath, [cli, 'inspect', environment.NEXTAUTH_URL, '--json'], { cwd: process.cwd(), env: cliEnvironment, encoding: 'utf8', stdio: 'pipe' });
      if (result.status !== 0) return null;
      return parseJsonOutput(result, 'Vercel production inspection').id ?? null;
    },
    async deployProduction() {
      return parseJsonOutput(run(process.execPath, [cli, 'deploy', '--prod', '--yes', '--json'], {
        cwd: process.cwd(), env: cliEnvironment, encoding: 'utf8', stdio: 'pipe',
      }), 'Vercel Production deployment');
    },
    async smokeTest(deployment) { return productionSmokeTest(deployment, environment, request); },
    async migrationsCompatible() { return (await databaseMarker(environment)).schemaVersion === manifest.database.schemaVersion; },
    async promoteDeployment(deploymentId) {
      checkedRun(run, process.execPath, [cli, 'promote', deploymentId, '--yes'], cliEnvironment, 'alias rollback');
    },
  };
}

module.exports = {
  MANIFEST_FILE, COMMANDS, repositoryState, linkedVercelProject, databaseMarker,
  createPreparationAdapters, createDeploymentAdapters,
};
