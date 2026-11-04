#!/usr/bin/env node
/**
 * WXT names its zip `anti-slop-for-x-extension-<version>-<browser>.zip`, but
 * releases use `v<version>.zip`, so this renames the artifact in place and
 * leaves exactly one top-level zip in `extension/.output`.
 *
 * Selection is by content, never by filename: the version is read out of each
 * zip's own `manifest.json`, and only an artifact whose manifest version equals
 * `package.json`'s version may become the release asset.
 *
 * - More than one unnamed candidate for the current version is ambiguous and
 *   fails the build rather than picking one.
 * - A zip built for another version (a leftover from an earlier release) is
 *   moved into `.output/stale/` under a unique name instead of failing the
 *   whole release build. It is never renamed to the release asset, so a stale
 *   artifact cannot be published as the new version by accident.
 * - An existing asset with the release name is archived into `.output/stale/`
 *   before the newcomer takes its place, so no earlier bytes are destroyed.
 * - A zip whose manifest cannot be read is an error and nothing is moved: an
 *   unreadable archive is not evidence of a stale one.
 * - Symbolic links are refused for top-level zips, and `stale/` is checked
 *   whenever something is archived, so a link cannot redirect an archive or a
 *   rename outside `.output`.
 * - Archived names are never reused: occupancy is decided with lstat, so a
 *   dangling link also keeps its directory entry instead of being replaced.
 *
 * The zip reader is deliberately narrow: it reads the version of a trusted WXT
 * artifact. It does not verify checksums, does not support zip64, and a
 * successful read is not a statement about archive integrity.
 */
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const ZIP64_SENTINEL = 0xffffffff;
const ZIP64_COUNT_SENTINEL = 0xffff;

