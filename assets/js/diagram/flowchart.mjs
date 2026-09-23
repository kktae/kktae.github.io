import {
  cleanLabel,
  escapeXML,
  measureMultiline,
  parseStyleMap,
  svgOpen,
  svgText,
  svgThemeStyle,
} from './common.mjs';

const DEFAULTS = Object.freeze({
  font: 'Inter',
  padding: 40,
  nodeSpacing: 28,
  layerSpacing: 48,
  mergeEdges: true,
  thoroughness: 3,
});

const SHAPES = [
  { regex: /^([\w-]+)\(\(\((.+?)\)\)\)/, shape: 'doublecircle' },
  { regex: /^([\w-]+)\(\[(.+?)\]\)/, shape: 'stadium' },
  { regex: /^([\w-]+)\(\((.+?)\)\)/, shape: 'circle' },
  { regex: /^([\w-]+)\[\[(.+?)\]\]/, shape: 'subroutine' },
  { regex: /^([\w-]+)\[\((.+?)\)\]/, shape: 'cylinder' },
  { regex: /^([\w-]+)\[\/(.+?)\\\]/, shape: 'trapezoid' },
  { regex: /^([\w-]+)\[\\(.+?)\/\]/, shape: 'trapezoid-alt' },
  { regex: /^([\w-]+)>(.+?)\]/, shape: 'asymmetric' },
  { regex: /^([\w-]+)\{\{(.+?)\}\}/, shape: 'hexagon' },
  { regex: /^([\w-]+)\[(.+?)\]/, shape: 'rectangle' },
  { regex: /^([\w-]+)\((.+?)\)/, shape: 'rounded' },
  { regex: /^([\w-]+)\{(.+?)\}/, shape: 'diamond' },
];

const PLAIN_NODE = /^([\w-]+)/;
const CLASS_SUFFIX = /^:::([\w][\w-]*)/;

function addNode(graph, stack, node) {
  if (!graph.nodes.has(node.id)) graph.nodes.set(node.id, node);
  if (stack.length) {
    const current = stack[stack.length - 1];
    if (!current.nodeIds.includes(node.id)) current.nodeIds.push(node.id);
  }
}

function parseNodeToken(input, graph, stack) {
  for (const { regex, shape } of SHAPES) {
    const match = input.match(regex);
    if (!match) continue;
    const id = match[1];
    addNode(graph, stack, { id, label: cleanLabel(match[2]), shape });
    return { id, remaining: input.slice(match[0].length) };
  }

  const match = input.match(PLAIN_NODE);
  if (!match) return null;
  const id = match[1];
  if (!graph.nodes.has(id)) addNode(graph, stack, { id, label: id, shape: 'rectangle' });
  return { id, remaining: input.slice(match[0].length) };
}

function parseNode(input, graph, stack) {
  const parsed = parseNodeToken(input, graph, stack);
  if (!parsed) return null;
  let remaining = parsed.remaining.trim();
  const classMatch = remaining.match(CLASS_SUFFIX);
  if (classMatch) {
    graph.classAssignments.set(parsed.id, classMatch[1]);
    remaining = remaining.slice(classMatch[0].length);
  }
  return { id: parsed.id, remaining };
}

function parseNodeSet(input, graph, stack) {
  let parsed = parseNode(input, graph, stack);
  if (!parsed) return null;
  const ids = [parsed.id];
  let remaining = parsed.remaining.trim();
  while (remaining.startsWith('&')) {
    remaining = remaining.slice(1).trim();
    parsed = parseNode(remaining, graph, stack);
    if (!parsed) break;
    ids.push(parsed.id);
    remaining = parsed.remaining.trim();
  }
  return { ids, remaining };
}

function parseEdgePrefix(value) {
  const direct = value.match(/^(<)?(-->|-.->|==>|---|-.-|===)(?:\|([^|]*)\|)?/);
  if (direct) {
    const token = direct[2];
    return {
      consumed: direct[0].length,
      arrowStart: Boolean(direct[1]),
      arrowEnd: token.endsWith('>'),
      label: direct[3]?.trim() ? cleanLabel(direct[3].trim()) : undefined,
      style: token === '-.->' || token === '-.-' ? 'dotted' : token === '==>' || token === '===' ? 'thick' : 'solid',
    };
  }

  const spaced = value.match(/^(<)?(--|-.|==)\s+(.+?)\s+(-->|---|.->|-.-|==>|===)/);
  if (spaced) {
    const start = spaced[2];
    const end = spaced[4];
    return {
      consumed: spaced[0].length,
      arrowStart: Boolean(spaced[1]),
      arrowEnd: end.endsWith('>'),
      label: spaced[3].trim() ? cleanLabel(spaced[3].trim()) : undefined,
      style: start === '-.' || end === '.->' || end === '-.-' ? 'dotted' : start === '==' || end === '==>' || end === '===' ? 'thick' : 'solid',
    };
  }

  return null;
}

function parseFlowLine(line, graph, stack) {
  let parsed = parseNodeSet(line.trim(), graph, stack);
  if (!parsed || !parsed.ids.length) return;
  let sources = parsed.ids;
  let remaining = parsed.remaining.trim();

  while (remaining) {
    const edge = parseEdgePrefix(remaining);
    if (!edge) break;
    remaining = remaining.slice(edge.consumed).trim();
    const targets = parseNodeSet(remaining, graph, stack);
    if (!targets || !targets.ids.length) break;
    remaining = targets.remaining.trim();

    for (const source of sources) {
      for (const target of targets.ids) {
        graph.edges.push({
          source,
          target,
          label: edge.label,
          style: edge.style,
          hasArrowStart: edge.arrowStart,
          hasArrowEnd: edge.arrowEnd,
        });
      }
    }
    sources = targets.ids;
  }
}

