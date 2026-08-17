const nextJest = require('next/jest');
const { thresholds } = require('./.coverage-thresholds.json');

const createJestConfig = nextJest({ dir: './' });

/** @type {import('jest').Config} */
const customJestConfig = {
  testEnvironment: 'node',
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
  },
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  // Scoped to the release pipeline, which is what the deployment gate protects.
  // Application behaviour under app/, components/, and lib/ is verified by the
  // Production smoke test instead of by unit-coverage thresholds.
  // The excluded scripts are entry-point wrappers: argument-free glue that only
  // forwards to a covered module and sets process.exitCode.
  collectCoverageFrom: [
    'scripts/prototype/**/*.{ts,cjs}',
    '!**/*.{test,spec}.{ts,tsx,cjs}',
    '!**/*.d.ts',
    '!**/*.config.{ts,tsx,cjs,js,mjs}',
    '!scripts/prototype/cli/**',
    '!scripts/prototype/reset.ts',
    '!scripts/prototype/migrate-auxiliary.ts',
  ],
  coveragePathIgnorePatterns: [
    '/node_modules/',
    '/.next/',
    '/coverage/',
  ],
  coverageThreshold: {
    global: thresholds,
  },
};

module.exports = createJestConfig(customJestConfig);
