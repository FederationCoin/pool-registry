import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';

export default defineConfig({
  plugins: [
    swc.vite({
      jsc: {
        parser: { syntax: 'typescript', decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
        target: 'es2022',
      },
      module: { type: 'es6' },
    }),
  ],
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.spec.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/main.ts',
        'src/cli.ts',
        'src/app.module.ts',
        'src/infra/registry-infra.module.ts',
        'src/infra/dynamo/**',
        'src/infra/redis/**',
        'src/infra/rpc/**',
        'src/infra/secrets/aws-sm.ts',
        'src/ports/**',
        'src/**/*.spec.ts',
        'src/test-support.ts',
        'src/http/params.ts',
      ],
      thresholds: {
        branches: 80,
        lines: 80,
        functions: 80,
        statements: 80,
      },
    },
  },
});