export function parseFlowchart(source) {
  const lines = source.split('\n').map(line => line.trim()).filter(line => line && !line.startsWith('%%'));
  if (!lines.length) throw new Error('Empty diagram');

  const header = lines[0].match(/^(?:graph|flowchart)\s+(TD|TB|LR|BT|RL)\s*$/i);
  if (!header) {
    throw new Error('Invalid diagram header: "' + lines[0] + '". Expected graph/flowchart direction.');
  }

  const graph = {
    type: 'flowchart',
    direction: header[1].toUpperCase(),
    nodes: new Map(),
    edges: [],
    subgraphs: [],
    classDefs: new Map(),
    classAssignments: new Map(),
    nodeStyles: new Map(),
    linkStyles: new Map(),
  };
  const stack = [];

  for (const line of lines.slice(1)) {
    let match = line.match(/^classDef\s+(\w+)\s+(.+)$/);
    if (match) {
      graph.classDefs.set(match[1], parseStyleMap(match[2]));
      continue;
    }

    match = line.match(/^class\s+([\w,-]+)\s+(\w+)$/);
    if (match) {
      for (const id of match[1].split(',').map(value => value.trim())) {
        graph.classAssignments.set(id, match[2]);
      }
      continue;
    }

    match = line.match(/^style\s+([\w,-]+)\s+(.+)$/);
    if (match) {
      const style = parseStyleMap(match[2]);
      for (const id of match[1].split(',').map(value => value.trim())) {
        graph.nodeStyles.set(id, { ...(graph.nodeStyles.get(id) ?? {}), ...style });
      }
      continue;
    }

    match = line.match(/^linkStyle\s+(default|[\d,\s]+)\s+(.+)$/);
    if (match) {
      const style = parseStyleMap(match[2]);
      if (match[1].trim() === 'default') {
        graph.linkStyles.set('default', { ...(graph.linkStyles.get('default') ?? {}), ...style });
      } else {
        for (const raw of match[1].split(',')) {
          const index = Number.parseInt(raw.trim(), 10);
          if (!Number.isNaN(index)) {
            graph.linkStyles.set(index, { ...(graph.linkStyles.get(index) ?? {}), ...style });
          }
        }
      }
      continue;
    }

    match = line.match(/^direction\s+(TD|TB|LR|BT|RL)\s*$/i);
    if (match && stack.length) {
      stack[stack.length - 1].direction = match[1].toUpperCase();
      continue;
    }

    match = line.match(/^subgraph\s+(.+)$/);
    if (match) {
      let id;
      let label;
      const value = match[1].trim();
      const explicit = value.match(/^([\w-]+)\s*\[(.+)\]$/);
      if (explicit) {
        id = explicit[1];
        label = cleanLabel(explicit[2]);
      } else {
        label = cleanLabel(value);
        id = value.replace(/\s+/g, '_').replace(/[^\w]/g, '');
      }
      stack.push({ id, label, nodeIds: [], children: [] });
      continue;
    }

    if (line === 'end') {
      const group = stack.pop();
      if (group) {
        if (stack.length) stack[stack.length - 1].children.push(group);
        else graph.subgraphs.push(group);
      }
      continue;
    }

    parseFlowLine(line, graph, stack);
  }

  while (stack.length) {
    const group = stack.pop();
    if (!group) break;
    if (stack.length) stack[stack.length - 1].children.push(group);
    else graph.subgraphs.push(group);
  }
  return graph;
}

function directionToELK(direction) {
  if (direction === 'LR') return 'RIGHT';
  if (direction === 'RL') return 'LEFT';
  if (direction === 'BT') return 'UP';
  return 'DOWN';
}

export function nodeSize(label, shape) {
  const measured = measureMultiline(label, 13, 500);
  let width = measured.width + 40;
  let height = measured.height + 20;

  if (shape === 'diamond') {
    width = Math.max(width, height) + 24;
    height = width;
  }
  if (shape === 'circle' || shape === 'doublecircle') {
    width = Math.ceil(Math.sqrt(width * width + height * height)) + 8;
    height = shape === 'doublecircle' ? width + 12 : width;
  }
  if (shape === 'hexagon' || shape === 'trapezoid' || shape === 'trapezoid-alt') width += 20;
  if (shape === 'asymmetric') width += 12;
  if (shape === 'cylinder') height += 14;
  if (shape === 'state-start' || shape === 'state-end') return { width: 28, height: 28 };

  return { width: Math.max(width, 60), height: Math.max(height, 36) };
}

function collectGroupMembership(groups) {
  const nodeIds = new Set();
  const groupIds = new Set();

  const walk = group => {
    groupIds.add(group.id);
    for (const id of group.nodeIds) nodeIds.add(id);
    for (const child of group.children) walk(child);
  };
  for (const group of groups) walk(group);
  return { nodeIds, groupIds };
}

function nodeGroupMap(groups) {
  const map = new Map();
  const walk = group => {
    for (const id of group.nodeIds) map.set(id, group.id);
    for (const child of group.children) walk(child);
  };
  for (const group of groups) walk(group);
  return map;
}

function buildSubgraph(group, graph, settings, internalEdges, ports) {
  const layoutOptions = {
    'elk.algorithm': 'layered',
    'elk.padding': '[top=44,left=16,bottom=16,right=16]',
    'elk.edgeRouting': 'ORTHOGONAL',
    'elk.contentAlignment': 'H_CENTER V_CENTER',
    'elk.spacing.edgeEdge': '12',
    'elk.layered.spacing.edgeEdgeBetweenLayers': '12',
    'elk.layered.spacing.edgeNodeBetweenLayers': '12',
    'elk.layered.nodePlacement.bk.fixedAlignment': 'BALANCED',
    'elk.layered.spacing.nodeNodeBetweenLayers': String(settings.layerSpacing),
    'elk.spacing.nodeNode': String(settings.nodeSpacing),
  };
  if (group.direction) layoutOptions['elk.direction'] = directionToELK(group.direction);

  const elkGroup = {
    id: group.id,
    layoutOptions,
    labels: group.label ? [{ text: group.label }] : undefined,
    children: [],
    edges: [],
  };
  const groupPorts = ports.get(group.id) ?? [];
  if (groupPorts.length) elkGroup.ports = groupPorts.map(port => ({ id: port.portId }));

  for (const id of group.nodeIds) {
    const node = graph.nodes.get(id);
    if (!node) continue;
    const size = nodeSize(node.label, node.shape);
    elkGroup.children.push({ id, width: size.width, height: size.height, labels: [{ text: node.label }] });
  }
  for (const child of group.children) {
    elkGroup.children.push(buildSubgraph(child, graph, settings, internalEdges, ports));
  }

  for (const { index, edge } of internalEdges.get(group.id) ?? []) {
    const entry = { id: 'e' + index, sources: [edge.source], targets: [edge.target] };
    if (edge.label) {
      const measured = measureMultiline(edge.label, 11, 400);
      entry.labels = [{
        text: edge.label,
        width: measured.width + 8,
        height: measured.height + 6,
        layoutOptions: { 'elk.edgeLabels.inline': 'true', 'elk.edgeLabels.placement': 'CENTER' },
      }];
    }
    elkGroup.edges.push(entry);
  }

  for (const port of groupPorts) {
    const id = 'e' + port.edgeIndex + '_internal';
    elkGroup.edges.push(port.direction === 'incoming'
      ? { id, sources: [port.portId], targets: [port.internalNodeId] }
      : { id, sources: [port.internalNodeId], targets: [port.portId] });
  }
  return elkGroup;
}

