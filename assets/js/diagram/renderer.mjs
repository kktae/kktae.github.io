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
  if (/^statediagram(-v2)?\s*$/.test(first)) return 'state';
  return 'flowchart';
}

export async function renderDiagram(source, options = {}) {
  const decoded = decodeEntities(source);
  const theme = options.theme === 'dark' ? 'dark' : 'light';
  const palette = { ...PALETTES[theme], ...(options.palette ?? {}) };
  const shared = {
    palette,
    font: options.font ?? 'Inter',
    transparent: options.transparent ?? false,
  };

  const type = detectDiagramType(decoded);
  if (type === 'sequence') return renderSequence(decoded, shared);
  if (type === 'class') return renderClassDiagram(decoded, { ...shared, elk });
  if (type === 'er') return renderERDiagram(decoded, { ...shared, elk });
  if (type === 'xychart') {
    return renderXYChart(decoded, { ...shared, interactive: options.interactive ?? false });
  }
  if (type === 'state') return renderStateDiagram(decoded, { ...shared, elk });
  return renderFlowchart(decoded, { ...shared, elk });
}

export function renderErrorMessage(error) {
  const first = String(error instanceof Error ? error.message : error).split('\n')[0];
  if (first.startsWith('Invalid diagram header')) {
    return first + '. Supported types: ' + SUPPORTED_DIAGRAM_TYPES.join(', ') + '.';
  }
  return first;
}
