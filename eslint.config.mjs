import { rootEslintConfig } from '@payloadcms/eslint-config'

const eslintConfig = [
  ...rootEslintConfig,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
        allowDefaultProject: ['*.mjs', '*.js'],
      },
    },
    rules: {
      'no-console': 'off',
      'no-restricted-exports': 'off',
    },
  },
  {
    ignores: ['.next/', 'node_modules/', 'dist/', 'build/'],
  },
]

export default eslintConfig
