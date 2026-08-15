const {
  findForbiddenArtifacts,
  runCli: runArtifactCli,
  trackedFiles: trackedArtifactFiles,
} = require('../../scripts/prototype/scan-artifacts.cjs');
const {
  findSecretFindings,
  runCli: runSecretCli,
  trackedFiles: trackedSecretFiles,
} = require('../../scripts/prototype/scan-secrets.cjs');

describe('prototype artifact audit', () => {
  test('accepts approved source and example environment files', () => {
    expect(
      findForbiddenArtifacts([
        '.env.example',
        'app/page.tsx',
        'public/materials/example.pdf',
        'tests/example.test.ts',
        'tests/coverage/core-modules.test.ts',
      ])
    ).toEqual([]);
  });

  test.each([
    '.env',
    '.env.production',
    'node_modules/library/index.js',
    '.next/server/app.js',
    'coverage/lcov.info',
    'output/report.txt',
    'tmp/request.json',
    'public/uploads/submission.pdf',
    '.agents/state.json',
    '.claude/state.json',
    '.codex/settings.json',
    '.gemini/settings.json',
    '.superset/state.json',
    'temp_hash.js',
    'temp_resources.json',
    'package-test.json',
    'docs/skripsi-validation.md',
    'skripsi.pdf',
    'validation-report.md',
    'papers/thesis.docx',
    'validation/evidence.txt',
    'packages/web/coverage/lcov.info',
    'packages/api/output/report.txt',
    'packages/worker/tmp/request.json',
  ])('rejects tracked development artifact %s', (file: string) => {
    expect(findForbiddenArtifacts([file])).toEqual([file]);
  });

  test('reads tracked and untracked deployable paths while respecting Git ignores', () => {
    const run = jest.fn(() => ({ status: 0, stdout: 'app/page.tsx\0README.md\0' }));

    expect(trackedArtifactFiles(run)).toEqual(['app/page.tsx', 'README.md']);
    expect(run).toHaveBeenCalledWith([
      'ls-files', '-z', '--cached', '--others', '--exclude-standard',
    ]);
  });

  test('surfaces Git process errors while listing artifacts', () => {
    const processError = new Error('git unavailable');
    expect(() =>
      trackedArtifactFiles(() => ({ status: null, error: processError }))
    ).toThrow(processError);
  });

  test('rejects a nonzero Git exit while listing artifacts', () => {
    expect(() =>
      trackedArtifactFiles(() => ({ status: 2, stdout: '' }))
    ).toThrow('Unable to list tracked files (exit 2)');
  });

  test('reports an unknown Git exit while listing artifacts', () => {
    expect(() =>
      trackedArtifactFiles(() => ({ status: null, stdout: '' }))
    ).toThrow('Unable to list tracked files (exit unknown)');
  });

  test('CLI passes clean artifacts and reports forbidden paths', () => {
    const logger = { error: jest.fn(), log: jest.fn() };

    expect(runArtifactCli(['README.md'], logger)).toBe(0);
    expect(logger.log).toHaveBeenCalledWith('Artifact scan passed.');

    logger.log.mockClear();
    expect(runArtifactCli(['tmp/request.json'], logger)).toBe(1);
    expect(logger.error).toHaveBeenCalledWith('Forbidden tracked artifacts:');
    expect(logger.error).toHaveBeenCalledWith('- tmp/request.json');
    expect(logger.log).not.toHaveBeenCalled();
  });
});

