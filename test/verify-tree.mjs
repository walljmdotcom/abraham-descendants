import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

import { assembleCatalogFromDisk, renderLocalHtml } from '../scripts/build-local-html.mjs';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, '..');
const publicDir = path.join(repoRoot, 'public');

assert.equal(
  fs.existsSync(path.join(publicDir, 'js/lineage')),
  false,
  'Legacy public/js/lineage directory must be removed'
);

const authoredCodeFiles = [
  'public/css/chart.css',
  'public/js/geo-map.js',
  'public/js/tree-app.js',
  'scripts/build-local-html.mjs',
  'test/verify-tree.mjs',
];

const catalogMeta = JSON.parse(
  fs.readFileSync(path.join(publicDir, 'data/catalog.json'), 'utf8')
);
assert.equal(
  typeof catalogMeta.geoFile === 'string' && catalogMeta.geoFile.length > 0,
  true,
  'catalog.json must declare geoFile'
);
assert.equal(
  Array.isArray(catalogMeta.entryFiles) && catalogMeta.entryFiles.length === 5,
  true,
  'catalog.json must list all 5 lineage JSON files'
);

const jsonDataFiles = [
  'public/data/catalog.json',
  'public/' + catalogMeta.geoFile,
  ...catalogMeta.entryFiles.map((relPath) => 'public/' + relPath),
];

const filesOnDiskInDataDir = fs
  .readdirSync(path.join(publicDir, 'data'))
  .map((name) => 'public/data/' + name)
  .sort();
assert.deepEqual(
  filesOnDiskInDataDir,
  [...jsonDataFiles].sort(),
  'Unexpected or missing JSON files in public/data/'
);

const allCheckedFiles = [
  ...authoredCodeFiles,
  ...jsonDataFiles,
  'public/index.html',
  'index.html',
  'README.md',
  '.github/workflows/deploy-pages.yml',
];

for (const relativeFile of allCheckedFiles) {
  const fullPath = path.join(repoRoot, relativeFile);
  assert.equal(fs.existsSync(fullPath), true, 'Missing file: ' + relativeFile);
  const bytes = fs.readFileSync(fullPath);
  assert.equal(bytes.includes(0), false, 'NUL byte found in ' + relativeFile);
}

for (const relativeCodeFile of authoredCodeFiles) {
  const fullPath = path.join(repoRoot, relativeCodeFile);
  const lines = fs.readFileSync(fullPath, 'utf8').split('\n');
  lines.forEach((line, index) => {
    assert.equal(
      line.length <= 120,
      true,
      `${relativeCodeFile}:${index + 1} exceeds 120 chars (${line.length})`
    );
  });
}

function assertCleanText(value, contextLabel) {
  assert.equal(
    typeof value === 'string' && value.trim().length > 0,
    true,
    `Empty string at ${contextLabel}`
  );
  assert.equal(value.includes('  '), false, `Double space in ${contextLabel}`);
  assert.equal(value.includes('\u2014'), false, `Em dash in ${contextLabel}`);
}

const hexColorPattern = /^#[0-9a-fA-F]{6}$/;
for (const [branchKey, palette] of Object.entries(catalogMeta.branches)) {
  for (const colorField of ['accent', 'surface', 'border', 'badgeBg', 'badgeText']) {
    assert.equal(
      hexColorPattern.test(palette[colorField]),
      true,
      `Invalid hex color ${branchKey}.${colorField}: ${palette[colorField]}`
    );
  }
}

const catalog = assembleCatalogFromDisk(publicDir);
assert.ok(catalog, 'Catalog failed to assemble from public/data/*.json');
assert.equal(
  catalog.entries.length >= 108,
  true,
  `Expected >= 108 lineage nodes, found ${catalog.entries.length}`
);
assert.equal(
  Boolean(catalog.geo && catalog.geo.land && catalog.geo.lakes && catalog.geo.rivers),
  true,
  'Missing Natural Earth vector layers in catalog.geo'
);

