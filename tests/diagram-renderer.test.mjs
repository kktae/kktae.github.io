import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

import { measureText, PALETTES } from '../assets/js/diagram/common.mjs';
import { roundedPolylinePath } from '../assets/js/diagram/geometry.mjs';
import { parseFlowchart } from '../assets/js/diagram/flowchart.mjs';
import {
  detectDiagramType,
  renderAntigravityDiagram,
  renderErrorMessage,
  renderDiagram,
  SUPPORTED_DIAGRAM_TYPES,
} from '../assets/js/diagram/renderer.mjs';
import { parseSequence } from '../assets/js/diagram/sequence.mjs';

const ROOT = new URL('../', import.meta.url).pathname;

const FIXTURES = {
  flowchart: [
    'flowchart LR',
    '  subgraph G["Group"]',
    '    direction TB',
    '    A["Start<br/>한글"] --> B{Decision?}',
    '  end',
    '  B -- Yes --> C["Done"]',
    '  B -. No .-> D["Retry"]',
    '  classDef hot fill:#ffeeee,stroke:#cc0000,color:#111',
    '  class C hot',
  ].join('\n'),
  state: [
    'stateDiagram-v2',
    '  [*] --> Idle',
    '  state "Working State" as Working',
    '  Idle --> Working : start',
    '  state Parent {',
    '    direction LR',
    '    A --> B',
    '  }',
    '  Working --> [*]',
  ].join('\n'),
  sequence: [
    'sequenceDiagram',
    '  actor U as 사용자',
    '  participant A as App',
    '  Note over U,A: hello<br/>world',
    '  U->>A: request',
    '  A-->>U: response',
  ].join('\n'),
  class: [
    'classDiagram',
    '  class Animal {',
    '    <<abstract>>',
    '    +String name',
    '    +speak() void',
    '  }',
    '  class Dog',
    '  Animal <|-- Dog : inherits',
  ].join('\n'),
  er: [
    'erDiagram',
    '  CUSTOMER {',
    '    int id PK',
    '    string name "display name"',
    '  }',
    '  ORDER {',
    '    int id PK',
    '    int customer_id FK',
    '  }',
    '  CUSTOMER ||--o{ ORDER : places',
  ].join('\n'),
  xychart: [
    'xychart-beta',
    '  title "Sales"',
    '  x-axis [Jan, Feb, Mar]',
    '  y-axis "Count" 0 --> 100',
    '  bar [30, 55, 80]',
    '  line [20, 65, 70]',
  ].join('\n'),
};


// Recorded from the Antigravity 2.15.1 f6b() differential oracle; only hashes are checked in.
const ORACLE_HASHES = Object.freeze({
  light: Object.freeze({
    flowchart: '271cc604b90064291dfa68c452b4dbe588cb20e910b4e96259e207a01dfd96e8',
    state: 'a876f4154f102c337cc1686591f8ce2f5e0b01d4d91eeb879e6ad91656498d83',
    sequence: '4f39ae63ee4461bac25150bd875d80a7e9bbf0e6c11a8dc6fe3fd11a37664cd3',
    class: 'ac8188638ead435ebe4ca91a6030eaa9ce25b684c4b75f3f48d1ae5c9bfc9a42',
    er: '5928a9a6bbbe26b33e4611038caa34aa63e4dd9fe8888e62c780a1715c55989d',
    xychart: '81b8cbe632031f1e089a3d9ff48f07272b354e73b65c8ac1d4b1db2e60cb03de',
  }),
  dark: Object.freeze({
    flowchart: 'c08b8d0e302d3b7b78ac09b676c152e0cfb6aa85b1aedd0234df44c68d80eda2',
    state: 'c3a6ee95c3ae12cdc6d33573319219c5891789ad0dddd29baf040b739456aa03',
    sequence: '60cc8d7edb5a7558c5c0def39b69d7330d4889ca9ba1e92c691b1f6ce45de597',
    class: 'b8616a1fd9b61c39b0a38c073a4afeb8bad4dded72d31f8fd599bef2cde04c9e',
    er: 'c39155f63a58d9dc697d19f3eef48ae1666f838d1463dbc5044df74ad7d9e27c',
    xychart: '89980220527391db7070dd1fb57dd67cc055c78a8b17c4508fef6c1a745eb613',
  }),
});
test('direct renderer exposes the Antigravity 2.15.1 supported type set', () => {
  assert.deepEqual(SUPPORTED_DIAGRAM_TYPES, [
    'flowchart/graph',
    'stateDiagram-v2',
    'sequenceDiagram',
    'classDiagram',
    'erDiagram',
    'xychart-beta',
  ]);
  assert.equal(detectDiagramType(FIXTURES.flowchart), 'flowchart');
  assert.equal(detectDiagramType(FIXTURES.state), 'flowchart');
  assert.equal(detectDiagramType(FIXTURES.sequence), 'sequence');
  assert.equal(detectDiagramType(FIXTURES.class), 'class');
  assert.equal(detectDiagramType(FIXTURES.er), 'er');
  assert.equal(detectDiagramType(FIXTURES.xychart), 'xychart');
});

test('Antigravity text-width heuristic remains deterministic for Latin and CJK', () => {
  assert.ok(Math.abs(measureText('abc', 13, 500) - 24.18) < 1e-9);
  assert.ok(Math.abs(measureText('한글', 13, 500) - 31.59) < 1e-9);
});

test('rounded polyline geometry keeps endpoints and rounds only real corners', () => {
  assert.equal(
    roundedPolylinePath([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ], 4),
    'M 0 0 L 6 0 Q 10 0 10 4 L 10 10'
  );
  assert.equal(
    roundedPolylinePath([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 20, y: 0 },
    ], 4),
    'M 0 0 L 10 0 L 20 0'
  );
});


