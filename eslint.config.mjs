import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';

export default defineConfig([
  ...nextVitals,
  {
    rules: {
      // These React Compiler diagnostics were not part of the previous
      // core-web-vitals ruleset. Keep the framework upgrade behavior-neutral;
      // application-wide compiler refactors belong in a separate change.
      'react-hooks/immutability': 'off',
      'react-hooks/preserve-manual-memoization': 'off',
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/static-components': 'off',
    },
  },
  globalIgnores([
    '.next/**',
    'coverage/**',
    'node_modules/**',
    'next-env.d.ts',
  ]),
]);
