/**
 * Packaging and discipline tests: the manifest contract DSH reads, and the two
 * "never" rules of this plugin (no host Client package, no iframe).
 *
 * These assertions are cheap and they protect the parts of the deliverable that
 * no unit test can see: the bundle patch row DSH mounts, the exports the host
 * and the browser half resolve through, and the dsh.client declaration the
 * client-module scanner validates before it serves /plugins/dsh-cyber-dept.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

/** Every host JavaScript file (index.js plus src/host and src/shared). */
function hostSources() {
  const files = [join(ROOT, 'index.js')];
  for (const directory of ['src/host', 'src/shared']) {
    for (const entry of readdirSync(join(ROOT, directory))) {
      if (entry.endsWith('.js')) files.push(join(ROOT, directory, entry));
    }
  }
  return files;
}

test('manifest: identity and module shape', () => {
  assert.equal(manifest.name, 'dsh-cyber-dept');
  assert.equal(manifest.version, '0.2.0');
  assert.equal(manifest.type, 'module');
  assert.equal(manifest.main, './index.js');
});

test('manifest: "." and "./client" are the two halves DSH resolves', () => {
  assert.equal(manifest.exports['.'], './index.js');
  assert.equal(manifest.exports['./client'], './client.js');
  assert.ok(existsSync(join(ROOT, 'index.js')));
  assert.ok(existsSync(join(ROOT, 'client.js')), 'the browser half must exist for the export to resolve');
});

test('manifest: the bundle patch is the cordis file DSH mounts', () => {
  assert.deepEqual(manifest.dsh.bundle, { patch: './cordis.patch.yml' });
  assert.ok(existsSync(join(ROOT, 'cordis.patch.yml')));
});

test('manifest: dsh.client is a web declaration injected after the layout', () => {
  assert.equal(manifest.dsh.client.platform, 'web');
  assert.deepEqual(manifest.dsh.client.inject, ['@deepseek-ai/dsh-client-ui-layout']);
  assert.equal(manifest.dsh.client.immediately, true);
  assert.equal(manifest.dsh.client.external, undefined);
});

test('manifest: peer dependencies are the two the halves import', () => {
  assert.ok(Object.hasOwn(manifest.peerDependencies, '@deepseek-ai/cordis'));
  assert.ok(Object.hasOwn(manifest.peerDependencies, 'react'));
  assert.match(manifest.peerDependencies.react, /^\^?18\./u);
});

test('cordis.patch.yml: exactly one insert row naming this bundle', () => {
  const text = readFileSync(join(ROOT, 'cordis.patch.yml'), 'utf8');
  const insertBlocks = text.match(/^-\s*insert:\s*$/gmu) ?? [];
  assert.equal(insertBlocks.length, 1, 'one insert block');
  const topLevelRow = text.match(/^-\s+id:/mu);
  assert.equal(topLevelRow, null, 'the patch must not configure existing rows');
  const ids = [...text.matchAll(/^\s+-\s+id:\s*["']?([^"'\s#]+)["']?\s*(?:#.*)?$/gmu)].map((match) => match[1]);
  const names = [...text.matchAll(/^\s+name:\s*["']?([^"'\s#]+)["']?\s*(?:#.*)?$/gmu)].map((match) => match[1]);
  assert.deepEqual(ids, ['cyber-dept']);
  assert.deepEqual(names, ['dsh-cyber-dept']);
});

test('discipline: the host half never requires a host Client package', () => {
  for (const file of hostSources()) {
    const source = readFileSync(file, 'utf8');
    assert.doesNotMatch(source, /require\s*\(/u, file + ' must not use require()');
    assert.doesNotMatch(source, /from\s+['"]@deepseek-ai\/dsh-client/u, file + ' must not import a host Client package');
    assert.doesNotMatch(source, /from\s+['"]@deepseek-ai\/dsh-cordis-client-runner/u, file);
  }
});

test('discipline: the host half never renders or embeds an iframe', () => {
  for (const file of hostSources()) {
    const source = readFileSync(file, 'utf8');
    assert.doesNotMatch(source, /<iframe/iu, file + ' must not embed an iframe');
    assert.doesNotMatch(source, /frameElement|contentWindow/iu, file);
  }
});

test('discipline: the host half imports only its own modules and node builtins', () => {
  for (const file of hostSources()) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(/from\s+['"]([^'"]+)['"]/gu)) {
      const specifier = match[1];
      const allowed = specifier.startsWith('./') || specifier.startsWith('../') || specifier.startsWith('node:');
      assert.ok(allowed, file + ' imports ' + specifier + ', which the host half must not depend on');
    }
  }
});