const d3Sandbox = {};
vm.runInNewContext(
  fs.readFileSync(path.join(publicDir, 'js/vendor/d3.min.js'), 'utf8'),
  d3Sandbox
);
const landSphericalArea = d3Sandbox.d3.geoArea(catalog.geo.land);
assert.equal(
  landSphericalArea > 0 && landSphericalArea < Math.PI,
  true,
  `Invalid spherical winding on catalog.geo.land (area=${landSphericalArea})`
);
for (const entry of catalog.entries) {
  const ring = [];
  for (let i = 0; i <= 32; i += 1) {
    const theta = -((i / 32) * Math.PI * 2);
    const rx = (entry.geo.rxKm || 40) / 111.32;
    const ry = (entry.geo.ryKm || 28) / 111.132;
    ring.push([entry.geo.lng + rx * Math.cos(theta), entry.geo.lat + ry * Math.sin(theta)]);
  }
  const terrArea = d3Sandbox.d3.geoArea({
    type: 'Feature',
    geometry: { type: 'Polygon', coordinates: [ring] },
  });
  assert.equal(
    terrArea > 0 && terrArea < 0.25,
    true,
    `Inverted spherical winding for ${entry.id} (area=${terrArea})`
  );
}

const expectedLocalHtml = renderLocalHtml(publicDir);
const actualLocalHtml = fs.readFileSync(path.join(repoRoot, 'index.html'), 'utf8');
assert.equal(
  actualLocalHtml,
  expectedLocalHtml,
  'Repo-root index.html is out of sync; run node scripts/build-local-html.mjs'
);

const inlineMatch = actualLocalHtml.match(
  /<script id="abraham-inline-catalog">([\s\S]*?)<\/script>/
);
assert.ok(inlineMatch, 'Repo-root index.html is missing #abraham-inline-catalog script');
const sandboxWindow = {};
vm.runInNewContext(inlineMatch[1], { window: sandboxWindow });
assert.equal(
  sandboxWindow.ABRAHAM_INLINE_CATALOG.entries.length,
  catalog.entries.length,
  'Inline catalog entry count in index.html does not match public/data/*.json'
);
assert.equal(
  Boolean(sandboxWindow.ABRAHAM_INLINE_CATALOG.geo && sandboxWindow.ABRAHAM_INLINE_CATALOG.geo.land),
  true,
  'Inline catalog in index.html is missing embedded geo data'
);

const entriesById = new Map();
const rootEntries = [];

for (const entry of catalog.entries) {
  assert.equal(typeof entry.id, 'string');
  assert.equal(entry.id.length > 0, true);
  assert.equal(entriesById.has(entry.id), false, `Duplicate entry id: ${entry.id}`);
  entriesById.set(entry.id, entry);

  if (entry.parentId === '') {
    rootEntries.push(entry);
  }
}

assert.equal(rootEntries.length, 1, 'Tree must have exactly one root node');
assert.equal(rootEntries[0].id, 'abraham', 'Root node must be abraham');

