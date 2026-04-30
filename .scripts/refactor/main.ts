#!/usr/bin/env bun
/**
 * Gist Refactor — AST-based cleanup
 */

import fs from 'node:fs';
import path from 'node:path';

import { Project } from 'ts-morph';

const GIST_ROOT = '/home/yolo/gist';
const SRC = path.join(GIST_ROOT, 'src');

function log(msg: string) {
  /* Empty */
}

// ─── Step 1: Fix cache.ts missing re-exports ────────────────────────────────

function fixCacheExports(): void {
  const filePath = path.join(SRC, 'cache.ts');
  if (!fs.existsSync(filePath)) {
    return;
  }

  const project = new Project({ skipAddingFilesFromTsConfig: true });
  const sf = project.addSourceFileAtPath(filePath);

  const missing = [
    'buildLanguageKey',
    'buildLengthKey',
    'buildPromptContentHash',
    'buildPromptHash',
    'hashJson',
    'hashString',
    'normalizeContentForHash',
    'extractTaggedBlock',
  ];

  // Add to import from cache-keys.js
  const imp = sf.getImportDeclaration((d) => d.getModuleSpecifier()?.value === './cache-keys.js');
  if (imp) {
    const existing = new Set(imp.getNamedImports().map((n) => n.getName()));
    for (const name of missing) {
      if (!existing.has(name)) {
        imp.addNamedImport(name);
        log(`import ${name}`);
      }
    }
  }

  // Add to re-export from cache-keys.js
  const exp = sf.getExportDeclaration((d) => d.getModuleSpecifier()?.value === './cache-keys.js');
  if (exp) {
    const existing = new Set(exp.getNamedImports().map((n) => n.getName()));
    for (const name of missing) {
      if (!existing.has(name)) {
        exp.addNamedImport(name);
        log(`export ${name}`);
      }
    }
  }

  sf.saveSync();
}

// ─── Step 2: Delete slides-related files entirely ──────────────────────────

function deleteSlidesFiles(): void {
  const files = ['run/runner-slides.ts', 'shared/slides-text.ts'];
  for (const rel of files) {
    const fp = path.join(SRC, rel);
    if (fs.existsSync(fp)) {
      fs.unlinkSync(fp);
      log(`Deleted ${rel}`);
    }
  }
}

// ─── Step 3: Remove slides imports from all files ──────────────────────────

function removeSlidesImports(): void {
  const slideSpecifiers = [
    'slides/index.js',
    'slides-session.js',
    'slides-output.js',
    'slides-text.js',
  ];
  const slideNames = new Set([
    'SlidesTerminalOutput',
    'SlideExtractionResult',
    'extractSlidesForSource',
    'resolveSlideSource',
    'normalizeSummarySlideHeadings',
    'shouldBypassShortContentSummary',
    'buildModelMetaFromAttempt',
    'createUrlSlidesSession',
  ]);

  const allFiles = fs
    .readdirSync(SRC, { recursive: true })
    .filter((f: string) => f.endsWith('.ts') && !f.includes('node_modules'))
    .map((f: string) => path.join(SRC, f));

  for (const filePath of allFiles) {
    const project = new Project({ skipAddingFilesFromTsConfig: true });
    const sf = project.addSourceFileAtPath(filePath);
    let changed = false;

    // Remove import declarations with slide specifiers
    for (const imp of sf.getImportDeclarations()) {
      const spec = imp.getModuleSpecifier()?.value ?? '';
      if (slideSpecifiers.some((s) => spec.includes(s))) {
        imp.remove();
        changed = true;
      }
    }

    // Remove slide-related named imports from other modules
    for (const imp of sf.getImportDeclarations()) {
      const toRemove: any[] = [];
      for (const ni of imp.getNamedImports()) {
        if (slideNames.has(ni.getName())) {
          toRemove.push(ni);
          log(`Removed slide name from ${path.relative(SRC, filePath)}: ${ni.getName()}`);
        }
      }
      for (const ni of toRemove) {
        ni.remove();
        changed = true;
      }
    }

    if (changed) {
      sf.saveSync();
      log(`Saved ${path.relative(SRC, filePath)}`);
    }
  }
}

// ─── Step 4: Remove litellm imports ────────────────────────────────────────

function removeLitellmImports(): void {
  const allFiles = fs
    .readdirSync(SRC, { recursive: true })
    .filter((f: string) => f.endsWith('.ts') && !f.includes('node_modules'))
    .map((f: string) => path.join(SRC, f));

  for (const filePath of allFiles) {
    const project = new Project({ skipAddingFilesFromTsConfig: true });
    const sf = project.addSourceFileAtPath(filePath);
    let changed = false;

    for (const imp of sf.getImportDeclarations()) {
      const spec = imp.getModuleSpecifier()?.value ?? '';
      if (spec.includes('litellm')) {
        imp.remove();
        changed = true;
        log(`Removed litellm import from ${path.relative(SRC, filePath)}`);
      }
    }

    if (changed) {
      sf.saveSync();
    }
  }
}

// ─── Step 5: Handle cookies/twitter.ts ──────────────────────────────────────

function handleCookiesTwitter(): void {
  const cookiesPath = path.join(SRC, 'run/cookies/twitter.ts');
  if (!fs.existsSync(cookiesPath)) {
    return;
  }

  const allFiles = fs
    .readdirSync(SRC, { recursive: true })
    .filter((f: string) => f.endsWith('.ts') && !f.includes('node_modules'))
    .map((f: string) => path.join(SRC, f));

  const neededBy: string[] = [];
  for (const filePath of allFiles) {
    const content = fs.readFileSync(filePath, 'utf8');
    if (content.includes('cookies/twitter')) {
      neededBy.push(path.relative(SRC, filePath));
    }
  }
}

// ─── Step 6: Fix bird module imports ────────────────────────────────────────

function fixBirdImports(): void {
  // Check what's exported from bird/index.ts
  const birdIndexPath = path.join(SRC, 'run/bird/index.ts');
  if (!fs.existsSync(birdIndexPath)) {
    return;
  }

  const project = new Project({ skipAddingFilesFromTsConfig: true });
  const sf = project.addSourceFileAtPath(birdIndexPath);
  const exports = sf.getExportedDeclarations();

  // Check what's imported from bird in other files
  const allFiles = fs
    .readdirSync(SRC, { recursive: true })
    .filter((f: string) => f.endsWith('.ts') && !f.includes('node_modules'))
    .map((f: string) => path.join(SRC, f));

  for (const filePath of allFiles) {
    const content = fs.readFileSync(filePath, 'utf8');
    const match = /import\s*\{([^}]+)\}\s*from\s*['"]\.\.\/\.\.\/bird\.js['"]/.exec(content);
    if (match) {
      const imports = match[1].split(',').map((s) => s.trim());
      for (const imp of imports) {
        if (!exports.has(imp)) {
          log(`bird.js missing export needed by ${path.relative(SRC, filePath)}: ${imp}`);
        }
      }
    }
  }
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  fixCacheExports();
  deleteSlidesFiles();
  removeSlidesImports();
  removeLitellmImports();
  handleCookiesTwitter();
  fixBirdImports();
}
