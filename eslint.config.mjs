import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// Vale para libs e apps NestJS. O app web usa a config do Next.
export default tseslint.config(
  { ignores: ['**/dist/**', '**/.next/**', '**/node_modules/**', 'apps/web/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { languageOptions: { globals: { ...globals.node } } },
);
