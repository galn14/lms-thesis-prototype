const {
  PROVIDER_API_KEY_NAMES,
  REQUIRED_PROTOTYPE_ENV_NAMES,
  runCli,
  validatePrototypeEnvironment,
} = require('../../scripts/prototype/validate-env.cjs');

const validEnvironment = (): Record<string, string> => ({
  PROTOTYPE_MODE: 'true',
  NEXT_PUBLIC_PROTOTYPE_MODE: 'true',
  PROTOTYPE_INSTALLATION_ID: '11111111-1111-4111-8111-111111111111',
  DATABASE_URL: 'postgresql://role:secret@ep-demo-pooler.region.aws.neon.tech/database',
  AUX_POSTGRES_URL: 'postgresql://role:secret@ep-demo-pooler.region.aws.neon.tech/database',
  DATABASE_URL_UNPOOLED: 'postgresql://role:secret@ep-demo.region.aws.neon.tech/database',
  NEXTAUTH_SECRET: 'nextauth-secret-for-tests',
  NEXTAUTH_URL: 'https://prototype.example.test',
  CREDENTIAL_ENCRYPTION_SECRET: 'credential-secret-for-tests',
  CRON_SECRET: 'cron-secret-for-tests',
  DEMO_SHARED_PASSWORD: 'shared-password-for-tests',
});

