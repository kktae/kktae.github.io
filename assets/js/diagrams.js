import { renderDiagram, renderErrorMessage } from './diagram/renderer.mjs';

const diagrams = [...document.querySelectorAll('pre.diagram-source')].map((node, index) => ({
  node,
  source: node.textContent ?? '',
  index,
  wrapper: node.closest('.diagram'),
  status: node.closest('.diagram').querySelector('.diagram-status'),
}));

const root = document.documentElement;
let running = false;
let requested = false;
let generation = 0;

function themeName() {
  return root.dataset.theme === 'dark' ? 'dark' : 'light';
}

function diagramTitle(diagram) {
  let sibling = diagram.wrapper.previousElementSibling;
  while (sibling) {
    if (/^H[1-6]$/.test(sibling.tagName)) return sibling.textContent.trim();
    sibling = sibling.previousElementSibling;
  }
  return document.querySelector('.post-title, h1')?.textContent?.trim() || '다이어그램';
}

function downloadName(diagram) {
  const slug = location.pathname.split('/').filter(Boolean).at(-1) || 'diagram';
  return slug + '-diagram-' + (diagram.index + 1) + '.svg';
}

function showSource(diagram, message) {
  diagram.wrapper.querySelector('.diagram-toolbar')?.remove();
  diagram.node.textContent = diagram.source;
  diagram.status.textContent = message;
  diagram.status.hidden = false;
}

function parseSVG(source) {
  const parsed = new DOMParser().parseFromString(source, 'image/svg+xml');
  if (parsed.querySelector('parsererror') || parsed.documentElement.localName !== 'svg') {
    throw new Error('Direct renderer returned invalid SVG');
  }
  return document.importNode(parsed.documentElement, true);
}

function openZoom(diagram, svg, trigger) {
  const dialog = document.createElement('dialog');
  dialog.className = 'diagram-zoom';
  dialog.setAttribute('aria-label', diagramTitle(diagram) + ' 확대');

  const header = document.createElement('div');
  header.className = 'diagram-zoom-header';

  const title = document.createElement('span');
  title.className = 'diagram-zoom-title';
  title.textContent = diagramTitle(diagram);

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'diagram-action';
  close.textContent = '닫기';
  close.addEventListener('click', () => dialog.close());

  const canvas = document.createElement('div');
  canvas.className = 'diagram-zoom-canvas';
  canvas.tabIndex = 0;
  canvas.setAttribute('aria-label', '원본 크기 다이어그램 (스크롤 가능)');

  const enlarged = svg.cloneNode(true);
  const width = Number(svg.getAttribute('width')) || svg.viewBox.baseVal.width || svg.getBBox().width;
  enlarged.style.width = Math.ceil(width) + 'px';
  enlarged.style.maxWidth = 'none';
  canvas.append(enlarged);

  header.append(title, close);
  dialog.append(header, canvas);
  document.body.append(dialog);

  dialog.addEventListener('close', () => {
    dialog.remove();
    trigger.focus();
  }, { once: true });
  dialog.addEventListener('click', event => {
    if (event.target === dialog) dialog.close();
  });
  dialog.showModal();
}
async function copyDiagramSource(diagram, button) {
  const original = button.textContent;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(diagram.source);
    } else {
      const textarea = document.createElement('textarea');
      textarea.value = diagram.source;
      textarea.setAttribute('readonly', '');
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.append(textarea);
      textarea.select();
      const copied = document.execCommand('copy');
      textarea.remove();
      if (!copied) throw new Error('Copy command failed');
    }
    button.textContent = '복사됨';
  } catch {
    button.textContent = '복사 실패';
  }
  setTimeout(() => {
    button.textContent = original;
  }, 1500);
}


function addToolbar(diagram, svg) {
  diagram.wrapper.querySelector('.diagram-toolbar')?.remove();

  const toolbar = document.createElement('div');
  toolbar.className = 'diagram-toolbar';

  const format = document.createElement('span');
  format.className = 'diagram-format';
  format.textContent = 'Mermaid';

  const actions = document.createElement('div');
  actions.className = 'diagram-actions';

  const copy = document.createElement('button');
  copy.type = 'button';
  copy.className = 'diagram-action diagram-copy';
  copy.textContent = '코드 복사';
  copy.setAttribute('aria-label', 'Mermaid 코드 복사');
  copy.addEventListener('click', () => copyDiagramSource(diagram, copy));

  const expand = document.createElement('button');
  expand.type = 'button';
  expand.className = 'diagram-action diagram-expand';
  expand.textContent = '확대 보기';
  expand.addEventListener('click', () => openZoom(diagram, svg, expand));

  const download = document.createElement('button');
  download.type = 'button';
  download.className = 'diagram-action diagram-download';
  download.textContent = 'SVG 다운로드';
  download.addEventListener('click', () => {
    const content = new XMLSerializer().serializeToString(svg);
    const url = URL.createObjectURL(new Blob([content], { type: 'image/svg+xml' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = downloadName(diagram);
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  });

  actions.append(copy, expand, download);
  toolbar.append(format, actions);
  diagram.wrapper.append(toolbar);
}

async function renderDiagrams() {
  requested = true;
  if (running) return;
  running = true;

  try {
    while (requested) {
      requested = false;
      const theme = themeName();
      generation += 1;

      for (const diagram of diagrams) {
        try {
          const result = await renderDiagram(diagram.source, {
            theme,
            font: 'Inter',
            interactive: false,
          });
          const svg = parseSVG(result.svg);
          svg.dataset.renderer = 'antigravity-direct';
          svg.dataset.diagramType = result.type;
          svg.setAttribute('role', 'img');
          svg.setAttribute('aria-label', diagramTitle(diagram));
          diagram.node.replaceChildren(svg);
          diagram.node.dataset.rendered = theme;
          diagram.node.dataset.generation = String(generation);
          diagram.node.dataset.diagramType = result.type;
          diagram.status.hidden = true;
          addToolbar(diagram, svg);
        } catch (error) {
          console.error('Diagram rendering error:', error);
          showSource(
            diagram,
            '다이어그램을 표시하지 못해 원문을 보여드립니다. ' + renderErrorMessage(error),
          );
        }
      }
    }
  } finally {
    running = false;
  }
}

async function initializeDiagrams() {
  if (!diagrams.length) return;
  new MutationObserver(renderDiagrams).observe(root, {
    attributes: true,
    attributeFilter: ['data-theme'],
  });
  await renderDiagrams();
}

initializeDiagrams();
