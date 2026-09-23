// Optional local browser smoke tests. Run through scripts/check-browser.py.
const assert = (await import('node:assert/strict')).default;
const fs = await import('node:fs/promises');
const path = await import('node:path');

const options = globalThis.blogCheck;
if (!options) throw new Error('Run this suite through scripts/check-browser.py');

const task = await taskSpace(options.spaceId ?? 'Blog browser smoke');
const page = task.page('p1');
const base = options.baseURL;
const posts = (await fs.readFile(
  path.join(options.projectRoot, 'tests/fixtures/published-posts.txt'),
  'utf8',
)).trim().split('\n');
const report = [];
const check = (name, evidence) => {
  report.push({ name, evidence });
  console.log(JSON.stringify({ name, evidence }));
};
const go = async (route) => page.goto(base + route);
const viewport = async (width, height = 900) =>
  page.cdp('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: width < 600,
  });

const injected = await page.cdp('Page.addScriptToEvaluateOnNewDocument', {
  source: `window.__blogErrors=[];addEventListener('error',e=>window.__blogErrors.push(e.message));addEventListener('unhandledrejection',e=>window.__blogErrors.push(String(e.reason)));`,
});

try {
  await viewport(390);
  await go('/');
  const home = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth > innerWidth,
    summaries: document.querySelectorAll('.post-summary').length,
    hasBrand: Boolean(document.querySelector('.site-name')),
    errors: window.__blogErrors,
  }));
  assert.equal(home.overflow, false);
  assert.equal(home.summaries, 0);
  assert.equal(home.hasBrand, true);
  assert.deepEqual(home.errors, []);
  check('home responsive smoke', home);

  await page.evaluate(() => localStorage.removeItem('pref-toc-open'));
  await go(posts[6]);
  assert.equal(await page.evaluate(() => document.querySelector('.toc')?.open), true);
  await page.click('.toc > summary');
  await go(posts[6]);
  assert.equal(await page.evaluate(() => document.querySelector('.toc')?.open), false);
  await page.evaluate(() => localStorage.removeItem('pref-toc-open'));
  check('toc preference persistence', 'passed');

  await viewport(1440);
  await go('/search/');
  await page.waitForFunction(() => document.querySelector('#searchStatus').textContent === '검색어를 입력하세요.');
  await page.fill('#searchInput', '네트워크');
  await page.waitForFunction(() => document.querySelectorAll('#searchResults li').length > 0);
  check('search smoke', await page.evaluate(() => document.querySelector('#searchStatus').textContent));

  let diagrams = 0;
  let alerts = 0;
  for (const route of posts) {
    await go(route);
    await page.waitForFunction(() =>
      [...document.querySelectorAll('pre.diagram-source')].every(
        node => node.querySelector('svg') || !node.closest('.diagram')?.querySelector('.diagram-status')?.hidden,
      ),
    );
    const result = await page.evaluate(() => ({
      source: document.querySelectorAll('pre.diagram-source').length,
      rendered: document.querySelectorAll('pre.diagram-source svg').length,
      alerts: document.querySelectorAll('blockquote.alert').length,
      overflow: document.documentElement.scrollWidth > innerWidth,
      errors: window.__blogErrors,
    }));
    assert.equal(result.source, result.rendered, route);
    assert.equal(result.overflow, false, route);
    assert.deepEqual(result.errors, [], route);
    diagrams += result.source;
    alerts += result.alerts;
  }
  assert.ok(alerts > 0);
  check('article and Markdown smoke', { articles: posts.length, diagrams, alerts });

  await page.evaluate(() => localStorage.setItem('pref-theme', 'light'));
  await go('/posts/google-cloud/gemini-cli-ip-access/');
  await page.waitForFunction(() =>
    document.querySelectorAll('pre.diagram-source').length > 0 &&
    [...document.querySelectorAll('pre.diagram-source')].every(
      node => node.querySelector('svg[data-renderer="antigravity-direct"]'),
    ),
  );
  const diagramUX = await page.evaluate(() => {
    const svg = document.querySelector('pre.diagram-source svg');
    const groups = [...svg.querySelectorAll('g.subgraph')];
    const edges = [...svg.querySelectorAll('.edge')];
    const nodes = [...svg.querySelectorAll('g.node')];
    const headers = groups.filter(group => {
      const rects = [...group.querySelectorAll(':scope > rect')];
      return rects.length === 2 && Number(rects[1].getAttribute('height')) === 28;
    });
    const pathEdges = edges.filter(edge => edge.tagName.toLowerCase() === 'path');
    const roundedEdges = pathEdges.filter(edge => /\bQ\b/.test(edge.getAttribute('d') ?? ''));
    const clippedLabels = nodes.filter(node => {
      const shape = node.querySelector(':scope > rect, :scope > polygon, :scope > circle, :scope > ellipse');
      const text = node.querySelector(':scope > text');
      if (!shape || !text || !text.textContent.trim()) return false;
      const shapeBox = shape.getBBox();
      const textBox = text.getBBox();
      return textBox.x < shapeBox.x - 1 || textBox.y < shapeBox.y - 1 ||
        textBox.x + textBox.width > shapeBox.x + shapeBox.width + 1 ||
        textBox.y + textBox.height > shapeBox.y + shapeBox.height + 1;
    });
    return {
      renderer: svg.dataset.renderer,
      type: svg.dataset.diagramType,
      groups: groups.length,
      headers: headers.length,
      toolbars: document.querySelectorAll('.diagram-toolbar').length,
      diagrams: document.querySelectorAll('pre.diagram-source').length,
      edges: edges.length,
      pathEdges: pathEdges.length,
      roundedEdges: roundedEdges.length,
      clippedLabels: clippedLabels.length,
    };
  });
  assert.equal(diagramUX.renderer, 'antigravity-direct');
  assert.equal(diagramUX.type, 'flowchart');
  assert.ok(diagramUX.groups > 0);
  assert.equal(diagramUX.headers, diagramUX.groups);
  assert.equal(diagramUX.toolbars, diagramUX.diagrams);
  assert.equal(diagramUX.pathEdges, diagramUX.edges);
  assert.ok(diagramUX.roundedEdges > 0);
  assert.equal(diagramUX.clippedLabels, 0);

  await page.evaluate(() => {
    window.__copiedDiagramSource = '';
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async text => { window.__copiedDiagramSource = text; },
      },
    });
  });
  await page.click('.diagram-copy');
  await page.waitForFunction(() => document.querySelector('.diagram-copy')?.textContent === '복사됨');
  const copiedDiagram = await page.evaluate(() => window.__copiedDiagramSource);
  assert.match(copiedDiagram, /^flowchart LR/);
  assert.match(copiedDiagram, /subgraph Allowed/);

  await page.click('.diagram-expand');
  await page.waitForSelector('dialog.diagram-zoom[open]');
  assert.equal(await page.evaluate(() => document.querySelectorAll('dialog.diagram-zoom svg').length), 1);
  await page.press('dialog.diagram-zoom', 'Escape');
  await page.waitForFunction(() => !document.querySelector('dialog.diagram-zoom'));
  assert.equal(await page.evaluate(() => document.activeElement?.classList.contains('diagram-expand')), true);

  const downloading = page.waitForEvent('download', { timeout: 10000 });
  await page.click('.diagram-download');
  const download = await downloading;
  const downloadPath = path.join(options.outputDirectory, 'diagram-download.svg');
  await download.saveAs(downloadPath);
  const downloadedSVG = await fs.readFile(downloadPath, 'utf8');
  assert.match(downloadedSVG, /<svg\b/);
  assert.match(downloadedSVG, /data-renderer="antigravity-direct"/);
  assert.match(downloadedSVG, /--bg:#FFFFFF/);
  assert.match(downloadedSVG, /class="subgraph"/);
  check('direct diagram UX smoke', diagramUX);

  await go(posts[6]);
  await page.evaluate(() => localStorage.setItem('pref-theme', 'light'));
  await go(posts[6]);
  await page.click('#theme-toggle');
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark');
  await go(posts[6]);
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark');
  check('theme persistence', 'passed');

  await go('/posts/gemini-enterprise/01-overview/');
  await page.waitForFunction(() => document.querySelector('iframe')?.contentDocument?.readyState === 'complete');
  assert.ok(await page.evaluate(() => document.querySelector('iframe')?.contentDocument?.title));
  await go('/posts/gemini-enterprise/slides/');
  await page.waitForFunction(() => document.querySelector('#navDots a[aria-current="page"]'));
  await go('/posts/gemini-enterprise/slides/#s22');
  await page.waitForFunction(() => document.querySelector('#navDots a[aria-current="page"]')?.hash === '#s22');
  await page.waitForTimeout(700);
  assert.equal(await page.evaluate(() => document.querySelector('#navDots a[aria-current="page"]')?.hash), '#s22');
  await page.evaluate(() => {
    const link = document.querySelector('#s22 a.link-card');
    link.focus();
    link.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
  });
  await page.waitForTimeout(500);
  assert.equal(await page.evaluate(() => document.querySelector('#navDots a[aria-current="page"]')?.hash), '#s22');
  assert.ok(await page.evaluate(() => document.querySelector('#navDots')));
  check('slides smoke', 'passed');

  for (const route of ['/posts/', '/series/', '/tags/', '/archives/']) {
    await go(route);
    assert.ok(await page.evaluate(() => document.querySelector('main h1')?.textContent), route);
  }
  await go('/about/');
  await page.waitForFunction(() => location.pathname === '/');
  check('navigation smoke', 'passed');

  await fs.writeFile(
    path.join(options.outputDirectory, 'kktae-browser-results.json'),
    JSON.stringify(report, null, 2),
  );
  console.log(`PASS: ${report.length} browser smoke groups`);
} finally {
  await page.evaluate(() => {
    localStorage.setItem('pref-theme', 'light');
    localStorage.removeItem('pref-toc-open');
  }).catch(() => {});
  await page.cdp('Page.removeScriptToEvaluateOnNewDocument', { identifier: injected.identifier });
  await page.cdp('Emulation.clearDeviceMetricsOverride', {});
}
