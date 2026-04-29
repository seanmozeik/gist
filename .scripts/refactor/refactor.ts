#!/usr/bin/env bun
/**
 * Gist Refactor — AST-based cleanup script
 * Uses ts-morph for proper TypeScript AST manipulation.
 *
 * Steps:
 * 1. Fix cache.ts missing re-exports
 * 2. Remove slides imports and related code
 * 3. Remove old provider refs from CLI files
 * 4. Remove pricing/litellm references
 * 5. Fix bird module issues
 */

import fs from 'node:fs';
import path from 'node:path';

import { Project, SyntaxKind } from 'ts-morph';

const GIST_ROOT = '/home/yolo/gist';
const SRC = path.join(GIST_ROOT, 'src');

// ─── Helpers ────────────────────────────────────────────────────────────────

function log(msg: string) { /* empty */ }

function fileExists(p: string): boolean {
  return fs.existsSync(p);
}

function readFileSync(p: string): string | null {
  try {
    return fs.readFileSync(p, 'utf8');
  } catch {
    return null;
  }
}

// ─── Step 1: Fix cache.ts missing re-exports ────────────────────────────────

function fixCacheExports(project: Project): void {
  const filePath = path.join(SRC, 'cache.ts');
  if (!fileExists(filePath)) {
    return;
  }

  const sourceFile = project.addSourceFileAtPath(filePath);

  // Check what's already exported from cache-keys.js
  const cacheKeysExports = sourceFile.getExportedDeclarations().get('buildLanguageKey') ?? null;

  // The current file imports and re-exports these from cache-keys:
  // BuildExtractCacheKeyValue, buildSlidesCacheKeyValue, buildSummaryCacheKeyValue, buildTranscriptCacheKeyValue
  // Missing (need to add back):
  // BuildLanguageKey, buildLengthKey, buildPromptContentHash, buildPromptHash
  // HashJson, hashString, normalizeContentForHash, extractTaggedBlock

  const missingExports = [
    'buildLanguageKey',
    'buildLengthKey',
    'buildPromptContentHash',
    'buildPromptHash',
    'hashJson',
    'hashString',
    'normalizeContentForHash',
    'extractTaggedBlock',
  ];

  // Check which are already exported
  const existingExports = new Set<string>();
  for (const [name] of sourceFile.getExportedDeclarations()) {
    if (Array.isArray(name)) {
      existingExports.add(name[0]);
    }
  }

  // Also check imports from cache-keys.js
  const importFromCacheKeys = sourceFile.getImportDeclaration(
    (d) => d.getModuleSpecifier()?.value === './cache-keys.js',
  );

  let added = false;
  for (const name of missingExports) {
    if (!existingExports.has(name)) {
      // Add to the existing import statement from cache-keys.js
      if (importFromCacheKeys) {
        const namedImports = importFromCacheKeys.getNamedImports();
        const hasImport = namedImports.some((ni) => ni.getName() === name);
        if (!hasImport) {
          importFromCacheKeys.addNamedImport(name);
          added = true;
          log(`Added import for ${name}`);
        }
      }
    }
  }

  // Also need to add re-exports. Check if there's a re-export statement from cache-keys.js
  const reExportFromCacheKeys = sourceFile.getExportDeclaration(
    (d) => d.getModuleSpecifier()?.value === './cache-keys.js',
  );

  if (reExportFromCacheKeys) {
    const existingReExports = new Set<string>();
    for (const ni of reExportFromCacheKeys.getNamedImports()) {
      existingReExports.add(ni.getName());
    }

    for (const name of missingExports) {
      if (!existingReExports.has(name)) {
        reExportFromCacheKeys.addNamedImport(name);
        added = true;
        log(`Added re-export for ${name}`);
      }
    }
  }

  if (added) {
    sourceFile.saveSync();
    log('Saved cache.ts with fixed exports');
  } else {
    log('cache.ts already has all needed exports');
  }
}

// ─── Step 2: Remove slides imports and code ─────────────────────────────────