export function buildELKGraph(graph, options = {}) {
  const settings = { ...DEFAULTS, ...options };
  const { nodeIds, groupIds } = collectGroupMembership(graph.subgraphs);
  const membership = nodeGroupMap(graph.subgraphs);
  const internalEdges = new Map([[null, []]]);
  const crossEdges = [];

  graph.edges.forEach((edge, index) => {
    const sourceGroup = membership.get(edge.source);
    const targetGroup = membership.get(edge.target);
    if (sourceGroup && sourceGroup === targetGroup) {
      if (!internalEdges.has(sourceGroup)) internalEdges.set(sourceGroup, []);
      internalEdges.get(sourceGroup).push({ index, edge });
    } else if (sourceGroup || targetGroup) {
      crossEdges.push({ index, edge, sourceGroup, targetGroup });
    } else {
      internalEdges.get(null).push({ index, edge });
    }
  });

  const hasDirectedSubgraph = graph.subgraphs.some(group => {
    const check = item => Boolean(item.direction) || item.children.some(check);
    return check(group);
  });

  const ports = new Map();
  if (hasDirectedSubgraph) {
    for (const { index, edge, sourceGroup, targetGroup } of crossEdges) {
      if (sourceGroup) {
        const portId = sourceGroup + '_out_' + index;
        if (!ports.has(sourceGroup)) ports.set(sourceGroup, []);
        ports.get(sourceGroup).push({ portId, edgeIndex: index, direction: 'outgoing', internalNodeId: edge.source });
      }
      if (targetGroup) {
        const portId = targetGroup + '_in_' + index;
        if (!ports.has(targetGroup)) ports.set(targetGroup, []);
        ports.get(targetGroup).push({ portId, edgeIndex: index, direction: 'incoming', internalNodeId: edge.target });
      }
    }
  }

  const root = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': directionToELK(graph.direction),
      'elk.spacing.nodeNode': String(settings.nodeSpacing),
      'elk.layered.spacing.nodeNodeBetweenLayers': String(settings.layerSpacing),
      'elk.spacing.edgeEdge': '12',
      'elk.layered.spacing.edgeEdgeBetweenLayers': '12',
      'elk.layered.spacing.edgeNodeBetweenLayers': '12',
      'elk.padding': '[top=' + settings.padding + ',left=' + settings.padding + ',bottom=' + settings.padding + ',right=' + settings.padding + ']',
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.layered.nodePlacement.bk.fixedAlignment': 'BALANCED',
      'elk.contentAlignment': 'H_CENTER V_CENTER',
      'elk.layered.thoroughness': String(settings.thoroughness),
      'elk.layered.highDegreeNodes.treatment': 'true',
      'elk.layered.highDegreeNodes.threshold': '8',
      'elk.layered.compaction.postCompaction.strategy': 'LEFT_RIGHT_CONSTRAINT_LOCKING',
      'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
      'elk.layered.wrapping.strategy': 'OFF',
      'elk.hierarchyHandling': hasDirectedSubgraph ? 'SEPARATE' : 'INCLUDE_CHILDREN',
    },
    children: [],
    edges: [],
  };

  for (const [id, node] of graph.nodes) {
    if (nodeIds.has(id) || groupIds.has(id)) continue;
    const size = nodeSize(node.label, node.shape);
    root.children.push({ id, width: size.width, height: size.height, labels: [{ text: node.label }] });
  }
  for (const group of graph.subgraphs) {
    root.children.push(buildSubgraph(group, graph, settings, internalEdges, ports));
  }

  const addEdge = (index, edge, sources, targets) => {
    const entry = { id: 'e' + index, sources, targets };
    if (edge.label) {
      const measured = measureMultiline(edge.label, 11, 400);
      entry.labels = [{
        text: edge.label,
        width: measured.width + 8,
        height: measured.height + 6,
        layoutOptions: { 'elk.edgeLabels.inline': 'true', 'elk.edgeLabels.placement': 'CENTER' },
      }];
    }
    root.edges.push(entry);
  };

  for (const { index, edge } of internalEdges.get(null)) {
    addEdge(index, edge, [edge.source], [edge.target]);
  }
  for (const { index, edge, sourceGroup, targetGroup } of crossEdges) {
    const sources = hasDirectedSubgraph && sourceGroup ? [sourceGroup + '_out_' + index] : [edge.source];
    const targets = hasDirectedSubgraph && targetGroup ? [targetGroup + '_in_' + index] : [edge.target];
    addEdge(index, edge, sources, targets);
  }
  return root;
}

function findGroup(groups, id) {
  for (const group of groups) {
    if (group.id === id) return group;
    const nested = findGroup(group.children, id);
    if (nested) return nested;
  }
  return undefined;
}

function classStyle(graph, id) {
  let style;
  const className = graph.classAssignments.get(id);
  if (className && graph.classDefs.has(className)) style = { ...graph.classDefs.get(className) };
  const direct = graph.nodeStyles.get(id);
  if (direct) style = style ? { ...style, ...direct } : { ...direct };
  return style;
}

function flattenChildren(elkNode, graph, groupIds, nodes, groups, offsetX = 0, offsetY = 0) {
  for (const child of elkNode.children ?? []) {
    const x = (child.x ?? 0) + offsetX;
    const y = (child.y ?? 0) + offsetY;
    const width = child.width ?? 0;
    const height = child.height ?? 0;
    if (groupIds.has(child.id)) {
      const nestedGroups = [];
      flattenChildren(child, graph, groupIds, nodes, nestedGroups, x, y);
      const source = findGroup(graph.subgraphs, child.id);
      groups.push({
        id: child.id,
        label: source?.label ?? '',
        x,
        y,
        width,
        height,
        children: nestedGroups,
      });
    } else {
      const source = graph.nodes.get(child.id);
      if (source) {
        nodes.push({
          id: child.id,
          label: source.label,
          shape: source.shape,
          x,
          y,
          width,
          height,
          inlineStyle: classStyle(graph, child.id),
        });
      }
      if (child.children?.length) flattenChildren(child, graph, groupIds, nodes, groups, x, y);
    }
  }
}

