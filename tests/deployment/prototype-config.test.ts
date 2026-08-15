import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '../..');

describe('prototype deployment configuration', () => {
  test('schedules only the authenticated reset endpoint at midnight WIB', () => {
    const configuration = JSON.parse(
      readFileSync(path.join(root, 'vercel.json'), 'utf8')
    );

    expect(configuration.crons).toEqual([
      { path: '/api/cron/reset', schedule: '0 17 * * *' },
    ]);
  });

  test('keeps migrations outside the Vercel build command', () => {
    const configuration = JSON.parse(
      readFileSync(path.join(root, 'vercel.json'), 'utf8')
    );
    const buildCommand = configuration.buildCommand.toLowerCase();

    expect(buildCommand).toBe('npm run build');
    expect(buildCommand).not.toContain('migrate');
    expect(buildCommand).not.toContain('seed');
    expect(buildCommand).not.toContain('reset');
  });

  test('exposes one release entry point', () => {
    const packageJson = JSON.parse(
      readFileSync(path.join(root, 'package.json'), 'utf8')
    );

    expect(packageJson.scripts['release:prototype']).toBe(
      'node scripts/prototype/cli/release.cjs'
    );
    expect(packageJson.devDependencies.vercel).toMatch(/^\d+\.\d+\.\d+$/);
    expect(packageJson.devDependencies.tsx).toMatch(/^\d+\.\d+\.\d+$/);
    expect(packageJson.scripts['db:migrate:aux']).toBe(
      'node --import tsx scripts/prototype/migrate-auxiliary.ts'
    );
    expect(packageJson.scripts['db:reset:prototype']).toBe(
      'node --import tsx scripts/prototype/reset.ts'
    );
  });
});
