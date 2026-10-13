import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import importPlugin from 'eslint-plugin-import';
import nextPlugin from '@next/eslint-plugin-next';
import prettier from 'eslint-config-prettier';

const prismaRestriction = {
  group: ['@prisma/client', '@prisma/client/*', 'prisma'],
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
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
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
  // API: Prisma only inside repository files (+ the lib/db.ts client singleton
  // and test-support helpers, per doc 07 module layout). Type-only imports are
  // allowed everywhere (services/controllers may name Prisma types).
  {
    files: ['apps/api/**/*.ts'],
    ignores: [
      'apps/api/**/repository.ts',
      'apps/api/**/*.repository.ts',
      'apps/api/src/lib/db.ts',
      'apps/api/src/test-support/**',
      'apps/api/**/*.test.ts',
      'apps/api/prisma/**',
      'apps/api/vitest.*.ts',
    ],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        { patterns: [{ ...prismaRestriction, allowTypeImports: true }] },
      ],
    },
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
  prettier,
);
