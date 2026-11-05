(function runAbrahamTreeApp(globalScope) {
  'use strict';

  let catalog = null;
  const entriesById = new Map();
  const childrenByParentId = new Map();
  const outgoingCrossLinks = new Map();
  const incomingCrossLinks = new Map();

  function fetchJsonFile(urlPath) {
    return fetch(urlPath).then(function parseJsonResponse(response) {
      if (!response.ok) {
        throw new Error('HTTP ' + response.status + ' while loading ' + urlPath);
      }
      return response.json();
    });
  }

  function loadAbrahamCatalog(scope) {
    if (scope.ABRAHAM_INLINE_CATALOG !== undefined) {
      return Promise.resolve(scope.ABRAHAM_INLINE_CATALOG);
    }
    return fetchJsonFile('data/catalog.json').then(function loadCatalogParts(catalogMeta) {
      const geoPromise = catalogMeta.geoFile
        ? fetchJsonFile(catalogMeta.geoFile)
        : Promise.resolve(null);
      const batchPromises = catalogMeta.entryFiles.map(function fetchBatch(filePath) {
        return fetchJsonFile(filePath);
      });
      return Promise.all([geoPromise, Promise.all(batchPromises)]).then(function mergeParts(res) {
        const geoData = res[0];
        const batches = res[1];
        const entries = [];
        for (let i = 0; i < batches.length; i += 1) {
          const batch = batches[i];
          for (let j = 0; j < batch.length; j += 1) {
            entries.push(batch[j]);
          }
        }
        return {
          branches: catalogMeta.branches,
          regions: catalogMeta.regions,
          kinds: catalogMeta.kinds,
          continuityKinds: catalogMeta.continuityKinds,
          mapLabels: catalogMeta.mapLabels,
          tradeRoutes: catalogMeta.tradeRoutes,
          crossLinks: catalogMeta.crossLinks,
          scopeNotes: catalogMeta.scopeNotes,
          geo: geoData,
          entries: entries,
        };
      });
    });
  }

  const validModes = new Set(['tree', 'split', 'map']);
  const validBranches = new Set(['all', 'ishmael', 'keturah', 'esau', 'jacob']);
  const validRegions = new Set([
    'all',
    'peoples',
    'north-arabia',
    'hejaz-west-arabia',
    'sinai-negev-edom',
    'levant-canaan',
    'syria-mesopotamia',
    'mediterranean-diaspora',
  ]);
  const validLayouts = new Set(['top', 'left']);
  const validArcsModes = new Set(['converge', 'all', 'none']);
  const validDepths = new Set(['all', 'core']);

  const workspaceEl = document.getElementById('workspace');
  const chartPaneEl = document.getElementById('chart-pane');
  const chartContainerEl = document.getElementById('chart');
  const geoPaneEl = document.getElementById('geo-pane');
  const geoMapContainerEl = document.getElementById('geo-map');
  const statsPillEl = document.getElementById('stats-pill');
  const searchInputEl = document.getElementById('node-search');
  const searchResultsEl = document.getElementById('search-results');
  const regionSelectEl = document.getElementById('region-filter');
  const arcsSelectEl = document.getElementById('arcs-mode');
  const layoutButtonEl = document.getElementById('toggle-layout');
  const expandAllButtonEl = document.getElementById('expand-all');
  const collapseCoreButtonEl = document.getElementById('collapse-core');
  const fitChartButtonEl = document.getElementById('fit-chart');
  const zoomInButtonEl = document.getElementById('zoom-in');
  const zoomOutButtonEl = document.getElementById('zoom-out');
  const openScopeButtonEl = document.getElementById('open-scope');
  const spotlightBarEl = document.getElementById('spotlight-bar');
  const spotlightTitleEl = document.getElementById('spotlight-title');
  const spotlightChipsEl = document.getElementById('spotlight-chips');
  const clearSpotlightButtonEl = document.getElementById('clear-spotlight');
  const entryDialogEl = document.getElementById('entry-dialog');
  const scopeDialogEl = document.getElementById('scope-dialog');
  const branchTabButtons = Array.prototype.slice.call(
    document.querySelectorAll('[data-branch-tab]')
  );
  const modeTabButtons = Array.prototype.slice.call(
    document.querySelectorAll('[data-view-mode]')
  );

  let activeChart = null;
  let activeAtlas = null;
  let activeDialogEntryId = null;
  let activeSearchIndex = -1;
  let fallbackQuery = globalScope.location.search;
  let useFallbackQuery = false;

  function escapeHtml(raw) {
    return String(raw)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function parseArcsParam(rawArcs) {
    if (rawArcs === '1') {
      return 'all';
    }
    if (rawArcs === '0') {
      return 'none';
    }
    if (rawArcs !== null && validArcsModes.has(rawArcs)) {
      return rawArcs;
    }
    return 'converge';
  }

  function readNavigationState() {
    const searchText = useFallbackQuery ? fallbackQuery : globalScope.location.search;
    const params = new URLSearchParams(searchText);
    const rawMode = params.get('mode');
    const rawBranch = params.get('branch');
    const rawRegion = params.get('region');
    const rawLayout = params.get('layout');
    const rawDepth = params.get('depth');
    const rawTrace = params.get('trace');
    const rawEntry = params.get('entry');

    const mode = rawMode !== null && validModes.has(rawMode) ? rawMode : 'tree';
    const branch = rawBranch !== null && validBranches.has(rawBranch) ? rawBranch : 'all';
    const region = rawRegion !== null && validRegions.has(rawRegion) ? rawRegion : 'all';
    const layout = rawLayout !== null && validLayouts.has(rawLayout) ? rawLayout : 'top';
    const arcsMode = parseArcsParam(params.get('arcs'));
    const depth = rawDepth !== null && validDepths.has(rawDepth) ? rawDepth : 'all';
    const routesShown = params.get('routes') !== '0';
    const traceId = rawTrace !== null && entriesById.has(rawTrace) ? rawTrace : '';
    const entryId = rawEntry !== null && entriesById.has(rawEntry) ? rawEntry : '';
    const scopeOpen = params.get('scope') === '1';

    return {
      mode: mode,
      branch: branch,
      region: region,
      layout: layout,
      arcsMode: arcsMode,
      depth: depth,
      routesShown: routesShown,
      traceId: traceId,
      entryId: entryId,
      scopeOpen: scopeOpen,
    };
  }

  function writeNavigationState(nextPartial) {
    const current = readNavigationState();
    const merged = {
      mode: nextPartial.mode !== undefined ? nextPartial.mode : current.mode,
      branch: nextPartial.branch !== undefined ? nextPartial.branch : current.branch,
      region: nextPartial.region !== undefined ? nextPartial.region : current.region,
      layout: nextPartial.layout !== undefined ? nextPartial.layout : current.layout,
      arcsMode: nextPartial.arcsMode !== undefined ? nextPartial.arcsMode : current.arcsMode,
      depth: nextPartial.depth !== undefined ? nextPartial.depth : current.depth,
      routesShown:
        nextPartial.routesShown !== undefined ? nextPartial.routesShown : current.routesShown,
      traceId: nextPartial.traceId !== undefined ? nextPartial.traceId : current.traceId,
      entryId: nextPartial.entryId !== undefined ? nextPartial.entryId : current.entryId,
      scopeOpen: nextPartial.scopeOpen !== undefined ? nextPartial.scopeOpen : current.scopeOpen,
    };

    const params = new URLSearchParams();
    if (merged.mode !== 'tree') {
      params.set('mode', merged.mode);
    }
    if (merged.branch !== 'all') {
      params.set('branch', merged.branch);
    }
    if (merged.region !== 'all') {
      params.set('region', merged.region);
    }
    if (merged.layout !== 'top') {
      params.set('layout', merged.layout);
    }
    if (merged.arcsMode !== 'converge') {
      params.set('arcs', merged.arcsMode);
    }
    if (merged.depth !== 'all') {
      params.set('depth', merged.depth);
    }
    if (!merged.routesShown) {
      params.set('routes', '0');
    }
    if (merged.traceId !== '') {
      params.set('trace', merged.traceId);
    }
    if (merged.entryId !== '') {
      params.set('entry', merged.entryId);
    }
    if (merged.scopeOpen) {
      params.set('scope', '1');
    }

    const query = params.toString();
    fallbackQuery = query !== '' ? '?' + query : '';
    const nextUrl = globalScope.location.pathname + fallbackQuery + globalScope.location.hash;
    try {
      globalScope.history.replaceState(null, '', nextUrl);
      useFallbackQuery = false;
    } catch (_error) {
      useFallbackQuery = true;
    }
    return merged;
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
    return true;
  }

  function computeCoreExpandedIds() {
    const expandedIds = new Set();
    for (let i = 0; i < catalog.entries.length; i += 1) {
      const entry = catalog.entries[i];
      const isCoreHead =
        entry.kind === 'patriarch' ||
        entry.kind === 'matriarch' ||
        entry.parentId === 'keturah';
      if (isCoreHead) {
        let cursor = entry;
        while (cursor !== undefined) {
          expandedIds.add(cursor.id);
          cursor = cursor.parentId !== '' ? entriesById.get(cursor.parentId) : undefined;
        }
      }
    }
    return expandedIds;
  }

  function collectVisibleEntries(branch, depthMode) {
    const coreSet = depthMode === 'core' ? computeCoreExpandedIds() : null;
    const visible = [];
    for (let i = 0; i < catalog.entries.length; i += 1) {
      const entry = catalog.entries[i];
      if (isEntryInBranch(entry, branch)) {
        const clone = Object.assign({}, entry);
        clone._expanded = coreSet === null ? true : coreSet.has(entry.id);
        visible.push(clone);
      }
    }
    return visible;
  }

  function computeSpotlightSets(visibleEntries, navState) {
    const visibleIds = new Set();
    for (let i = 0; i < visibleEntries.length; i += 1) {
      visibleIds.add(visibleEntries[i].id);
    }

    const matchedIds = new Set();
    if (navState.traceId !== '' && visibleIds.has(navState.traceId)) {
      matchedIds.add(navState.traceId);
    } else if (navState.region === 'peoples') {
      for (let i = 0; i < visibleEntries.length; i += 1) {
        if (visibleEntries[i].kind === 'people') {
          matchedIds.add(visibleEntries[i].id);
        }
      }
    } else if (navState.region !== 'all') {
      for (let i = 0; i < visibleEntries.length; i += 1) {
        if (visibleEntries[i].region === navState.region) {
          matchedIds.add(visibleEntries[i].id);
        }
      }
    }

    const ancestorIds = new Set();
    matchedIds.forEach(function walkAncestors(matchId) {
      let current = entriesById.get(matchId);
      while (current !== undefined && current.parentId !== '') {
        if (!matchedIds.has(current.parentId) && visibleIds.has(current.parentId)) {
          ancestorIds.add(current.parentId);
        }
        current = entriesById.get(current.parentId);
      }
    });

    return {
      matchedIds: matchedIds,
      ancestorIds: ancestorIds,
      isActive: matchedIds.size > 0,
    };
  }

  function kindIconSvg(kind) {
    if (kind === 'patriarch') {
      return (
        '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
        '<polygon points="12 2 15.1 8.3 22 9.3 17 14.1 18.2 21 12 17.7 5.8 21 7 14.1 2 9.3 8.9 8.3 12 2"/>' +
        '</svg>'
      );
    }
    if (kind === 'matriarch') {
      return (
        '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
        '<circle cx="12" cy="8" r="5"/><path d="M5 21c1.5-4 4-6 7-6s5.5 2 7 6"/>' +
        '</svg>'
      );
    }
    if (kind === 'people') {
      return (
        '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
        '<path d="M3 21h18M5 21V9l7-5 7 5v12M9 21v-5h6v5"/>' +
        '</svg>'
      );
    }
    if (kind === 'clan') {
      return (
        '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
        '<path d="M2 20h20M4 20L12 4l8 16M9.5 20L12 14l2.5 6"/>' +
        '</svg>'
      );
    }
    return (
      '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
      '<circle cx="12" cy="8" r="4"/><path d="M6 20c1.2-3.3 3.3-5 6-5s4.8 1.7 6 5"/>' +
      '</svg>'
    );
  }

  function shortKindBadge(kind) {
    if (kind === 'people') {
      return 'People Group';
    }
    if (kind === 'clan') {
      return 'Tribe / Clan';
    }
    if (kind === 'patriarch') {
      return 'Patriarch';
    }
    if (kind === 'matriarch') {
      return 'Matriarch';
    }
    return 'Descendant';
  }

  function getAncestorChain(entryId) {
    const chain = [];
    let cursor = entriesById.get(entryId);
    while (cursor !== undefined) {
      chain.unshift(cursor);
      cursor = cursor.parentId !== '' ? entriesById.get(cursor.parentId) : undefined;
    }
    return chain;
  }

  function getPeopleInSubtree(rootId) {
    const collected = [];
    const queue = childrenByParentId.get(rootId) ? childrenByParentId.get(rootId).slice() : [];
    while (queue.length > 0) {
      const next = queue.shift();
      if (next.kind === 'people') {
        collected.push(next);
      }
      const grandChildren = childrenByParentId.get(next.id);
      if (grandChildren !== undefined) {
        for (let i = 0; i < grandChildren.length; i += 1) {
          queue.push(grandChildren[i]);
        }
      }
    }
    return collected;
  }

  function ensureConnectionMarkers(svgElement) {
    if (!svgElement) {
      return;
    }
    const svgSel = d3.select(svgElement);
    let defs = svgSel.select('defs.abraham-conn-defs');
    if (!defs.empty()) {
      return;
    }
    defs = svgSel.append('defs').attr('class', 'abraham-conn-defs');
    const specs = [
      { id: 'abraham-arrow-absorption', color: '#8c5a18' },
      { id: 'abraham-arrow-coalescence', color: '#6e6456' },
      { id: 'abraham-arrow-marriage', color: '#982b2b' },
    ];
    for (let i = 0; i < specs.length; i += 1) {
      defs
        .append('marker')
        .attr('id', specs[i].id)
        .attr('viewBox', '0 -4 8 8')
        .attr('refX', 6.5)
        .attr('refY', 0)
        .attr('markerWidth', 6)
        .attr('markerHeight', 6)
        .attr('orient', 'auto')
        .append('path')
        .attr('d', 'M0,-3.4L7.5,0L0,3.4Z')
        .attr('fill', specs[i].color);
    }
  }

  function routeConnectionsBehindCards() {
    const svgNode = chartContainerEl.querySelector('svg');
    if (!svgNode) {
      return;
    }
    ensureConnectionMarkers(svgNode);
    const connGroup = svgNode.querySelector('g.connections-wrapper');
    const nodesGroup = svgNode.querySelector('g.nodes-wrapper');
    if (connGroup && nodesGroup && connGroup.parentNode === nodesGroup.parentNode) {
      nodesGroup.parentNode.insertBefore(connGroup, nodesGroup);
    }
  }

  function syncToolbarControls(navState, visibleEntries, spotlight) {
    let peopleCount = 0;
    let clanCount = 0;
    for (let i = 0; i < visibleEntries.length; i += 1) {
      if (visibleEntries[i].kind === 'people') {
        peopleCount += 1;
      } else if (visibleEntries[i].kind === 'clan') {
        clanCount += 1;
      }
    }
    statsPillEl.textContent =
      visibleEntries.length +
      ' nodes · ' +
      peopleCount +
      ' people groups · ' +
      clanCount +
      ' tribes & clans';

    for (let i = 0; i < modeTabButtons.length; i += 1) {
      const btn = modeTabButtons[i];
      const active = btn.getAttribute('data-view-mode') === navState.mode;
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    }

    for (let i = 0; i < branchTabButtons.length; i += 1) {
      const tabButton = branchTabButtons[i];
      const isSelected = tabButton.getAttribute('data-branch-tab') === navState.branch;
      tabButton.setAttribute('aria-pressed', isSelected ? 'true' : 'false');
    }

    regionSelectEl.value = navState.region;
    arcsSelectEl.value = navState.arcsMode;
    layoutButtonEl.textContent =
      navState.layout === 'top' ? 'Layout: Top-Down' : 'Layout: Left-Right';
    collapseCoreButtonEl.setAttribute('aria-pressed', navState.depth === 'core' ? 'true' : 'false');

    const treeControlsHidden = navState.mode === 'map';
    layoutButtonEl.hidden = treeControlsHidden;
    expandAllButtonEl.hidden = treeControlsHidden;
    collapseCoreButtonEl.hidden = treeControlsHidden;

    workspaceEl.setAttribute('data-mode', navState.mode);
    chartPaneEl.hidden = navState.mode === 'map';
    geoPaneEl.hidden = navState.mode === 'tree';

    if (!spotlight.isActive) {
      spotlightBarEl.hidden = true;
      spotlightChipsEl.textContent = '';
      return;
    }

    spotlightBarEl.hidden = false;
    spotlightChipsEl.textContent = '';

    if (navState.traceId !== '') {
      const traced = entriesById.get(navState.traceId);
      const chain = getAncestorChain(navState.traceId);
      spotlightTitleEl.textContent = 'Lineage Trace (' + chain.length + ' generations):';
      for (let i = 0; i < chain.length; i += 1) {
        const step = chain[i];
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'spotlight-chip';
        chip.textContent = step.name;
        chip.addEventListener('click', function onTraceChipClick() {
          openEntryDialog(step.id);
        });
        spotlightChipsEl.appendChild(chip);
      }
      if (traced !== undefined) {
        spotlightBarEl.setAttribute('aria-label', 'Lineage trace for ' + traced.name);
      }
      return;
    }

    const label =
      navState.region === 'peoples'
        ? 'All Mapped People Groups'
        : catalog.regions[navState.region].label;
    const matchedEntries = [];
    spotlight.matchedIds.forEach(function pushEntry(matchId) {
      const found = entriesById.get(matchId);
      if (found !== undefined) {
        matchedEntries.push(found);
      }
    });

    matchedEntries.sort(function compareEntries(left, right) {
      if (left.kind === 'people' && right.kind !== 'people') {
        return -1;
      }
      if (left.kind !== 'people' && right.kind === 'people') {
        return 1;
      }
      return left.name.localeCompare(right.name);
    });

    spotlightTitleEl.textContent = label + ' (' + matchedEntries.length + '):';
    const maxChips = 12;
    for (let i = 0; i < Math.min(matchedEntries.length, maxChips); i += 1) {
      const matched = matchedEntries[i];
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'spotlight-chip';
      chip.textContent = matched.name;
      chip.addEventListener('click', function onMatchChipClick() {
        focusNodeOnCanvas(matched.id, false);
        openEntryDialog(matched.id);
      });
      spotlightChipsEl.appendChild(chip);
    }
    if (matchedEntries.length > maxChips) {
      const moreSpan = document.createElement('span');
      moreSpan.className = 'dialog-footer-hint';
      moreSpan.textContent = '+' + (matchedEntries.length - maxChips) + ' more';
      spotlightChipsEl.appendChild(moreSpan);
    }
  }

  function selectActiveCrossLinks(arcsMode, visibleIds) {
    if (arcsMode === 'none') {
      return [];
    }
    const chosen = [];
    for (let i = 0; i < catalog.crossLinks.length; i += 1) {
      const arc = catalog.crossLinks[i];
      if (!visibleIds.has(arc.from) || !visibleIds.has(arc.to)) {
        continue;
      }
      if (arcsMode === 'converge' && arc.kind === 'coalescence') {
        continue;
      }
      chosen.push(Object.assign({}, arc));
    }
    return chosen;
  }

  function renderTreePane(navState, visibleEntries, spotlight, config) {
    const visibleIds = new Set();
    for (let i = 0; i < visibleEntries.length; i += 1) {
      visibleIds.add(visibleEntries[i].id);
    }

    const activeConnections = selectActiveCrossLinks(navState.arcsMode, visibleIds);
    const paneRect = chartPaneEl.getBoundingClientRect();
    const canvasWidth = Math.max(300, Math.floor(paneRect.width));
    const canvasHeight = Math.max(280, Math.floor(paneRect.height));

    chartContainerEl.innerHTML = '';

    activeChart = new d3.OrgChart()
      .container('#chart')
      .imageName('Abraham-Descendants-and-Peoples')
      .duration(0)
      .initialExpandLevel(1)
      .data(visibleEntries)
      .connections(activeConnections)
      .layout(navState.layout)
      .compact(true)
      .svgWidth(canvasWidth)
      .svgHeight(canvasHeight)
      .minPagingVisibleNodes(function disablePaging() {
        return 2000;
      })
      .nodeWidth(function measureNodeWidth(hierarchyNode) {
        const kind = hierarchyNode.data.kind;
        return kind === 'people' || kind === 'patriarch' || kind === 'matriarch' ? 308 : 286;
      })
      .nodeHeight(function measureNodeHeight(hierarchyNode) {
        const kind = hierarchyNode.data.kind;
        return kind === 'people' || kind === 'patriarch' || kind === 'matriarch' ? 162 : 148;
      })
      .childrenMargin(function measureChildrenMargin() {
        return 58;
      })
      .neighbourMargin(function measureNeighbourMargin() {
        return 44;
      })
      .siblingsMargin(function measureSiblingsMargin() {
        return 22;
      })
      .compactMarginPair(function measureCompactPair() {
        return 46;
      })
      .compactMarginBetween(function measureCompactBetween() {
        return 20;
      })
      .nodeButtonWidth(function measureButtonWidth() {
        return 52;
      })
      .nodeButtonHeight(function measureButtonHeight() {
        return 24;
      })
      .nodeButtonX(function measureButtonX() {
        return -26;
      })
      .nodeButtonY(function measureButtonY() {
        return -12;
      })
      .setActiveNodeCentered(true)
      .buttonContent(function renderButtonContent(context) {
        const node = context.node;
        const isExpanded = Boolean(node.children);
        const symbol = isExpanded ? '&#9652;' : '&#9662;';
        const count = node.data._directSubordinatesPaging || node.data._directSubordinates || 0;
        return '<div class="node-expand-pill"><span>' + symbol + '</span><span>' + count + '</span></div>';
      })
      .onExpandOrCollapse(function afterExpandCollapse() {
        routeConnectionsBehindCards();
      })
      .nodeContent(function renderNodeCard(hierarchyNode) {
        const entry = hierarchyNode.data;
        const branchMeta = catalog.branches[entry.branch] || catalog.branches.root;
        const isMatch = spotlight.matchedIds.has(entry.id);
        const isAncestor = spotlight.ancestorIds.has(entry.id);
        const isDimmed = spotlight.isActive && !isMatch && !isAncestor;

        const wrapClass = isDimmed ? 'tree-card-wrap is-dimmed' : 'tree-card-wrap';
        let cardClass = 'tree-card tree-card-' + escapeHtml(entry.kind);
        if (isMatch) {
          cardClass += ' is-spotlight-match';
        } else if (isAncestor) {
          cardClass += ' is-spotlight-ancestor';
        }

        const totalSubordinates = hierarchyNode.data._totalSubordinates || 0;
        const countHtml =
          totalSubordinates > 0
            ? '<span class="tree-card-count" title="Total nodes below">+' +
              totalSubordinates +
              '</span>'
            : '';

        const contStatus =
          entry.continuity && entry.continuity.status ? entry.continuity.status : 'continuing';
        const contBadge =
          entry.continuity && entry.continuity.badge ? entry.continuity.badge : '';
        const continuityHtml = contBadge
          ? '<div class="tree-card-continuity continuity-tag-' +
            escapeHtml(contStatus) +
            '">' +
            escapeHtml(contBadge) +
            '</div>'
          : '';

        const inlineVars =
          '--card-accent:' +
          branchMeta.accent +
          ';--card-surface:' +
          branchMeta.surface +
          ';--card-border:' +
          branchMeta.border +
          ';--card-badge-bg:' +
          branchMeta.badgeBg +
          ';--card-badge-text:' +
          branchMeta.badgeText +
          ';';

        return (
          '<div class="' +
          wrapClass +
          '" role="button" tabindex="0" aria-label="' +
          escapeHtml(entry.name + ' - ' + entry.cardRole) +
          '" data-entry-id="' +
          escapeHtml(entry.id) +
          '">' +
          '<div class="' +
          cardClass +
          '" style="' +
          inlineVars +
          '">' +
          '<div class="tree-card-stripe"></div>' +
          '<div class="tree-card-body">' +
          '<div class="tree-card-top">' +
          '<div class="tree-card-emblem-group">' +
          '<span class="tree-card-emblem">' +
          kindIconSvg(entry.kind) +
          '</span>' +
          '<span class="tree-card-kind">' +
          escapeHtml(shortKindBadge(entry.kind)) +
          '</span>' +
          '</div>' +
          '<span class="tree-card-era">' +
          escapeHtml(entry.era) +
          '</span>' +
          '</div>' +
          '<div class="tree-card-title-group">' +
          '<div class="tree-card-name">' +
          escapeHtml(entry.name) +
          '</div>' +
          (entry.nativeNames
            ? '<div class="tree-card-native">' + escapeHtml(entry.nativeNames) + '</div>'
            : '') +
          '</div>' +
          '<div class="tree-card-role">' +
          escapeHtml(entry.cardRole) +
          '</div>' +
          continuityHtml +
          '<div class="tree-card-footer">' +
          '<span class="tree-card-territory">' +
          escapeHtml(entry.territory) +
          '</span>' +
          countHtml +
          '</div>' +
          '</div>' +
          '</div>' +
          '</div>'
        );
      })
      .nodeUpdate(function styleNodeRect(hierarchyNode) {
        const rectW = Math.max(0, hierarchyNode.width - 4);
        const rectH = Math.max(0, hierarchyNode.height - 4);
        d3.select(this)
          .select('.node-rect')
          .attr('x', 2)
          .attr('y', 2)
          .attr('width', rectW)
          .attr('height', rectH)
          .attr('rx', 8)
          .attr('ry', 8)
          .attr('stroke', 'none')
          .attr('fill', '#f4efe4');
      })
      .linkUpdate(function styleTreeLink(hierarchyNode) {
        const entry = hierarchyNode.data;
        const branchMeta = catalog.branches[entry.branch] || catalog.branches.root;
        const onSpotlightPath =
          spotlight.matchedIds.has(entry.id) || spotlight.ancestorIds.has(entry.id);

        const linkSelection = d3.select(this).attr('fill', 'none');
        if (spotlight.isActive) {
          linkSelection
            .attr('stroke', onSpotlightPath ? branchMeta.accent : '#d8cebc')
            .attr('stroke-width', onSpotlightPath ? 3.2 : 1.2)
            .attr('opacity', onSpotlightPath ? 0.96 : 0.35);
          if (onSpotlightPath) {
            linkSelection.raise();
          }
        } else {
          linkSelection
            .attr('stroke', branchMeta.accent)
            .attr('stroke-width', 1.8)
            .attr('opacity', 0.55);
        }
      })
      .connectionsUpdate(function styleCrossArc(conn) {
        const kind = conn.kind || 'absorption';
        let strokeColor = '#8c5a18';
        let strokeWidth = 2.2;
        let dash = '7,5';
        let markerId = 'abraham-arrow-absorption';

        if (kind === 'coalescence') {
          strokeColor = '#6e6456';
          strokeWidth = 1.45;
          dash = '3,4';
          markerId = 'abraham-arrow-coalescence';
        } else if (kind === 'marriage') {
          strokeColor = '#982b2b';
          strokeWidth = 2.0;
          dash = '2,4';
          markerId = 'abraham-arrow-marriage';
        }

        const touchesSpotlight =
          !spotlight.isActive ||
          spotlight.matchedIds.has(conn.from) ||
          spotlight.matchedIds.has(conn.to) ||
          spotlight.ancestorIds.has(conn.from) ||
          spotlight.ancestorIds.has(conn.to);

        d3.select(this)
          .attr('fill', 'none')
          .attr('stroke', strokeColor)
          .attr('stroke-width', strokeWidth)
          .attr('stroke-dasharray', dash)
          .attr('opacity', touchesSpotlight ? 0.86 : 0.16)
          .attr('pointer-events', 'none')
          .attr('marker-start', null)
          .attr('marker-end', 'url(#' + markerId + ')');
      })
      .onNodeClick(function openClickedNode(clickedNode) {
        const clickedId =
          clickedNode && clickedNode.data
            ? clickedNode.data.id
            : clickedNode && clickedNode.id
              ? clickedNode.id
              : String(clickedNode);
        if (entriesById.has(clickedId)) {
          openEntryDialog(clickedId);
        }
      });

    activeChart.render();
    if (config.centerEntryId && visibleIds.has(config.centerEntryId)) {
      activeChart.setCentered(config.centerEntryId).render();
    } else {
      activeChart.fit({ animate: false });
    }
    routeConnectionsBehindCards();
    activeChart.duration(240);
  }

  function renderWorkspace(options) {
    const config = options || {};
    const navState = readNavigationState();
    const visibleEntries = collectVisibleEntries(navState.branch, navState.depth);
    const spotlight = computeSpotlightSets(visibleEntries, navState);

    syncToolbarControls(navState, visibleEntries, spotlight);

    if (navState.mode !== 'map') {
      renderTreePane(navState, visibleEntries, spotlight, config);
    }

    if (navState.mode !== 'tree' && globalScope.AbrahamGeoMap && catalog.geo) {
      const justCreated = activeAtlas === null;
      if (justCreated) {
        activeAtlas = globalScope.AbrahamGeoMap.createAtlas(geoMapContainerEl, catalog, {
          onSelectEntry: function onMapSelect(entryId) {
            openEntryDialog(entryId);
          },
          onToggleRoutes: function onRoutesToggle(nextRoutesShown) {
            writeNavigationState({ routesShown: nextRoutesShown });
          },
        });
      }
      if (activeAtlas !== null) {
        const traceChain = navState.traceId !== '' ? getAncestorChain(navState.traceId) : [];
        activeAtlas.update(
          {
            visibleEntries: visibleEntries,
            spotlight: spotlight,
            traceChain: traceChain,
            routesShown: navState.routesShown,
            arcsMode: navState.arcsMode,
          },
          {
            resize: true,
            focusEntryId: config.focusMapEntryId || '',
            fitSelection: Boolean(justCreated || config.fitMapSelection),
            animate: Boolean(config.animate && !justCreated),
          }
        );
      }
    }
  }

  function focusNodeOnCanvas(entryId, recordTrace, forceMapVisible) {
    const current = readNavigationState();
    const target = entriesById.get(entryId);
    if (target === undefined) {
      return;
    }

    const nextBranch = isEntryInBranch(target, current.branch) ? current.branch : 'all';
    const nextMode =
      forceMapVisible && current.mode === 'tree' ? 'split' : current.mode;

    writeNavigationState({
      mode: nextMode,
      branch: nextBranch,
      depth: 'all',
      region: recordTrace ? 'all' : current.region,
      traceId: recordTrace ? entryId : current.traceId,
    });

    renderWorkspace({
      centerEntryId: entryId,
      focusMapEntryId: entryId,
      fitMapSelection: true,
      animate: true,
    });
  }

  function extractHostLabel(urlString) {
    try {
      return new URL(urlString).hostname.replace(/^www\./, '');
    } catch (_error) {
      return 'source';
    }
  }

  function createChipButton(targetEntry, onSelect) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = targetEntry.kind === 'people' ? 'node-chip node-chip-people' : 'node-chip';

    const nameSpan = document.createElement('span');
    nameSpan.textContent = targetEntry.name;
    chip.appendChild(nameSpan);

    const kindSpan = document.createElement('span');
    kindSpan.className = 'node-chip-kind';
    kindSpan.textContent = shortKindBadge(targetEntry.kind);
    chip.appendChild(kindSpan);

    chip.addEventListener('click', function handleChipClick() {
      onSelect(targetEntry.id);
    });
    return chip;
  }

  function appendCrossLinkRows(container, links, pickPartnerId) {
    const list = document.createElement('div');
    list.className = 'related-list';
    for (let i = 0; i < links.length; i += 1) {
      const link = links[i];
      const partner = entriesById.get(pickPartnerId(link));
      if (partner !== undefined) {
        const row = document.createElement('div');
        row.className = 'related-row';
        row.appendChild(createChipButton(partner, openEntryDialog));
        const desc = document.createElement('span');
        desc.className = 'related-desc';
        desc.textContent = link.summary;
        row.appendChild(desc);
        list.appendChild(row);
      }
    }
    container.appendChild(list);
  }

  function openEntryDialog(entryId) {
    const entry = entriesById.get(entryId);
    if (entry === undefined) {
      return;
    }
    activeDialogEntryId = entryId;

    const branchMeta = catalog.branches[entry.branch] || catalog.branches.root;
    entryDialogEl.style.setProperty('--dialog-accent', branchMeta.accent);
    entryDialogEl.style.setProperty('--dialog-surface', branchMeta.surface);
    entryDialogEl.style.setProperty('--dialog-badge-bg', branchMeta.badgeBg);
    entryDialogEl.style.setProperty('--dialog-badge-text', branchMeta.badgeText);

    const badgesEl = document.getElementById('dialog-badges');
    badgesEl.textContent = '';

    const kindBadge = document.createElement('span');
    kindBadge.className = 'dialog-badge';
    kindBadge.textContent = catalog.kinds[entry.kind].label;
    badgesEl.appendChild(kindBadge);

    const branchBadge = document.createElement('span');
    branchBadge.className = 'dialog-badge dialog-badge-neutral';
    branchBadge.textContent = branchMeta.shortLabel;
    badgesEl.appendChild(branchBadge);

    const eraBadge = document.createElement('span');
    eraBadge.className = 'dialog-badge dialog-badge-neutral';
    eraBadge.textContent = entry.era;
    badgesEl.appendChild(eraBadge);

    if (entry.continuity && entry.continuity.status && catalog.continuityKinds) {
      const statusMeta = catalog.continuityKinds[entry.continuity.status];
      if (statusMeta) {
        const contHeaderBadge = document.createElement('span');
        contHeaderBadge.className =
          'dialog-badge dialog-badge-continuity-' + entry.continuity.status;
        contHeaderBadge.textContent = statusMeta.label;
        badgesEl.appendChild(contHeaderBadge);
      }
    }

    document.getElementById('dialog-title').textContent = entry.name;
    const nativeEl = document.getElementById('dialog-native');
    nativeEl.textContent = entry.nativeNames || '';
    nativeEl.hidden = !entry.nativeNames;

    document.getElementById('dialog-role').textContent = entry.cardRole;

    const bodyEl = document.getElementById('dialog-body');
    bodyEl.textContent = '';

    const chain = getAncestorChain(entry.id);
    if (chain.length > 1) {
      const crumbNav = document.createElement('nav');
      crumbNav.className = 'lineage-breadcrumb';
      crumbNav.setAttribute('aria-label', 'Ancestral lineage');

      const crumbLabel = document.createElement('span');
      crumbLabel.className = 'crumb-label';
      crumbLabel.textContent = 'Lineage:';
      crumbNav.appendChild(crumbLabel);

      for (let i = 0; i < chain.length; i += 1) {
        const ancestor = chain[i];
        if (i > 0) {
          const separator = document.createElement('span');
          separator.className = 'crumb-sep';
          separator.textContent = '›';
          crumbNav.appendChild(separator);
        }
        if (ancestor.id === entry.id) {
          const currentSpan = document.createElement('span');
          currentSpan.className = 'crumb-current';
          currentSpan.textContent = ancestor.name;
          crumbNav.appendChild(currentSpan);
        } else {
          const crumbButton = document.createElement('button');
          crumbButton.type = 'button';
          crumbButton.className = 'crumb-link';
          crumbButton.textContent = ancestor.name;
          crumbButton.addEventListener('click', function jumpToAncestor() {
            openEntryDialog(ancestor.id);
          });
          crumbNav.appendChild(crumbButton);
        }
      }
      bodyEl.appendChild(crumbNav);
    }

    const factsGrid = document.createElement('div');
    factsGrid.className = 'facts-grid';

    const territoryBox = document.createElement('div');
    territoryBox.className = 'fact-box';
    const territoryLabel = document.createElement('div');
    territoryLabel.className = 'fact-label';
    territoryLabel.textContent = 'Historical Lands & Region';
    const territoryValue = document.createElement('div');
    territoryValue.className = 'fact-value';
    const regionMeta = catalog.regions[entry.region];
    territoryValue.textContent =
      entry.territory + (regionMeta !== undefined ? ' (' + regionMeta.label + ')' : '');
    territoryBox.appendChild(territoryLabel);
    territoryBox.appendChild(territoryValue);
    factsGrid.appendChild(territoryBox);

    if (entry.continuity && entry.continuity.detail) {
      const contBox = document.createElement('div');
      contBox.className = 'fact-box fact-box-continuity';
      const contLabel = document.createElement('div');
      contLabel.className = 'fact-label';
      contLabel.textContent = 'Historical Outcome & Continuity';
      const contValue = document.createElement('div');
      contValue.className = 'fact-value';
      contValue.textContent = entry.continuity.detail;
      contBox.appendChild(contLabel);
      contBox.appendChild(contValue);
      factsGrid.appendChild(contBox);
    }

    if (entry.mother || (entry.consorts && entry.consorts.length > 0)) {
      const familyBox = document.createElement('div');
      familyBox.className = 'fact-box';
      const familyLabel = document.createElement('div');
      familyLabel.className = 'fact-label';
      if (entry.mother && entry.consorts) {
        familyLabel.textContent = 'Mother & Consorts';
      } else {
        familyLabel.textContent = entry.mother ? 'Maternal Line' : 'Consorts / Unions';
      }
      const familyValue = document.createElement('div');
      familyValue.className = 'fact-value';
      const parts = [];
      if (entry.mother) {
        parts.push('Mother: ' + entry.mother);
      }
      if (entry.consorts && entry.consorts.length > 0) {
        parts.push('Consorts: ' + entry.consorts.join(', '));
      }
      familyValue.textContent = parts.join(' · ');
      familyBox.appendChild(familyLabel);
      familyBox.appendChild(familyValue);
      factsGrid.appendChild(familyBox);
    }

    if (entry.traditions && entry.traditions.length > 0) {
      const traditionBox = document.createElement('div');
      traditionBox.className = 'fact-box';
      const traditionLabel = document.createElement('div');
      traditionLabel.className = 'fact-label';
      traditionLabel.textContent = 'Attesting Traditions & Evidence';
      const tagWrap = document.createElement('div');
      tagWrap.className = 'tradition-tags';
      for (let i = 0; i < entry.traditions.length; i += 1) {
        const tag = document.createElement('span');
        tag.className = 'tradition-tag';
        tag.textContent = entry.traditions[i];
        tagWrap.appendChild(tag);
      }
      traditionBox.appendChild(traditionLabel);
      traditionBox.appendChild(tagWrap);
      factsGrid.appendChild(traditionBox);
    }

    bodyEl.appendChild(factsGrid);

    if (entry.geo && globalScope.AbrahamGeoMap && catalog.geo) {
      const mapSection = document.createElement('section');
      mapSection.className = 'dialog-section';
      const mapHeading = document.createElement('h3');
      mapHeading.className = 'dialog-section-title';
      mapHeading.textContent = 'Homeland & Archaeological Footprint';
      mapSection.appendChild(mapHeading);

      const miniMapBox = document.createElement('div');
      miniMapBox.className = 'dialog-minimap';
      mapSection.appendChild(miniMapBox);
      bodyEl.appendChild(mapSection);

      globalScope.AbrahamGeoMap.renderMiniMap(
        miniMapBox,
        entry,
        catalog,
        function viewEntryInAtlas(targetId) {
          entryDialogEl.close();
          focusNodeOnCanvas(targetId, true, true);
        }
      );
    }

    const historySection = document.createElement('section');
    historySection.className = 'dialog-section';
    const historyHeading = document.createElement('h3');
    historyHeading.className = 'dialog-section-title';
    historyHeading.textContent = 'History & Genealogical Context';
    historySection.appendChild(historyHeading);

    const proseDiv = document.createElement('div');
    proseDiv.className = 'history-prose';
    for (let i = 0; i < entry.history.length; i += 1) {
      const paragraphNode = document.createElement('p');
      paragraphNode.textContent = entry.history[i];
      proseDiv.appendChild(paragraphNode);
    }
    historySection.appendChild(proseDiv);
    bodyEl.appendChild(historySection);

    const outLinks = outgoingCrossLinks.get(entry.id) || [];
    if (outLinks.length > 0) {
      const outSection = document.createElement('section');
      outSection.className = 'dialog-section';
      const outHeading = document.createElement('h3');
      outHeading.className = 'dialog-section-title';
      outHeading.textContent =
        'Coalescence, Absorption & Marriage Ties (' + outLinks.length + ')';
      outSection.appendChild(outHeading);
      appendCrossLinkRows(outSection, outLinks, function getTo(link) {
        return link.to;
      });
      bodyEl.appendChild(outSection);
    }

    const inLinks = incomingCrossLinks.get(entry.id) || [];
    if (inLinks.length > 0) {
      const inSection = document.createElement('section');
      inSection.className = 'dialog-section';
      const inHeading = document.createElement('h3');
      inHeading.className = 'dialog-section-title';
      inHeading.textContent =
        'Constituent & Absorbed Lineages (' + inLinks.length + ')';
      inSection.appendChild(inHeading);
      appendCrossLinkRows(inSection, inLinks, function getFrom(link) {
        return link.from;
      });
      bodyEl.appendChild(inSection);
    }

    const directChildren = childrenByParentId.get(entry.id) || [];
    if (directChildren.length > 0) {
      const childSection = document.createElement('section');
      childSection.className = 'dialog-section';
      const childHeading = document.createElement('h3');
      childHeading.className = 'dialog-section-title';
      childHeading.textContent = 'Direct Branches & Issue (' + directChildren.length + ')';
      childSection.appendChild(childHeading);

      const chipList = document.createElement('div');
      chipList.className = 'node-chip-list';
      for (let i = 0; i < directChildren.length; i += 1) {
        chipList.appendChild(createChipButton(directChildren[i], openEntryDialog));
      }
      childSection.appendChild(chipList);
      bodyEl.appendChild(childSection);
    }

    const subtreePeoples = getPeopleInSubtree(entry.id);
    const hasDeeperPeoples = subtreePeoples.some(function checkDepth(peopleNode) {
      return peopleNode.parentId !== entry.id;
    });
    if (subtreePeoples.length > 0 && hasDeeperPeoples) {
      const peoplesSection = document.createElement('section');
      peoplesSection.className = 'dialog-section';
      const peoplesHeading = document.createElement('h3');
      peoplesHeading.className = 'dialog-section-title';
      peoplesHeading.textContent =
        'Peoples & Polities Emergent from This Line (' + subtreePeoples.length + ')';
      peoplesSection.appendChild(peoplesHeading);

      const peoplesList = document.createElement('div');
      peoplesList.className = 'node-chip-list';
      for (let i = 0; i < subtreePeoples.length; i += 1) {
        peoplesList.appendChild(createChipButton(subtreePeoples[i], openEntryDialog));
      }
      peoplesSection.appendChild(peoplesList);
      bodyEl.appendChild(peoplesSection);
    }

    if (entry.relatedIds && entry.relatedIds.length > 0) {
      const relatedSection = document.createElement('section');
      relatedSection.className = 'dialog-section';
      const relatedHeading = document.createElement('h3');
      relatedHeading.className = 'dialog-section-title';
      relatedHeading.textContent = 'Cross-Lineage & Regional Links';
      relatedSection.appendChild(relatedHeading);

      const relatedList = document.createElement('div');
      relatedList.className = 'related-list';
      for (let i = 0; i < entry.relatedIds.length; i += 1) {
        const relationLink = entry.relatedIds[i];
        const target = entriesById.get(relationLink.id);
        if (target !== undefined) {
          const row = document.createElement('div');
          row.className = 'related-row';
          row.appendChild(createChipButton(target, openEntryDialog));
          const relationNote = document.createElement('span');
          relationNote.className = 'related-desc';
          relationNote.textContent = relationLink.relation;
          row.appendChild(relationNote);
          relatedList.appendChild(row);
        }
      }
      relatedSection.appendChild(relatedList);
      bodyEl.appendChild(relatedSection);
    }

    if (entry.sources && entry.sources.length > 0) {
      const sourceSection = document.createElement('section');
      sourceSection.className = 'dialog-section';
      const sourceHeading = document.createElement('h3');
      sourceHeading.className = 'dialog-section-title';
      sourceHeading.textContent = 'Primary Texts & Scholarly References';
      sourceSection.appendChild(sourceHeading);

      const sourceList = document.createElement('ul');
      sourceList.className = 'source-list';
      for (let i = 0; i < entry.sources.length; i += 1) {
        const sourceItem = entry.sources[i];
        const sourceRow = document.createElement('li');
        sourceRow.className = 'source-item';

        const anchor = document.createElement('a');
        anchor.className = 'source-link';
        anchor.href = sourceItem.url;
        anchor.target = '_blank';
        anchor.rel = 'noopener noreferrer';
        anchor.textContent = sourceItem.label + ' ↗';
        sourceRow.appendChild(anchor);

        const metaWrap = document.createElement('span');
        metaWrap.className = 'source-meta';

        const kindSpan = document.createElement('span');
        kindSpan.className = 'source-kind';
        kindSpan.textContent = sourceItem.kind;
        metaWrap.appendChild(kindSpan);

        const hostSpan = document.createElement('span');
        hostSpan.className = 'source-host';
        hostSpan.textContent = extractHostLabel(sourceItem.url);
        metaWrap.appendChild(hostSpan);

        sourceRow.appendChild(metaWrap);
        sourceList.appendChild(sourceRow);
      }
      sourceSection.appendChild(sourceList);
      bodyEl.appendChild(sourceSection);
    }

    bodyEl.scrollTop = 0;
    if (scopeDialogEl.open) {
      scopeDialogEl.close();
    }
    writeNavigationState({ entryId: entryId, scopeOpen: false });
    if (!entryDialogEl.open) {
      entryDialogEl.showModal();
    }
  }

  function openScopeDialog() {
    const scopeBodyEl = document.getElementById('scope-dialog-body');
    scopeBodyEl.textContent = '';

    for (let i = 0; i < catalog.scopeNotes.length; i += 1) {
      const note = catalog.scopeNotes[i];
      const section = document.createElement('section');
      section.className = 'dialog-section';

      const heading = document.createElement('h3');
      heading.className = 'dialog-section-title';
      heading.textContent = note.heading;
      section.appendChild(heading);

      const prose = document.createElement('div');
      prose.className = 'history-prose';
      for (let j = 0; j < note.paragraphs.length; j += 1) {
        const paragraphNode = document.createElement('p');
        paragraphNode.textContent = note.paragraphs[j];
        prose.appendChild(paragraphNode);
      }
      section.appendChild(prose);
      scopeBodyEl.appendChild(section);
    }

    if (entryDialogEl.open) {
      entryDialogEl.close();
    }
    writeNavigationState({ scopeOpen: true, entryId: '' });
    if (!scopeDialogEl.open) {
      scopeDialogEl.showModal();
    }
  }

  function setActiveSearchOption(nextIndex) {
    const options = searchResultsEl.querySelectorAll('.search-option');
    if (options.length === 0) {
      activeSearchIndex = -1;
      searchInputEl.removeAttribute('aria-activedescendant');
      return;
    }
    const clamped =
      ((nextIndex % options.length) + options.length) % options.length;
    activeSearchIndex = clamped;
    for (let i = 0; i < options.length; i += 1) {
      const isCurrent = i === clamped;
      options[i].setAttribute('aria-selected', isCurrent ? 'true' : 'false');
      if (isCurrent) {
        searchInputEl.setAttribute('aria-activedescendant', options[i].id);
        options[i].scrollIntoView({ block: 'nearest' });
      }
    }
  }

  function closeSearchDropdown() {
    searchResultsEl.hidden = true;
    searchInputEl.setAttribute('aria-expanded', 'false');
    searchInputEl.removeAttribute('aria-activedescendant');
    activeSearchIndex = -1;
  }

  function renderSearchDropdown(rawQuery) {
    const query = rawQuery.trim().toLowerCase();
    if (query === '') {
      closeSearchDropdown();
      searchResultsEl.textContent = '';
      return;
    }

    const scored = [];
    for (let i = 0; i < catalog.entries.length; i += 1) {
      const entry = catalog.entries[i];
      const nameLower = entry.name.toLowerCase();
      const nativeLower = (entry.nativeNames || '').toLowerCase();
      const territoryLower = entry.territory.toLowerCase();
      const roleLower = entry.cardRole.toLowerCase();
      const summaryLower = entry.summary.toLowerCase();

      let score = 0;
      if (nameLower.startsWith(query)) {
        score = 100;
      } else if (nameLower.includes(query)) {
        score = 80;
      } else if (nativeLower.includes(query)) {
        score = 70;
      } else if (territoryLower.includes(query)) {
        score = 60;
      } else if (roleLower.includes(query) || summaryLower.includes(query)) {
        score = 40;
      }

      if (score > 0) {
        scored.push({ entry: entry, score: score });
      }
    }

    scored.sort(function sortByScore(left, right) {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      return left.entry.name.localeCompare(right.entry.name);
    });

    searchResultsEl.textContent = '';
    activeSearchIndex = -1;
    if (scored.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'search-empty';
      empty.textContent = 'No matching person, tribe, or people group.';
      searchResultsEl.appendChild(empty);
      searchResultsEl.hidden = false;
      searchInputEl.setAttribute('aria-expanded', 'true');
      return;
    }

    const limit = Math.min(scored.length, 10);
    for (let i = 0; i < limit; i += 1) {
      const match = scored[i].entry;
      const branchMeta = catalog.branches[match.branch] || catalog.branches.root;
      const option = document.createElement('button');
      option.type = 'button';
      option.id = 'search-opt-' + match.id;
      option.className = 'search-option';
      option.setAttribute('role', 'option');
      option.setAttribute('aria-selected', 'false');

      const topRow = document.createElement('div');
      topRow.className = 'search-option-top';

      const nameEl = document.createElement('span');
      nameEl.className = 'search-option-name';
      nameEl.textContent = match.name;
      topRow.appendChild(nameEl);

      const kindEl = document.createElement('span');
      kindEl.className = 'search-option-kind';
      kindEl.style.backgroundColor = branchMeta.badgeBg;
      kindEl.style.color = branchMeta.badgeText;
      kindEl.textContent = shortKindBadge(match.kind);
      topRow.appendChild(kindEl);

      const metaRow = document.createElement('div');
      metaRow.className = 'search-option-meta';
      metaRow.textContent = match.territory + ' · ' + match.cardRole;

      option.appendChild(topRow);
      option.appendChild(metaRow);

      option.addEventListener('click', function selectSearchResult() {
        closeSearchDropdown();
        searchInputEl.value = '';
        focusNodeOnCanvas(match.id, true, false);
        openEntryDialog(match.id);
      });

      searchResultsEl.appendChild(option);
    }

    searchResultsEl.hidden = false;
    searchInputEl.setAttribute('aria-expanded', 'true');
  }

  function wireDialogDismissal(dialogEl) {
    dialogEl.addEventListener('click', function onBackdropClick(event) {
      if (event.target === dialogEl) {
        dialogEl.close();
      }
    });
  }

  function renderCatalogLoadError(error) {
    statsPillEl.textContent = 'Local file:// fetch blocked';
    chartContainerEl.textContent = '';

    const card = document.createElement('div');
    card.className = 'load-error-card';

    const heading = document.createElement('h2');
    heading.className = 'load-error-title';
    heading.textContent = 'Cannot fetch JSON files over file:// from public/index.html';
    card.appendChild(heading);

    const detail = document.createElement('p');
    detail.className = 'load-error-text';
    detail.textContent =
      'Browsers block fetch() requests to local JSON files on file:// URLs. ' +
      'Open the repo-root index.html for local offline viewing, or serve public/ over HTTP.';
    card.appendChild(detail);

    const actions = document.createElement('div');
    actions.className = 'load-error-actions';

    const rootLink = document.createElement('a');
    rootLink.className = 'action-button';
    rootLink.href = '../index.html' + globalScope.location.search + globalScope.location.hash;
    rootLink.textContent = 'Open repo-root index.html';
    actions.appendChild(rootLink);

    const cmdCode = document.createElement('code');
    cmdCode.className = 'load-error-code';
    cmdCode.textContent = 'python3 -m http.server 8080 -d public';
    actions.appendChild(cmdCode);

    card.appendChild(actions);

    if (error && error.message) {
      const meta = document.createElement('p');
      meta.className = 'load-error-meta';
      meta.textContent = String(error.message);
      card.appendChild(meta);
    }

    chartContainerEl.appendChild(card);
  }

  function startWithCatalog(loadedCatalog) {
    catalog = loadedCatalog;
    for (let i = 0; i < catalog.entries.length; i += 1) {
      const entry = catalog.entries[i];
      entriesById.set(entry.id, entry);
      if (entry.parentId !== '') {
        let siblings = childrenByParentId.get(entry.parentId);
        if (siblings === undefined) {
          siblings = [];
          childrenByParentId.set(entry.parentId, siblings);
        }
        siblings.push(entry);
      }
    }

    for (let i = 0; i < catalog.crossLinks.length; i += 1) {
      const link = catalog.crossLinks[i];
      let outList = outgoingCrossLinks.get(link.from);
      if (outList === undefined) {
        outList = [];
        outgoingCrossLinks.set(link.from, outList);
      }
      outList.push(link);

      let inList = incomingCrossLinks.get(link.to);
      if (inList === undefined) {
        inList = [];
        incomingCrossLinks.set(link.to, inList);
      }
      inList.push(link);
    }

    for (let i = 0; i < modeTabButtons.length; i += 1) {
      modeTabButtons[i].addEventListener('click', function onModeClick(event) {
        const nextMode = event.currentTarget.getAttribute('data-view-mode');
        writeNavigationState({ mode: nextMode });
        renderWorkspace({ fitMapSelection: true, animate: true });
      });
    }

    for (let i = 0; i < branchTabButtons.length; i += 1) {
      branchTabButtons[i].addEventListener('click', function onBranchClick(event) {
        const nextBranch = event.currentTarget.getAttribute('data-branch-tab');
        writeNavigationState({ branch: nextBranch, traceId: '' });
        renderWorkspace({ fitMapSelection: true, animate: true });
      });
    }

    regionSelectEl.addEventListener('change', function onRegionChange() {
      writeNavigationState({ region: regionSelectEl.value, traceId: '' });
      renderWorkspace({ fitMapSelection: true, animate: true });
    });

    arcsSelectEl.addEventListener('change', function onArcsModeChange() {
      writeNavigationState({ arcsMode: arcsSelectEl.value });
      renderWorkspace({ animate: false });
    });

    layoutButtonEl.addEventListener('click', function onToggleLayout() {
      const current = readNavigationState();
      const nextLayout = current.layout === 'top' ? 'left' : 'top';
      writeNavigationState({ layout: nextLayout });
      renderWorkspace({ animate: true });
    });

    expandAllButtonEl.addEventListener('click', function onExpandAll() {
      writeNavigationState({ depth: 'all' });
      renderWorkspace({ animate: true });
    });

    collapseCoreButtonEl.addEventListener('click', function onCollapseCore() {
      const current = readNavigationState();
      const nextDepth = current.depth === 'core' ? 'all' : 'core';
      writeNavigationState({ depth: nextDepth });
      renderWorkspace({ animate: true });
    });

    fitChartButtonEl.addEventListener('click', function onFitChart() {
      const current = readNavigationState();
      if (current.mode === 'map' && activeAtlas !== null) {
        activeAtlas.fitDefault(true);
      } else if (activeChart !== null) {
        activeChart.fit({ animate: true });
      }
    });

    zoomInButtonEl.addEventListener('click', function onZoomIn() {
      const current = readNavigationState();
      if (current.mode === 'map' && activeAtlas !== null) {
        activeAtlas.zoomIn();
      } else if (activeChart !== null) {
        activeChart.zoomIn();
      }
    });

    zoomOutButtonEl.addEventListener('click', function onZoomOut() {
      const current = readNavigationState();
      if (current.mode === 'map' && activeAtlas !== null) {
        activeAtlas.zoomOut();
      } else if (activeChart !== null) {
        activeChart.zoomOut();
      }
    });

    clearSpotlightButtonEl.addEventListener('click', function onClearSpotlight() {
      writeNavigationState({ region: 'all', traceId: '' });
      renderWorkspace({ fitMapSelection: true, animate: true });
    });

    openScopeButtonEl.addEventListener('click', openScopeDialog);

    chartContainerEl.addEventListener('keydown', function onCardKeydown(event) {
      if (event.key !== 'Enter' && event.key !== ' ') {
        return;
      }
      const cardEl = event.target.closest('.tree-card-wrap[data-entry-id]');
      if (cardEl) {
        event.preventDefault();
        const targetId = cardEl.getAttribute('data-entry-id');
        if (entriesById.has(targetId)) {
          openEntryDialog(targetId);
        }
      }
    });

    document
      .getElementById('entry-dialog-close')
      .addEventListener('click', function closeEntryDialog() {
        entryDialogEl.close();
      });

    document
      .getElementById('entry-dialog-done')
      .addEventListener('click', function closeEntryFooter() {
        entryDialogEl.close();
      });

    document
      .getElementById('entry-dialog-trace')
      .addEventListener('click', function traceFromDialog() {
        if (activeDialogEntryId !== null) {
          const targetId = activeDialogEntryId;
          entryDialogEl.close();
          focusNodeOnCanvas(targetId, true, false);
        }
      });

    document
      .getElementById('entry-dialog-map')
      .addEventListener('click', function mapFromDialog() {
        if (activeDialogEntryId !== null) {
          const targetId = activeDialogEntryId;
          entryDialogEl.close();
          focusNodeOnCanvas(targetId, true, true);
        }
      });

    document
      .getElementById('scope-dialog-close')
      .addEventListener('click', function closeScopeDialog() {
        scopeDialogEl.close();
      });

    document
      .getElementById('scope-dialog-done')
      .addEventListener('click', function closeScopeFooter() {
        scopeDialogEl.close();
      });

    entryDialogEl.addEventListener('close', function onEntryDialogClosed() {
      const closedEntryId = activeDialogEntryId;
      activeDialogEntryId = null;
      const current = readNavigationState();
      if (closedEntryId !== null && current.entryId === closedEntryId) {
        writeNavigationState({ entryId: '' });
      }
    });

    scopeDialogEl.addEventListener('close', function onScopeDialogClosed() {
      const current = readNavigationState();
      if (current.scopeOpen) {
        writeNavigationState({ scopeOpen: false });
      }
    });

    wireDialogDismissal(entryDialogEl);
    wireDialogDismissal(scopeDialogEl);

    searchInputEl.addEventListener('input', function onSearchInput() {
      renderSearchDropdown(searchInputEl.value);
    });

    searchInputEl.addEventListener('keydown', function onSearchKeydown(event) {
      if (event.key === 'Escape') {
        closeSearchDropdown();
      } else if (event.key === 'ArrowDown' && !searchResultsEl.hidden) {
        event.preventDefault();
        setActiveSearchOption(activeSearchIndex + 1);
      } else if (event.key === 'ArrowUp' && !searchResultsEl.hidden) {
        event.preventDefault();
        setActiveSearchOption(activeSearchIndex <= 0 ? -1 : activeSearchIndex - 1);
      } else if (event.key === 'Enter') {
        const options = searchResultsEl.querySelectorAll('.search-option');
        const chosen =
          activeSearchIndex >= 0 && activeSearchIndex < options.length
            ? options[activeSearchIndex]
            : options[0] || null;
        if (chosen !== null) {
          event.preventDefault();
          chosen.click();
        }
      }
    });

    document.addEventListener('click', function onDocumentClick(event) {
      if (!event.target.closest('.search-box')) {
        closeSearchDropdown();
      }
    });

    let resizeTimer = null;
    globalScope.addEventListener('resize', function onWindowResize() {
      if (resizeTimer !== null) {
        clearTimeout(resizeTimer);
      }
      resizeTimer = setTimeout(function resizePanes() {
        const nav = readNavigationState();
        if (nav.mode !== 'map' && activeChart !== null) {
          const rect = chartPaneEl.getBoundingClientRect();
          activeChart
            .svgWidth(Math.max(300, Math.floor(rect.width)))
            .svgHeight(Math.max(280, Math.floor(rect.height)))
            .render();
          routeConnectionsBehindCards();
        }
        if (nav.mode !== 'tree' && activeAtlas !== null) {
          activeAtlas.resize();
        }
      }, 150);
    });

    globalScope.addEventListener('popstate', function onPopState() {
      fallbackQuery = globalScope.location.search;
      const nav = readNavigationState();
      renderWorkspace({ fitMapSelection: true, animate: false });
      if (nav.entryId !== '') {
        openEntryDialog(nav.entryId);
      } else if (entryDialogEl.open) {
        entryDialogEl.close();
      }
      if (nav.scopeOpen) {
        openScopeDialog();
      } else if (scopeDialogEl.open) {
        scopeDialogEl.close();
      }
    });

    const initialNav = readNavigationState();
    const initialCenterId =
      initialNav.traceId !== ''
        ? initialNav.traceId
        : initialNav.entryId !== ''
          ? initialNav.entryId
          : undefined;
    renderWorkspace({
      centerEntryId: initialCenterId,
      focusMapEntryId: initialCenterId || '',
      fitMapSelection: true,
      animate: false,
    });
    if (initialNav.entryId !== '') {
      openEntryDialog(initialNav.entryId);
    } else if (initialNav.scopeOpen) {
      openScopeDialog();
    }
  }

  loadAbrahamCatalog(globalScope).then(startWithCatalog, renderCatalogLoadError);
})(window);
