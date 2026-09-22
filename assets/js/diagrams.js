import * as params from '@params';

const diagrams = [...document.querySelectorAll('pre.mermaid')].map((node, index) => ({
  node,
  source: node.textContent ?? '',
  index,
  status: node.closest('.diagram').querySelector('.diagram-status'),
}));
const root = document.documentElement;
let mermaid;
let running = false;
let requested = false;
let generation = 0;

function showSource(diagram, message) {
  diagram.node.textContent = diagram.source;
  diagram.status.textContent = message;
  diagram.status.hidden = false;
}

async function renderDiagrams() {
  requested = true;
  if (running || !mermaid) return;
  running = true;
  try {
    while (requested) {
      requested = false;
      const theme = root.dataset.theme === 'dark' ? 'dark' : 'neutral';
      mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme, layout: 'dagre', look: 'classic' });
      generation += 1;
      for (const diagram of diagrams) {
        try {
          const { svg, bindFunctions } = await mermaid.render(`diagram-${generation}-${diagram.index}`, diagram.source);
          // SVG is produced by Mermaid with its strict sanitization enabled.
          diagram.node.innerHTML = svg;
          bindFunctions?.(diagram.node);
          diagram.status.hidden = true;
          diagram.node.dataset.rendered = theme;
        } catch {
          showSource(diagram, '다이어그램을 표시하지 못해 원문을 보여드립니다.');
        }
      }
    }
  } finally {
    running = false;
  }
}

async function initializeDiagrams() {
  if (!diagrams.length) return;
  try {
    const module = await import(params.mermaidURL);
    mermaid = module.default;
    await document.fonts.ready;
    new MutationObserver(renderDiagrams).observe(root, { attributes: true, attributeFilter: ['data-theme'] });
    await renderDiagrams();
  } catch {
    for (const diagram of diagrams) showSource(diagram, '다이어그램을 불러오지 못했습니다. 아래 원문은 계속 읽을 수 있습니다.');
  }
}

initializeDiagrams();
