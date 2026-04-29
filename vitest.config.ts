import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      exclude: [
        '**/*.d.ts',
        '**/dist/**',
        '**/node_modules/**',
        'tests/**',
        '**/src/daemon/**',
        'src/slides/download.ts',
        'src/slides/extract-finalize.ts',
        'src/slides/extract.ts',
        'src/slides/frame-extraction.ts',
        'src/slides/ocr.ts',
        'src/slides/process.ts',
        '**/src/content/transcript/providers/twitter-cookies-*.ts',
        'src/**/index.ts',
        'src/**/types.ts',
        'src/**/contracts.ts',
        'src/**/slides-text.ts',
        'src/**/slides-text-types.ts',
        'src/**/deps.ts',
      ],
      include: ['src/**/*.ts'],
      provider: 'v8',
      reporter: ['text', 'html'],
      thresholds: { branches: 75, functions: 75, lines: 75, statements: 75 },
    },
    environment: 'node',
    globals: true,
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
  },
});
