const REQUIRED_PROTOTYPE_ENV_NAMES = Object.freeze([
  'PROTOTYPE_MODE',
  'NEXT_PUBLIC_PROTOTYPE_MODE',
  'PROTOTYPE_INSTALLATION_ID',
  'DATABASE_URL',
  'AUX_POSTGRES_URL',
  'DATABASE_URL_UNPOOLED',
  'NEXTAUTH_SECRET',
  'NEXTAUTH_URL',
  'CREDENTIAL_ENCRYPTION_SECRET',
  'CRON_SECRET',
  'DEMO_SHARED_PASSWORD',
]);

const PROVIDER_API_KEY_NAMES = Object.freeze([
  'OPENAI_API_KEY',
  'AZURE_OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'GEMINI_API_KEY',
  'GOOGLE_AI_API_KEY',
  'GOOGLE_GENERATIVE_AI_API_KEY',
  'COHERE_API_KEY',
  'MISTRAL_API_KEY',
  'GROQ_API_KEY',
  'DEEPSEEK_API_KEY',
  'VOYAGE_API_KEY',
  'OPENROUTER_API_KEY',
  'HUGGINGFACE_API_KEY',
  'REPLICATE_API_TOKEN',
]);

const hasValue = (value) => typeof value === 'string' && value.trim().length > 0;

function databaseTargetIdentity(connectionString) {
  let parsed;
  try {
    parsed = new URL(connectionString);
  } catch {
    throw new Error('Database connection must be a valid PostgreSQL URL');
  }
  const database = decodeURIComponent(parsed.pathname.replace(/^\/+/, ''));
  if (
    !['postgres:', 'postgresql:'].includes(parsed.protocol) ||
    !parsed.hostname ||
    !database
  ) {
    throw new Error('Database connection must be a valid PostgreSQL URL');
  }
  const hostParts = parsed.hostname.toLowerCase().split('.');
  hostParts[0] = hostParts[0].replace(/-pooler$/, '');
  return { branchHost: hostParts.join('.'), database };
}

function validateNeonConnectionRole(name, connectionString, pooled, errors) {
  if (!hasValue(connectionString)) return;
  let parsed;
  try {
    parsed = new URL(connectionString);
  } catch {
    return;
  }
  const hostname = parsed.hostname.toLowerCase();
  if (!hostname.endsWith('.neon.tech')) {
    errors.push(`${name} must use a Neon PostgreSQL connection`);
    return;
  }
  const poolerHost = hostname.split('.')[0].endsWith('-pooler');
  if (pooled && !poolerHost) {
    errors.push(`${name} must use a pooled Neon connection`);
  }
  if (!pooled && poolerHost) {
    errors.push(`${name} must use a direct Neon connection`);
  }
}

function validatePrototypeEnvironment(environment) {
  const errors = [];

  for (const name of REQUIRED_PROTOTYPE_ENV_NAMES) {
    if (!hasValue(environment[name])) {
      errors.push(`Missing required environment variable: ${name}`);
    }
  }

  for (const name of ['PROTOTYPE_MODE', 'NEXT_PUBLIC_PROTOTYPE_MODE']) {
    if (hasValue(environment[name]) && environment[name] !== 'true') {
      errors.push(`${name} must be exactly "true"`);
    }
  }

  if (
    hasValue(environment.DATABASE_URL) &&
    hasValue(environment.AUX_POSTGRES_URL) &&
    environment.AUX_POSTGRES_URL !== environment.DATABASE_URL
  ) {
    errors.push('AUX_POSTGRES_URL must equal DATABASE_URL for this prototype');
  }

  validateNeonConnectionRole('DATABASE_URL', environment.DATABASE_URL, true, errors);
  validateNeonConnectionRole('AUX_POSTGRES_URL', environment.AUX_POSTGRES_URL, true, errors);
  validateNeonConnectionRole(
    'DATABASE_URL_UNPOOLED',
    environment.DATABASE_URL_UNPOOLED,
    false,
    errors
  );

  if (hasValue(environment.DATABASE_URL) && hasValue(environment.DATABASE_URL_UNPOOLED)) {
    try {
      const pooled = databaseTargetIdentity(environment.DATABASE_URL);
      const direct = databaseTargetIdentity(environment.DATABASE_URL_UNPOOLED);
      if (
        pooled.branchHost !== direct.branchHost ||
        pooled.database !== direct.database
      ) {
        errors.push(
          'DATABASE_URL and DATABASE_URL_UNPOOLED must identify the same Neon branch and database'
        );
      }
    } catch (error) {
      errors.push(error.message);
    }
  }

  if (
    hasValue(environment.DATABASE_URL) &&
    hasValue(environment.DATABASE_URL_UNPOOLED) &&
    environment.DATABASE_URL_UNPOOLED === environment.DATABASE_URL
  ) {
    errors.push(
      'DATABASE_URL_UNPOOLED must be a direct connection, not the pooled URL'
    );
  }

  const installationId = environment.PROTOTYPE_INSTALLATION_ID;
  const uuidPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (hasValue(installationId) && !uuidPattern.test(installationId)) {
    errors.push('PROTOTYPE_INSTALLATION_ID must be a valid UUID');
  }

  for (const name of PROVIDER_API_KEY_NAMES) {
    if (hasValue(environment[name])) {
      errors.push(`Provider API key environment variable is not allowed: ${name}`);
    }
  }

  return { valid: errors.length === 0, errors };
}

function runCli(environment, logger) {
  const result = validatePrototypeEnvironment(environment);
  if (!result.valid) {
    logger.error('Prototype environment validation failed:');
    for (const error of result.errors) {
      logger.error(`- ${error}`);
    }
    return 1;
  }

  logger.log('Prototype environment validation passed.');
  return 0;
}

module.exports = {
  PROVIDER_API_KEY_NAMES,
  REQUIRED_PROTOTYPE_ENV_NAMES,
  runCli,
  validatePrototypeEnvironment,
  databaseTargetIdentity,
};
