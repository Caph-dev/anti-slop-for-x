import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nameReleaseAsset, zipManifestVersion } from '../name-release-asset.mjs';

/**
 * Minimal zip writer (store or deflate) so fixtures need no dependency.
 * CRC is left at 0: the script reads through the central directory and never
 * validates checksums, which is exactly the surface under test.
 * Accepts an array of [name, content] pairs so duplicate names can be written.
 */
function buildZip(pairs, { deflate = false } = {}) {
  const files = Array.isArray(pairs) ? pairs : Object.entries(pairs);
  const locals = [];
  const central = [];
  let offset = 0;
  for (const [name, content] of files) {
    const data = Buffer.from(content);
    const nameBytes = Buffer.from(name);
    const stored = deflate ? deflateRawSync(data) : data;
    const method = deflate ? 8 : 0;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(0, 14);
    local.writeUInt32LE(stored.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    locals.push(local, nameBytes, stored);

    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(0, 8);
    entry.writeUInt16LE(method, 10);
    entry.writeUInt32LE(0, 16);
    entry.writeUInt32LE(stored.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(nameBytes.length, 28);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, nameBytes);

    offset += 30 + nameBytes.length + stored.length;
  }

  const centralBytes = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralBytes.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBytes, eocd]);
}

const manifestOf = (version) => JSON.stringify({ manifest_version: 3, name: '__MSG_extName__', version });
const zipFor = (version, extra = {}) => buildZip({ 'manifest.json': manifestOf(version), ...extra });

