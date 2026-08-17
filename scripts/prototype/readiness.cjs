const { createHash, createHmac, timingSafeEqual } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { spawnSync } = require('node:child_process');
const { REQUIRED_PROTOTYPE_ENV_NAMES } = require('./validate-env.cjs');

const HMAC_ENV_NAMES = Object.freeze([
  ...REQUIRED_PROTOTYPE_ENV_NAMES,
  'NEON_PROJECT_ID',
  'NEON_PRODUCTION_BRANCH_ID',
]);

const digest = (value) => createHash('sha256').update(value).digest('hex');

function canonicalEnvironment(environment) {
  return HMAC_ENV_NAMES.map((name) => [name, environment[name] ?? '']);
}

function environmentHmac(environment) {
  const key = environment.READINESS_HMAC_KEY?.trim();
  if (!key) throw new Error('READINESS_HMAC_KEY is required for readiness integrity');
  return createHmac('sha256', key).update(JSON.stringify(canonicalEnvironment(environment))).digest('hex');
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

function manifestSignature(payload, environment) {
  const key = environment.READINESS_HMAC_KEY?.trim();
  if (!key) throw new Error('READINESS_HMAC_KEY is required for readiness integrity');
  return createHmac('sha256', key).update(JSON.stringify(canonicalize(payload))).digest('hex');
}

function createReadinessManifest(input, environment, now = () => new Date().toISOString()) {
  const payload = {
    version: 1,
    mode: 'prototype',
    preparedAt: now(),
    ...input,
    environmentHmac: environmentHmac(environment),
  };
  return { ...payload, signature: manifestSignature(payload, environment) };
}

function verifyReadinessManifest(manifest, current, environment) {
  const errors = [];
  if (manifest.version !== 1) errors.push('Readiness manifest version is unsupported');
  if (manifest.mode !== 'prototype') errors.push('Readiness manifest mode must be prototype');
  const { signature, ...payload } = manifest;
  let expectedSignature = '';
  try { expectedSignature = manifestSignature(payload, environment); } catch { /* reported as drift below */ }
  const actualSignature = String(signature ?? '');
  const signatureMatches = actualSignature.length === expectedSignature.length && actualSignature.length > 0 &&
    timingSafeEqual(Buffer.from(actualSignature), Buffer.from(expectedSignature));
  if (!signatureMatches) errors.push('Readiness manifest signature is invalid');
  const fields = [
    ['gitHead', 'Readiness manifest Git HEAD has drifted'],
    ['deployableTreeDigest', 'Readiness manifest deployable tree has drifted'],
    ['lockDigest', 'Readiness manifest dependency lock has drifted'],
    ['vercel', 'Readiness manifest Vercel project has drifted'],
    ['database', 'Readiness manifest database marker has drifted'],
    ['backup', 'Readiness manifest Neon backup has drifted'],
    ['backups', 'Readiness manifest Neon backups have drifted'],
    ['vercelEnvironment', 'Readiness manifest Vercel environment metadata has drifted'],
    ['migrationContract', 'Readiness manifest migration compatibility contract has drifted'],
    ['repositoryRemotes', 'Readiness manifest repository remotes have drifted'],
  ];
  for (const [field, message] of fields) {
    if (JSON.stringify(manifest[field]) !== JSON.stringify(current[field])) errors.push(message);
  }
  let expected;
  try { expected = environmentHmac(environment); } catch { expected = ''; }
  const actual = String(manifest.environmentHmac ?? '');
  const matches = actual.length === expected.length && actual.length > 0 &&
    timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
  if (!matches) errors.push('Readiness manifest environment has drifted');
  return { valid: errors.length === 0, errors };
}

function git(runGit, args) {
  const result = runGit(args);
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Git readiness check failed: ${args[0]}`);
  return result.stdout.trim();
}

function assertRepositoryReleaseShape(runGit = (args) => spawnSync('git', args, { encoding: 'utf8' })) {
  if (git(runGit, ['status', '--porcelain'])) throw new Error('Prototype release worktree must be clean');
  const lines = git(runGit, ['log', '--format=%h %s']).split('\n').filter(Boolean);
  if (lines.length === 0) throw new Error('Prototype release requires at least one commit');
  const origin = git(runGit, ['remote', 'get-url', 'origin']);
  if (!origin) throw new Error('Prototype release requires an origin remote');
  const localHead = git(runGit, ['rev-parse', 'HEAD']);
  const remoteHeadLine = git(runGit, ['ls-remote', 'origin', 'refs/heads/main']);
  const remoteHead = remoteHeadLine.split(/\s+/)[0];
  if (!remoteHead || remoteHead !== localHead) throw new Error('Local HEAD must exactly match origin/main');
  const remoteLines = git(runGit, ['log', 'origin/main', '--format=%h %s']).split('\n').filter(Boolean);
  if (JSON.stringify(remoteLines) !== JSON.stringify(lines)) throw new Error('Local history must exactly match origin/main history');
  return { gitHead: localHead, repositoryRemotes: { origin } };
}

function fileDigest(file, readFile = readFileSync) {
  return digest(readFile(file));
}

module.exports = {
  createReadinessManifest,
  verifyReadinessManifest,
  assertRepositoryReleaseShape,
  environmentHmac,
  fileDigest,
  digest,
  manifestSignature,
};
