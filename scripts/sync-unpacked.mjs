#!/usr/bin/env node
/**
 * Mirror the WXT build into a stable folder that Chrome can keep loaded via
 * "Load unpacked".
 *
 * Why a copy instead of loading `.output/chrome-mv3` directly: every build
 * rewrites that folder (and drops hashed chunks), so a Chrome tab pointed at it
 * breaks until the extension is reloaded. This folder is replaced as a whole,
 * so no stale chunks survive.
 *
 * The copy lands in a staging folder first and is renamed into place, so Chrome
 * never observes a half-written extension.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'extension', '.output', 'chrome-mv3');
const outRoot = path.join(root, 'unpacked');
const target = path.join(outRoot, 'chrome-mv3');
const staging = path.join(outRoot, `.chrome-mv3.tmp-${process.pid}`);

if (!existsSync(path.join(source, 'manifest.json'))) {
  console.error(`No build at ${path.relative(root, source)} — run "npm run build" first.`);
  process.exit(1);
}

// Safety: only ever replace unpacked/chrome-mv3, never unpacked/ itself.
if (path.basename(target) !== 'chrome-mv3' || path.dirname(target) !== outRoot) {
  console.error(`Refusing to replace unexpected path: ${target}`);
  process.exit(1);
}

mkdirSync(outRoot, { recursive: true });
rmSync(staging, { recursive: true, force: true });
cpSync(source, staging, { recursive: true });
rmSync(target, { recursive: true, force: true });
renameSync(staging, target);

const manifest = JSON.parse(readFileSync(path.join(target, 'manifest.json'), 'utf8'));
console.log(`Unpacked build ready: ${path.relative(root, target)}/ (v${manifest.version})`);
console.log('Load or reload it at chrome://extensions → Developer mode → Load unpacked.');