function withWorkspace(fill, run) {
  const directory = mkdtempSync(join(tmpdir(), 'release-asset-'));
  try {
    fill(directory);
    return run(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

const write = (directory, name, content) => writeFileSync(join(directory, name), content);
const zipsIn = (directory) => readdirSync(directory).filter((name) => name.endsWith('.zip')).sort();
const staleDir = (directory) => join(directory, 'stale');
const staleIn = (directory) => (existsSync(staleDir(directory)) ? readdirSync(staleDir(directory)).sort() : []);

test('renames the artifact whose manifest matches and archives an older one', () => {
  withWorkspace((directory) => {
    write(directory, 'anti-slop-for-x-extension-0.10.0-chrome.zip', zipFor('0.10.0'));
    write(directory, 'v0.9.0.zip', zipFor('0.9.0', { 'a.js': 'old-build' }));
  }, (directory) => {
    const result = nameReleaseAsset({ outDir: directory, version: '0.10.0' });
    assert.equal(result.renamed, true);
    assert.equal(result.assetName, 'v0.10.0.zip');
    assert.deepEqual(zipsIn(directory), ['v0.10.0.zip'], 'one top-level zip is left');
    assert.deepEqual(result.archived, ['v0.9.0.zip']);
    assert.deepEqual(staleIn(directory), ['v0.9.0.zip'], 'the stale zip is kept, not deleted');
    assert.equal(readFileSync(join(staleDir(directory), 'v0.9.0.zip')).equals(zipFor('0.9.0', { 'a.js': 'old-build' })), true);
    assert.equal(zipManifestVersion(join(directory, 'v0.10.0.zip')), '0.10.0');
  });
});

test('never promotes a stale artifact to the current version', () => {
  withWorkspace((directory) => {
    write(directory, 'v0.9.0.zip', zipFor('0.9.0'));
  }, (directory) => {
    assert.throws(() => nameReleaseAsset({ outDir: directory, version: '0.10.0' }), /no zip built for v0\.10\.0/);
    assert.deepEqual(zipsIn(directory), ['v0.9.0.zip']);
    assert.equal(existsSync(join(directory, 'v0.10.0.zip')), false);
    assert.equal(existsSync(staleDir(directory)), false, 'nothing is archived when there is no build');
  });
});

test('a candidate replaces the already-named asset and keeps the old bytes', () => {
  const oldAsset = zipFor('0.10.0', { 'a.js': 'previous-build' });
  const candidate = zipFor('0.10.0', { 'a.js': 'current-build' });
  withWorkspace((directory) => {
    write(directory, 'anti-slop-for-x-extension-0.10.0-chrome.zip', candidate);
    write(directory, 'v0.10.0.zip', oldAsset);
  }, (directory) => {
    const result = nameReleaseAsset({ outDir: directory, version: '0.10.0' });
    assert.equal(result.renamed, true);
    assert.deepEqual(zipsIn(directory), ['v0.10.0.zip']);
    assert.equal(readFileSync(join(directory, 'v0.10.0.zip')).equals(candidate), true, 'the asset is the candidate, byte for byte');
    assert.deepEqual(result.archived, ['v0.10.0.zip']);
    assert.equal(readFileSync(join(staleDir(directory), 'v0.10.0.zip')).equals(oldAsset), true, 'the previous asset is archived, not deleted');
  });
});

test('is idempotent when only the asset name is left', () => {
  withWorkspace((directory) => {
    write(directory, 'v0.10.0.zip', zipFor('0.10.0'));
  }, (directory) => {
    const result = nameReleaseAsset({ outDir: directory, version: '0.10.0' });
    assert.equal(result.renamed, false);
    assert.deepEqual(result.archived, []);
    assert.deepEqual(zipsIn(directory), ['v0.10.0.zip']);
    assert.equal(existsSync(staleDir(directory)), false);
  });
});

test('two unnamed candidates for the same version are ambiguous and nothing moves', () => {
  withWorkspace((directory) => {
    write(directory, 'anti-slop-for-x-extension-0.10.0-chrome.zip', zipFor('0.10.0'));
    write(directory, 'anti-slop-for-x-extension-0.10.0-firefox.zip', zipFor('0.10.0'));
    write(directory, 'v0.9.0.zip', zipFor('0.9.0'));
  }, (directory) => {
    assert.throws(() => nameReleaseAsset({ outDir: directory, version: '0.10.0' }), /ambiguous/);
    assert.deepEqual(zipsIn(directory), [
      'anti-slop-for-x-extension-0.10.0-chrome.zip',
      'anti-slop-for-x-extension-0.10.0-firefox.zip',
      'v0.9.0.zip',
    ]);
    assert.equal(existsSync(staleDir(directory)), false);
  });
});

test('two zips with the same name in one archive are refused', () => {
  withWorkspace((directory) => {
    write(directory, 'anti-slop-for-x-extension-0.10.0-chrome.zip', buildZip([
      ['manifest.json', manifestOf('0.10.0')],
      ['manifest.json', manifestOf('0.9.0')],
    ]));
  }, (directory) => {
    assert.throws(() => nameReleaseAsset({ outDir: directory, version: '0.10.0' }), /duplicate manifest\.json/);
    assert.deepEqual(zipsIn(directory), ['anti-slop-for-x-extension-0.10.0-chrome.zip']);
  });
});

test('an unreadable zip is an error, never a stale zip', () => {
  withWorkspace((directory) => {
    write(directory, 'anti-slop-for-x-extension-0.10.0-chrome.zip', zipFor('0.10.0'));
    write(directory, 'broken.zip', Buffer.from('not a zip at all'));
  }, (directory) => {
    assert.throws(() => nameReleaseAsset({ outDir: directory, version: '0.10.0' }), /cannot verify broken\.zip/);
    assert.deepEqual(zipsIn(directory), ['anti-slop-for-x-extension-0.10.0-chrome.zip', 'broken.zip']);
    assert.equal(existsSync(staleDir(directory)), false);
  });
});

test('trailing bytes after the archive are not accepted as a zip', () => {
  withWorkspace((directory) => {
    write(directory, 'anti-slop-for-x-extension-0.10.0-chrome.zip', Buffer.concat([zipFor('0.10.0'), Buffer.from('junk')]));
  }, (directory) => {
    assert.throws(() => nameReleaseAsset({ outDir: directory, version: '0.10.0' }), /not a zip archive/);
  });
});

test('a zip without a manifest version is rejected', () => {
  withWorkspace((directory) => {
    write(directory, 'anti-slop-for-x-extension-0.10.0-chrome.zip', buildZip({ 'manifest.json': JSON.stringify({ manifest_version: 3 }) }));
  }, (directory) => {
    assert.throws(() => nameReleaseAsset({ outDir: directory, version: '0.10.0' }), /manifest has no version/);
    assert.deepEqual(zipsIn(directory), ['anti-slop-for-x-extension-0.10.0-chrome.zip']);
  });
});

test('a zip without a manifest at all is rejected', () => {
  withWorkspace((directory) => {
    write(directory, 'anti-slop-for-x-extension-0.10.0-chrome.zip', buildZip({ 'content.js': 'x' }));
  }, (directory) => {
    assert.throws(() => nameReleaseAsset({ outDir: directory, version: '0.10.0' }), /no manifest\.json/);
  });
});

test('deflated manifests are read too', () => {
  withWorkspace((directory) => {
    write(directory, 'anti-slop-for-x-extension-0.10.0-chrome.zip', buildZip({ 'manifest.json': manifestOf('0.10.0'), 'a.js': 'x'.repeat(400) }, { deflate: true }));
  }, (directory) => {
    assert.equal(zipManifestVersion(join(directory, 'anti-slop-for-x-extension-0.10.0-chrome.zip')), '0.10.0');
    assert.equal(nameReleaseAsset({ outDir: directory, version: '0.10.0' }).renamed, true);
  });
});

test('archived names never overwrite an earlier archive', () => {
  withWorkspace((directory) => {
    write(directory, 'anti-slop-for-x-extension-0.10.0-chrome.zip', zipFor('0.10.0'));
    write(directory, 'v0.9.0.zip', zipFor('0.9.0', { 'a.js': 'this-build' }));
    mkdirSync(staleDir(directory));
    write(staleDir(directory), 'v0.9.0.zip', zipFor('0.9.0', { 'a.js': 'earlier-archive' }));
  }, (directory) => {
    const result = nameReleaseAsset({ outDir: directory, version: '0.10.0' });
    assert.deepEqual(result.archived, ['v0.9.0-2.zip'], 'a busy name gets a suffix instead of being replaced');
    assert.deepEqual(staleIn(directory), ['v0.9.0-2.zip', 'v0.9.0.zip']);
    assert.equal(readFileSync(join(staleDir(directory), 'v0.9.0.zip')).equals(zipFor('0.9.0', { 'a.js': 'earlier-archive' })), true);
    assert.equal(readFileSync(join(staleDir(directory), 'v0.9.0-2.zip')).equals(zipFor('0.9.0', { 'a.js': 'this-build' })), true);
  });
});

test('a symlinked zip is refused instead of ignored', () => {
  withWorkspace((directory) => {
    write(directory, 'anti-slop-for-x-extension-0.10.0-chrome.zip', zipFor('0.10.0'));
    write(directory, 'elsewhere.zip', zipFor('0.9.0'));
    symlinkSync(join(directory, 'elsewhere.zip'), join(directory, 'v0.9.0.zip'));
  }, (directory) => {
    assert.throws(() => nameReleaseAsset({ outDir: directory, version: '0.10.0' }), /refusing v0\.9\.0\.zip: not a regular file/);
    assert.deepEqual(zipsIn(directory), ['anti-slop-for-x-extension-0.10.0-chrome.zip', 'elsewhere.zip', 'v0.9.0.zip']);
    assert.equal(existsSync(staleDir(directory)), false);
  });
});

test('a dangling link in stale/ keeps its entry instead of being replaced', () => {
  const oldAsset = zipFor('0.10.0', { 'a.js': 'previous-build' });
  const candidate = zipFor('0.10.0', { 'a.js': 'current-build' });
  withWorkspace((directory) => {
    write(directory, 'anti-slop-for-x-extension-0.10.0-chrome.zip', candidate);
    write(directory, 'v0.10.0.zip', oldAsset);
    mkdirSync(staleDir(directory));
    // existsSync() reports false for a link whose target is gone, so a name check
    // built on it would rename straight over this directory entry.
    symlinkSync(join(directory, 'gone.zip'), join(staleDir(directory), 'v0.10.0.zip'));
  }, (directory) => {
    const result = nameReleaseAsset({ outDir: directory, version: '0.10.0' });
    assert.deepEqual(result.archived, ['v0.10.0-2.zip']);
    assert.deepEqual(staleIn(directory), ['v0.10.0-2.zip', 'v0.10.0.zip']);
    assert.equal(readFileSync(join(staleDir(directory), 'v0.10.0-2.zip')).equals(oldAsset), true, 'the old asset lands in the free name');
    assert.equal(readFileSync(join(directory, 'v0.10.0.zip')).equals(candidate), true, 'the asset is the candidate');
  });
});

test('a dangling stale link is refused when archiving is needed', () => {
  withWorkspace((directory) => {
    write(directory, 'anti-slop-for-x-extension-0.10.0-chrome.zip', zipFor('0.10.0'));
    write(directory, 'v0.9.0.zip', zipFor('0.9.0'));
    symlinkSync(join(directory, 'gone'), staleDir(directory));
  }, (directory) => {
    assert.throws(() => nameReleaseAsset({ outDir: directory, version: '0.10.0' }), /not a plain directory/);
    assert.deepEqual(zipsIn(directory), ['anti-slop-for-x-extension-0.10.0-chrome.zip', 'v0.9.0.zip']);
  });
});

test('a symlinked stale directory is refused', () => {
  withWorkspace((directory) => {
    write(directory, 'anti-slop-for-x-extension-0.10.0-chrome.zip', zipFor('0.10.0'));
    write(directory, 'v0.9.0.zip', zipFor('0.9.0'));
    const outside = join(directory, 'outside');
    mkdirSync(outside);
    symlinkSync(outside, staleDir(directory));
  }, (directory) => {
    assert.throws(() => nameReleaseAsset({ outDir: directory, version: '0.10.0' }), /not a plain directory/);
    assert.deepEqual(zipsIn(directory), ['anti-slop-for-x-extension-0.10.0-chrome.zip', 'v0.9.0.zip'], 'the stale zip is left in place');
    assert.deepEqual(readdirSync(join(directory, 'outside')), [], 'nothing is archived outside .output');
  });
});

test('an empty output directory and a missing version are rejected', () => {
  withWorkspace(() => {}, (directory) => {
    assert.throws(() => nameReleaseAsset({ outDir: directory, version: '0.10.0' }), /no zip built for v0\.10\.0/);
    assert.throws(() => nameReleaseAsset({ outDir: directory, version: '' }), /version is required/);
  });
});

test('a missing output directory is rejected', () => {
  const missing = join(tmpdir(), `release-asset-missing-${process.pid}-${Date.now()}`);
  assert.throws(() => nameReleaseAsset({ outDir: missing, version: '0.10.0' }), /no output directory/);
});
