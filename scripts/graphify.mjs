#!/usr/bin/env node
/**
 * Minimalny, samowystarczalny generator grafu zależności kodu → graphify-out/graph.json.
 *
 * Po co: zakładka „🌳 Graph" w Salonie Architekta czyta graphify-out/graph.json
 * (packages/server/src/intel/project-intel-poller.ts → readGraphify). Zewnętrzne CLI
 * `graphify` nie jest wymagane — ten skrypt produkuje ten sam schemat bez zależności.
 *
 * Co liczy (poziom modułów/plików):
 *  - nodes: pliki źródłowe (.ts/.tsx/.js/.jsx/.mjs/.cjs), id = ścieżka względna,
 *  - edges: importy/`require` ścieżek WZGLĘDNYCH (./ , ../) rozwiązane do plików,
 *  - degree: liczba krawędzi incydentnych (in + out) — wysoki = „god-node",
 *  - communities: liczba unikalnych katalogów pierwszego poziomu pod katalogiem skanu.
 *
 * Użycie:
 *   node scripts/graphify.mjs [katalog=.]
 *   npm run graphify
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';

const IGNORE = new Set(['node_modules', '.git', 'dist', 'build', 'graphify-out', '.beads', '.claude', 'coverage']);
const SRC_EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
const IMPORT_RE = /(?:import\s[^'"]*?from\s*|import\s*|require\s*\(\s*|export\s[^'"]*?from\s*)['"]([^'"]+)['"]/g;

const root = path.resolve(process.argv[2] ?? '.');

/** Rekurencyjnie zbierz pliki źródłowe (pomijając katalogi z IGNORE). */
async function collect(dir, out = []) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.name.startsWith('.') && e.name !== '.') continue;
    if (IGNORE.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) await collect(full, out);
    else if (SRC_EXT.has(path.extname(e.name))) out.push(full);
  }
  return out;
}

/** Rozwiąż import względny do realnego pliku (próbuje rozszerzeń i /index). */
async function resolveImport(fromFile, spec) {
  if (!spec.startsWith('.')) return null; // tylko importy względne (pomijamy paczki npm)
  const base = path.resolve(path.dirname(fromFile), spec);
  const candidates = [
    base,
    ...[...SRC_EXT].map((x) => base + x),
    ...[...SRC_EXT].map((x) => path.join(base, 'index' + x)),
  ];
  for (const c of candidates) {
    try {
      const st = await fs.stat(c);
      if (st.isFile()) return c;
    } catch {
      /* próbuj dalej */
    }
  }
  return null;
}

async function main() {
  const files = await collect(root);
  const rel = (f) => path.relative(root, f).split(path.sep).join('/');
  const degree = new Map(files.map((f) => [f, 0]));
  let edgeCount = 0;

  for (const f of files) {
    let src;
    try {
      src = await fs.readFile(f, 'utf8');
    } catch {
      continue;
    }
    const specs = new Set();
    for (const m of src.matchAll(IMPORT_RE)) specs.add(m[1]);
    for (const spec of specs) {
      const target = await resolveImport(f, spec);
      if (target && degree.has(target)) {
        edgeCount++;
        degree.set(f, (degree.get(f) ?? 0) + 1);
        degree.set(target, (degree.get(target) ?? 0) + 1);
      }
    }
  }

  // communities ≈ liczba katalogów pierwszego poziomu (zgrubny podział na moduły)
  const topDirs = new Set(files.map((f) => rel(f).split('/')[0]));

  const nodes = files
    .map((f) => ({ id: rel(f), symbol: rel(f), degree: degree.get(f) ?? 0 }))
    .sort((a, b) => b.degree - a.degree);

  const graph = {
    stats: {
      nodeCount: nodes.length,
      edgeCount,
      communityCount: topDirs.size,
      generatedAt: new Date().toISOString(),
    },
    nodes,
  };

  const outDir = path.join(root, 'graphify-out');
  await fs.mkdir(outDir, { recursive: true });
  await fs.writeFile(path.join(outDir, 'graph.json'), JSON.stringify(graph, null, 2));
  console.log(
    `✓ graphify-out/graph.json: ${nodes.length} węzłów, ${edgeCount} krawędzi, ${topDirs.size} modułów` +
      (nodes[0] ? ` · top hub: ${nodes[0].symbol} (${nodes[0].degree})` : ''),
  );
}

main().catch((err) => {
  console.error('graphify: błąd', err);
  process.exit(1);
});
