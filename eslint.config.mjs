import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import importPlugin from 'eslint-plugin-import';
import nextPlugin from '@next/eslint-plugin-next';
import prettier from 'eslint-config-prettier';

const prismaRestriction = {
  // The packages only (@prisma/client, prisma, prisma/config ...). A glob such as 'prisma' also matched relative paths
  // through a folder named prisma/ (../../prisma/seed-data), which is our own code, not the Prisma package.
  regex: '^(@prisma/client|prisma)(/.*)?$',
  message: 'Only apps/api repositories may import Prisma (AGENTS.md).',
};

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/.next/**',
      '**/dist/**',
      '**/coverage/**',
      'docs/**',
      'next-env.d.ts',
      '**/next-env.d.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: { import: importPlugin },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      'import/no-cycle': 'error',
      'no-restricted-syntax': [
        'error',
        {
          selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
          message: 'dangerouslySetInnerHTML is prohibited (AGENTS.md).',
        },
      ],
    },
  },
  // Web: UI only. No Prisma, no apps/api.
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    plugins: { 'jsx-a11y': jsxA11y, '@next/next': nextPlugin },
    rules: {
      ...jsxA11y.flatConfigs.recommended.rules,
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs['core-web-vitals'].rules,
      '@next/next/no-html-link-for-pages': 'off', // App Router only; no pages/ dir
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            prismaRestriction,
            {
              group: ['@zoauro/api', '@zoauro/api/*', '**/apps/api/**'],
              message: 'apps/web must not import apps/api (doc 07 §4).',
            },
          ],
        },
      ],
    },
  },
  // API: Prisma only inside repository files and the Prisma client module.
  {
    files: ['apps/api/**/*.ts'],
    ignores: [
      'apps/api/**/repository.ts',
      'apps/api/**/*repository.ts', // matches *.repository.ts and *-repository.ts
      'apps/api/prisma/**',
      'apps/api/prisma.config.ts', // Prisma CLI config, not application code
      'apps/api/src/lib/db.ts', // Prisma client adapters; lib/audit stays Prisma-free
    ],
    rules: { 'no-restricted-imports': ['error', { patterns: [prismaRestriction] }] },
  },
  // Shared: pure, no app or Prisma imports.
  {
    files: ['packages/shared/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            prismaRestriction,
            {
              group: ['@zoauro/api', '@zoauro/web', '**/apps/**'],
              message: 'shared must not import apps.',
            },
          ],
        },
      ],
    },
  },
  // Tests may use non-null assertions.
  {
    files: ['**/*.test.{ts,tsx}', 'tests/**'],
    rules: { '@typescript-eslint/no-non-null-assertion': 'off' },
  },
  // Node scripts (plain .mjs) run outside the TypeScript projects.
  {
    files: ['**/scripts/**/*.mjs'],
    languageOptions: { globals: { process: 'readonly', console: 'readonly', URL: 'readonly' } },
  },
  prettier,
);