function collectELKEdges(node, map, offsetX = 0, offsetY = 0) {
  for (const edge of node.edges ?? []) {
    const internal = edge.id.endsWith('_internal');
    const index = Number.parseInt(edge.id.slice(1), 10);
    if (Number.isNaN(index)) continue;
    const points = [];
    const section = edge.sections?.[0];
    if (section) {
      points.push({ x: section.startPoint.x + offsetX, y: section.startPoint.y + offsetY });
      for (const bend of section.bendPoints ?? []) {
        points.push({ x: bend.x + offsetX, y: bend.y + offsetY });
      }
      points.push({ x: section.endPoint.x + offsetX, y: section.endPoint.y + offsetY });
    }
    let labelPosition;
    const label = edge.labels?.[0];
    if (label?.x != null && label?.y != null) {
      labelPosition = {
        x: label.x + (label.width ?? 0) / 2 + offsetX,
        y: label.y + (label.height ?? 0) / 2 + offsetY,
      };
    }
    if (!map.has(index)) map.set(index, {});
    const collected = map.get(index);
    if (internal) {
      const source = edge.sources?.[0] ?? '';
      const target = edge.targets?.[0] ?? '';
      const sourcePort = source.includes('_in_') || source.includes('_out_');
      const targetPort = target.includes('_in_') || target.includes('_out_');
      if (sourcePort) collected.incoming = { points, labelPosition };
      else if (targetPort) collected.outgoing = { points, labelPosition };
    } else {
      collected.external = { points, labelPosition };
    }
  }

  for (const child of node.children ?? []) {
    collectELKEdges(child, map, offsetX + (child.x ?? 0), offsetY + (child.y ?? 0));
  }
}

function pathMidpoint(points) {
  if (!points.length) return { x: 0, y: 0 };
  if (points.length === 1) return points[0];
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    total += Math.hypot(points[index].x - points[index - 1].x, points[index].y - points[index - 1].y);
  }
  let remaining = total / 2;
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const length = Math.hypot(current.x - previous.x, current.y - previous.y);
    if (remaining <= length) {
      const ratio = length > 0 ? remaining / length : 0;
      return {
        x: previous.x + (current.x - previous.x) * ratio,
        y: previous.y + (current.y - previous.y) * ratio,
      };
    }
    remaining -= length;
  }
  return points[points.length - 1];
}

function groupBoxes(groups, output = []) {
  for (const group of groups) {
    output.push({ x: group.x, y: group.y, right: group.x + group.width, bottom: group.y + group.height });
    groupBoxes(group.children, output);
  }
  return output;
}

function normalizeOrthogonal(points, bounds, offset = 0) {
  if (points.length < 2) return points;
  const diagonal = points.some((point, index) => {
    if (!index) return false;
    const previous = points[index - 1];
    return Math.abs(point.x - previous.x) > 1 && Math.abs(point.y - previous.y) > 1;
  });
  if (!diagonal) return points;

  const result = [points[0]];
  for (let index = 1; index < points.length; index += 1) {
    const previous = result[result.length - 1];
    const current = points[index];
    if (Math.abs(current.x - previous.x) > 1 && Math.abs(current.y - previous.y) > 1) {
      if (bounds) {
        const laneOffset = Math.floor(offset / 2) * 12;
        const laneX = offset % 2 === 0 ? bounds.rightX + laneOffset : bounds.leftX - laneOffset;
        result.push({ x: laneX, y: previous.y }, { x: laneX, y: current.y });
      } else {
        const middleY = (previous.y + current.y) / 2;
        result.push({ x: previous.x, y: middleY }, { x: current.x, y: middleY });
      }
    }
    result.push(current);
  }
  return result;
}

function mergeLinkStyle(graph, index) {
  let style;
  const base = graph.linkStyles.get('default');
  if (base) style = { ...base };
  const direct = graph.linkStyles.get(index);
  if (direct) style = style ? { ...style, ...direct } : { ...direct };
  return style;
}

function flattenEdges(elkGraph, graph, groups) {
  const collected = new Map();
  collectELKEdges(elkGraph, collected);

  const boxes = groupBoxes(groups);
  const bounds = boxes.length
    ? { leftX: Math.min(...boxes.map(box => box.x)) - 20, rightX: Math.max(...boxes.map(box => box.right)) + 20 }
    : undefined;

  const edges = [];
  let detour = 0;
  for (const [index, parts] of collected) {
    const source = graph.edges[index];
    if (!source) continue;
    let points = [];
    if (parts.outgoing?.points.length) points.push(...parts.outgoing.points);
    if (parts.external?.points.length) {
      points.push(...(points.length ? parts.external.points.slice(1) : parts.external.points));
    }
    if (parts.incoming?.points.length) {
      points.push(...(points.length ? parts.incoming.points.slice(1) : parts.incoming.points));
    }

    let labelPosition;
    if (source.label && points.length >= 2) {
      labelPosition = parts.external?.labelPosition ?? pathMidpoint(points);
    }

    const normalized = normalizeOrthogonal(points, bounds, detour);
    const pathChanged = normalized !== points;
    if (pathChanged && normalized.length) detour += 1;
    points = normalized;
    if (pathChanged && source.label && points.length >= 2) labelPosition = pathMidpoint(points);

    edges.push({
      ...source,
      points,
      labelPosition,
      inlineStyle: mergeLinkStyle(graph, index),
    });
  }
  return edges;
}

