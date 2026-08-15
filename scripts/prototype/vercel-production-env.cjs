const { spawnSync } = require('node:child_process');
const { mkdtempSync, readFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const dotenv = require('dotenv');

const {
  REQUIRED_PROTOTYPE_ENV_NAMES,
  validatePrototypeEnvironment,
} = require('./validate-env.cjs');

function resolveVercelCli() {
  const packagePath = require.resolve('vercel/package.json');
  const packageDirectory = path.dirname(packagePath);
  const manifest = JSON.parse(readFileSync(packagePath, 'utf8'));
  const relativeCli = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.vercel;
  if (!relativeCli) throw new Error('The pinned Vercel CLI executable could not be resolved');
  return path.resolve(packageDirectory, relativeCli);
}

function compareVercelProductionEnvironment(localEnvironment, productionEnvironment) {
  const productionValidation = validatePrototypeEnvironment(productionEnvironment);
  const errors = [...productionValidation.errors];

  for (const name of REQUIRED_PROTOTYPE_ENV_NAMES) {
    const localValue = localEnvironment[name];
    const productionValue = productionEnvironment[name];
    if (
      typeof localValue === 'string' &&
      localValue.trim().length > 0 &&
      typeof productionValue === 'string' &&
      productionValue.trim().length > 0 &&
      localValue !== productionValue
    ) {
      errors.push(`Vercel Production value does not match local release environment: ${name}`);
    }
  }

  return { valid: errors.length === 0, errors };
}

function assertLinkedProject(projectLinkContent) {
  let project;
  try {
    project = JSON.parse(projectLinkContent);
  } catch {
    throw new Error('Run the pinned Vercel CLI link command before release');
  }
  if (!project?.orgId || !project?.projectId) {
    throw new Error('Run the pinned Vercel CLI link command before release');
  }
}

function pullVercelProductionEnvironment({
  environment = process.env,
  run = spawnSync,
  readFile = (file) => readFileSync(file, 'utf8'),
  makeTempDirectory = () => mkdtempSync(path.join(tmpdir(), 'lms-prototype-release-')),
  removeDirectory = (directory) => rmSync(directory, { recursive: true, force: true }),
  cwd = process.cwd(),
  vercelCliPath = resolveVercelCli(),
} = {}) {
  const projectLinkPath = path.join(cwd, '.vercel', 'project.json');
  try {
    assertLinkedProject(readFile(projectLinkPath));
  } catch {
    throw new Error('Run the pinned Vercel CLI link command before release');
  }

  const temporaryDirectory = makeTempDirectory();
  const outputPath = path.join(temporaryDirectory, 'production.env');
  try {
    const result = run(
      process.execPath,
      [
        vercelCliPath,
        'env',
        'pull',
        outputPath,
        '--environment=production',
        '--yes',
      ],
      {
        cwd,
        env: environment,
        encoding: 'utf8',
        stdio: 'pipe',
      }
    );
    if (result.error || result.status !== 0) {
      throw new Error('Unable to read the linked Vercel Production environment');
    }
    const productionEnvironment = dotenv.parse(readFile(outputPath));
    const comparison = compareVercelProductionEnvironment(environment, productionEnvironment);
    if (!comparison.valid) {
      const error = new Error('Vercel Production environment validation failed');
      error.validationErrors = comparison.errors;
      throw error;
    }
    return comparison;
  } finally {
    removeDirectory(temporaryDirectory);
  }
}

function runCli(environment, logger) {
  try {
    pullVercelProductionEnvironment({ environment });
    logger.log('Vercel Production environment matches the local release environment.');
    return 0;
  } catch (error) {
    logger.error(error instanceof Error ? error.message : 'Vercel Production environment validation failed');
    for (const message of error?.validationErrors ?? []) logger.error(`- ${message}`);
    return 1;
  }
}

module.exports = {
  compareVercelProductionEnvironment,
  pullVercelProductionEnvironment,
  resolveVercelCli,
  runCli,
};
