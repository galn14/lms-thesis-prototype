import { existsSync } from 'fs';
import path from 'path';

describe('prototype deployment route surface', () => {
  test.each([
    'app/api/files/[...path]/route.ts',
    'app/api/login/route.ts',
    'app/api/db/test/route.ts',
    'app/api/db/prisma-test/route.ts',
  ])('does not ship the development route %s', routePath => {
    expect(existsSync(path.join(process.cwd(), routePath))).toBe(false);
  });
});