/** Read one entry out of a zip buffer using the central directory. */
function readZipEntry(buffer, entryName) {
  // The end-of-central-directory record ends where the archive ends; requiring
  // that keeps trailing garbage from being mistaken for an archive.
  let eocd = -1;
  const floor = Math.max(0, buffer.length - 22 - 0xffff);
  for (let i = buffer.length - 22; i >= floor; i -= 1) {
    if (buffer.readUInt32LE(i) !== EOCD_SIGNATURE) continue;
    if (i + 22 + buffer.readUInt16LE(i + 20) === buffer.length) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a zip archive');

  const count = buffer.readUInt16LE(eocd + 10);
  const directorySize = buffer.readUInt32LE(eocd + 12);
  const directoryOffset = buffer.readUInt32LE(eocd + 16);
  if (count === ZIP64_COUNT_SENTINEL || directoryOffset === ZIP64_SENTINEL) throw new Error('zip64 is not supported');
  if (directoryOffset + directorySize > buffer.length) throw new Error('corrupt central directory');

  let pointer = directoryOffset;
  let found = null;
  for (let index = 0; index < count; index += 1) {
    if (pointer + 46 > buffer.length || buffer.readUInt32LE(pointer) !== CENTRAL_SIGNATURE) {
      throw new Error('corrupt central directory');
    }
    const method = buffer.readUInt16LE(pointer + 10);
    const compressedSize = buffer.readUInt32LE(pointer + 20);
    const nameLength = buffer.readUInt16LE(pointer + 28);
    const extraLength = buffer.readUInt16LE(pointer + 30);
    const commentLength = buffer.readUInt16LE(pointer + 32);
    const localOffset = buffer.readUInt32LE(pointer + 42);
    const name = buffer.toString('utf8', pointer + 46, pointer + 46 + nameLength);

    if (name === entryName) {
      // Two entries with the same name leave it to the reader to pick one, so
      // refuse instead of reporting a version that an unzip tool may disagree with.
      if (found !== null) throw new Error(`duplicate ${entryName}`);
      if (localOffset === ZIP64_SENTINEL || compressedSize === ZIP64_SENTINEL) throw new Error('zip64 is not supported');
      if (localOffset + 30 > buffer.length || buffer.readUInt32LE(localOffset) !== LOCAL_SIGNATURE) {
        throw new Error('corrupt local header');
      }
      const dataStart = localOffset + 30 + buffer.readUInt16LE(localOffset + 26) + buffer.readUInt16LE(localOffset + 28);
      const end = dataStart + compressedSize;
      if (end > buffer.length) throw new Error('truncated entry');
      const raw = buffer.subarray(dataStart, end);
      if (method === 0) found = raw;
      else if (method === 8) found = inflateRawSync(raw);
      else throw new Error(`unsupported compression method ${method}`);
    }
    pointer += 46 + nameLength + extraLength + commentLength;
  }
  return found;
}

/** The `version` field of the manifest stored inside a zip. */
export function zipManifestVersion(zipPath) {
  const manifest = readZipEntry(readFileSync(zipPath), 'manifest.json');
  if (!manifest) throw new Error('no manifest.json');
  const parsed = JSON.parse(manifest.toString('utf8'));
  const version = parsed?.version;
  if (typeof version !== 'string' || version.length === 0) throw new Error('manifest has no version');
  return version;
}

/** Whether a directory entry exists, including a dangling symbolic link. */
function isOccupied(target) {
  try {
    lstatSync(target);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

/** A free name inside `stale/`, never reusing (and so never overwriting) one. */
function freeArchivePath(staleDir, name) {
  const extension = path.extname(name);
  const stem = name.slice(0, name.length - extension.length);
  let candidate = path.join(staleDir, name);
  for (let suffix = 2; isOccupied(candidate); suffix += 1) {
    candidate = path.join(staleDir, `${stem}-${suffix}${extension}`);
  }
  return candidate;
}

function ensureStaleDirectory(staleDir) {
  try {
    // lstat so a link pointing at some other directory (or dangling) is refused, not followed.
    if (!lstatSync(staleDir).isDirectory()) throw new Error(`refusing ${staleDir}: not a plain directory`);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    mkdirSync(staleDir, { recursive: true });
  }
}

function archive(staleDir, sourcePath) {
  ensureStaleDirectory(staleDir);
  const destination = freeArchivePath(staleDir, path.basename(sourcePath));
  renameSync(sourcePath, destination);
  return destination;
}

/**
 * Rename the artifact built for `version` to the release asset name, archive
 * anything else aside, and report what happened. Throws rather than guessing
 * whenever the release asset would be ambiguous.
 */
export function nameReleaseAsset({ outDir, version }) {
  if (typeof version !== 'string' || version.length === 0) throw new Error('version is required');
  if (!existsSync(outDir)) throw new Error(`no output directory at ${outDir}`);

  const staleDir = path.join(outDir, 'stale');
  const targetName = `v${version}.zip`;
  const target = path.join(outDir, targetName);

  const entries = readdirSync(outDir, { withFileTypes: true }).filter((entry) => entry.name.endsWith('.zip'));
  for (const entry of entries) {
    if (!entry.isFile()) throw new Error(`refusing ${entry.name}: not a regular file`);
  }

  const zips = entries
    .map((entry) => entry.name)
    .sort()
    .map((name) => {
      try {
        return { name, version: zipManifestVersion(path.join(outDir, name)) };
      } catch (error) {
        throw new Error(`cannot verify ${name}: ${error.message}`);
      }
    });

  const current = zips.filter((zip) => zip.version === version);
  const stale = zips.filter((zip) => zip.version !== version);
  const candidates = current.filter((zip) => zip.name !== targetName);
  const alreadyNamed = current.some((zip) => zip.name === targetName);

  if (candidates.length > 1) {
    throw new Error(`ambiguous: ${candidates.length} zips claim v${version}: ${candidates.map((zip) => zip.name).join(', ')}`);
  }
  if (candidates.length === 0 && !alreadyNamed) {
    const found = zips.length > 0
      ? ` found only: ${zips.map((zip) => `${zip.name} (v${zip.version})`).join(', ')}`
      : '';
    throw new Error(`no zip built for v${version} — run "npm run zip" first.${found}`);
  }

  const archived = [];
  for (const zip of stale) {
    archived.push(path.basename(archive(staleDir, path.join(outDir, zip.name))));
  }

  let renamed = false;
  if (candidates.length === 1) {
    // The previous asset is archived, never deleted, before the newcomer lands.
    if (existsSync(target)) archived.push(path.basename(archive(staleDir, target)));
    renameSync(path.join(outDir, candidates[0].name), target);
    renamed = true;
  }

  return { assetPath: target, assetName: targetName, version, renamed, archived, staleDir };
}

function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const outDir = path.join(root, 'extension', '.output');
  if (!existsSync(outDir)) {
    console.error('No extension/.output — run "npm run zip" first.');
    process.exitCode = 1;
    return;
  }
  const { version } = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  try {
    const result = nameReleaseAsset({ outDir, version });
    for (const name of result.archived) {
      console.log(`Archived ${name} → ${path.relative(root, path.join(result.staleDir, name))}`);
    }
    console.log(`Release asset: ${path.relative(root, result.assetPath)}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

function isMain() {
  if (typeof import.meta.main === 'boolean') return import.meta.main;
  if (!process.argv[1] || process.execArgv.some((arg) => /^-[ep]/.test(arg) || /^--(?:eval|print)(?:=|$)/.test(arg))) return false;
  try {
    const entry = statSync(process.argv[1], { bigint: true });
    const module = statSync(new URL(import.meta.url), { bigint: true });
    return entry.dev === module.dev && entry.ino === module.ino;
  } catch { return false; }
}

if (isMain()) main();
