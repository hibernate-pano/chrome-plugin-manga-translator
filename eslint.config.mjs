import eslint from '@eslint/js';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'public/**', 'coverage/**'],
  },
  {
    files: ['**/*.{ts,tsx,js,jsx,mjs}'],
    languageOptions: {
      parser: tseslint.parser,
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.webextensions,
      },
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    linterOptions: {
      reportUnusedDisableDirectives: 'error',
    },
    plugins: {
      'react-refresh': reactRefresh,
      '@typescript-eslint': tseslint.plugin,
      react,
      'react-hooks': reactHooks,
    },
    rules: {
      ...eslint.configs.recommended.rules,
      ...tseslint.configs.recommended[0].rules,
      // The TS-aware rule understands how enums and types are referenced;
      // the base no-unused-vars rule does not and misfires on both.
      'no-unused-vars': 'off',
      ...react.configs.recommended.rules,
      ...react.configs['jsx-runtime'].rules,
      ...reactHooks.configs.recommended.rules,
      // Globals come from tsconfig types (`vitest/globals`, `chrome`), not
      // runtime globals — `no-undef` cannot see type-level declarations.
      'no-undef': 'off',
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-non-null-assertion': 'warn',
      'react/prop-types': 'off',
      'react/react-in-jsx-scope': 'off',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'prefer-const': 'error',
      'no-var': 'error',
      'object-shorthand': 'error',
      'prefer-template': 'error',
    },
    settings: {
      react: { version: 'detect' },
    },
  },
  {
    files: ['src/components/theme-provider.tsx', 'src/components/ui/**/*.tsx'],
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },
  {
    files: ['src/background/**/*.ts', 'src/services/**/*.ts'],
    rules: {
      'no-console': 'off',
    },
  },
  {
    files: ['src/stores/cache-v2.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  {
    // Build guard scripts run under Node and report on stdout by design.
    files: ['scripts/**/*.mjs', 'scripts/**/*.js'],
    rules: {
      'no-console': 'off',
    },
  }
);