test('flowchart parser preserves nested groups, edge styles, labels, and class styling', () => {
  const graph = parseFlowchart(FIXTURES.flowchart);
  assert.equal(graph.direction, 'LR');
  assert.equal(graph.subgraphs.length, 1);
  assert.equal(graph.subgraphs[0].direction, 'TB');
  assert.equal(graph.nodes.get('B').shape, 'diamond');
  assert.equal(graph.edges.length, 3);
  assert.equal(graph.edges[1].label, 'Yes');
  assert.equal(graph.edges[2].style, 'dotted');
  assert.equal(graph.classAssignments.get('C'), 'hot');
  assert.equal(graph.classDefs.get('hot').fill, '#ffeeee');
});

test('sequence parser preserves actors, notes, line styles, and labels', () => {
  const sequence = parseSequence(FIXTURES.sequence);
  assert.equal(sequence.actors.length, 2);
  assert.equal(sequence.actors[0].type, 'actor');
  assert.equal(sequence.notes.length, 1);
  assert.equal(sequence.notes[0].text, 'hello\nworld');
  assert.equal(sequence.messages.length, 2);
  assert.equal(sequence.messages[0].lineStyle, 'solid');
  assert.equal(sequence.messages[1].lineStyle, 'dashed');
});

test('all six Antigravity diagram families match oracle output', async () => {
  const expected = {
    flowchart: ['flowchart', 431, 461],
    state: ['state', 423, 422],
    sequence: ['sequence', 280, 222],
    class: ['class', 200, 372],
    er: ['er', 602, 158],
    xychart: ['xychart', 750, 492],
  };

  for (const theme of ['light', 'dark']) {
    for (const [name, source] of Object.entries(FIXTURES)) {
      const result = await renderDiagram(source, { theme });
      const [type, width, height] = expected[name];
      const digest = createHash('sha256').update(result.svg).digest('hex');
      assert.equal(result.type, type, name);
      assert.equal(Math.round(result.layout.width), width, name + ' width');
      assert.equal(Math.round(result.layout.height), height, name + ' height');
      assert.equal(digest, ORACLE_HASHES[theme][name], theme + ' ' + name);
      assert.match(result.svg, /^<svg\b/, name);
      assert.doesNotMatch(result.svg, /mermaid\.esm|foreignObject|flowchart-v2/, name);
    }
  }
});

test('clean-room renderer matches the 466-case Antigravity 2.15.1 corpus', async () => {
  const corpus = JSON.parse(
    await readFile(join(ROOT, 'tests/fixtures/antigravity-diagram-corpus.json'), 'utf8'),
  );
  assert.equal(corpus.oracle, 'Antigravity 2.15.1 f6b()');
  assert.equal(corpus.cases.length, 466);

  for (const item of corpus.cases) {
    const options = {
      ...(item.profile ? corpus.profiles[item.profile] : {}),
      ...(item.options ?? {}),
    };
    if (item.error) {
      await assert.rejects(
        () => renderAntigravityDiagram(item.source, options),
        error => {
          assert.equal(error.message, item.error, item.id);
          if (item.formattedError) {
            assert.equal(renderErrorMessage(error), item.formattedError, item.id);
          }
          return true;
        },
      );
      continue;
    }

    const svg = await renderAntigravityDiagram(item.source, options);
    const digest = createHash('sha256').update(svg).digest('hex');
    assert.equal(digest, item.sha256, item.id);
  }
});

test('dark palette matches Antigravity 2.15.1', async () => {
  const result = await renderDiagram(FIXTURES.flowchart, { theme: 'dark' });
  assert.equal(PALETTES.dark.bg, '#1F1F1F');
  assert.equal(PALETTES.dark.fg, '#CCCCCC');
  assert.equal(PALETTES.dark.accent, '#0078D4');
  assert.equal(PALETTES.dark.surface, '#181818');
  assert.match(result.svg, /--bg:#1F1F1F/);
  assert.match(result.svg, /--accent:#0078D4/);
});

test('vendored ELK 0.9.3 asset is compatibility-pinned by digest', async () => {
  const path = join(ROOT, 'assets/js/vendor/elk.bundled.js');
  const digest = createHash('sha256').update(await readFile(path)).digest('hex');
  assert.equal(digest, 'b0745abd7f23cd91690a1587e377edbe19fd7233c783300290936720546216d4');
});

test('every published Mermaid block renders through the direct renderer', async () => {
  const contentRoot = join(ROOT, 'content');
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const run = promisify(execFile);
  const { stdout } = await run('find', [contentRoot, '-name', '*.md', '-type', 'f']);
  const files = stdout.trim().split('\n').filter(Boolean);
  const fence = String.fromCharCode(96).repeat(3);
  const pattern = new RegExp(fence + 'mermaid\\s*\\n(.*?)\\n' + fence, 'gs');
  let total = 0;
  const types = new Map();

  for (const file of files) {
    const text = await readFile(file, 'utf8');
    for (const match of text.matchAll(pattern)) {
      const source = match[1].trim();
      const result = await renderDiagram(source, { theme: 'light' });
      assert.match(result.svg, /^<svg\b/, file);
      assert.ok(result.layout.width > 0, file);
      assert.ok(result.layout.height > 0, file);
      types.set(result.type, (types.get(result.type) ?? 0) + 1);
      total += 1;
    }
  }

  assert.equal(total, 20);
  assert.deepEqual(Object.fromEntries(types), { flowchart: 18, sequence: 2 });
});
