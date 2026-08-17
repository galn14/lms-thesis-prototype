const fs = require('node:fs');
const path = require('node:path');

const configSource = fs.readFileSync(path.join(process.cwd(), 'jest.config.js'), 'utf8');

describe('Jest production coverage configuration', () => {
  it('collects the release pipeline at the global threshold', () => {
    expect(configSource).toContain(`'scripts/prototype/**/*.{ts,cjs}'`);
    expect(configSource).toContain('global: thresholds');
  });

  it('excludes tests, declarations, configuration, and entry-point wrappers', () => {
    for (const pattern of [
      '!**/*.{test,spec}.{ts,tsx,cjs}',
      '!**/*.d.ts',
      '!**/*.config.{ts,tsx,cjs,js,mjs}',
      '!scripts/prototype/cli/**',
      '!scripts/prototype/reset.ts',
      '!scripts/prototype/migrate-auxiliary.ts',
    ]) {
      expect(configSource).toContain(`'${pattern}'`);
    }
  });
});
