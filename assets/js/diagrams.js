import * as params from '@params';
import { decorate } from './mermaid-geometry.mjs';

const diagrams = [...document.querySelectorAll('pre.mermaid')].map((node, index) => ({
  node,
  source: node.textContent ?? '',
  index,
  wrapper: node.closest('.diagram'),
  status: node.closest('.diagram').querySelector('.diagram-status'),
}));

const root = document.documentElement;
let mermaid;
let running = false;
let requested = false;
let generation = 0;
let svgCSS;

const palettes = {
  light: {
    primaryColor: '#ffffff',
    secondaryColor: '#ffffff',
    tertiaryColor: '#ffffff',
    primaryTextColor: '#3b3b3b',
    primaryBorderColor: '#3b3b3b',
    lineColor: '#3b3b3b',
    clusterBkg: '#ffffff',
    clusterBorder: '#3b3b3b',
    edgeLabelBackground: '#ffffff',
    arrowheadColor: '#005fb8',
    actorBkg: '#ffffff',
    actorBorder: '#3b3b3b',
    actorTextColor: '#3b3b3b',
    actorLineColor: '#3b3b3b',
    signalColor: '#005fb8',
    signalTextColor: '#3b3b3b',
    labelBoxBkgColor: '#ffffff',
    labelBoxBorderColor: '#3b3b3b',
    labelTextColor: '#3b3b3b',
    noteBkgColor: '#ffffff',
    noteBorderColor: '#3b3b3b',
    noteTextColor: '#3b3b3b',
    sequenceNumberColor: '#ffffff',
    sequenceNumberBkgColor: '#005fb8',
  },
  dark: {
    primaryColor: '#202020',
    secondaryColor: '#202020',
    tertiaryColor: '#202020',
    primaryTextColor: '#e5e5e5',
    primaryBorderColor: '#d4d4d4',
    lineColor: '#d4d4d4',
    clusterBkg: '#202020',
    clusterBorder: '#d4d4d4',
    edgeLabelBackground: '#202020',
    arrowheadColor: '#58a6ff',
    actorBkg: '#202020',
    actorBorder: '#d4d4d4',
    actorTextColor: '#e5e5e5',
    actorLineColor: '#d4d4d4',
    signalColor: '#58a6ff',
    signalTextColor: '#e5e5e5',
    labelBoxBkgColor: '#202020',
    labelBoxBorderColor: '#d4d4d4',
    labelTextColor: '#e5e5e5',
    noteBkgColor: '#202020',
    noteBorderColor: '#d4d4d4',
    noteTextColor: '#e5e5e5',
    sequenceNumberColor: '#202020',
    sequenceNumberBkgColor: '#58a6ff',
  },
};

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
  return `${slug}-diagram-${diagram.index + 1}.svg`;
}

function showSource(diagram, message) {
  diagram.wrapper.querySelector('.diagram-toolbar')?.remove();
  diagram.node.textContent = diagram.source;
  diagram.status.textContent = message;
  diagram.status.hidden = false;
}

function themedClone(svg) {
  const clone = svg.cloneNode(true);
  clone.classList.toggle('mermaid-theme-dark', themeName() === 'dark');
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  return clone;
}

async function serializedSVG(svg) {
  const clone = themedClone(svg);
  const style = document.createElementNS('http://www.w3.org/2000/svg', 'style');
  style.textContent = svgCSS;
  clone.prepend(style);
  return new XMLSerializer().serializeToString(clone);
}

function openZoom(diagram, svg, trigger) {
  const dialog = document.createElement('dialog');
  dialog.className = 'diagram-zoom';
  dialog.setAttribute('aria-label', `${diagramTitle(diagram)} 확대`);

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

  const enlarged = themedClone(svg);
  const width = Math.ceil(svg.viewBox.baseVal.width || svg.getBBox().width);
  enlarged.style.width = `${width}px`;
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

function addToolbar(diagram, svg) {
  diagram.wrapper.querySelector('.diagram-toolbar')?.remove();

  const toolbar = document.createElement('div');
  toolbar.className = 'diagram-toolbar';

  const format = document.createElement('span');
  format.className = 'diagram-format';
  format.textContent = 'SVG';

  const actions = document.createElement('div');
  actions.className = 'diagram-actions';

  const expand = document.createElement('button');
  expand.type = 'button';
  expand.className = 'diagram-action diagram-expand';
  expand.textContent = '확대 보기';
  expand.addEventListener('click', () => openZoom(diagram, svg, expand));

  const download = document.createElement('button');
  download.type = 'button';
  download.className = 'diagram-action diagram-download';
  download.textContent = 'SVG 다운로드';
  download.addEventListener('click', async () => {
    const content = await serializedSVG(svg);
    const url = URL.createObjectURL(new Blob([content], { type: 'image/svg+xml' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = downloadName(diagram);
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  });

  actions.append(expand, download);
  toolbar.append(format, actions);
  diagram.wrapper.append(toolbar);
}

async function renderDiagrams() {
  requested = true;
  if (running || !mermaid) return;
  running = true;
  try {
    while (requested) {
      requested = false;
      const theme = themeName();
      const diagramFont = getComputedStyle(document.body).fontFamily;
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        suppressErrorRendering: true,
        theme: 'base',
        layout: 'elk',
        flowchart: {
          defaultRenderer: 'elk',
          curve: 'linear',
          htmlLabels: true,
          nodeSpacing: 40,
          rankSpacing: 60,
          subGraphTitleMargin: { top: 4, bottom: 16 },
        },
        sequence: {
          rightAngles: true,
          actorFontSize: 13,
          noteFontSize: 13,
          messageFontSize: 13,
        },
        fontFamily: diagramFont,
        themeVariables: {
          ...palettes[theme],
          fontFamily: diagramFont,
          fontSize: '13px',
        },
      });

      generation += 1;
      for (const diagram of diagrams) {
        try {
          const { svg, bindFunctions } = await mermaid.render(
            `diagram-${generation}-${diagram.index}`,
            diagram.source,
          );
          const parsed = new DOMParser().parseFromString(svg, 'text/html');
          const parsedSVG = parsed.querySelector('svg');
          if (!parsedSVG) throw new Error('Mermaid returned invalid SVG');
          const rendered = document.importNode(parsedSVG, true);
          diagram.node.replaceChildren(rendered);
          if (!rendered) throw new Error('Mermaid returned no SVG');
          decorate(rendered);
          rendered.classList.toggle('mermaid-theme-dark', theme === 'dark');
          rendered.setAttribute('aria-label', diagramTitle(diagram));
          bindFunctions?.(diagram.node);
          diagram.status.hidden = true;
          diagram.node.dataset.rendered = theme;
          addToolbar(diagram, rendered);
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
    const [mermaidModule, elkModule, cssResponse] = await Promise.all([
      import(params.mermaidURL),
      import(params.mermaidElkURL),
      fetch(params.mermaidCSSURL),
    ]);
    if (!cssResponse.ok) throw new Error('Mermaid stylesheet unavailable');
    svgCSS = await cssResponse.text();
    mermaid = mermaidModule.default;
    mermaid.registerLayoutLoaders(elkModule.default);
    await document.fonts.ready;
    new MutationObserver(renderDiagrams).observe(root, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
    await renderDiagrams();
  } catch {
    for (const diagram of diagrams) {
      showSource(diagram, '다이어그램을 불러오지 못했습니다. 아래 원문은 계속 읽을 수 있습니다.');
    }
  }
}

initializeDiagrams();
