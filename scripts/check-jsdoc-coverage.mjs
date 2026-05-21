#!/usr/bin/env node
/**
 * @fileoverview Checks source-level JSDoc coverage for StarMade-Decoder.
 *
 * The project intentionally documents both exported APIs and internal helpers.
 * This script keeps that contract executable by requiring every source file to
 * start with a file overview and every top-level declaration or callable class
 * member to have a JSDoc block.
 */

import ts from 'typescript';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const sourceRoot = join(projectRoot, 'src');

function listTypeScriptFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      out.push(...listTypeScriptFiles(path));
    } else if (path.endsWith('.ts')) {
      out.push(path);
    }
  }
  return out.sort();
}

function hasLeadingJsDoc(sourceFile, node) {
  const comments = ts.getLeadingCommentRanges(sourceFile.text, node.pos) ?? [];
  return comments.some((comment) => {
    const text = sourceFile.text.slice(comment.pos, comment.end);
    return text.startsWith('/**') && !/@fileoverview\b/.test(text);
  });
}

function hasFileOverview(source) {
  const shebangStripped = source.startsWith('#!') ? source.slice(source.indexOf('\n') + 1) : source;
  const trimmedStart = shebangStripped.trimStart();
  if (!trimmedStart.startsWith('/**')) {
    return false;
  }
  const end = trimmedStart.indexOf('*/');
  return end >= 0 && /@fileoverview\b/.test(trimmedStart.slice(0, end));
}

function isTopLevel(node) {
  return node.parent && ts.isSourceFile(node.parent);
}

function isClassMember(node) {
  return node.parent && ts.isClassDeclaration(node.parent);
}

function isInterfaceMethod(node) {
  return node.parent && ts.isInterfaceDeclaration(node.parent);
}

function isDocumentedDeclaration(node) {
  if (
    ts.isFunctionDeclaration(node) ||
    ts.isClassDeclaration(node) ||
    ts.isInterfaceDeclaration(node) ||
    ts.isTypeAliasDeclaration(node) ||
    ts.isEnumDeclaration(node) ||
    ts.isVariableStatement(node)
  ) {
    return isTopLevel(node);
  }
  if (
    ts.isMethodDeclaration(node) ||
    ts.isConstructorDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node)
  ) {
    return isClassMember(node);
  }
  if (ts.isMethodSignature(node)) {
    return isInterfaceMethod(node);
  }
  return false;
}

function declarationName(sourceFile, node) {
  if (ts.isConstructorDeclaration(node)) {
    return 'constructor';
  }
  if (ts.isVariableStatement(node)) {
    return node.declarationList.declarations.map(declaration => declaration.name.getText(sourceFile)).join(', ');
  }
  return node.name?.getText(sourceFile) ?? '<anonymous>';
}

function checkFile(path) {
  const source = readFileSync(path, 'utf8');
  const sourceFile = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  const missing = [];

  if (!hasFileOverview(source)) {
    missing.push({ line: 1, kind: 'FileOverview', name: '@fileoverview' });
  }

  function visit(node) {
    if (isDocumentedDeclaration(node) && !hasLeadingJsDoc(sourceFile, node)) {
      const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
      missing.push({
        line: line + 1,
        kind: ts.SyntaxKind[node.kind],
        name: declarationName(sourceFile, node),
      });
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return missing;
}

if (!existsSync(sourceRoot)) {
  console.error(`Source directory not found: ${sourceRoot}`);
  process.exit(2);
}

const failures = [];
for (const file of listTypeScriptFiles(sourceRoot)) {
  const missing = checkFile(file);
  for (const issue of missing) {
    failures.push({ file: relative(projectRoot, file), ...issue });
  }
}

if (failures.length > 0) {
  console.error(`JSDoc coverage check failed: ${failures.length} missing documentation blocks.`);
  for (const issue of failures.slice(0, 200)) {
    console.error(`${issue.file}:${issue.line} ${issue.kind} ${issue.name}`);
  }
  if (failures.length > 200) {
    console.error(`...and ${failures.length - 200} more.`);
  }
  process.exit(1);
}

console.log('JSDoc coverage check passed: source file overviews and declaration docs are complete.');