function shiftAlignedNodes(nodes, edges, direction) {
  if (!nodes.length) return;
  const horizontal = direction === 'LR' || direction === 'RL';
  const connected = new Set();
  for (const edge of edges) {
    connected.add(edge.source + ':' + edge.target);
    connected.add(edge.target + ':' + edge.source);
  }

  const threshold = DEFAULTS.layerSpacing * 0.6;
  const sorted = [...nodes].sort((a, b) => horizontal ? a.x - b.x : a.y - b.y);
  const bands = [];
  let band = [sorted[0]];
  for (let index = 1; index < sorted.length; index += 1) {
    const distance = (horizontal ? sorted[index].x : sorted[index].y) -
      (horizontal ? sorted[index - 1].x : sorted[index - 1].y);
    const hasConnection = band.some(node => connected.has(node.id + ':' + sorted[index].id));
    if (distance <= threshold && !hasConnection) band.push(sorted[index]);
    else {
      bands.push(band);
      band = [sorted[index]];
    }
  }
  bands.push(band);

  const shifts = new Map();
  for (const group of bands) {
    if (group.length <= 1) continue;
    const coordinates = group.map(node => horizontal ? node.x : node.y);
    const min = Math.min(...coordinates);
    const max = Math.max(...coordinates);
    if (max - min <= 1) continue;
    const center = (min + max) / 2;
    for (const node of group) {
      const shift = center - (horizontal ? node.x : node.y);
      if (Math.abs(shift) <= 0.5) continue;
      if (horizontal) node.x = center;
      else node.y = center;
      shifts.set(node.id, shift);
    }
  }

  if (!shifts.size) return;
  for (const edge of edges) {
    if (edge.points.length < 2) continue;
    const sourceShift = shifts.get(edge.source);
    const targetShift = shifts.get(edge.target);
    if (sourceShift != null) {
      const first = edge.points[0];
      if (horizontal) {
        const oldX = first.x;
        first.x += sourceShift;
        if (edge.points[1].x === oldX) edge.points[1].x += sourceShift;
      } else {
        const oldY = first.y;
        first.y += sourceShift;
        if (edge.points[1].y === oldY) edge.points[1].y += sourceShift;
      }
    }
    if (targetShift != null) {
      const last = edge.points[edge.points.length - 1];
      if (horizontal) {
        const oldX = last.x;
        last.x += targetShift;
        const previous = edge.points[edge.points.length - 2];
        if (previous.x === oldX) previous.x += targetShift;
      } else {
        const oldY = last.y;
        last.y += targetShift;
        const previous = edge.points[edge.points.length - 2];
        if (previous.y === oldY) previous.y += targetShift;
      }
    }
  }
}

function containsPoint(group, x, y) {
  if (x < group.x || x > group.x + group.width || y < group.y || y > group.y + group.height) return [];
  const result = [group];
  for (const child of group.children) result.push(...containsPoint(child, x, y));
  return result;
}

function collisionSafeLane(value, centerX, centerY, groups, direction) {
  const horizontal = direction === 'LR' || direction === 'RL';
  const first = groups.flatMap(group => containsPoint(group, centerX, centerY)).map(group => group.id);
  const occupied = new Set(first);
  const second = groups.flatMap(group => containsPoint(group, horizontal ? value : centerX, horizontal ? centerY : value));
  const blocker = second.find(group => !occupied.has(group.id));
  if (!blocker) return value;
  if (direction === 'LR') return blocker.x - 12;
  if (direction === 'RL') return blocker.x + blocker.width + 12;
  if (direction === 'BT') return blocker.y + blocker.height + 12;
  return blocker.y - 12;
}

function mergeFanEdges(edges, nodes, groups, direction) {
  const nodeMap = new Map(nodes.map(node => [node.id, node]));
  const handled = new Set();
  const horizontalForward = direction === 'LR';
  const horizontalReverse = direction === 'RL';
  const verticalReverse = direction === 'BT';
  const horizontal = horizontalForward || horizontalReverse;

  const outgoing = new Map();
  for (const edge of edges) {
    if (edge.source === edge.target) continue;
    if (!outgoing.has(edge.source)) outgoing.set(edge.source, []);
    outgoing.get(edge.source).push(edge);
  }

  for (const [sourceId, candidates] of outgoing) {
    if (candidates.length < 2) continue;
    const style = candidates[0].style;
    if (candidates.some(edge => edge.label || edge.style !== style)) continue;
    const source = nodeMap.get(sourceId);
    if (!source) continue;

    const eligible = candidates.filter(edge => {
      const target = nodeMap.get(edge.target);
      if (!target) return false;
      if (horizontalForward) return target.x > source.x + source.width;
      if (horizontalReverse) return target.x + target.width < source.x;
      if (verticalReverse) return target.y + target.height < source.y;
      return target.y > source.y + source.height;
    });
    if (eligible.length < 2) continue;

    const targetNodes = eligible.map(edge => ({ edge, node: nodeMap.get(edge.target) }));
    const centerX = source.x + source.width / 2;
    const centerY = source.y + source.height / 2;

    if (horizontal) {
      const sourceX = horizontalForward ? source.x + source.width : source.x;
      let lane = horizontalForward
        ? Math.min(...targetNodes.map(item => item.node.x))
        : Math.max(...targetNodes.map(item => item.node.x + item.node.width));
      lane = sourceX + (lane - sourceX) / 2;
      lane = collisionSafeLane(lane, centerX, centerY, groups, direction);
      for (const { edge, node } of targetNodes) {
        const y = node.y + node.height / 2;
        edge.points = [
          { x: sourceX, y: centerY },
          { x: lane, y: centerY },
          { x: lane, y },
          { x: horizontalForward ? node.x : node.x + node.width, y },
        ];
        handled.add(edge);
      }
    } else {
      const sourceY = verticalReverse ? source.y : source.y + source.height;
      let lane = verticalReverse
        ? Math.max(...targetNodes.map(item => item.node.y + item.node.height))
        : Math.min(...targetNodes.map(item => item.node.y));
      lane = sourceY + (lane - sourceY) / 2;
      lane = collisionSafeLane(lane, centerX, centerY, groups, direction);
      for (const { edge, node } of targetNodes) {
        const x = node.x + node.width / 2;
        edge.points = [
          { x: centerX, y: sourceY },
          { x: centerX, y: lane },
          { x, y: lane },
          { x, y: verticalReverse ? node.y + node.height : node.y },
        ];
        handled.add(edge);
      }
    }
  }

  const incoming = new Map();
  for (const edge of edges) {
    if (handled.has(edge) || edge.source === edge.target) continue;
    if (!incoming.has(edge.target)) incoming.set(edge.target, []);
    incoming.get(edge.target).push(edge);
  }

  for (const [targetId, candidates] of incoming) {
    if (candidates.length < 2) continue;
    const style = candidates[0].style;
    if (candidates.some(edge => edge.label || edge.style !== style)) continue;
    const target = nodeMap.get(targetId);
    if (!target) continue;

    const eligible = candidates.filter(edge => {
      const source = nodeMap.get(edge.source);
      if (!source) return false;
      if (horizontalForward) return source.x + source.width < target.x;
      if (horizontalReverse) return source.x > target.x + target.width;
      if (verticalReverse) return source.y > target.y + target.height;
      return source.y + source.height < target.y;
    });
    if (eligible.length < 2) continue;

    const sourceNodes = eligible.map(edge => ({ edge, node: nodeMap.get(edge.source) }));
    const centerX = target.x + target.width / 2;
    const centerY = target.y + target.height / 2;

    if (horizontal) {
      const targetX = horizontalForward ? target.x : target.x + target.width;
      let lane = horizontalForward
        ? Math.max(...sourceNodes.map(item => item.node.x + item.node.width))
        : Math.min(...sourceNodes.map(item => item.node.x));
      lane += (targetX - lane) / 2;
      lane = collisionSafeLane(lane, centerX, centerY, groups, direction);
      for (const { edge, node } of sourceNodes) {
        const y = node.y + node.height / 2;
        edge.points = [
          { x: horizontalForward ? node.x + node.width : node.x, y },
          { x: lane, y },
          { x: lane, y: centerY },
          { x: targetX, y: centerY },
        ];
      }
    } else {
      const targetY = verticalReverse ? target.y + target.height : target.y;
      let lane = verticalReverse
        ? Math.min(...sourceNodes.map(item => item.node.y))
        : Math.max(...sourceNodes.map(item => item.node.y + item.node.height));
      lane += (targetY - lane) / 2;
      lane = collisionSafeLane(lane, centerX, centerY, groups, direction);
      for (const { edge, node } of sourceNodes) {
        const x = node.x + node.width / 2;
        edge.points = [
          { x, y: verticalReverse ? node.y : node.y + node.height },
          { x, y: lane },
          { x: centerX, y: lane },
          { x: centerX, y: targetY },
        ];
      }
    }
  }
}

