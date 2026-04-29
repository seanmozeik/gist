#!/usr/bin/env bun
/** Step 1: Fix cache.ts missing re-exports from cache-keys.js */

import path from 'node:path';

import { Project } from 'ts-morph';

const GIST_ROOT = '/home/yolo/gist';
const SRC = path.join(GIST_ROOT, 'src');

const project = new Project({ skipAddingFilesFromTsConfig: true });
const filePath = path.join(SRC, 'cache.ts');

const sourceFile = project.addSourceFileAtPath(filePath);

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

// Find the import from cache-keys.js and add missing names
const importDecl = sourceFile.getImportDeclaration(
  (d) => d.getModuleSpecifier()?.value === './cache-keys.js',
);

if (importDecl) {
  const existingNames = new Set(importDecl.getNamedImports().map((ni) => ni.getName()));
  const toAdd: string[] = [];

  for (const name of missingExports) {
    if (!existingNames.has(name)) {
      toAdd.push(name);
    }
  }

  for (const name of toAdd) {
    importDecl.addNamedImport(name);
  }
}

// Find the re-export from cache-keys.js and add missing names
const exportDecl = sourceFile.getExportDeclaration(
  (d) => d.getModuleSpecifier()?.value === './cache-keys.js',
);

if (exportDecl) {
  const existingNames = new Set(exportDecl.getNamedImports().map((ni) => ni.getName()));
  const toAdd: string[] = [];

  for (const name of missingExports) {
    if (!existingNames.has(name)) {
      toAdd.push(name);
    }
  }

  for (const name of toAdd) {
    exportDecl.addNamedImport(name);
  }
}

sourceFile.saveSync();
