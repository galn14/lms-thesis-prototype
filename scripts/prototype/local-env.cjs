const path = require('node:path');
const { readFileSync, statSync } = require('node:fs');
const dotenv = require('dotenv');
const { validatePrototypeEnvironment } = require('./validate-env.cjs');

const PRODUCTION_ENV_FILE = '.env.production.local';

function loadProductionEnvironment({
  cwd = process.cwd(),
  environment = process.env,
  stat = statSync,
  readFile = (file) => readFileSync(file, 'utf8'),
} = {}) {
  const file = path.join(cwd, PRODUCTION_ENV_FILE);
  let metadata;
  try {
    metadata = stat(file);
  } catch {
    throw new Error(`${PRODUCTION_ENV_FILE} is required for prototype preparation and deployment`);
  }
  if ((metadata.mode & 0o077) !== 0) {
    throw new Error(`${PRODUCTION_ENV_FILE} must use owner-only permissions; run chmod 600`);
  }
  return { ...environment, ...dotenv.parse(readFile(file)) };
}

function validateDeploymentEnvironment(environment) {
  const errors = [...validatePrototypeEnvironment(environment).errors];
  const secretNames = [
    'NEXTAUTH_SECRET',
    'CREDENTIAL_ENCRYPTION_SECRET',
    'CRON_SECRET',
    'READINESS_HMAC_KEY',
  ];
  const values = secretNames.map((name) => environment[name]?.trim() ?? '');
  secretNames.forEach((name, index) => {
    if (Buffer.byteLength(values[index], 'utf8') < 32) errors.push(`${name} must contain at least 32 bytes`);
  });
  if (new Set(values.filter(Boolean)).size !== values.filter(Boolean).length) {
    errors.push('Deployment secrets must be independent values');
  }
  for (const name of ['NEXTAUTH_URL', 'DATABASE_URL', 'DATABASE_URL_UNPOOLED']) {
    if (/replace|example|placeholder/i.test(environment[name] ?? '')) errors.push(`${name} still contains a placeholder`);
  }
  for (const name of ['NEON_API_KEY', 'NEON_PROJECT_ID', 'NEON_PRODUCTION_BRANCH_ID']) {
    if (!environment[name]?.trim()) errors.push(`Missing local release variable: ${name}`);
  }
  return { valid: errors.length === 0, errors };
}

module.exports = { PRODUCTION_ENV_FILE, loadProductionEnvironment, validateDeploymentEnvironment };