function removeSlidesCode(project: Project): void {
  const slideImportPatterns = [
    'slides/index.js',
    'slides-session.js',
    'slides-output.js',
    'slides-text.js',
  ];

  // Files known to have slides imports
  const filesWithSlides = [
    'run/flows/url/extraction-session.ts',
    'run/flows/url/flow.ts',
    'run/flows/url/summary-prompt.ts',
    'run/flows/url/summary-resolution.ts',
    'run/flows/url/summary.ts',
    'run/flows/url/video-only.ts',
    'run/runner-slides.ts',
    'shared/slides-text.ts',
  ];

  for (const relativePath of filesWithSlides) {
    const filePath = path.join(SRC, relativePath);
    if (!fileExists(filePath)) {
      continue;
    }

    const sourceFile = project.addSourceFileAtPath(filePath);
    let modified = false;

    // Remove import declarations that reference slides
    for (const importDecl of sourceFile.getImportDeclarations()) {
      const specifier = importDecl.getModuleSpecifier()?.value ?? '';
      if (slideImportPatterns.some((p) => specifier.includes(p))) {
        importDecl.remove();
        modified = true;
        log(`Removed slides import from ${relativePath}: ${specifier}`);
      }
    }

    // Remove imports of slide-related types/values from other modules
    for (const importDecl of sourceFile.getImportDeclarations()) {
      const namedImports = importDecl.getNamedImports();
      const slideNames = new Set([
        'SlidesTerminalOutput',
        'SlideExtractionResult',
        'extractSlidesForSource',
        'resolveSlideSource',
        'normalizeSummarySlideHeadings',
        'shouldBypassShortContentSummary',
        'buildModelMetaFromAttempt',
      ]);

      const toRemove = namedImports.filter((ni) => slideNames.has(ni.getName()));
      for (const ni of toRemove) {
        ni.remove();
        modified = true;
        log(`Removed slide name import from ${relativePath}: ${ni.getName()}`);
      }
    }

    // Remove unused imports that became unused after slides removal
    // E.g., 'normalizeSummarySlideHeadings' and 'shouldBypassShortContentSummary'
    // Might be imported but no longer used
    for (const identifier of sourceFile.getIdentifierReferences()) {
      // Check if this is an import that's now unused
    }

    if (modified) {
      sourceFile.saveSync();
      log(`Saved ${relativePath} after slides removal`);
    }
  }

  // Delete runner-slides.ts entirely since it's all about slides
  const runnerSlidesPath = path.join(SRC, 'run/runner-slides.ts');
  if (fileExists(runnerSlidesPath)) {
    fs.unlinkSync(runnerSlidesPath);
    log('Deleted runner-slides.ts');
  }

  // Delete shared/slides-text.ts entirely
  const slidesTextPath = path.join(SRC, 'shared/slides-text.ts');
  if (fileExists(slidesTextPath)) {
    fs.unlinkSync(slidesTextPath);
    log('Deleted shared/slides-text.ts');
  }
}

// ─── Step 3: Remove old provider refs from CLI files ────────────────────────

function removeOldProviderRefs(project: Project): void {
  // These are the old provider-related names to find and remove
  const oldProviderNames = [
    'zaiApiKey',
    'zaiBaseUrl',
    'zai.',
    'nvidiaApiKey',
    'nvidiaBaseUrl',
    'nvidia.',
    'anthropicApiKey',
    'anthropicConfigured',
    'anthropic.',
    'googleApiKey',
    'googleConfigured',
    'google.',
    'xaiApiKey',
    'xai.',
    'openaiApiKey', // Only as a provider (not openrouter)
  ];

  const oldProviderKeywords = [
    'providerBaseUrls',
    'keyFlags',
    'resolveGitHubModelsApiKey',
    'getLiteLlmCatalog',
  ];

  // Files that need provider cleanup (CLI files, not core library files)
  const cliFilesWithProviders = [
    'model-spec.ts',
    'run/flows/asset/media.ts',
    'run/flows/asset/output.ts',
    'run/flows/asset/preprocess.ts',
    'run/flows/asset/summary-attempts.ts',
    'run/flows/asset/summary.ts',
    'run/flows/url/extraction-session.ts',
    'run/flows/url/flow.ts',
    'run/flows/url/markdown.ts',
    'run/flows/url/summary-json.ts',
    'run/flows/url/summary-resolution.ts',
    'run/run-env.ts',
    'run/runner-contexts.ts',
    'run/runner-execution.ts',
    'run/runner-plan.ts',
    'run/summary-engine.ts',
    'run/types.ts',
  ];

  for (const relativePath of cliFilesWithProviders) {
    const filePath = path.join(SRC, relativePath);
    if (!fileExists(filePath)) {
      continue;
    }

    const sourceFile = project.addSourceFileAtPath(filePath);

    // This is complex - we need to remove dead branches, unused variables, etc.
    // For now, let's just track what needs manual review
    const content = sourceFile.getFullText();

    // Check for old provider references
    for (const name of [...oldProviderNames, ...oldProviderKeywords]) {
      if (content.includes(name)) {
        log(`Found "${name}" in ${relativePath} — needs manual cleanup`);
      }
    }
  }
}

