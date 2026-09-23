import { cleanLabel, parseStyleMap } from './common.mjs';
import { layoutFlowchart, renderFlowchartLayout } from './flowchart.mjs';

function addNode(graph, stack, node) {
  if (!graph.nodes.has(node.id)) graph.nodes.set(node.id, node);
  if (stack.length) {
    const current = stack[stack.length - 1];
    if (!current.nodeIds.includes(node.id)) current.nodeIds.push(node.id);
  }
}

function ensureRounded(graph, stack, id) {
  if (!graph.nodes.has(id)) addNode(graph, stack, { id, label: id, shape: 'rounded' });
  else if (stack.length && !stack[stack.length - 1].nodeIds.includes(id)) stack[stack.length - 1].nodeIds.push(id);
}

export function parseStateDiagram(source) {
  const lines = source.split('\n').map(line => line.trim()).filter(line => line && !line.startsWith('%%'));
  if (!lines.length || !/^stateDiagram(-v2)?\s*$/i.test(lines[0])) throw new Error('Invalid stateDiagram header');

  const graph = {
    type: 'state',
    direction: 'TD',
    nodes: new Map(),
    edges: [],
    subgraphs: [],
    classDefs: new Map(),
    classAssignments: new Map(),
    nodeStyles: new Map(),
    linkStyles: new Map(),
  };
  const stack = [];
  const groupIds = new Set();
  let startCount = 0;
  let endCount = 0;

  for (const line of lines.slice(1)) {
    let match = line.match(/^direction\s+(TD|TB|LR|BT|RL)\s*$/i);
    if (match) {
      if (stack.length) stack[stack.length - 1].direction = match[1].toUpperCase();
      else graph.direction = match[1].toUpperCase();
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

    match = line.match(/^state\s+(?:"([^"]+)"\s+as\s+)?([\w\p{L}]+)\s*\{$/u);
    if (match) {
      const id = match[2];
      stack.push({ id, label: match[1] ?? id, nodeIds: [], children: [] });
      groupIds.add(id);
      graph.nodes.delete(id);
      continue;
    }

    if (line === '}') {
      const group = stack.pop();
      if (group) {
        if (stack.length) stack[stack.length - 1].children.push(group);
        else graph.subgraphs.push(group);
      }
      continue;
    }

    match = line.match(/^state\s+"([^"]+)"\s+as\s+([\w\p{L}]+)\s*$/u);
    if (match) {
      addNode(graph, stack, { id: match[2], label: cleanLabel(match[1]), shape: 'rounded' });
      continue;
    }

    match = line.match(/^(\[\*\]|[\w\p{L}-]+)\s*(-->)\s*(\[\*\]|[\w\p{L}-]+)(?:\s*:\s*(.+))?$/u);
    if (match) {
      let sourceId = match[1];
      let targetId = match[3];
      const label = match[4]?.trim() ? cleanLabel(match[4].trim()) : undefined;

      if (sourceId === '[*]') {
        startCount += 1;
        sourceId = '_start' + (startCount > 1 ? startCount : '');
        addNode(graph, stack, { id: sourceId, label: '', shape: 'state-start' });
      } else if (!groupIds.has(sourceId)) {
        ensureRounded(graph, stack, sourceId);
      }

      if (targetId === '[*]') {
        endCount += 1;
        targetId = '_end' + (endCount > 1 ? endCount : '');
        addNode(graph, stack, { id: targetId, label: '', shape: 'state-end' });
      } else if (!groupIds.has(targetId)) {
        ensureRounded(graph, stack, targetId);
      }

      graph.edges.push({
        source: sourceId,
        target: targetId,
        label,
        style: 'solid',
        hasArrowStart: false,
        hasArrowEnd: true,
      });
      continue;
    }

    match = line.match(/^([\w\p{L}-]+)\s*:\s*(.+)$/u);
    if (match) {
      addNode(graph, stack, {
        id: match[1],
        label: cleanLabel(match[2].trim()),
        shape: 'rounded',
      });
    }
  }

  while (stack.length) {
    const group = stack.pop();
    if (!group) break;
    if (stack.length) stack[stack.length - 1].children.push(group);
    else graph.subgraphs.push(group);
  }
  return graph;
}

export async function renderStateDiagram(source, {
  elk,
  palette,
  font = 'Inter',
  transparent = false,
  edgeCornerRadius = 0,
  layoutOptions = {},
} = {}) {
  if (!elk) throw new Error('ELK instance is required');
  const graph = parseStateDiagram(source);
  const layout = await layoutFlowchart(graph, elk, layoutOptions);
  return {
    type: 'state',
    graph,
    layout,
    svg: renderFlowchartLayout(layout, palette, { font, transparent, edgeCornerRadius }),
  };
}
