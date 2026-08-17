const { spawnSync } = require('node:child_process');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { PROVIDER_API_KEY_NAMES, REQUIRED_PROTOTYPE_ENV_NAMES, validatePrototypeEnvironment } = require('./validate-env.cjs');

const CONFIG_ENV_NAMES = Object.freeze(['PROTOTYPE_MODE', 'NEXT_PUBLIC_PROTOTYPE_MODE', 'PROTOTYPE_INSTALLATION_ID', 'NEXTAUTH_URL']);
const SENSITIVE_ENV_NAMES = Object.freeze(REQUIRED_PROTOTYPE_ENV_NAMES.filter((name) => !CONFIG_ENV_NAMES.includes(name)));
const LOCAL_ONLY_ENV_NAMES = Object.freeze(['NEON_API_KEY', 'NEON_PROJECT_ID', 'NEON_PRODUCTION_BRANCH_ID', 'READINESS_HMAC_KEY']);

function vercelProcessEnvironment(environment) {
  const omitted = new Set([...REQUIRED_PROTOTYPE_ENV_NAMES, ...PROVIDER_API_KEY_NAMES, ...LOCAL_ONLY_ENV_NAMES]);
  return { ...Object.fromEntries(Object.entries(environment).filter(([name]) => !omitted.has(name))), VERCEL_SKIP_UPDATE_CHECK: '1' };
}

function resolveVercelCli() {
  const packagePath = require.resolve('vercel/package.json');
  const packageDirectory = path.dirname(packagePath);
  const manifest = JSON.parse(readFileSync(packagePath, 'utf8'));
  const relativeCli = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.vercel;
  if (!relativeCli) throw new Error('The pinned Vercel CLI executable could not be resolved');
  return path.resolve(packageDirectory, relativeCli);
}

function assertLinkedProject(projectLinkContent) {
  let project;
  try { project = JSON.parse(projectLinkContent); } catch { throw new Error('Run the pinned Vercel CLI link command before release'); }
  if (!project?.orgId || !project?.projectId) throw new Error('Run the pinned Vercel CLI link command before release');
  return { orgId: project.orgId, projectId: project.projectId };
}

function normalizeVercelMetadata(records) {
  return records.map((record) => ({
    id: String(record.id ?? ''),
    key: String(record.key ?? record.name ?? ''),
    visibility: record.type === 'sensitive' ? 'sensitive' : 'config',
    target: (Array.isArray(record.target) ? [...record.target] : [record.target].filter(Boolean)).sort(),
    updatedAt: Number(record.updatedAt ?? record.updated_at ?? 0),
  })).sort((left, right) => left.key.localeCompare(right.key));
}

function validateVercelProductionMetadata(metadata) {
  const errors = [];
  const byKey = new Map(metadata.map((record) => [record.key, record]));
  for (const providerName of PROVIDER_API_KEY_NAMES) {
    if (byKey.has(providerName)) errors.push(`Provider API key is forbidden in Vercel Production: ${providerName}`);
  }
  for (const name of REQUIRED_PROTOTYPE_ENV_NAMES) {
    const record = byKey.get(name);
    if (!record) { errors.push(`Missing Vercel Production metadata: ${name}`); continue; }
    const expectedVisibility = SENSITIVE_ENV_NAMES.includes(name) ? 'sensitive' : 'config';
    if (record.visibility !== expectedVisibility) errors.push(`${name} must use ${expectedVisibility} visibility`);
    if (!record.target.includes('production')) errors.push(`${name} must target Vercel Production`);
    if (!record.id) errors.push(`${name} must have a Vercel metadata ID`);
    if (!Number.isFinite(record.updatedAt) || record.updatedAt <= 0) errors.push(`${name} must have a valid updatedAt timestamp`);
  }
  return { valid: errors.length === 0, errors };
}

function projectLink({ cwd, readFile }) {
  return assertLinkedProject(readFile(path.join(cwd, '.vercel', 'project.json')));
}

function listVercelProductionMetadata({ environment = process.env, run = spawnSync, readFile = (file) => readFileSync(file, 'utf8'), cwd = process.cwd(), vercelCliPath = resolveVercelCli() } = {}) {
  projectLink({ cwd, readFile });
  const result = run(process.execPath, [vercelCliPath, 'env', 'ls', 'production', '--json'], {
    cwd, env: vercelProcessEnvironment(environment), encoding: 'utf8', stdio: 'pipe',
  });
  if (result.error || result.status !== 0) throw new Error('Unable to inspect Vercel Production environment metadata');
  let records;
  try { records = JSON.parse(result.stdout); } catch { throw new Error('Vercel Production metadata returned invalid JSON'); }
  if (!Array.isArray(records)) throw new Error('Vercel Production metadata must be a JSON array');
  const metadata = normalizeVercelMetadata(records);
  const validation = validateVercelProductionMetadata(metadata);
  if (!validation.valid) {
    const error = new Error('Vercel Production environment metadata validation failed');
    error.validationErrors = validation.errors;
    throw error;
  }
  return metadata;
}

function upsertVercelProductionEnvironment({ environment = process.env, run = spawnSync, readFile = (file) => readFileSync(file, 'utf8'), cwd = process.cwd(), vercelCliPath = resolveVercelCli() } = {}) {
  const validation = validatePrototypeEnvironment(environment);
  if (!validation.valid) throw new Error(`Local prototype environment is invalid: ${validation.errors[0]}`);
  projectLink({ cwd, readFile });
  for (const name of REQUIRED_PROTOTYPE_ENV_NAMES) {
    const visibilityFlag = SENSITIVE_ENV_NAMES.includes(name) ? '--sensitive' : '--no-sensitive';
    const result = run(process.execPath, [vercelCliPath, 'env', 'add', name, 'production', '--force', visibilityFlag], {
      cwd, env: vercelProcessEnvironment(environment), encoding: 'utf8', input: environment[name], stdio: ['pipe', 'pipe', 'pipe'],
    });
    if (result.error || result.status !== 0) throw new Error(`Unable to upsert Vercel Production variable: ${name}`);
  }
  return listVercelProductionMetadata({ environment, run, readFile, cwd, vercelCliPath });
}

function runCli(environment, logger) {
  try {
    listVercelProductionMetadata({ environment });
    logger.log('Vercel Production environment metadata is valid.');
    return 0;
  } catch (error) {
    logger.error(error instanceof Error ? error.message : 'Vercel Production environment metadata validation failed');
    for (const message of error?.validationErrors ?? []) logger.error(`- ${message}`);
    return 1;
  }
}

module.exports = {
  CONFIG_ENV_NAMES, SENSITIVE_ENV_NAMES, normalizeVercelMetadata, validateVercelProductionMetadata,
  listVercelProductionMetadata, upsertVercelProductionEnvironment, resolveVercelCli,
  vercelProcessEnvironment, assertLinkedProject, runCli,
};
