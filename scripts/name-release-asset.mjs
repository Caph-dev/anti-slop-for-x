#!/usr/bin/env node
/**
 * WXT names its zip `anti-slop-for-x-extension-<version>-<browser>.zip`.
 * Releases use `v<version>.zip`, so this renames the artifact in place and
 * leaves exactly one zip in extension/.output.
 */
import { existsSync, readdirSync, readFileSync, renameSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'extension', '.output');

if (!existsSync(outDir)) {
  console.error('No extension/.output — run "npm run zip" first.');
  process.exit(1);
}

const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const target = path.join(outDir, `v${pkg.version}.zip`);

const zips = readdirSync(outDir).filter((name) => name.endsWith('.zip'));
if (zips.length === 0) {
  console.error('No zip in extension/.output — run "npm run zip" first.');
  process.exit(1);
}

if (zips.length > 1) {
  console.error(`Expected one zip, found ${zips.length}: ${zips.join(', ')}`);
  process.exit(1);
}

const source = path.join(outDir, zips[0]);
if (source !== target) {
  rmSync(target, { force: true });
  renameSync(source, target);
}

console.log(`Release asset: ${path.relative(root, target)}`);