function lineAtY(y, a, b) {
  const delta = b.y - a.y;
  if (Math.abs(delta) < 0.001) return null;
  const t = (y - a.y) / delta;
  if (t < 0 || t > 1) return null;
  return { x: a.x + t * (b.x - a.x), y };
}

function lineAtX(x, a, b) {
  const delta = b.x - a.x;
  if (Math.abs(delta) < 0.001) return null;
  const t = (x - a.x) / delta;
  if (t < 0 || t > 1) return null;
  return { x, y: a.y + t * (b.y - a.y) };
}

function diamondIntersection(point, neighbour, node) {
  const centerX = node.x + node.width / 2;
  const centerY = node.y + node.height / 2;
  const top = { x: centerX, y: node.y };
  const right = { x: node.x + node.width, y: centerY };
  const bottom = { x: centerX, y: node.y + node.height };
  const left = { x: node.x, y: centerY };
  const dx = point.x - neighbour.x;
  const dy = point.y - neighbour.y;

  if (Math.abs(dx) < Math.abs(dy)) {
    if (dy > 0) {
      return point.x <= centerX ? lineAtX(point.x, left, top) ?? top : lineAtX(point.x, top, right) ?? top;
    }
    return point.x <= centerX ? lineAtX(point.x, bottom, left) ?? bottom : lineAtX(point.x, right, bottom) ?? bottom;
  }

  if (dx > 0) {
    return point.y <= centerY ? lineAtY(point.y, top, left) ?? left : lineAtY(point.y, left, bottom) ?? left;
  }
  return point.y <= centerY ? lineAtY(point.y, top, right) ?? right : lineAtY(point.y, right, bottom) ?? right;
}

function clipEndpoint(points, node, source) {
  if (points.length < 2 || ['rectangle', 'rounded', 'stadium'].includes(node.shape)) return points;
  if (node.shape !== 'diamond') return points;
  const copy = points.map(point => ({ ...point }));
  if (source) copy[0] = diamondIntersection(copy[0], copy[1], node);
  else {
    const last = copy.length - 1;
    copy[last] = diamondIntersection(copy[last], copy[last - 1], node);
  }
  return copy;
}

export async function layoutFlowchart(graph, elk, options = {}) {
  const settings = { ...DEFAULTS, ...options };
  const elkGraph = buildELKGraph(graph, settings);
  const laidOut = await elk.layout(elkGraph);

  const { groupIds } = collectGroupMembership(graph.subgraphs);
  const nodes = [];
  const groups = [];
  flattenChildren(laidOut, graph, groupIds, nodes, groups);

  const edges = flattenEdges(laidOut, graph, groups);
  shiftAlignedNodes(nodes, edges, graph.direction);
  if (settings.mergeEdges) mergeFanEdges(edges, nodes, groups, graph.direction);

  const nodeMap = new Map(nodes.map(node => [node.id, node]));
  for (const edge of edges) {
    const source = nodeMap.get(edge.source);
    const target = nodeMap.get(edge.target);
    if (source) edge.points = clipEndpoint(edge.points, source, true);
    if (target) edge.points = clipEndpoint(edge.points, target, false);
  }

  let width = laidOut.width ?? 800;
  let height = laidOut.height ?? 600;
  for (const edge of edges) {
    for (const point of edge.points) {
      width = Math.max(width, point.x + 8 + settings.padding);
      height = Math.max(height, point.y + 8 + settings.padding);
    }
    if (edge.labelPosition) {
      width = Math.max(width, edge.labelPosition.x + 60 + settings.padding);
      height = Math.max(height, edge.labelPosition.y + 20 + settings.padding);
    }
  }

  return { width, height, nodes, edges, groups, graph };
}

function renderGroup(group) {
  const lines = [
    '<g class="subgraph" data-id="' + escapeXML(group.id) + '" data-label="' + escapeXML(group.label) + '">',
    '  <rect x="' + group.x + '" y="' + group.y + '" width="' + group.width + '" height="' + group.height +
      '" rx="0" ry="0" fill="var(--_group-fill)" stroke="var(--_node-stroke)" stroke-width="1" />',
    '  <rect x="' + group.x + '" y="' + group.y + '" width="' + group.width +
      '" height="28" rx="0" ry="0" fill="var(--_group-hdr)" stroke="var(--_node-stroke)" stroke-width="1" />',
    '  ' + svgText(group.label, group.x + 12, group.y + 14, 12,
      'font-size="12" font-weight="600" fill="var(--_text-sec)"'),
  ];
  for (const child of group.children) lines.push(renderGroup(child));
  lines.push('</g>');
  return lines.join('\n');
}