for (const entry of catalog.entries) {
  if (entry.id !== 'abraham') {
    assert.equal(
      entriesById.has(entry.parentId),
      true,
      `Entry ${entry.id} references missing parentId ${entry.parentId}`
    );
  }

  const visited = new Set();
  let cursor = entry;
  while (cursor !== undefined) {
    assert.equal(visited.has(cursor.id), false, `Cycle detected at ${cursor.id}`);
    visited.add(cursor.id);
    if (cursor.parentId === '') {
      assert.equal(cursor.id, 'abraham', `Disconnected root at ${cursor.id}`);
      break;
    }
    cursor = entriesById.get(cursor.parentId);
  }

  assert.equal(entry.kind in catalog.kinds, true, `Invalid kind on ${entry.id}: ${entry.kind}`);
  assert.equal(
    entry.branch in catalog.branches,
    true,
    `Invalid branch on ${entry.id}: ${entry.branch}`
  );
  assert.equal(
    entry.region in catalog.regions,
    true,
    `Invalid region on ${entry.id}: ${entry.region}`
  );

  for (const fieldName of ['name', 'era', 'territory', 'cardRole', 'summary']) {
    assertCleanText(entry[fieldName], `${entry.id}.${fieldName}`);
  }
  if (entry.nativeNames !== undefined) {
    assertCleanText(entry.nativeNames, `${entry.id}.nativeNames`);
  }
  if (entry.mother !== undefined) {
    assertCleanText(entry.mother, `${entry.id}.mother`);
  }
  if (entry.consorts !== undefined) {
    assert.equal(Array.isArray(entry.consorts) && entry.consorts.length > 0, true);
    entry.consorts.forEach((consort, idx) => {
      assertCleanText(consort, `${entry.id}.consorts[${idx}]`);
    });
  }

  assert.ok(entry.continuity, `Missing continuity object on ${entry.id}`);
  assert.equal(
    entry.continuity.status in catalog.continuityKinds,
    true,
    `Invalid continuity.status on ${entry.id}: ${entry.continuity.status}`
  );
  assertCleanText(entry.continuity.badge, `${entry.id}.continuity.badge`);
  assertCleanText(entry.continuity.detail, `${entry.id}.continuity.detail`);

  assert.ok(entry.geo, `Missing geo object on ${entry.id}`);
  assert.equal(
    typeof entry.geo.lat === 'number' && entry.geo.lat >= 8 && entry.geo.lat <= 56,
    true,
    `Out-of-bounds geo.lat on ${entry.id}: ${entry.geo.lat}`
  );
  assert.equal(
    typeof entry.geo.lng === 'number' && entry.geo.lng >= -12 && entry.geo.lng <= 66,
    true,
    `Out-of-bounds geo.lng on ${entry.id}: ${entry.geo.lng}`
  );
  assert.equal(typeof entry.geo.rxKm === 'number' && entry.geo.rxKm > 0, true);
  assert.equal(typeof entry.geo.ryKm === 'number' && entry.geo.ryKm > 0, true);
  assert.equal(
    Array.isArray(entry.geo.sites) && entry.geo.sites.length > 0,
    true,
    `Missing geo.sites on ${entry.id}`
  );
  entry.geo.sites.forEach((site, idx) => {
    assertCleanText(site.name, `${entry.id}.geo.sites[${idx}].name`);
    assert.equal(typeof site.lat === 'number' && typeof site.lng === 'number', true);
  });

  assert.equal(
    Array.isArray(entry.history) && entry.history.length > 0,
    true,
    `Missing history paragraphs on ${entry.id}`
  );
  entry.history.forEach((paragraphText, idx) => {
    assert.equal(paragraphText.trim().length > 40, true);
    assertCleanText(paragraphText, `${entry.id}.history[${idx}]`);
  });

  assert.equal(
    Array.isArray(entry.sources) && entry.sources.length > 0,
    true,
    `Missing sources on ${entry.id}`
  );
  const seenUrlsInEntry = new Set();
  for (const sourceItem of entry.sources) {
    assertCleanText(sourceItem.label, `${entry.id}.sources.label`);
    assertCleanText(sourceItem.kind, `${entry.id}.sources.kind`);
    assert.equal(
      typeof sourceItem.url === 'string' && sourceItem.url.startsWith('https://'),
      true,
      `Invalid source URL on ${entry.id}: ${sourceItem.url}`
    );
    assert.equal(
      seenUrlsInEntry.has(sourceItem.url),
      false,
      `Duplicate URL on ${entry.id}: ${sourceItem.url}`
    );
    seenUrlsInEntry.add(sourceItem.url);
  }

  if (entry.relatedIds !== undefined) {
    for (const relationLink of entry.relatedIds) {
      assert.notEqual(relationLink.id, entry.id, `Self relation on ${entry.id}`);
      assert.equal(
        entriesById.has(relationLink.id),
        true,
        `${entry.id} relatedIds references unknown id ${relationLink.id}`
      );
      assertCleanText(relationLink.relation, `${entry.id}.relatedIds(${relationLink.id})`);
    }
  }
}

