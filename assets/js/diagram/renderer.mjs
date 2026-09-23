import ELK from '../vendor/elk.bundled.js';
import { decodeEntities, PALETTES } from './common.mjs';
import { renderClassDiagram } from './class.mjs';
import { renderERDiagram } from './er.mjs';
import { renderFlowchart } from './flowchart.mjs';
import { renderSequence } from './sequence.mjs';
import { renderStateDiagram } from './state.mjs';
import { renderXYChart } from './xychart.mjs';

export const SUPPORTED_DIAGRAM_TYPES = Object.freeze([
  'flowchart/graph',
  'stateDiagram-v2',
  'sequenceDiagram',
  'classDiagram',
  'erDiagram',
  'xychart-beta',
]);

const elk = new ELK();

export function detectDiagramType(source) {
  const first = source.trim().split(/[\n;]/)[0]?.trim().toLowerCase() ?? '';
  if (/^xychart(-beta)?\b/.test(first)) return 'xychart';
  if (/^sequencediagram\s*$/.test(first)) return 'sequence';
  if (/^classdiagram\s*$/.test(first)) return 'class';
  if (/^erdiagram\s*$/.test(first)) return 'er';
  return 'flowchart';
}

async function renderAntigravityDetailed(source, options = {}) {
  const decoded = decodeEntities(source);
  const palette = {
    bg: options.bg ?? '#FFFFFF',
    fg: options.fg ?? '#27272A',
    line: options.line,
    accent: options.accent,
    muted: options.muted,
    surface: options.surface,
    border: options.border,
  };
  const shared = {
    palette,
    font: options.font ?? 'Inter',
    transparent: options.transparent ?? false,
    edgeCornerRadius: Math.max(0, Number(options.edgeCornerRadius) || 0),
  };

  const type = detectDiagramType(decoded);
  if (type === 'sequence') return renderSequence(decoded, shared);
  if (type === 'class') return renderClassDiagram(decoded, { ...shared, elk });
  if (type === 'er') return renderERDiagram(decoded, { ...shared, elk });
  if (type === 'xychart') {
    return renderXYChart(decoded, {
      ...shared,
      interactive: options.interactive ?? false,
    });
  }
  const lines = decoded.split('\n').map(line => line.trim()).filter(
    line => line.length > 0 && !line.startsWith('%%'),
  );
  if (/^stateDiagram(-v2)?\s*$/i.test(lines[0] ?? '')) {
    return renderStateDiagram(decoded, { ...shared, elk, layoutOptions: options });
  }
  return renderFlowchart(decoded, { ...shared, elk, layoutOptions: options });
}

export async function renderAntigravityDiagram(source, options = {}) {
  return (await renderAntigravityDetailed(source, { ...options, edgeCornerRadius: 0 })).svg;
}

export async function renderDiagram(source, options = {}) {
  const theme = options.theme === 'dark' ? 'dark' : 'light';
  const palette = { ...PALETTES[theme], ...(options.palette ?? {}) };
  const coreOptions = {
    ...palette,
    font: options.font ?? 'Inter',
    transparent: options.transparent ?? false,
    interactive: options.interactive ?? false,
  };
  for (const key of ['padding', 'nodeSpacing', 'layerSpacing', 'mergeEdges', 'thoroughness', 'edgeCornerRadius']) {
    if (Object.prototype.hasOwnProperty.call(options, key)) coreOptions[key] = options[key];
  }
  return renderAntigravityDetailed(source, coreOptions);
}

export function renderErrorMessage(error) {
  const first = String(error instanceof Error ? error.message : error).split('\n')[0];
  if (first.startsWith('Invalid mermaid header')) {
    return first + '. Supported types: ' + SUPPORTED_DIAGRAM_TYPES.join(', ') + '.';
  }
  return first;
}