function renderShape(node) {
  let x = node.x;
  let y = node.y;
  let width = node.width;
  let height = node.height;
  const style = node.inlineStyle;
  const fill = escapeXML(style?.fill ?? 'var(--_node-fill)');
  const stroke = escapeXML(style?.stroke ?? 'var(--_node-stroke)');
  const strokeWidth = escapeXML(style?.['stroke-width'] ?? '0.75');

  if (node.shape === 'diamond') {
    const cx = x + width / 2;
    const cy = y + height / 2;
    const rx = width / 2;
    const ry = height / 2;
    return '<polygon points="' + [
      cx + ',' + (cy - ry),
      (cx + rx) + ',' + cy,
      cx + ',' + (cy + ry),
      (cx - rx) + ',' + cy,
    ].join(' ') + '" fill="' + fill + '" stroke="' + stroke + '" stroke-width="' + strokeWidth + '" />';
  }
  if (node.shape === 'rounded') {
    return '<rect x="' + x + '" y="' + y + '" width="' + width + '" height="' + height +
      '" rx="6" ry="6" fill="' + fill + '" stroke="' + stroke + '" stroke-width="' + strokeWidth + '" />';
  }
  if (node.shape === 'stadium') {
    const radius = height / 2;
    return '<rect x="' + x + '" y="' + y + '" width="' + width + '" height="' + height +
      '" rx="' + radius + '" ry="' + radius + '" fill="' + fill + '" stroke="' + stroke +
      '" stroke-width="' + strokeWidth + '" />';
  }
  if (node.shape === 'circle') {
    return '<circle cx="' + (x + width / 2) + '" cy="' + (y + height / 2) + '" r="' +
      (Math.min(width, height) / 2) + '" fill="' + fill + '" stroke="' + stroke +
      '" stroke-width="' + strokeWidth + '" />';
  }
  if (node.shape === 'subroutine') {
    return '<rect x="' + x + '" y="' + y + '" width="' + width + '" height="' + height +
      '" rx="0" ry="0" fill="' + fill + '" stroke="' + stroke + '" stroke-width="' + strokeWidth + '" />\n' +
      '<line x1="' + (x + 8) + '" y1="' + y + '" x2="' + (x + 8) + '" y2="' + (y + height) +
      '" stroke="' + stroke + '" stroke-width="' + strokeWidth + '" />\n' +
      '<line x1="' + (x + width - 8) + '" y1="' + y + '" x2="' + (x + width - 8) + '" y2="' +
      (y + height) + '" stroke="' + stroke + '" stroke-width="' + strokeWidth + '" />';
  }
  if (node.shape === 'doublecircle') {
    const cx = x + width / 2;
    const cy = y + height / 2;
    const radius = Math.min(width, height) / 2;
    return '<circle cx="' + cx + '" cy="' + cy + '" r="' + radius + '" fill="' + fill + '" stroke="' +
      stroke + '" stroke-width="' + strokeWidth + '" />\n' +
      '<circle cx="' + cx + '" cy="' + cy + '" r="' + (radius - 5) + '" fill="' + fill + '" stroke="' +
      stroke + '" stroke-width="' + strokeWidth + '" />';
  }
  if (node.shape === 'hexagon') {
    const inset = height / 4;
    return '<polygon points="' + [
      (x + inset) + ',' + y,
      (x + width - inset) + ',' + y,
      (x + width) + ',' + (y + height / 2),
      (x + width - inset) + ',' + (y + height),
      (x + inset) + ',' + (y + height),
      x + ',' + (y + height / 2),
    ].join(' ') + '" fill="' + fill + '" stroke="' + stroke + '" stroke-width="' + strokeWidth + '" />';
  }
  if (node.shape === 'cylinder') {
    const cx = x + width / 2;
    const top = y + 7;
    const bodyHeight = height - 14;
    return '<rect x="' + x + '" y="' + top + '" width="' + width + '" height="' + bodyHeight +
      '" fill="' + fill + '" stroke="none" />\n' +
      '<line x1="' + x + '" y1="' + top + '" x2="' + x + '" y2="' + (top + bodyHeight) +
      '" stroke="' + stroke + '" stroke-width="' + strokeWidth + '" />\n' +
      '<line x1="' + (x + width) + '" y1="' + top + '" x2="' + (x + width) + '" y2="' +
      (top + bodyHeight) + '" stroke="' + stroke + '" stroke-width="' + strokeWidth + '" />\n' +
      '<ellipse cx="' + cx + '" cy="' + (y + height - 7) + '" rx="' + (width / 2) +
      '" ry="7" fill="' + fill + '" stroke="' + stroke + '" stroke-width="' + strokeWidth + '" />\n' +
      '<ellipse cx="' + cx + '" cy="' + top + '" rx="' + (width / 2) +
      '" ry="7" fill="' + fill + '" stroke="' + stroke + '" stroke-width="' + strokeWidth + '" />';
  }
  if (node.shape === 'asymmetric') {
    return '<polygon points="' + [
      (x + 12) + ',' + y,
      (x + width) + ',' + y,
      (x + width) + ',' + (y + height),
      (x + 12) + ',' + (y + height),
      x + ',' + (y + height / 2),
    ].join(' ') + '" fill="' + fill + '" stroke="' + stroke + '" stroke-width="' + strokeWidth + '" />';
  }
  if (node.shape === 'trapezoid' || node.shape === 'trapezoid-alt') {
    const inset = width * 0.15;
    const points = node.shape === 'trapezoid'
      ? [(x + inset) + ',' + y, (x + width - inset) + ',' + y, (x + width) + ',' + (y + height), x + ',' + (y + height)]
      : [x + ',' + y, (x + width) + ',' + y, (x + width - inset) + ',' + (y + height), (x + inset) + ',' + (y + height)];
    return '<polygon points="' + points.join(' ') + '" fill="' + fill + '" stroke="' + stroke +
      '" stroke-width="' + strokeWidth + '" />';
  }
  if (node.shape === 'state-start') {
    return '<circle cx="' + (x + width / 2) + '" cy="' + (y + height / 2) + '" r="' +
      (Math.min(width, height) / 2 - 2) + '" fill="var(--_text)" stroke="none" />';
  }
  if (node.shape === 'state-end') {
    const cx = x + width / 2;
    const cy = y + height / 2;
    const radius = Math.min(width, height) / 2 - 2;
    return '<circle cx="' + cx + '" cy="' + cy + '" r="' + radius +
      '" fill="none" stroke="var(--_text)" stroke-width="1.5" />\n' +
      '<circle cx="' + cx + '" cy="' + cy + '" r="' + (radius - 4) + '" fill="var(--_text)" stroke="none" />';
  }
  return '<rect x="' + x + '" y="' + y + '" width="' + width + '" height="' + height +
    '" rx="0" ry="0" fill="' + fill + '" stroke="' + stroke + '" stroke-width="' + strokeWidth + '" />';
}

