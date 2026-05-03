import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

const repoRoot = import.meta.dirname;

/** Rolldown/Vite parses `.md` imports as JS; replace bundled gist skill with a TS stub. */
function gistSkillMdStub(): import('vite').Plugin {
  return {
    enforce: 'pre',
    load(id) {
      if (id === '\0gist-skill-md') {
        return String.raw`export default "## gist\n\n(stub for Vitest)\n";`;
      }
      return null;
    },
    name: 'vitest-gist-skill-md',
    resolveId(id) {
      if (id.includes('gist/SKILL.md')) {
        return '\0gist-skill-md';
      }
      return null;
    },
  };
}

export default defineConfig({
  plugins: [gistSkillMdStub()],
  resolve: {
    alias: {
      [path.resolve(repoRoot, 'skills/gist/SKILL.md')]: path.resolve(
        repoRoot,
        'tests/stubs/gist-skill-md.ts',
      ),
    },
  },
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
