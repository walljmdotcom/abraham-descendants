(function registerAbrahamGeoMap(globalScope) {
  'use strict';

  let clipIdCounter = 0;

  function clampNumber(value, minValue, maxValue) {
    return Math.max(minValue, Math.min(maxValue, value));
  }

  function buildTerritoryFeature(geoSpec) {
    const steps = 48;
    const centerLat = geoSpec.lat;
    const centerLng = geoSpec.lng;
    const rxKm = Math.max(12, geoSpec.rxKm || 40);
    const ryKm = Math.max(10, geoSpec.ryKm || 28);
    const angleRad = ((geoSpec.angle || 0) * Math.PI) / 180;
    const cosAngle = Math.cos(angleRad);
    const sinAngle = Math.sin(angleRad);
    const ring = [];

    for (let i = 0; i <= steps; i += 1) {
      const theta = -((i / steps) * Math.PI * 2);
      const localX = rxKm * Math.cos(theta);
      const localY = ryKm * Math.sin(theta);
      const eastKm = localX * cosAngle - localY * sinAngle;
      const northKm = localX * sinAngle + localY * cosAngle;
      const ptLat = clampNumber(centerLat + northKm / 111.132, -78, 78);
      const cosLat = Math.max(0.2, Math.cos((ptLat * Math.PI) / 180));
      const ptLng = clampNumber(centerLng + eastKm / (111.32 * cosLat), -27, 87);
      ring.push([ptLng, ptLat]);
    }

    const feature = {
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'Polygon',
        coordinates: [ring],
      },
    };
    if (typeof d3 !== 'undefined' && typeof d3.geoArea === 'function') {
      if (d3.geoArea(feature) > Math.PI) {
        ring.reverse();
      }
    }
    return feature;
  }

  function buildRouteFeature(route) {
    return {
      type: 'Feature',
      properties: { id: route.id, name: route.name },
      geometry: {
        type: 'LineString',
        coordinates: route.waypoints,
      },
    };
  }

  function computeDispersedPositions(entries) {
    const placed = [];
    const byId = new Map();
    const goldenAngle = 2.399963229728653;

    for (let i = 0; i < entries.length; i += 1) {
      const entry = entries[i];
      if (!entry.geo) {
        continue;
      }
      let lng = entry.geo.lng;
      let lat = entry.geo.lat;
      let attempt = 0;

      while (attempt < 24) {
        let collision = false;
        for (let j = 0; j < placed.length; j += 1) {
          const other = placed[j];
          const dLng = (lng - other.lng) * Math.cos((lat * Math.PI) / 180);
          const dLat = lat - other.lat;
          if (Math.hypot(dLng, dLat) < 0.085) {
            collision = true;
            break;
          }
        }
        if (!collision) {
          break;
        }
        attempt += 1;
        const radiusDeg = 0.075 * Math.sqrt(attempt);
        const theta = attempt * goldenAngle;
        const cosLat = Math.max(0.25, Math.cos((entry.geo.lat * Math.PI) / 180));
        lng = entry.geo.lng + (radiusDeg * Math.cos(theta)) / cosLat;
        lat = entry.geo.lat + radiusDeg * Math.sin(theta);
      }

      const coord = { lng: lng, lat: lat };
      placed.push(coord);
      byId.set(entry.id, coord);
    }

    return byId;
  }

  function computeBoundsForEntries(entries, includeSites) {
    let minLng = Infinity;
    let maxLng = -Infinity;
    let minLat = Infinity;
    let maxLat = -Infinity;

    for (let i = 0; i < entries.length; i += 1) {
      const entry = entries[i];
      if (!entry || !entry.geo) {
        continue;
      }
      const g = entry.geo;
      const latPad = Math.max(0.55, (g.ryKm || 35) / 111.0);
      const cosLat = Math.max(0.25, Math.cos((g.lat * Math.PI) / 180));
      const lngPad = Math.max(0.65, (g.rxKm || 45) / (111.0 * cosLat));

      minLng = Math.min(minLng, g.lng - lngPad);
      maxLng = Math.max(maxLng, g.lng + lngPad);
      minLat = Math.min(minLat, g.lat - latPad);
      maxLat = Math.max(maxLat, g.lat + latPad);

      if (includeSites && Array.isArray(g.sites)) {
        for (let s = 0; s < g.sites.length; s += 1) {
          const site = g.sites[s];
          minLng = Math.min(minLng, site.lng - 0.35);
          maxLng = Math.max(maxLng, site.lng + 0.35);
          minLat = Math.min(minLat, site.lat - 0.3);
          maxLat = Math.max(maxLat, site.lat + 0.3);
        }
      }
    }

    if (!Number.isFinite(minLng)) {
      return [
        [29.0, 12.0],
        [56.5, 38.5],
      ];
    }

    const lngSpan = Math.max(2.3, maxLng - minLng);
    const latSpan = Math.max(1.6, maxLat - minLat);
    const midLng = (minLng + maxLng) / 2;
    const midLat = (minLat + maxLat) / 2;

    return [
      [clampNumber(midLng - lngSpan * 0.6, -26, 84), clampNumber(midLat - latSpan * 0.6, -3, 63)],
      [clampNumber(midLng + lngSpan * 0.6, -24, 86), clampNumber(midLat + latSpan * 0.6, -1, 65)],
    ];
  }

  function computeMiniMapBounds(entry) {
    if (!entry || !entry.geo) {
      return computeBoundsForEntries([], false);
    }
    const g = entry.geo;
    const cosLat = Math.max(0.25, Math.cos((g.lat * Math.PI) / 180));
    const latPad = Math.max(0.38, (g.ryKm || 35) / 111.0);
    const lngPad = Math.max(0.48, (g.rxKm || 45) / (111.0 * cosLat));
    let minLng = g.lng - lngPad;
    let maxLng = g.lng + lngPad;
    let minLat = g.lat - latPad;
    let maxLat = g.lat + latPad;

    const allSites = Array.isArray(g.sites) ? g.sites : [];
    let sitesForBounds = allSites;
    if ((g.rxKm || 45) <= 180 && allSites.length >= 3) {
      const nearby = allSites.filter(function isNearCore(site) {
        const dLat = site.lat - g.lat;
        const dLng = (site.lng - g.lng) * cosLat;
        return Math.hypot(dLng, dLat) <= 4.2;
      });
      if (nearby.length >= 2) {
        sitesForBounds = nearby;
      }
    }

    for (let i = 0; i < sitesForBounds.length; i += 1) {
      const site = sitesForBounds[i];
      minLng = Math.min(minLng, site.lng - 0.24);
      maxLng = Math.max(maxLng, site.lng + 0.24);
      minLat = Math.min(minLat, site.lat - 0.2);
      maxLat = Math.max(maxLat, site.lat + 0.2);
    }

    const lngSpan = Math.max(1.9, maxLng - minLng);
    const latSpan = Math.max(1.25, maxLat - minLat);
    const midLng = (minLng + maxLng) / 2;
    const midLat = (minLat + maxLat) / 2;

    return [
      [clampNumber(midLng - lngSpan * 0.58, -26, 84), clampNumber(midLat - latSpan * 0.58, -3, 63)],
      [clampNumber(midLng + lngSpan * 0.58, -24, 86), clampNumber(midLat + latSpan * 0.58, -1, 65)],
    ];
  }

  function boxesOverlap(a, b) {
    return a.x1 < b.x2 && a.x2 > b.x1 && a.y1 < b.y2 && a.y2 > b.y1;
  }

  function createAtlas(containerEl, catalog, callbacks) {
    const geoData = catalog.geo;
    if (!geoData || !containerEl) {
      return null;
    }

    clipIdCounter += 1;
    const landClipId = 'abraham-atlas-land-clip-' + clipIdCounter;
    const arrowMarkerId = 'abraham-atlas-arrow-' + clipIdCounter;

    containerEl.textContent = '';

    const overlayBar = document.createElement('div');
    overlayBar.className = 'atlas-toolbar';

    const fitNearEastBtn = document.createElement('button');
    fitNearEastBtn.type = 'button';
    fitNearEastBtn.className = 'atlas-tool-btn';
    fitNearEastBtn.textContent = 'Near East & Arabia';

    const fitDiasporaBtn = document.createElement('button');
    fitDiasporaBtn.type = 'button';
    fitDiasporaBtn.className = 'atlas-tool-btn';
    fitDiasporaBtn.textContent = 'Mediterranean & Diaspora';

    const routesBtn = document.createElement('button');
    routesBtn.type = 'button';
    routesBtn.className = 'atlas-tool-btn';
    routesBtn.setAttribute('aria-pressed', 'true');
    routesBtn.textContent = 'Trade Routes';

    overlayBar.appendChild(fitNearEastBtn);
    overlayBar.appendChild(fitDiasporaBtn);
    overlayBar.appendChild(routesBtn);
    containerEl.appendChild(overlayBar);

    const tooltipEl = document.createElement('div');
    tooltipEl.className = 'atlas-tooltip';
    tooltipEl.hidden = true;
    containerEl.appendChild(tooltipEl);

    const svg = d3
      .select(containerEl)
      .append('svg')
      .attr('class', 'atlas-svg')
      .attr('role', 'img')
      .attr('aria-label', 'Geographic map of descendants of Abraham across the Near East');

    const defs = svg.append('defs');
    const landClip = defs.append('clipPath').attr('id', landClipId);
    const landClipPath = landClip.append('path');

    defs
      .append('marker')
      .attr('id', arrowMarkerId)
      .attr('viewBox', '0 -4 8 8')
      .attr('refX', 6.5)
      .attr('refY', 0)
      .attr('markerWidth', 6)
      .attr('markerHeight', 6)
      .attr('orient', 'auto')
      .append('path')
      .attr('d', 'M0,-3.5L7.5,0L0,3.5Z')
      .attr('fill', '#7c4d12');

    const seaRect = svg.append('rect').attr('class', 'atlas-sea');
    const viewport = svg.append('g').attr('class', 'atlas-viewport');
    const graticulePath = viewport.append('path').attr('class', 'atlas-graticule');
    const landPath = viewport.append('path').attr('class', 'atlas-land');
    const lakesGroup = viewport.append('g').attr('class', 'atlas-lakes');
    const riversGroup = viewport.append('g').attr('class', 'atlas-rivers');
    const mapLabelsGroup = viewport.append('g').attr('class', 'atlas-region-labels');
    const territoriesGroup = viewport
      .append('g')
      .attr('class', 'atlas-territories')
      .attr('clip-path', 'url(#' + landClipId + ')');
    const hoverTerritoryPath = viewport
      .append('path')
      .attr('class', 'atlas-hover-territory')
      .attr('clip-path', 'url(#' + landClipId + ')');
    const routesGroup = viewport.append('g').attr('class', 'atlas-routes');
    const linksGroup = viewport.append('g').attr('class', 'atlas-links');
    const traceGroup = viewport.append('g').attr('class', 'atlas-trace');
    const sitesGroup = viewport.append('g').attr('class', 'atlas-sites');
    const markersGroup = viewport.append('g').attr('class', 'atlas-markers');
    const markerLabelsGroup = viewport.append('g').attr('class', 'atlas-marker-labels');

    const projection = d3.geoMercator();
    const pathGen = d3.geoPath(projection);
    const graticule = d3.geoGraticule().extent([
      [-28, -4],
      [88, 66],
    ]).step([5, 5]);

    const territoryCache = new Map();
    for (let i = 0; i < catalog.entries.length; i += 1) {
      const item = catalog.entries[i];
      if (item.geo) {
        territoryCache.set(item.id, buildTerritoryFeature(item.geo));
      }
    }

    const routeFeatures = (catalog.tradeRoutes || []).map(buildRouteFeature);
    const entriesById = new Map();
    for (let i = 0; i < catalog.entries.length; i += 1) {
      entriesById.set(catalog.entries[i].id, catalog.entries[i]);
    }

    let currentWidth = 640;
    let currentHeight = 480;
    let currentTransform = d3.zoomIdentity;
    let currentState = {
      visibleEntries: catalog.entries,
      spotlight: { matchedIds: new Set(), ancestorIds: new Set(), isActive: false },
      traceChain: [],
      routesShown: true,
      arcsMode: 'converge',
      hoveredId: '',
    };

    const zoomBehavior = d3
      .zoom()
      .scaleExtent([0.55, 18])
      .on('zoom', function onAtlasZoom(event) {
        currentTransform = event.transform;
        viewport.attr('transform', currentTransform);
        updateZoomDependentStyles();
      });

    svg.call(zoomBehavior);

    function fitBoundsPoints(boundsPair, animate) {
      const feature = {
        type: 'MultiPoint',
        coordinates: boundsPair,
      };
      const pixelBounds = pathGen.bounds(feature);
      const dx = Math.max(24, pixelBounds[1][0] - pixelBounds[0][0]);
      const dy = Math.max(24, pixelBounds[1][1] - pixelBounds[0][1]);
      const cx = (pixelBounds[0][0] + pixelBounds[1][0]) / 2;
      const cy = (pixelBounds[0][1] + pixelBounds[1][1]) / 2;
      const scale = clampNumber(
        0.86 / Math.max(dx / currentWidth, dy / currentHeight),
        0.6,
        11
      );
      const tx = currentWidth / 2 - scale * cx;
      const ty = currentHeight / 2 - scale * cy;
      const nextTransform = d3.zoomIdentity.translate(tx, ty).scale(scale);

      if (animate) {
        svg.transition().duration(320).call(zoomBehavior.transform, nextTransform);
      } else {
        svg.call(zoomBehavior.transform, nextTransform);
      }
    }

    function setupBaseGeometry() {
      const rect = containerEl.getBoundingClientRect();
      currentWidth = Math.max(300, Math.floor(rect.width) || 640);
      currentHeight = Math.max(260, Math.floor(rect.height) || 480);

      svg.attr('viewBox', '0 0 ' + currentWidth + ' ' + currentHeight);
      seaRect
        .attr('x', -20000)
        .attr('y', -20000)
        .attr('width', 44000)
        .attr('height', 44000);

      const defaultBox = {
        type: 'MultiPoint',
        coordinates: geoData.defaultBounds || [
          [29.0, 12.0],
          [56.5, 38.5],
        ],
      };
      projection.fitExtent(
        [
          [22, 22],
          [currentWidth - 22, currentHeight - 22],
        ],
        defaultBox
      );

      landClipPath.attr('d', pathGen(geoData.land));
      graticulePath.attr('d', pathGen(graticule()));
      landPath.attr('d', pathGen(geoData.land));

      const lakePaths = lakesGroup
        .selectAll('path')
        .data(geoData.lakes ? geoData.lakes.features : []);
      lakePaths.exit().remove();
      lakePaths
        .enter()
        .append('path')
        .attr('class', 'atlas-lake')
        .merge(lakePaths)
        .attr('d', pathGen);

      const riverPaths = riversGroup
        .selectAll('path')
        .data(geoData.rivers ? geoData.rivers.features : []);
      riverPaths.exit().remove();
      riverPaths
        .enter()
        .append('path')
        .attr('class', 'atlas-river')
        .merge(riverPaths)
        .attr('d', pathGen);

      const regionLabels = mapLabelsGroup.selectAll('text').data(catalog.mapLabels || []);
      regionLabels.exit().remove();
      regionLabels
        .enter()
        .append('text')
        .merge(regionLabels)
        .attr('class', function labelClass(d) {
          return d.kind === 'water' ? 'atlas-water-label' : 'atlas-land-label';
        })
        .attr('transform', function placeMapLabel(d) {
          const pt = projection([d.lng, d.lat]) || [0, 0];
          const rot = d.rotate ? ' rotate(' + d.rotate + ')' : '';
          return 'translate(' + pt[0].toFixed(1) + ',' + pt[1].toFixed(1) + ')' + rot;
        })
        .text(function labelText(d) {
          return d.name;
        });
    }

    function showTooltip(event, entry) {
      const contBadge =
        entry.continuity && entry.continuity.badge ? entry.continuity.badge : entry.era;
      tooltipEl.innerHTML = '';

      const titleDiv = document.createElement('div');
      titleDiv.className = 'atlas-tooltip-title';
      titleDiv.textContent = entry.name;
      tooltipEl.appendChild(titleDiv);

      const subDiv = document.createElement('div');
      subDiv.className = 'atlas-tooltip-sub';
      subDiv.textContent = entry.territory;
      tooltipEl.appendChild(subDiv);

      const metaDiv = document.createElement('div');
      metaDiv.className = 'atlas-tooltip-meta';
      metaDiv.textContent = entry.era + ' · ' + contBadge;
      tooltipEl.appendChild(metaDiv);

      tooltipEl.hidden = false;
      moveTooltip(event);
    }

    function moveTooltip(event) {
      if (tooltipEl.hidden) {
        return;
      }
      const rect = containerEl.getBoundingClientRect();
      const relX = event.clientX - rect.left;
      const relY = event.clientY - rect.top;
      const leftPx = clampNumber(relX + 14, 8, Math.max(8, currentWidth - 260));
      const topPx = clampNumber(relY - 18, 8, Math.max(8, currentHeight - 92));
      tooltipEl.style.left = leftPx + 'px';
      tooltipEl.style.top = topPx + 'px';
    }

    function hideTooltip() {
      tooltipEl.hidden = true;
    }

    function renderSitesLayer(dispersedMap) {
      const k = currentTransform.k || 1;
      const activeSites = [];
      const spotlight = currentState.spotlight;
      const showMatchedSites = spotlight.isActive && spotlight.matchedIds.size <= 14;

      for (let i = 0; i < currentState.visibleEntries.length; i += 1) {
        const entry = currentState.visibleEntries[i];
        if (!entry.geo || !Array.isArray(entry.geo.sites)) {
          continue;
        }
        const includeEntrySites =
          entry.id === currentState.hoveredId ||
          (showMatchedSites && spotlight.matchedIds.has(entry.id)) ||
          (k >= 3.4 && (!spotlight.isActive || spotlight.matchedIds.has(entry.id)));

        if (includeEntrySites) {
          const branchMeta = catalog.branches[entry.branch] || catalog.branches.root;
          for (let s = 0; s < entry.geo.sites.length; s += 1) {
            const site = entry.geo.sites[s];
            activeSites.push({
              key: entry.id + ':' + site.name,
              name: site.name,
              lng: site.lng,
              lat: site.lat,
              accent: branchMeta.accent,
            });
          }
        }
      }

      const dedupedSites = [];
      const seenNames = new Set();
      for (let i = 0; i < activeSites.length; i += 1) {
        const candidate = activeSites[i];
        const sig = candidate.name + '@' + candidate.lat.toFixed(2);
        if (!seenNames.has(sig)) {
          seenNames.add(sig);
          dedupedSites.push(candidate);
        }
      }

      const invScale = 1 / Math.pow(k, 0.8);
      const siteSel = sitesGroup.selectAll('g.atlas-site').data(dedupedSites, function keyFn(d) {
        return d.key;
      });
      siteSel.exit().remove();

      const siteEnter = siteSel.enter().append('g').attr('class', 'atlas-site');
      siteEnter.append('rect').attr('class', 'atlas-site-diamond');
      siteEnter.append('text').attr('class', 'atlas-site-label');

      const siteMerged = siteEnter.merge(siteSel);
      siteMerged.attr('transform', function placeSite(d) {
        const pt = projection([d.lng, d.lat]) || [0, 0];
        return 'translate(' + pt[0].toFixed(2) + ',' + pt[1].toFixed(2) + ')';
      });
      siteMerged
        .select('rect')
        .attr('x', -2.6 * invScale)
        .attr('y', -2.6 * invScale)
        .attr('width', 5.2 * invScale)
        .attr('height', 5.2 * invScale)
        .attr('transform', 'rotate(45)')
        .attr('fill', '#fffdf8')
        .attr('stroke', function siteColor(d) {
          return d.accent;
        })
        .attr('stroke-width', 1.3 * invScale);

      siteMerged
        .select('text')
        .attr('x', 5.5 * invScale)
        .attr('y', 3 * invScale)
        .style('font-size', (9.5 * invScale).toFixed(2) + 'px')
        .style('stroke-width', (2.6 * invScale).toFixed(2) + 'px')
        .text(function siteLabel(d) {
          return d.name;
        });

      return dispersedMap;
    }

    function updateZoomDependentStyles() {
      const k = currentTransform.k || 1;
      const inv = 1 / k;
      const softInv = 1 / Math.pow(k, 0.72);

      landPath.style('stroke-width', (0.85 * inv).toFixed(3) + 'px');
      graticulePath.style('stroke-width', (0.5 * inv).toFixed(3) + 'px');
      lakesGroup.selectAll('path').style('stroke-width', (0.6 * inv).toFixed(3) + 'px');
      riversGroup.selectAll('path').style('stroke-width', (0.9 * inv).toFixed(3) + 'px');

      mapLabelsGroup.selectAll('text').style('font-size', function scaleRegionFont(d) {
        const base = d.kind === 'water' ? 11 : 9.5;
        return clampNumber(base * softInv, 3.2, 14).toFixed(2) + 'px';
      });

      territoriesGroup.selectAll('path').style('stroke-width', function territoryStroke(d) {
        const isMatched = currentState.spotlight.matchedIds.has(d.id);
        return ((isMatched ? 1.8 : 1.0) * inv).toFixed(3) + 'px';
      });
      hoverTerritoryPath.style('stroke-width', (2.1 * inv).toFixed(3) + 'px');

      routesGroup.selectAll('path.atlas-route-line').style('stroke-width', (1.7 * inv).toFixed(3) + 'px');
      routesGroup.selectAll('text.atlas-route-label').style('font-size', (9.5 * softInv).toFixed(2) + 'px');

      linksGroup.selectAll('path').style('stroke-width', (1.5 * inv).toFixed(3) + 'px');
      traceGroup.selectAll('path').style('stroke-width', (2.4 * inv).toFixed(3) + 'px');
      traceGroup.selectAll('circle').attr('r', 7.5 * softInv).style('stroke-width', (1.4 * softInv) + 'px');
      traceGroup.selectAll('text').style('font-size', (8.5 * softInv).toFixed(2) + 'px');

      markersGroup.selectAll('circle.atlas-node-dot').attr('r', function dotRadius(d) {
        let baseR = 4.3;
        if (d.kind === 'patriarch' || d.kind === 'matriarch') {
          baseR = 6.2;
        } else if (d.kind === 'people') {
          baseR = 5.6;
        }
        if (currentState.spotlight.matchedIds.has(d.id) || d.id === currentState.hoveredId) {
          baseR += 1.5;
        }
        return baseR * softInv;
      }).style('stroke-width', (1.4 * softInv).toFixed(2) + 'px');

      markersGroup.selectAll('circle.atlas-node-ring').attr('r', function ringRadius(d) {
        const baseR = d.kind === 'people' || d.kind === 'patriarch' ? 8.8 : 7.4;
        return baseR * softInv;
      }).style('stroke-width', (1.2 * softInv).toFixed(2) + 'px');

      const occupiedBoxes = [];
      markerLabelsGroup.selectAll('text.atlas-node-label').each(function evaluateLabelCollision(d) {
        const textNode = d3.select(this);
        const screenX = d.px * k + currentTransform.x;
        const screenY = d.py * k + currentTransform.y;
        const isMatched = currentState.spotlight.matchedIds.has(d.id);
        const isAncestor = currentState.spotlight.ancestorIds.has(d.id);
        const isHovered = d.id === currentState.hoveredId;

        if (currentState.spotlight.isActive && !isMatched && !isAncestor && !isHovered && k < 5.5) {
          textNode.attr('display', 'none');
          return;
        }
        if (
          !currentState.spotlight.isActive &&
          !isHovered &&
          d.kind !== 'people' &&
          d.kind !== 'patriarch' &&
          k < 1.85
        ) {
          textNode.attr('display', 'none');
          return;
        }

        const fontPx = d.kind === 'people' || d.kind === 'patriarch' ? 11.2 : 10.0;
        const estWidth = d.shortLabel.length * (fontPx * 0.54) + 8;
        const estHeight = fontPx + 4;
        const box = {
          x1: screenX + 7,
          y1: screenY - estHeight / 2,
          x2: screenX + 7 + estWidth,
          y2: screenY + estHeight / 2,
        };

        let collides = false;
        if (!isHovered) {
          for (let i = 0; i < occupiedBoxes.length; i += 1) {
            if (boxesOverlap(box, occupiedBoxes[i])) {
              collides = true;
              break;
            }
          }
        }

        if (collides) {
          textNode.attr('display', 'none');
        } else {
          occupiedBoxes.push(box);
          const labelOpacity =
            currentState.spotlight.isActive && !isMatched && !isAncestor && !isHovered ? 0.45 : 1;
          textNode
            .attr('display', null)
            .attr('fill-opacity', labelOpacity)
            .attr('x', d.px + 7.5 * softInv)
            .attr('y', d.py + 3.4 * softInv)
            .style('font-size', (fontPx * softInv).toFixed(2) + 'px')
            .style('stroke-width', (3.0 * softInv).toFixed(2) + 'px');
        }
      });

      renderSitesLayer();
    }

    function renderDataLayers() {
      const visible = currentState.visibleEntries.filter(function hasGeo(entry) {
        return Boolean(entry.geo);
      });
      const spotlight = currentState.spotlight;
      const dispersed = computeDispersedPositions(visible);

      routesBtn.setAttribute('aria-pressed', currentState.routesShown ? 'true' : 'false');
      routesGroup.attr('display', currentState.routesShown ? null : 'none');

      const routeLines = routesGroup.selectAll('path.atlas-route-line').data(routeFeatures);
      routeLines.exit().remove();
      routeLines
        .enter()
        .append('path')
        .attr('class', 'atlas-route-line')
        .merge(routeLines)
        .attr('d', pathGen);

      const routeLabels = routesGroup.selectAll('text.atlas-route-label').data(catalog.tradeRoutes || []);
      routeLabels.exit().remove();
      routeLabels
        .enter()
        .append('text')
        .attr('class', 'atlas-route-label')
        .merge(routeLabels)
        .attr('transform', function placeRouteLabel(route) {
          const midIdx = Math.floor(route.waypoints.length / 2);
          const pt = projection(route.waypoints[midIdx]) || [0, 0];
          return 'translate(' + (pt[0] + 6).toFixed(1) + ',' + (pt[1] - 5).toFixed(1) + ')';
        })
        .text(function routeText(route) {
          return route.name;
        });

      const territoryEntries = visible.filter(function shouldDrawTerritory(entry) {
        if (spotlight.isActive) {
          return spotlight.matchedIds.has(entry.id) || spotlight.ancestorIds.has(entry.id);
        }
        return entry.kind === 'people';
      });

      const terrPaths = territoriesGroup
        .selectAll('path.atlas-territory')
        .data(territoryEntries, function terrKey(d) {
          return d.id;
        });
      terrPaths.exit().remove();
      terrPaths
        .enter()
        .append('path')
        .attr('class', 'atlas-territory')
        .on('click', function onTerritoryClick(_event, d) {
          if (callbacks && callbacks.onSelectEntry) {
            callbacks.onSelectEntry(d.id);
          }
        })
        .merge(terrPaths)
        .attr('d', function renderTerritoryPath(d) {
          return pathGen(territoryCache.get(d.id));
        })
        .attr('fill', function territoryFill(d) {
          const branchMeta = catalog.branches[d.branch] || catalog.branches.root;
          return branchMeta.accent;
        })
        .attr('fill-opacity', function territoryFillOpacity(d) {
          if (spotlight.isActive) {
            return spotlight.matchedIds.has(d.id) ? 0.22 : 0.07;
          }
          return 0.13;
        })
        .attr('stroke', function territoryStrokeColor(d) {
          const branchMeta = catalog.branches[d.branch] || catalog.branches.root;
          return branchMeta.accent;
        })
        .attr('stroke-opacity', function territoryStrokeOpacity(d) {
          if (spotlight.isActive) {
            return spotlight.matchedIds.has(d.id) ? 0.82 : 0.35;
          }
          return 0.46;
        })
        .attr('stroke-dasharray', function territoryDash(d) {
          if (spotlight.isActive && spotlight.ancestorIds.has(d.id)) {
            return '4,3';
          }
          return null;
        });

      const visibleIds = new Set(visible.map(function mapId(e) { return e.id; }));
      const activeGeoLinks = [];
      if (currentState.arcsMode !== 'none') {
        for (let i = 0; i < catalog.crossLinks.length; i += 1) {
          const link = catalog.crossLinks[i];
          if (!visibleIds.has(link.from) || !visibleIds.has(link.to)) {
            continue;
          }
          if (currentState.arcsMode === 'converge' && link.kind === 'coalescence') {
            continue;
          }
          const relevantToFocus =
            !spotlight.isActive ||
            spotlight.matchedIds.has(link.from) ||
            spotlight.matchedIds.has(link.to) ||
            link.from === currentState.hoveredId ||
            link.to === currentState.hoveredId;
          if (relevantToFocus) {
            activeGeoLinks.push(link);
          }
        }
      }

      const geoLinkSel = linksGroup
        .selectAll('path.atlas-cross-link')
        .data(activeGeoLinks, function linkKey(d) {
          return d.from + '->' + d.to;
        });
      geoLinkSel.exit().remove();
      geoLinkSel
        .enter()
        .append('path')
        .attr('class', 'atlas-cross-link')
        .merge(geoLinkSel)
        .attr('d', function buildCurvedLink(d) {
          const fromPos = dispersed.get(d.from);
          const toPos = dispersed.get(d.to);
          if (!fromPos || !toPos) {
            return '';
          }
          const p1 = projection([fromPos.lng, fromPos.lat]);
          const p2 = projection([toPos.lng, toPos.lat]);
          if (!p1 || !p2) {
            return '';
          }
          const dx = p2[0] - p1[0];
          const dy = p2[1] - p1[1];
          const dist = Math.hypot(dx, dy);
          if (dist < 2) {
            return '';
          }
          const cx = (p1[0] + p2[0]) / 2 - dy * 0.18;
          const cy = (p1[1] + p2[1]) / 2 + dx * 0.18;
          return 'M' + p1[0] + ',' + p1[1] + 'Q' + cx + ',' + cy + ' ' + p2[0] + ',' + p2[1];
        })
        .attr('marker-end', 'url(#' + arrowMarkerId + ')');

      const traceSteps = currentState.traceChain.filter(function traceHasGeo(step) {
        return Boolean(step.geo);
      });
      traceGroup.selectAll('*').remove();
      if (traceSteps.length > 1) {
        for (let i = 0; i < traceSteps.length - 1; i += 1) {
          const a = dispersed.get(traceSteps[i].id) || traceSteps[i].geo;
          const b = dispersed.get(traceSteps[i + 1].id) || traceSteps[i + 1].geo;
          const p1 = projection([a.lng, a.lat]);
          const p2 = projection([b.lng, b.lat]);
          if (p1 && p2 && Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) > 3) {
            const dx = p2[0] - p1[0];
            const dy = p2[1] - p1[1];
            const cx = (p1[0] + p2[0]) / 2 - dy * 0.14;
            const cy = (p1[1] + p2[1]) / 2 + dx * 0.14;
            traceGroup
              .append('path')
              .attr('class', 'atlas-trace-segment')
              .attr('d', 'M' + p1[0] + ',' + p1[1] + 'Q' + cx + ',' + cy + ' ' + p2[0] + ',' + p2[1])
              .attr('marker-end', 'url(#' + arrowMarkerId + ')');
          }
        }
      }

      const markerNodes = visible.map(function buildMarkerDatum(entry) {
        const coord = dispersed.get(entry.id) || entry.geo;
        const pt = projection([coord.lng, coord.lat]) || [0, 0];
        const parenIdx = entry.name.indexOf(' (');
        const shortLabel = parenIdx > 0 ? entry.name.slice(0, parenIdx) : entry.name;
        let priority = 10;
        if (spotlight.matchedIds.has(entry.id)) {
          priority = 100;
        } else if (spotlight.ancestorIds.has(entry.id)) {
          priority = 80;
        } else if (entry.kind === 'patriarch' || entry.kind === 'matriarch') {
          priority = 65;
        } else if (entry.kind === 'people') {
          priority = 50;
        }
        return {
          id: entry.id,
          name: entry.name,
          shortLabel: shortLabel,
          kind: entry.kind,
          branch: entry.branch,
          entry: entry,
          px: pt[0],
          py: pt[1],
          priority: priority,
        };
      });

      markerNodes.sort(function sortMarkersForPaint(left, right) {
        return left.priority - right.priority;
      });

      const markerSel = markersGroup
        .selectAll('g.atlas-marker')
        .data(markerNodes, function markerKey(d) {
          return d.id;
        });
      markerSel.exit().remove();

      const markerEnter = markerSel
        .enter()
        .append('g')
        .attr('class', 'atlas-marker')
        .attr('tabindex', '0')
        .attr('role', 'button')
        .on('mouseenter', function onMarkerEnter(event, d) {
          currentState.hoveredId = d.id;
          const hoverFeature = territoryCache.get(d.id);
          const branchMeta = catalog.branches[d.branch] || catalog.branches.root;
          if (hoverFeature) {
            hoverTerritoryPath
              .attr('d', pathGen(hoverFeature))
              .attr('fill', branchMeta.accent)
              .attr('stroke', branchMeta.accent)
              .attr('display', null);
          }
          showTooltip(event, d.entry);
          updateZoomDependentStyles();
        })
        .on('mousemove', function onMarkerMove(event) {
          moveTooltip(event);
        })
        .on('mouseleave', function onMarkerLeave() {
          currentState.hoveredId = '';
          hoverTerritoryPath.attr('display', 'none');
          hideTooltip();
          updateZoomDependentStyles();
        })
        .on('click', function onMarkerClick(event, d) {
          event.stopPropagation();
          if (callbacks && callbacks.onSelectEntry) {
            callbacks.onSelectEntry(d.id);
          }
        })
        .on('keydown', function onMarkerKeydown(event, d) {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            if (callbacks && callbacks.onSelectEntry) {
              callbacks.onSelectEntry(d.id);
            }
          }
        });

      markerEnter.append('circle').attr('class', 'atlas-node-ring');
      markerEnter.append('circle').attr('class', 'atlas-node-dot');

      const markerMerged = markerEnter.merge(markerSel);
      markerMerged
        .attr('aria-label', function markerAria(d) {
          return d.name + ' (' + d.entry.territory + ')';
        })
        .attr('transform', function placeMarker(d) {
          return 'translate(' + d.px.toFixed(2) + ',' + d.py.toFixed(2) + ')';
        })
        .attr('opacity', function markerOpacity(d) {
          if (!spotlight.isActive) {
            return 1;
          }
          if (spotlight.matchedIds.has(d.id) || spotlight.ancestorIds.has(d.id)) {
            return 1;
          }
          return 0.24;
        });

      markerMerged
        .select('circle.atlas-node-ring')
        .attr('display', function showRing(d) {
          return spotlight.matchedIds.has(d.id) ? null : 'none';
        })
        .attr('stroke', function ringColor(d) {
          const branchMeta = catalog.branches[d.branch] || catalog.branches.root;
          return branchMeta.accent;
        });

      markerMerged
        .select('circle.atlas-node-dot')
        .attr('fill', function dotFill(d) {
          const branchMeta = catalog.branches[d.branch] || catalog.branches.root;
          return d.kind === 'people' || d.kind === 'patriarch' ? branchMeta.accent : '#fffdf8';
        })
        .attr('stroke', function dotStroke(d) {
          const branchMeta = catalog.branches[d.branch] || catalog.branches.root;
          return branchMeta.accent;
        });

      const labelOrder = markerNodes.slice().sort(function sortLabelsByPriority(left, right) {
        if (right.priority !== left.priority) {
          return right.priority - left.priority;
        }
        return left.name.localeCompare(right.name);
      });

      const labelSel = markerLabelsGroup
        .selectAll('text.atlas-node-label')
        .data(labelOrder, function labelId(d) {
          return d.id;
        });
      labelSel.exit().remove();
      labelSel
        .enter()
        .append('text')
        .attr('class', 'atlas-node-label')
        .merge(labelSel)
        .attr('font-weight', function labelWeight(d) {
          return d.kind === 'people' || d.kind === 'patriarch' || spotlight.matchedIds.has(d.id)
            ? '700'
            : '600';
        })
        .text(function labelString(d) {
          return d.shortLabel;
        });

      hoverTerritoryPath.attr('display', 'none');
      updateZoomDependentStyles();
    }

    fitNearEastBtn.addEventListener('click', function onFitNearEast() {
      fitBoundsPoints(
        geoData.defaultBounds || [
          [29.0, 12.0],
          [56.5, 38.5],
        ],
        true
      );
    });

    fitDiasporaBtn.addEventListener('click', function onFitDiaspora() {
      fitBoundsPoints(
        [
          [-9.5, 13.0],
          [58.5, 54.5],
        ],
        true
      );
    });

    routesBtn.addEventListener('click', function onRoutesClick() {
      currentState.routesShown = !currentState.routesShown;
      routesBtn.setAttribute('aria-pressed', currentState.routesShown ? 'true' : 'false');
      routesGroup.attr('display', currentState.routesShown ? null : 'none');
      if (callbacks && callbacks.onToggleRoutes) {
        callbacks.onToggleRoutes(currentState.routesShown);
      }
    });

    setupBaseGeometry();

    return {
      update: function updateAtlas(nextState, options) {
        const opts = options || {};
        currentState = {
          visibleEntries: nextState.visibleEntries || catalog.entries,
          spotlight: nextState.spotlight || currentState.spotlight,
          traceChain: nextState.traceChain || [],
          routesShown:
            nextState.routesShown !== undefined ? nextState.routesShown : currentState.routesShown,
          arcsMode: nextState.arcsMode || 'converge',
          hoveredId: '',
        };
        if (opts.resize) {
          setupBaseGeometry();
        }
        renderDataLayers();

        if (opts.focusEntryId && entriesById.has(opts.focusEntryId)) {
          const focusEntry = entriesById.get(opts.focusEntryId);
          fitBoundsPoints(computeBoundsForEntries([focusEntry], true), Boolean(opts.animate));
        } else if (opts.fitSelection) {
          if (currentState.spotlight.isActive) {
            const matchedList = [];
            currentState.spotlight.matchedIds.forEach(function collectMatched(id) {
              const found = entriesById.get(id);
              if (found) {
                matchedList.push(found);
              }
            });
            if (currentState.traceChain.length > 1) {
              for (let i = 0; i < currentState.traceChain.length; i += 1) {
                matchedList.push(currentState.traceChain[i]);
              }
            }
            fitBoundsPoints(computeBoundsForEntries(matchedList, true), Boolean(opts.animate));
          } else {
            fitBoundsPoints(
              geoData.defaultBounds || [
                [29.0, 12.0],
                [56.5, 38.5],
              ],
              Boolean(opts.animate)
            );
          }
        }
      },
      resize: function resizeAtlas() {
        setupBaseGeometry();
        renderDataLayers();
      },
      fitDefault: function fitDefault(animate) {
        fitBoundsPoints(
          geoData.defaultBounds || [
            [29.0, 12.0],
            [56.5, 38.5],
          ],
          Boolean(animate)
        );
      },
      zoomIn: function zoomInAtlas() {
        svg.transition().duration(200).call(zoomBehavior.scaleBy, 1.35);
      },
      zoomOut: function zoomOutAtlas() {
        svg.transition().duration(200).call(zoomBehavior.scaleBy, 0.74);
      },
    };
  }

  function renderMiniMap(containerEl, entry, catalog, onViewInAtlas) {
    containerEl.textContent = '';
    if (!entry || !entry.geo || !catalog.geo) {
      return;
    }

    clipIdCounter += 1;
    const miniClipId = 'abraham-mini-clip-' + clipIdCounter;
    const width = 540;
    const height = 216;
    const geoData = catalog.geo;
    const branchMeta = catalog.branches[entry.branch] || catalog.branches.root;

    const headerRow = document.createElement('div');
    headerRow.className = 'minimap-header';

    const captionSpan = document.createElement('span');
    captionSpan.className = 'minimap-caption';
    const siteCount = Array.isArray(entry.geo.sites) ? entry.geo.sites.length : 0;
    captionSpan.textContent =
      entry.territory + (siteCount > 0 ? ' · ' + siteCount + ' mapped sites' : '');
    headerRow.appendChild(captionSpan);

    if (typeof onViewInAtlas === 'function') {
      const openMapBtn = document.createElement('button');
      openMapBtn.type = 'button';
      openMapBtn.className = 'action-button minimap-open-btn';
      openMapBtn.textContent = 'View on Full Map';
      openMapBtn.addEventListener('click', function handleOpenAtlas() {
        onViewInAtlas(entry.id);
      });
      headerRow.appendChild(openMapBtn);
    }
    containerEl.appendChild(headerRow);

    const svgWrap = document.createElement('div');
    svgWrap.className = 'minimap-frame';
    containerEl.appendChild(svgWrap);

    const boundsPair = computeMiniMapBounds(entry);
    const projection = d3.geoMercator().fitExtent(
      [
        [18, 16],
        [width - 18, height - 16],
      ],
      {
        type: 'MultiPoint',
        coordinates: boundsPair,
      }
    );
    const pathGen = d3.geoPath(projection);

    const svg = d3
      .select(svgWrap)
      .append('svg')
      .attr('class', 'minimap-svg')
      .attr('viewBox', '0 0 ' + width + ' ' + height)
      .attr('role', 'img')
      .attr('aria-label', 'Homeland locator map for ' + entry.name);

    const defs = svg.append('defs');
    defs.append('clipPath').attr('id', miniClipId).append('path').attr('d', pathGen(geoData.land));

    svg.append('rect').attr('class', 'atlas-sea').attr('width', width).attr('height', height);
    svg.append('path').attr('class', 'atlas-land').attr('d', pathGen(geoData.land));

    if (geoData.lakes && geoData.lakes.features) {
      svg
        .append('g')
        .selectAll('path')
        .data(geoData.lakes.features)
        .enter()
        .append('path')
        .attr('class', 'atlas-lake')
        .attr('d', pathGen);
    }

    if (geoData.rivers && geoData.rivers.features) {
      svg
        .append('g')
        .selectAll('path')
        .data(geoData.rivers.features)
        .enter()
        .append('path')
        .attr('class', 'atlas-river')
        .attr('d', pathGen);
    }

    const territoryFeature = buildTerritoryFeature(entry.geo);
    svg
      .append('path')
      .attr('clip-path', 'url(#' + miniClipId + ')')
      .attr('d', pathGen(territoryFeature))
      .attr('fill', branchMeta.accent)
      .attr('fill-opacity', 0.24)
      .attr('stroke', branchMeta.accent)
      .attr('stroke-width', 1.8);

    const sites = Array.isArray(entry.geo.sites) ? entry.geo.sites : [];
    const placedMiniBoxes = [];
    const sitesGroup = svg.append('g');

    for (let i = 0; i < sites.length; i += 1) {
      const site = sites[i];
      const pt = projection([site.lng, site.lat]);
      if (!pt) {
        continue;
      }
      sitesGroup
        .append('circle')
        .attr('cx', pt[0])
        .attr('cy', pt[1])
        .attr('r', 4.2)
        .attr('fill', '#fffdf8')
        .attr('stroke', branchMeta.accent)
        .attr('stroke-width', 2);

      const estW = site.name.length * 5.8 + 8;
      const preferRight = pt[0] + 7 + estW <= width - 6;
      const candidateSides = preferRight ? [true, false] : [false, true];
      for (let sideIdx = 0; sideIdx < candidateSides.length; sideIdx += 1) {
        const useRight = candidateSides[sideIdx];
        if (useRight && pt[0] + 7 + estW > width - 4) {
          continue;
        }
        if (!useRight && pt[0] - 7 - estW < 4) {
          continue;
        }
        const textX = useRight ? pt[0] + 7 : pt[0] - 7;
        const box = {
          x1: useRight ? textX : textX - estW,
          y1: pt[1] - 7,
          x2: useRight ? textX + estW : textX,
          y2: pt[1] + 7,
        };
        let overlap = false;
        for (let j = 0; j < placedMiniBoxes.length; j += 1) {
          if (boxesOverlap(box, placedMiniBoxes[j])) {
            overlap = true;
            break;
          }
        }
        if (!overlap) {
          placedMiniBoxes.push(box);
          sitesGroup
            .append('text')
            .attr('class', 'minimap-site-label')
            .attr('x', textX)
            .attr('y', pt[1] + 3.5)
            .attr('text-anchor', useRight ? 'start' : 'end')
            .text(site.name);
          break;
        }
      }
    }
  }

  globalScope.AbrahamGeoMap = {
    createAtlas: createAtlas,
    renderMiniMap: renderMiniMap,
  };
})(window);