function markerSuffix(color) {
  return color.replace(/[^a-zA-Z0-9]/g, character => character.charCodeAt(0).toString(16));
}

export function renderFlowchartLayout(layout, palette, options = {}) {
  const font = options.font ?? DEFAULTS.font;
  const transparent = options.transparent ?? false;
  const lines = [svgOpen(layout.width, layout.height, palette, transparent), svgThemeStyle(font, false), '<defs>'];
  lines.push(
    '  <marker id="arrowhead" markerWidth="8" markerHeight="5" refX="7" refY="2.5" orient="auto">\n' +
    '    <polygon points="0 0, 8 2.5, 0 5" fill="var(--_arrow)" stroke="var(--_arrow)" stroke-width="0.75" stroke-linejoin="round" />\n' +
    '  </marker>\n' +
    '  <marker id="arrowhead-start" markerWidth="8" markerHeight="5" refX="1" refY="2.5" orient="auto-start-reverse">\n' +
    '    <polygon points="8 0, 0 2.5, 8 5" fill="var(--_arrow)" stroke="var(--_arrow)" stroke-width="0.75" stroke-linejoin="round" />\n' +
    '  </marker>'
  );

  const markerColors = new Set();
  for (const edge of layout.edges) if (edge.inlineStyle?.stroke) markerColors.add(edge.inlineStyle.stroke);
  for (const color of markerColors) {
    const escaped = escapeXML(color);
    const suffix = markerSuffix(color);
    const attrs = 'fill="' + escaped + '" stroke="' + escaped +
      '" stroke-width="0.75" stroke-linejoin="round"';
    lines.push(
      '  <marker id="arrowhead-' + suffix + '" markerWidth="8" markerHeight="5" refX="7" refY="2.5" orient="auto">\n' +
      '    <polygon points="0 0, 8 2.5, 0 5" ' + attrs + ' />\n' +
      '  </marker>\n' +
      '  <marker id="arrowhead-start-' + suffix + '" markerWidth="8" markerHeight="5" refX="1" refY="2.5" orient="auto-start-reverse">\n' +
      '    <polygon points="8 0, 0 2.5, 8 5" ' + attrs + ' />\n' +
      '  </marker>'
    );
  }
  lines.push('</defs>');

  for (const group of layout.groups) lines.push(renderGroup(group));

  for (const edge of layout.edges) {
    if (edge.points.length < 2) continue;
    const points = edge.points.map(point => point.x + ',' + point.y).join(' ');
    const dotted = edge.style === 'dotted' ? ' stroke-dasharray="4 4"' : '';
    const width = escapeXML(edge.inlineStyle?.['stroke-width'] ?? String(edge.style === 'thick' ? 2 : 1));
    const stroke = escapeXML(edge.inlineStyle?.stroke ?? 'var(--_line)');
    const suffix = edge.inlineStyle?.stroke ? '-' + markerSuffix(edge.inlineStyle.stroke) : '';
    let markers = '';
    if (edge.hasArrowEnd) markers += ' marker-end="url(#arrowhead' + suffix + ')"';
    if (edge.hasArrowStart) markers += ' marker-start="url(#arrowhead-start' + suffix + ')"';
    const attrs = [
      'class="edge"',
      'data-from="' + escapeXML(edge.source) + '"',
      'data-to="' + escapeXML(edge.target) + '"',
      'data-style="' + edge.style + '"',
      'data-arrow-start="' + edge.hasArrowStart + '"',
      'data-arrow-end="' + edge.hasArrowEnd + '"',
    ];
    if (edge.label) attrs.push('data-label="' + escapeXML(edge.label) + '"');
    lines.push('<polyline ' + attrs.join(' ') + ' points="' + points +
      '" fill="none" stroke="' + stroke + '" stroke-width="' + width + '"' + dotted + markers + ' />');
  }

  for (const edge of layout.edges) {
    if (!edge.label) continue;
    const position = edge.labelPosition ?? pathMidpoint(edge.points);
    const measured = measureMultiline(edge.label, 11, 400);
    const width = measured.width + 16;
    const height = measured.height + 16;
    const background = '<rect x="' + (position.x - width / 2) + '" y="' + (position.y - height / 2) +
      '" width="' + width + '" height="' + height +
      '" rx="2" ry="2" fill="var(--bg)" stroke="var(--_inner-stroke)" stroke-width="1" />';
    const text = svgText(edge.label, position.x, position.y, 11,
      'text-anchor="middle" font-size="11" font-weight="400" fill="var(--_text-sec)"');
    lines.push('<g class="edge-label" data-from="' + escapeXML(edge.source) + '" data-to="' +
      escapeXML(edge.target) + '" data-label="' + escapeXML(edge.label) + '">\n  ' +
      (background + '\n' + text).replace(/\n/g, '\n  ') + '\n</g>');
  }

  for (const node of layout.nodes) {
    const shape = renderShape(node);
    const color = escapeXML(node.inlineStyle?.color ?? 'var(--_text)');
    const text = node.shape !== 'state-start' && node.shape !== 'state-end' || node.label
      ? svgText(node.label, node.x + node.width / 2, node.y + node.height / 2, 13,
        'text-anchor="middle" font-size="13" font-weight="500" fill="' + color + '"')
      : '';
    lines.push(
      '<g class="node" data-id="' + escapeXML(node.id) + '" data-label="' + escapeXML(node.label) +
      '" data-shape="' + node.shape + '">\n  ' + shape.replace(/\n/g, '\n  ') +
      (text ? '\n  ' + text.replace(/\n/g, '\n  ') : '') + '\n</g>'
    );
  }

  lines.push('</svg>');
  return lines.join('\n');
}

export async function renderFlowchart(source, { elk, palette, font = DEFAULTS.font, transparent = false } = {}) {
  if (!elk) throw new Error('ELK instance is required');
  const graph = parseFlowchart(source);
  const layout = await layoutFlowchart(graph, elk);
  return {
    type: 'flowchart',
    graph,
    layout,
    svg: renderFlowchartLayout(layout, palette, { font, transparent }),
  };
}
