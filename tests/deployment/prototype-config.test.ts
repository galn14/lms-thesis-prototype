import { readFileSync } from 'node:fs';
import { existsSync } from 'node:fs';
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
    expect(configuration.regions).toEqual(['sin1']);

    const cronRoute = readFileSync(
      path.join(root, 'app/api/cron/reset/route.ts'),
      'utf8'
    );
    expect(cronRoute).toContain('export const maxDuration = 300');
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

  test('exposes separate prepare and deploy gates plus a combined release entry point', () => {
    const packageJson = JSON.parse(
      readFileSync(path.join(root, 'package.json'), 'utf8')
    );

    expect(packageJson.scripts['prepare:prototype']).toBe('node scripts/prototype/cli/prepare.cjs');
    expect(packageJson.scripts['deploy:prototype']).toBe('node scripts/prototype/cli/deploy.cjs');
    expect(packageJson.scripts['release:prototype']).toBe('npm run prepare:prototype && npm run deploy:prototype');
    expect(packageJson.devDependencies.vercel).toMatch(/^\d+\.\d+\.\d+$/);
    expect(packageJson.devDependencies.tsx).toMatch(/^\d+\.\d+\.\d+$/);
    expect(packageJson.scripts['db:migrate:aux']).toBe(
      'node --import tsx scripts/prototype/migrate-auxiliary.ts'
    );
    expect(packageJson.scripts['db:reset:prototype']).toBe(
      'node --import tsx scripts/prototype/reset.ts'
    );
  });

  test('pins the supported runtime and secure production framework dependencies', () => {
    const packageJson = JSON.parse(
      readFileSync(path.join(root, 'package.json'), 'utf8')
    );

    expect(packageJson.engines).toEqual({ node: '24.x' });
    expect(packageJson.packageManager).toBe('npm@11.12.1');
    expect(packageJson.dependencies.next).toBe('16.3.1');
    expect(packageJson.dependencies['next-auth']).toBe('4.24.15');
    expect(packageJson.dependencies.react).toBe('19.2.8');
    expect(packageJson.dependencies['react-dom']).toBe('19.2.8');
    expect(packageJson.dependencies.xlsx).toBeUndefined();
    expect(packageJson.devDependencies['eslint-config-next']).toBe('16.3.1');
    expect(packageJson.devDependencies['@types/react']).toBe('19.2.18');
    expect(packageJson.devDependencies['@types/react-dom']).toBe('19.2.4');
    expect(packageJson.scripts.lint).toBe('eslint .');
    expect(packageJson.overrides).toEqual({
      'linkify-it': '5.0.2',
      'markdown-it': '14.3.0',
      preact: '10.29.8',
    });
  });

  test('uses the Next 16 proxy convention and deterministic local fonts', () => {
    expect(existsSync(path.join(root, 'middleware.ts'))).toBe(false);
    expect(existsSync(path.join(root, 'proxy.ts'))).toBe(true);
    expect(existsSync(path.join(root, 'eslint.config.mjs'))).toBe(true);
    expect(existsSync(path.join(root, '.eslintrc.json'))).toBe(false);

    const proxy = readFileSync(path.join(root, 'proxy.ts'), 'utf8');
    const layout = readFileSync(path.join(root, 'app/layout.tsx'), 'utf8');
    expect(proxy).toContain('export async function proxy');
    expect(layout).not.toContain('next/font/google');
    expect(layout).not.toContain('Geist(');
  });

  test('caps serverless database clients and never exits on idle pool errors', () => {
    for (const relativePath of [
      'lib/db.ts',
      'lib/database.ts',
      'lib/aux-db.ts',
      'lib/lms-db.ts',
    ]) {
      const source = readFileSync(path.join(root, relativePath), 'utf8');
      expect(source).toMatch(/max:\s*2/);
      expect(source).not.toMatch(/process\.exit\s*\(/);
    }
  });
});