const validCrossKinds = new Set(['absorption', 'coalescence', 'marriage']);
for (const crossLink of catalog.crossLinks) {
  assert.equal(entriesById.has(crossLink.from), true, `Unknown crossLink.from ${crossLink.from}`);
  assert.equal(entriesById.has(crossLink.to), true, `Unknown crossLink.to ${crossLink.to}`);
  assert.equal(validCrossKinds.has(crossLink.kind), true, `Bad crossLink.kind ${crossLink.kind}`);
  assertCleanText(crossLink.label, `crossLink(${crossLink.from}->${crossLink.to}).label`);
  assertCleanText(crossLink.summary, `crossLink(${crossLink.from}->${crossLink.to}).summary`);
}

for (const mapLabel of catalog.mapLabels) {
  assertCleanText(mapLabel.name, 'mapLabels.name');
}

for (const route of catalog.tradeRoutes) {
  assertCleanText(route.name, `tradeRoutes(${route.id}).name`);
  assert.equal(Array.isArray(route.waypoints) && route.waypoints.length >= 3, true);
}

for (const note of catalog.scopeNotes) {
  assertCleanText(note.heading, 'scopeNotes.heading');
  for (const paragraphText of note.paragraphs) {
    assertCleanText(paragraphText, `scopeNotes(${note.heading})`);
  }
}

function isEntryInBranch(entry, branch) {
  if (branch === 'all' || entry.id === 'abraham') {
    return true;
  }
  if (branch === 'ishmael') {
    return entry.id === 'hagar' || entry.branch === 'ishmael';
  }
  if (branch === 'keturah') {
    return entry.id === 'keturah' || entry.branch === 'keturah';
  }
  if (branch === 'esau') {
    return entry.id === 'sarah' || entry.id === 'isaac' || entry.branch === 'esau';
  }
  if (branch === 'jacob') {
    return entry.id === 'sarah' || entry.id === 'isaac' || entry.branch === 'jacob';
  }
  return false;
}

for (const branchKey of ['all', 'ishmael', 'keturah', 'esau', 'jacob']) {
  const subset = catalog.entries.filter((entry) => isEntryInBranch(entry, branchKey));
  const subsetIds = new Set(subset.map((entry) => entry.id));
  assert.equal(subsetIds.has('abraham'), true);
  assert.equal(subset.length > 5, true);
  for (const entry of subset) {
    if (entry.id !== 'abraham') {
      assert.equal(
        subsetIds.has(entry.parentId),
        true,
        `Branch ${branchKey} orphans ${entry.id} (parent ${entry.parentId} missing)`
      );
    }
  }
}

const pagesHtml = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8');
const treeAppSource = fs.readFileSync(path.join(publicDir, 'js/tree-app.js'), 'utf8');
const geoMapSource = fs.readFileSync(path.join(publicDir, 'js/geo-map.js'), 'utf8');

