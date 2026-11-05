import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
export const defaultRepoRoot = path.resolve(scriptDir, '..');

export function assembleCatalogFromDisk(publicDir) {
  const catalogPath = path.join(publicDir, 'data/catalog.json');
  const catalogMeta = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
  const geoPath = path.join(publicDir, catalogMeta.geoFile);
  const geo = JSON.parse(fs.readFileSync(geoPath, 'utf8'));
  const entries = [];

  for (const relativeBatchPath of catalogMeta.entryFiles) {
    const fullBatchPath = path.join(publicDir, relativeBatchPath);
    const batch = JSON.parse(fs.readFileSync(fullBatchPath, 'utf8'));
    for (const entry of batch) {
      entries.push(entry);
    }
  }

  return {
    geoFile: catalogMeta.geoFile,
    entryFiles: catalogMeta.entryFiles,
    branches: catalogMeta.branches,
    regions: catalogMeta.regions,
    kinds: catalogMeta.kinds,
    continuityKinds: catalogMeta.continuityKinds,
    mapLabels: catalogMeta.mapLabels,
    tradeRoutes: catalogMeta.tradeRoutes,
    crossLinks: catalogMeta.crossLinks,
    scopeNotes: catalogMeta.scopeNotes,
    geo,
    entries,
  };
}

function serializeForInlineScript(data) {
  return JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

export function renderLocalHtml(publicDir) {
  const pagesHtml = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8');
  const fullCatalog = assembleCatalogFromDisk(publicDir);
  const inlinePayload = serializeForInlineScript({
    branches: fullCatalog.branches,
    regions: fullCatalog.regions,
    kinds: fullCatalog.kinds,
    continuityKinds: fullCatalog.continuityKinds,
    mapLabels: fullCatalog.mapLabels,
    tradeRoutes: fullCatalog.tradeRoutes,
    crossLinks: fullCatalog.crossLinks,
    scopeNotes: fullCatalog.scopeNotes,
    geo: fullCatalog.geo,
    entries: fullCatalog.entries,
  });

  const cssTarget = 'href="css/chart.css"';
  const geoScriptTarget = '  <script src="js/geo-map.js"></script>';
  const appScriptTarget = '  <script src="js/tree-app.js"></script>';

  assert.equal(pagesHtml.includes(cssTarget), true, 'Missing css link in public/index.html');
  assert.equal(pagesHtml.includes(geoScriptTarget), true, 'Missing geo-map.js in public/index.html');
  assert.equal(pagesHtml.includes(appScriptTarget), true, 'Missing tree-app.js in public/index.html');
  assert.equal(pagesHtml.includes('src="js/vendor/'), true, 'Missing vendor scripts in public/index.html');

  const inlineScriptTag =
    '  <script id="abraham-inline-catalog">window.ABRAHAM_INLINE_CATALOG = ' +
    inlinePayload +
    ';</script>\n  <script src="public/js/tree-app.js"></script>';

  return pagesHtml
    .replace(cssTarget, () => 'href="public/css/chart.css"')
    .replace(/src="js\/vendor\//g, () => 'src="public/js/vendor/')
    .replace(geoScriptTarget, () => '  <script src="public/js/geo-map.js"></script>')
    .replace(appScriptTarget, () => inlineScriptTag);
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  const publicDir = path.join(defaultRepoRoot, 'public');
  const localHtml = renderLocalHtml(publicDir);
  const outputPath = path.join(defaultRepoRoot, 'index.html');
  fs.writeFileSync(outputPath, localHtml, 'utf8');
  console.log(`Generated ${outputPath}`);
}
