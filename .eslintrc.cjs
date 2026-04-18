module.exports = {
  root: true,
  env: {
    browser: true,
    es2020: true,
    webextensions: true,
    node: true
  },
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react-hooks/recommended',
    'plugin:react/recommended',
    'plugin:react/jsx-runtime'
  ],
  ignorePatterns: ['dist', '.eslintrc.cjs', 'node_modules'],
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
    ecmaFeatures: {
      jsx: true
    }
  },
  plugins: [
    'react-refresh',
    '@typescript-eslint',
    'react',
    'react-hooks'
  ],
  rules: {
    'react-refresh/only-export-components': [
      'warn',
      { allowConstantExport: true },
    ],
    '@typescript-eslint/no-unused-vars': [
      'error',
      {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_'
      }
    ],
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/no-non-null-assertion': 'warn',
    'react/prop-types': 'off',
    'react/react-in-jsx-scope': 'off',
    'react-hooks/rules-of-hooks': 'error',
    'react-hooks/exhaustive-deps': 'warn',
    'no-console': ['warn', { allow: ['warn', 'error'] }],
    'prefer-const': 'error',
    'no-var': 'error',
    'object-shorthand': 'error',
    'prefer-template': 'error'
  },
  settings: {
    react: {
      version: 'detect'
    }
  },
  overrides: [
    {
      files: [
        'src/components/UserGuide.tsx',
        'src/components/theme-provider.tsx',
        'src/components/ui/**/*.tsx'
      ],
      rules: {
        'react-refresh/only-export-components': 'off'
      }
    },
    {
      files: [
        'src/background/**/*.ts',
        'src/services/**/*.ts',
        'src/hooks/query-client.ts',
        'src/stores/persistence.ts',
        'src/utils/code-quality-checker.ts'
      ],
      rules: {
        'no-console': 'off'
      }
    },
    {
      files: [
        'src/stores/cache-v2.ts',
        'src/stores/persistence.ts',
        'src/utils/batch-translation-manager.ts'
      ],
      rules: {
        '@typescript-eslint/no-explicit-any': 'off'
      }
    }
  ]
};
