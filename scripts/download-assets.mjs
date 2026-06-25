#!/usr/bin/env node
/**
 * Semi-automated asset installer.
 *
 * Itch.io does not expose stable direct URLs (downloads require clicking on the
 * pack page), so the flow is:
 *   1. Download the zip from the pack page (the "page" field in assets-manifest.json).
 *   2. Save it as downloads/<id>.zip.
 *   3. Run `npm run assets`; the script unpacks everything it finds into
 *      packages/client/public/assets/<target> and lists what is missing.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(join(root, 'assets-manifest.json'), 'utf8'));
const downloadsDir = join(root, 'downloads');
const assetsDir = join(root, 'packages/client/public/assets');

mkdirSync(downloadsDir, { recursive: true });

const missing = [];
let installed = 0;

for (const pack of manifest.packs) {
  const zipPath = join(downloadsDir, `${pack.id}.zip`);
  const targetDir = join(assetsDir, pack.target);

  if (existsSync(targetDir)) {
    console.log(`✓ ${pack.name} - already installed (${pack.target})`);
    installed++;
    continue;
  }
  if (!existsSync(zipPath)) {
    missing.push(pack);
    continue;
  }
  mkdirSync(targetDir, { recursive: true });
  execFileSync('unzip', ['-oq', zipPath, '-d', targetDir]);
  console.log(`✓ ${pack.name} - unpacked to ${pack.target}`);
  installed++;
}

if (missing.length > 0) {
  console.log('\nMissing packs - download manually (Download button on the page):');
  for (const pack of missing) {
    console.log(`\n  ${pack.name} (${pack.license.split('—')[0].trim()})`);
    console.log(`    page:  ${pack.page}`);
    console.log(`    save:  downloads/${pack.id}.zip`);
    console.log(`    role:  ${pack.role}`);
  }
  console.log('\nThen run again: npm run assets');
} else {
  console.log(`\nComplete: ${installed}/${manifest.packs.length} packs installed.`);
}