describe('prototype secret audit', () => {
  test('accepts placeholders and environment variable references', () => {
    expect(
      findSecretFindings([
        {
          path: '.env.example',
          content: 'CRON_SECRET=replace-with-a-random-secret\n',
        },
        {
          path: 'lib/example.ts',
          content: 'const key = process.env.OPENAI_API_KEY;\n',
        },
        {
          path: 'empty.env',
          content: 'OPENAI' + '_API_KEY=""\n',
        },
        {
          path: 'reference.env',
          content: 'OPENAI' + '_API_KEY=process.env.OPENAI_API_KEY\n',
        },
        {
          path: 'invalid-url.txt',
          content: 'postgresql://user:%E0%A4%A@database.example/production',
        },
      ])
    ).toEqual([]);
  });

  test('finds private key material without returning the material', () => {
    const content = [
      '-----BEGIN PRIVATE ' + 'KEY-----',
      'sensitive-payload',
      '-----END PRIVATE KEY-----',
    ].join('\n');

    const findings = findSecretFindings([{ path: 'private.pem', content }]);

    expect(findings).toEqual([
      { path: 'private.pem', reason: 'private key material' },
    ]);
    expect(JSON.stringify(findings)).not.toContain('sensitive-payload');
  });

  test.each([
    ['config.ts', 'OPENAI' + '_API_KEY = "sk-' + '1234567890abcdef"'],
    ['config.json', '"GEMINI' + '_API_KEY": "credential-' + '1234567890"'],
    ['.env.example', 'OPENAI' + '_API_KEY=sk-' + '1234567890abcdef'],
    ['config.ts', 'OPENROUTER' + '_API_KEY="sk-or-' + '1234567890abcdef"'],
  ])('finds assigned provider credentials in %s', (file: string, content: string) => {
    expect(findSecretFindings([{ path: file, content }])).toEqual([
      { path: file, reason: 'provider API credential' },
    ]);
  });

  test.each([
    ['config.ts', 'const DATABASE_URL = "postgresql://' + 'admin:real-' + 'passphrase@database.example/production"', 'database credential'],
    ['config.ts', 'const CRON' + '_SECRET = "actual-' + 'cron-secret-123456"', 'application secret'],
    ['config.ts', 'NEXTAUTH' + '_SECRET=actual-' + 'nextauth-secret-123456', 'application secret'],
  ])('finds hardcoded non-provider secrets in %s', (file: string, content: string, reason: string) => {
    expect(findSecretFindings([{ path: file, content }])).toEqual([{ path: file, reason }]);
  });

  test.each([
    ['prototype.env', 'CRON' + '_SECRET=mysuper' + 'secret123', 'application secret'],
    ['prototype.env', 'OPENAI' + '_API_KEY=sk123' + '456', 'provider API credential'],
    [
      'prototype.env',
      'DATABASE_URL=postgresql://demo:S3cret' + 'Password123@database.example/prototype',
      'database credential',
    ],
  ])('rejects a bare alphanumeric literal in %s', (file: string, content: string, reason: string) => {
    expect(findSecretFindings([{ path: file, content }])).toEqual([{ path: file, reason }]);
  });

  test.each([
    'CRON' + '_SECRET=$CRON_SECRET',
    'CRON' + '_SECRET=${CRON_SECRET}',
    'CRON' + '_SECRET=process.env.CRON_SECRET',
    'CRON' + '_SECRET=process.env["CRON_SECRET"]',
  ])('accepts the explicit environment reference %s', content => {
    expect(findSecretFindings([{ path: 'reference.env', content }])).toEqual([]);
  });

  test('reads tracked text and treats unreadable files as binary', () => {
    const run = jest.fn(() => ({
      status: 0,
      stdout: 'README.md\0app/favicon.ico\0',
    }));
    const read = jest.fn((file: string) => {
      if (file.endsWith('.ico')) throw new Error('binary');
      return '# Prototype';
    });

    expect(trackedSecretFiles(run, read)).toEqual([
      { path: 'README.md', content: '# Prototype' },
      { path: 'app/favicon.ico', content: '' },
    ]);
    expect(run).toHaveBeenCalledWith([
      'ls-files', '-z', '--cached', '--others', '--exclude-standard',
    ]);
  });

  test('surfaces Git process errors while listing files for secret scan', () => {
    const processError = new Error('git unavailable');
    expect(() =>
      trackedSecretFiles(
        () => ({ status: null, error: processError }),
        jest.fn()
      )
    ).toThrow(processError);
  });

  test('rejects a nonzero Git exit while listing files for secret scan', () => {
    expect(() =>
      trackedSecretFiles(() => ({ status: 3, stdout: '' }), jest.fn())
    ).toThrow('Unable to list tracked files (exit 3)');
  });

  test('reports an unknown Git exit while listing files for secret scan', () => {
    expect(() =>
      trackedSecretFiles(() => ({ status: null, stdout: '' }), jest.fn())
    ).toThrow('Unable to list tracked files (exit unknown)');
  });

  test('CLI passes clean files and reports findings without their values', () => {
    const logger = { error: jest.fn(), log: jest.fn() };

    expect(
      runSecretCli([{ path: 'README.md', content: '# Prototype' }], logger)
    ).toBe(0);
    expect(logger.log).toHaveBeenCalledWith('Secret scan passed.');

    logger.log.mockClear();
    expect(
      runSecretCli(
        [{ path: 'private.pem', content: '-----BEGIN PRIVATE ' + 'KEY-----' }],
        logger
      )
    ).toBe(1);
    expect(logger.error).toHaveBeenCalledWith('Potential secrets found:');
    expect(logger.error).toHaveBeenCalledWith(
      '- private.pem: private key material'
    );
    expect(logger.log).not.toHaveBeenCalled();
  });
});