// ─── Step 4: Remove pricing/litellm references ──────────────────────────────

function removeLitellmRefs(project: Project): void {
  // Find and remove imports from pricing/litellm.js
  const litellmImportPatterns = ['pricing/litellm.js', 'pricing/litellm.ts'];

  const filesToCheck = ['run/flows/asset/summary.ts'];

  for (const relativePath of filesToCheck) {
    const filePath = path.join(SRC, relativePath);
    if (!fileExists(filePath)) {
      continue;
    }

    const sourceFile = project.addSourceFileAtPath(filePath);

    for (const importDecl of sourceFile.getImportDeclarations()) {
      const specifier = importDecl.getModuleSpecifier()?.value ?? '';
      if (litellmImportPatterns.some((p) => specifier.includes(p))) {
        importDecl.remove();
        log(`Removed litellm import from ${relativePath}`);
      }
    }
  }
}

// ─── Step 5: Fix bird module issues ─────────────────────────────────────────

function fixBirdModule(project: Project): void {
  // Check what's exported from bird/index.ts
  const birdIndexPath = path.join(SRC, 'run/bird/index.ts');

  if (fileExists(birdIndexPath)) {
    const sourceFile = project.addSourceFileAtPath(birdIndexPath);
    const exports = sourceFile.getExportedDeclarations();

    // Check what's being imported that doesn't exist
    const neededExports = ['readTweetWithPreferredClient'];
    for (const name of neededExports) {
      if (!exports.has(name)) {
        log(`bird/index.ts missing export: ${name}`);
      } else {
        log(`bird/index.ts has export: ${name} ✓`);
      }
    }
  }

  // Check bird parse.ts for unused imports and wrong types
  const birdParsePath = path.join(SRC, 'run/bird/parse.ts');
  if (fileExists(birdParsePath)) {
    const sourceFile = project.addSourceFileAtPath(birdParsePath);

    // Remove unused imports
    for (const importDecl of sourceFile.getImportDeclarations()) {
      const namedImports = importDecl.getNamedImports();
      const toRemove: string[] = [];

      for (const ni of namedImports) {
        const name = ni.getName();
        // Check if this identifier is actually used in the file
        const references = sourceFile
          .getDescendantsOfKind(SyntaxKind.Identifier)
          .filter((d) => d.getText() === name);

        // Filter out references that are part of the import itself
        const actualUses = references.filter(
          (r) =>
            !r
              .getParentIfKind(SyntaxKind.ImportSpecifier)
              ?.getParentIfKind(SyntaxKind.ImportClause)
              ?.getSourceFile()
              .isSame(sourceFile),
        );

        // Simple heuristic: if only used in import, remove it
        const allIdentifiers = sourceFile.getDescendantsOfKind(SyntaxKind.Identifier);
        const count = allIdentifiers.filter(
          (i) => i.getText() === name && !i.isPartOf(importDecl),
        ).length;

        if (count === 0) {
          toRemove.push(name);
        }
      }

      for (const name of toRemove) {
        const ni = namedImports.find((n) => n.getName() === name);
        if (ni) {
          ni.remove();
          log(`Removed unused import from bird/parse.ts: ${name}`);
        }
      }
    }

    sourceFile.saveSync();
    log('Saved bird/parse.ts with cleaned imports');
  }
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    tsConfigFilePath: path.join(GIST_ROOT, 'tsconfig.build.json'),
  });

  // Add all source files to the project
  const srcFiles = fs
    .readdirSync(SRC, { recursive: true })
    .filter((f: string) => f.endsWith('.ts') && !f.includes('node_modules'))
    .map((f: string) => path.join(SRC, f));

  for (const filePath of srcFiles) {
    try {
      project.addSourceFileAtPath(filePath);
    } catch {
      // Skip files that can't be parsed
    }
  }

  // Step 1: Fix cache exports

  fixCacheExports(project);

  // Step 2: Remove slides code

  removeSlidesCode(project);

  // Step 3: Remove old provider refs

  removeOldProviderRefs(project);

  // Step 4: Remove litellm refs

  removeLitellmRefs(project);

  // Step 5: Fix bird module

  fixBirdModule(project);
}