const requiredDomIds = Array.from(
  new Set([
    ...Array.from(treeAppSource.matchAll(/getElementById\('([^']+)'\)/g), (m) => m[1]),
    ...Array.from(geoMapSource.matchAll(/getElementById\('([^']+)'\)/g), (m) => m[1]),
  ])
);

for (const requiredId of requiredDomIds) {
  assert.equal(
    pagesHtml.includes(`id="${requiredId}"`),
    true,
    `public/index.html is missing element id="${requiredId}"`
  );
  assert.equal(
    actualLocalHtml.includes(`id="${requiredId}"`),
    true,
    `index.html is missing element id="${requiredId}"`
  );
}

const htmlWithoutInlineData = actualLocalHtml.replace(
  /<script id="abraham-inline-catalog">[\s\S]*?<\/script>/,
  ''
);

for (const assetMatch of pagesHtml.matchAll(/(?:src|href)="([^"]+)"/g)) {
  const assetPath = assetMatch[1];
  if (!assetPath.startsWith('http')) {
    assert.equal(
      fs.existsSync(path.join(publicDir, assetPath)),
      true,
      `public/index.html references missing asset ${assetPath}`
    );
  }
}

for (const assetMatch of htmlWithoutInlineData.matchAll(/(?:src|href)="([^"]+)"/g)) {
  const assetPath = assetMatch[1];
  if (!assetPath.startsWith('http')) {
    assert.equal(
      fs.existsSync(path.join(repoRoot, assetPath)),
      true,
      `index.html references missing asset ${assetPath}`
    );
  }
}

const uniqueUrls = Array.from(
  new Set(catalog.entries.flatMap((entry) => entry.sources.map((item) => item.url)))
);

const peopleCount = catalog.entries.filter((entry) => entry.kind === 'people').length;
const clanCount = catalog.entries.filter((entry) => entry.kind === 'clan').length;
console.log(
  `Verified ${catalog.entries.length} JSON nodes (${peopleCount} people groups, ` +
    `${clanCount} tribes/clans), ${catalog.crossLinks.length} crossLinks, geo vectors, ` +
    `Pages + local HTML parity, and ${uniqueUrls.length} unique source URLs.`
);

if (!process.argv.includes('--offline')) {
  const failures = [];
  const urlsByHost = new Map();
  for (const url of uniqueUrls) {
    const host = new URL(url).hostname;
    let bucket = urlsByHost.get(host);
    if (!bucket) {
      bucket = [];
      urlsByHost.set(host, bucket);
    }
    bucket.push(url);
  }

  function delayMs(ms) {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }

  async function checkSingleUrl(targetUrl) {
    const userAgent = [
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)',
      'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
    ].join(' ');
    const headers = {
      'User-Agent': userAgent,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    };
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        let response = await fetch(targetUrl, {
          method: 'HEAD',
          redirect: 'follow',
          headers,
          signal: AbortSignal.timeout(15000),
        });
        if (response.status === 405 || response.status === 403 || response.status === 404) {
          response = await fetch(targetUrl, {
            method: 'GET',
            redirect: 'follow',
            headers,
            signal: AbortSignal.timeout(15000),
          });
        }
        if (response.status === 429 || response.status >= 500) {
          await delayMs(600 * (attempt + 1));
          continue;
        }
        if (response.status >= 200 && response.status < 400) {
          return;
        }
        failures.push(`${response.status} ${targetUrl}`);
        return;
      } catch (error) {
        if (attempt < 2) {
          await delayMs(600 * (attempt + 1));
          continue;
        }
        failures.push(`ERR(${error.message}) ${targetUrl}`);
        return;
      }
    }
    failures.push(`RETRY_EXHAUSTED ${targetUrl}`);
  }

  async function checkHostQueue(hostUrls) {
    let idx = 0;
    async function hostWorker() {
      while (idx < hostUrls.length) {
        const currentUrl = hostUrls[idx];
        idx += 1;
        await checkSingleUrl(currentUrl);
      }
    }
    const concurrency = Math.min(2, hostUrls.length);
    await Promise.all(Array.from({ length: concurrency }, () => hostWorker()));
  }

  await Promise.all(Array.from(urlsByHost.values(), (hostUrls) => checkHostQueue(hostUrls)));
  assert.deepEqual(failures, [], `Unreachable source URLs:\n${failures.join('\n')}`);
  console.log(`All ${uniqueUrls.length} source URLs returned HTTP 2xx/3xx.`);
}