describe('prototype environment validator', () => {
  test('recognizes OpenRouter as a forbidden provider credential', () => {
    expect(PROVIDER_API_KEY_NAMES).toContain('OPENROUTER_API_KEY');
  });

  test('accepts the complete production environment', () => {
    expect(validatePrototypeEnvironment(validEnvironment())).toEqual({
      valid: true,
      errors: [],
    });
  });

  for (const variableName of REQUIRED_PROTOTYPE_ENV_NAMES as readonly string[]) {
    test(`rejects an empty required variable: ${variableName}`, () => {
      const environment = validEnvironment();
      environment[variableName] = '   ';

      const result = validatePrototypeEnvironment(environment);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        `Missing required environment variable: ${variableName}`
      );
    });
  }

  test.each(['PROTOTYPE_MODE', 'NEXT_PUBLIC_PROTOTYPE_MODE'])(
    'requires %s to equal true exactly',
    (name: string) => {
      const environment = validEnvironment();
      environment[name] = 'TRUE';

      const result = validatePrototypeEnvironment(environment);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain(`${name} must be exactly "true"`);
    }
  );

  test('requires the auxiliary URL to use the same pooled connection', () => {
    const environment = validEnvironment();
    environment.AUX_POSTGRES_URL = 'postgresql://different.example/database';

    const result = validatePrototypeEnvironment(environment);

    expect(result.errors).toContain(
      'AUX_POSTGRES_URL must equal DATABASE_URL for this prototype'
    );
  });

  test('requires a distinct direct URL for database migrations', () => {
    const environment = validEnvironment();
    environment.DATABASE_URL_UNPOOLED = environment.DATABASE_URL;

    const result = validatePrototypeEnvironment(environment);

    expect(result.errors).toContain(
      'DATABASE_URL_UNPOOLED must be a direct connection, not the pooled URL'
    );
  });

  test.each([
    ['DATABASE_URL', 'postgresql://role:secret@ep-demo.region.aws.neon.tech/database', 'pooled Neon connection'],
    ['AUX_POSTGRES_URL', 'postgresql://role:secret@ep-demo.region.aws.neon.tech/database', 'pooled Neon connection'],
    ['DATABASE_URL_UNPOOLED', 'postgresql://role:secret@ep-demo-pooler.region.aws.neon.tech/database', 'direct Neon connection'],
  ])('enforces the connection role for %s', (name, value, message) => {
    const environment = validEnvironment();
    environment[name] = value;
    if (name === 'DATABASE_URL') environment.AUX_POSTGRES_URL = value;
    if (name === 'AUX_POSTGRES_URL') environment.DATABASE_URL = value;
    expect(validatePrototypeEnvironment(environment).errors.join('\n')).toContain(message);
  });

  test('rejects PostgreSQL hosts outside Neon', () => {
    const result = validatePrototypeEnvironment({
      ...validEnvironment(),
      DATABASE_URL: 'postgresql://role:secret@db-pooler.example/database',
      AUX_POSTGRES_URL: 'postgresql://role:secret@db-pooler.example/database',
      DATABASE_URL_UNPOOLED: 'postgresql://role:secret@db.example/database',
    });
    expect(result.errors.join('\n')).toContain('Neon');
  });

  test.each([
    ['postgresql://role:secret@ep-other.region.aws.neon.tech/database'],
    ['postgresql://role:secret@ep-demo.region.aws.neon.tech/other_database'],
  ])('rejects a direct URL for another Neon branch or database', (directUrl) => {
    const environment = validEnvironment();
    environment.DATABASE_URL_UNPOOLED = directUrl;

    const result = validatePrototypeEnvironment(environment);

    expect(result.errors).toContain(
      'DATABASE_URL and DATABASE_URL_UNPOOLED must identify the same Neon branch and database'
    );
  });

  test.each(['not-a-url', 'https://example.test/database', 'postgresql://host/'])(
    'rejects a malformed direct PostgreSQL URL',
    (directUrl) => {
      const result = validatePrototypeEnvironment({
        ...validEnvironment(),
        DATABASE_URL_UNPOOLED: directUrl,
      });

      expect(result.errors).toContain('Database connection must be a valid PostgreSQL URL');
    }
  );

  test('normalizes a non-Error platform URL parser failure', () => {
    const originalUrl = global.URL;
    global.URL = jest.fn(() => {
      throw 'synthetic parser failure';
    }) as unknown as typeof URL;
    try {
      const result = validatePrototypeEnvironment(validEnvironment());
      expect(result.errors).toContain('Database connection must be a valid PostgreSQL URL');
    } finally {
      global.URL = originalUrl;
    }
  });

  test('rejects a malformed installation identifier', () => {
    const result = validatePrototypeEnvironment({
      ...validEnvironment(),
      PROTOTYPE_INSTALLATION_ID: 'not-a-uuid',
    });

    expect(result.errors).toContain(
      'PROTOTYPE_INSTALLATION_ID must be a valid UUID'
    );
  });

  for (const variableName of PROVIDER_API_KEY_NAMES as readonly string[]) {
    test(`rejects provider credential variable ${variableName} when it is present`, () => {
      const environment = {
        ...validEnvironment(),
        [variableName]: 'credential-present',
      };

      const result = validatePrototypeEnvironment(environment);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        `Provider API key environment variable is not allowed: ${variableName}`
      );
    });
  }

  test('does not include secret values in validation errors', () => {
    const forbiddenValue = 'do-not-print-this-value';
    const providerKey = 'OPENAI' + '_API_KEY';
    const result = validatePrototypeEnvironment({
      ...validEnvironment(),
      [providerKey]: forbiddenValue,
    });

    expect(result.errors.join('\n')).not.toContain(forbiddenValue);
  });

  test('CLI reports success without printing environment values', () => {
    const logger = { error: jest.fn(), log: jest.fn() };

    expect(runCli(validEnvironment(), logger)).toBe(0);
    expect(logger.log).toHaveBeenCalledWith(
      'Prototype environment validation passed.'
    );
    expect(logger.error).not.toHaveBeenCalled();
  });

  test('CLI reports every validation error', () => {
    const logger = { error: jest.fn(), log: jest.fn() };

    expect(runCli({}, logger)).toBe(1);
    expect(logger.error).toHaveBeenCalledWith(
      'Prototype environment validation failed:'
    );
    expect(logger.log).not.toHaveBeenCalled();
  });
});
