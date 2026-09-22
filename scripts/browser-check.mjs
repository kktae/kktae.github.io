// Optional local UI regression suite; requires the existing ego-browser CLI.
// Start Hugo, then: python3 scripts/check-browser.py
// Existing task space: python3 scripts/check-browser.py --space-id 2
const assert = (await import('node:assert/strict')).default;
const fs = await import('node:fs/promises');
const path = await import('node:path');
const options = globalThis.blogCheck;
if (!options) throw new Error('Run this suite through scripts/check-browser.py');
const task = await taskSpace(options.spaceId ?? 'Blog browser regression');
console.log({ spaceId: task.spaceId });
const page = task.page('p1');
const base = options.baseURL;
const posts = (await fs.readFile(path.join(options.projectRoot, 'tests/fixtures/published-posts.txt'), 'utf8')).trim().split('\n');
const report = [];
const check = (name, evidence) => { report.push({ name, evidence }); console.log(JSON.stringify({ name, evidence })); };
const go = async (route) => { await page.goto(base + route); };
const viewport = async (width, height = 1000) => page.cdp('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 600 });
const capture = async (name) => page.screenshot({ path: path.join(options.outputDirectory, `kktae-${name}.png`) });
const injected = await page.cdp('Page.addScriptToEvaluateOnNewDocument', { source: `window.__blogErrors=[];addEventListener('error',e=>window.__blogErrors.push(e.message));addEventListener('unhandledrejection',e=>window.__blogErrors.push(String(e.reason)));` });
await page.cdp('Network.enable', {});
await page.cdp('Network.setCacheDisabled', { cacheDisabled: true });
try {
  await viewport(1440);
  await go('/');
  await page.evaluate(() => { localStorage.setItem('pref-theme', 'light'); });
  await go('/');
  const home = await page.evaluate(() => {
    const brand = document.querySelector('.site-name');
    const avatar = document.querySelector('.site-avatar');
    return {
      count: document.querySelectorAll('article.post-row').length,
      menus: [...document.querySelectorAll('nav[aria-label="주 메뉴"] a')].map(n=>n.textContent),
      width: document.documentElement.scrollWidth,
      viewport: innerWidth,
      background: getComputedStyle(document.body).backgroundColor,
      brand: { text: brand?.textContent.trim(), avatarWidth: avatar?.getBoundingClientRect().width, avatarHeight: avatar?.getBoundingClientRect().height, avatarSrc: avatar?.currentSrc, targetHeight: brand?.getBoundingClientRect().height },
      hasHomeProfile: Boolean(document.querySelector('.home-profile')),
      recentHeading: document.querySelector('#recent-posts')?.tagName,
      summaryCount: document.querySelectorAll('.post-summary').length,
    };
  });
  assert.equal(home.count, 6);
  assert.deepEqual(home.menus, ['글', '시리즈', '검색']);
  assert.ok(home.width <= home.viewport);
  assert.equal(home.background, 'rgb(255, 255, 255)');
  assert.equal(home.brand.text, 'kktae.io');
  assert.equal(home.brand.avatarWidth, 36);
  assert.equal(home.brand.avatarHeight, 36);
  assert.ok(home.brand.avatarSrc.endsWith('avatar-72.webp'));
  assert.ok(home.brand.targetHeight >= 44);
  assert.equal(home.hasHomeProfile, false);
  assert.equal(home.recentHeading, 'H1');
  assert.equal(home.summaryCount, 0);
  check('desktop home', home);
  await capture('new-home-desktop');
  await go('/posts/');
  const fullListSummaryCount = await page.evaluate(() => document.querySelectorAll('.post-summary').length);
  assert.ok(fullListSummaryCount > 0);
  check('home hides summaries while full post list keeps them', { home: home.summaryCount, posts: fullListSummaryCount });
  await viewport(390, 844);
  await go('/');
  const mobileBrand = await page.evaluate(() => ({ avatarWidth: document.querySelector('.site-avatar').getBoundingClientRect().width, avatarHeight: document.querySelector('.site-avatar').getBoundingClientRect().height }));
  assert.equal(mobileBrand.avatarWidth, 32);
  assert.equal(mobileBrand.avatarHeight, 32);
  check('mobile compact brand', mobileBrand);
  const mobileTargets = await page.evaluate(() => [...document.querySelectorAll('.site-name, nav[aria-label="주 메뉴"] a, #theme-toggle')].map((node) => ({ label: node.textContent?.trim() || node.getAttribute('aria-label'), width: node.getBoundingClientRect().width, height: node.getBoundingClientRect().height })));
  for (const target of mobileTargets) {
    assert.ok(target.width >= 44, `${target.label}: touch target width ${target.width}`);
    assert.ok(target.height >= 44, `${target.label}: touch target height ${target.height}`);
  }
  check('mobile primary-navigation touch targets', mobileTargets);


  await page.evaluate(() => localStorage.removeItem('pref-toc-open'));
  for (const width of [390, 320, 768]) {
    await viewport(width, 844);
    await go(posts[6]);
    const mobile = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth, tocOpen: document.querySelector('.toc').open, tocHeight: document.querySelector('.toc').getBoundingClientRect().height, font: getComputedStyle(document.querySelector('.post-content')).fontSize }));
    assert.equal(mobile.tocOpen, true);
    assert.ok(mobile.tocHeight > 80);
    assert.ok(mobile.scrollWidth <= mobile.width);
    check(`responsive article ${width}`, mobile);
    if (width === 390) await capture('new-article-mobile');
  }

  await viewport(390, 844);
  await go(posts[6]);
  assert.equal(await page.evaluate(() => document.querySelector('.toc').open), true);
  await page.click('.toc > summary');
  await page.waitForFunction(() => document.querySelector('.toc').open === false);
  assert.equal(await page.evaluate(() => localStorage.getItem('pref-toc-open')), 'closed');
  await go(posts[6]);
  assert.equal(await page.evaluate(() => document.querySelector('.toc').open), false);
  await page.click('.toc > summary');
  await page.waitForFunction(() => document.querySelector('.toc').open === true);
  assert.equal(await page.evaluate(() => localStorage.getItem('pref-toc-open')), 'open');
  await go(posts[6]);
  assert.equal(await page.evaluate(() => document.querySelector('.toc').open), true);
  check('table of contents preference persists in localStorage', 'passed');

  await viewport(1440);
  await go('/search/');
  await page.waitForFunction(() => document.querySelector('#searchStatus').textContent === '검색어를 입력하세요.');
  await page.fill('#searchInput', '네트워크');
  const korean = await page.evaluate(() => ({ status: document.querySelector('#searchStatus').textContent, count: document.querySelectorAll('#searchResults li').length }));
  assert.ok(korean.count > 0);
  await page.press('#searchInput', 'ArrowDown');
  assert.equal(await page.evaluate(() => document.activeElement.closest('#searchResults')?.id), 'searchResults');
  await page.press('#searchResults a:focus', 'ArrowUp');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'searchInput');
  await page.fill('#searchInput', 'Envoy');
  assert.ok(await page.evaluate(() => document.querySelector('#searchResults h2').textContent.includes('Envoy')));
  await page.press('#searchInput', 'Escape');
  assert.equal(await page.evaluate(() => document.querySelectorAll('#searchResults li').length), 0);
  await page.fill('#searchInput', 'not-a-real-blog-result-zzzzzzzzzzzz');
  assert.ok(await page.evaluate(() => document.querySelector('#searchStatus').textContent.includes('결과가 없습니다')));
  await page.evaluate(() => {
    const input = document.querySelector('#searchInput');
    input.dispatchEvent(new CompositionEvent('compositionstart'));
    input.value = '네트워크';
    input.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true }));
  });
  assert.equal(await page.evaluate(() => document.querySelectorAll('#searchResults li').length), 0);
  await page.evaluate(() => document.querySelector('#searchInput').dispatchEvent(new CompositionEvent('compositionend')));
  assert.ok(await page.evaluate(() => document.querySelectorAll('#searchResults li').length > 0));
  check('search: Korean, English, empty, no-result, arrows, IME', korean);
  await capture('new-search-desktop');

  const failure = await page.cdp('Page.addScriptToEvaluateOnNewDocument', { source: `const originalFetch=window.fetch.bind(window);let fail=true;window.fetch=(...args)=>{if(String(args[0]).endsWith('index.json')&&fail){fail=false;return Promise.reject(new Error('Deliberate search network test'));}return originalFetch(...args);};` });
  await go('/search/');
  await page.cdp('Page.removeScriptToEvaluateOnNewDocument', { identifier: failure.identifier });
  await page.waitForFunction(() => !document.querySelector('#searchRetry').hidden);
  assert.ok(await page.evaluate(() => document.querySelector('#searchStatus').textContent.includes('불러오지 못했습니다')));
  await page.click('#searchRetry');
  await page.waitForFunction(() => document.querySelector('#searchStatus').textContent === '검색어를 입력하세요.');
  await page.fill('#searchInput', 'PSC');
  assert.ok(await page.evaluate(() => document.querySelectorAll('#searchResults li').length > 0));
  check('search: network failure and retry', 'passed');

  const delayed = await page.cdp('Page.addScriptToEvaluateOnNewDocument', { source: `const originalFetch=window.fetch.bind(window);window.fetch=(...args)=>String(args[0]).endsWith('index.json')?new Promise((resolve,reject)=>{window.__releaseIndex=()=>originalFetch(...args).then(resolve,reject);}):originalFetch(...args);` });
  await go('/search/');
  await page.cdp('Page.removeScriptToEvaluateOnNewDocument', { identifier: delayed.identifier });
  await page.fill('#searchInput', 'Gemini');
  await page.evaluate(() => window.__releaseIndex());
  await page.waitForFunction(() => document.querySelectorAll('#searchResults li').length > 0);
  assert.ok(await page.evaluate(() => document.querySelector('#searchResults h2').textContent.includes('Gemini')));
  check('search: input before index arrives', 'passed');

  let totalDiagrams = 0;
  for (const route of posts) {
    await go(route);
    await page.waitForFunction(() => [...document.querySelectorAll('pre.mermaid')].every(n => n.querySelector('svg') || !n.closest('.diagram').querySelector('.diagram-status').hidden));
    const result = await page.evaluate(() => ({ diagrams: document.querySelectorAll('pre.mermaid').length, rendered: document.querySelectorAll('pre.mermaid svg').length, errors: window.__blogErrors, statuses: [...document.querySelectorAll('.diagram-status:not([hidden])')].map(n=>n.textContent), overflow: document.documentElement.scrollWidth > innerWidth }));
    assert.equal(result.diagrams, result.rendered, route);
    assert.deepEqual(result.errors, [], route);
    assert.deepEqual(result.statuses, [], route);
    assert.equal(result.overflow, false, route);
    totalDiagrams += result.diagrams;
  }
  assert.equal(totalDiagrams, 12);
  check('all articles and Mermaid diagrams', { articles: posts.length, diagrams: totalDiagrams, errors: 0 });

  await go(posts[6]);
  await page.waitForFunction(() => [...document.querySelectorAll('pre.mermaid')].every(n=>n.dataset.rendered==='neutral'));
  await capture('new-article-desktop');
  await page.click('#theme-toggle');
  await page.waitForFunction(() => [...document.querySelectorAll('pre.mermaid')].every(n=>n.dataset.rendered==='dark'));
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark');
  await capture('new-article-dark');
  check('Mermaid rerenders after theme toggle', 'passed');

  await page.evaluate(() => {
    document.querySelector('.copy-code').dataset.testCopy = 'true';
    navigator.clipboard.writeText = async (text) => { window.__copiedCode = text; };
  });
  await page.click('[data-test-copy]');
  assert.equal(await page.evaluate(() => document.querySelector('[data-test-copy]').textContent), '복사됨');
  assert.ok(await page.evaluate(() => window.__copiedCode.length > 0));
  await page.evaluate(() => { navigator.clipboard.writeText = async () => { throw new Error('Deliberate denied clipboard'); }; });
  await page.click('[data-test-copy]');
  assert.equal(await page.evaluate(() => document.querySelector('[data-test-copy]').textContent), '직접 선택하여 복사');
  assert.ok(await page.evaluate(() => getSelection().toString().length > 0));
  check('clipboard success and denied-permission UI', 'passed with simulated browser API; user clipboard unchanged');

  await page.cdp('Emulation.setEmulatedMedia', { media: 'print' });
  const print = await page.evaluate(() => ({ header: getComputedStyle(document.querySelector('.site-header')).display, toc: getComputedStyle(document.querySelector('.article-toc')).display, background: getComputedStyle(document.body).backgroundColor, width: document.querySelector('.post-content').getBoundingClientRect().width, codeColor: getComputedStyle(document.querySelector('.chroma')).color, diagramFilter: getComputedStyle(document.querySelector('.diagram svg')).filter }));
  assert.equal(print.header, 'none');
  assert.equal(print.toc, 'none');
  assert.equal(print.background, 'rgb(255, 255, 255)');
  assert.equal(print.codeColor, 'rgb(17, 17, 17)');
  assert.equal(print.diagramFilter, 'invert(1) grayscale(1)');
  check('print stylesheet', print);
  await page.cdp('Emulation.setEmulatedMedia', { media: '' });

  await page.cdp('Network.setBlockedURLs', { urls: ['*mermaid@*'] });
  await go(posts[6]);
  await page.waitForFunction(() => [...document.querySelectorAll('.diagram-status')].every(n => !n.hidden));
  assert.ok(await page.evaluate(() => [...document.querySelectorAll('pre.mermaid')].every(n => n.textContent.trim().length > 20 && !n.querySelector('svg'))));
  check('Mermaid CDN failure preserves readable source', 'passed');
  await page.cdp('Network.setBlockedURLs', { urls: [] });

  await go(posts[9]);
  await page.waitForFunction(() => document.querySelector('iframe')?.contentDocument?.readyState === 'complete');
  const slides = await page.evaluate(() => ({ title: document.querySelector('iframe').contentDocument.title, url: document.querySelector('iframe').contentWindow.location.pathname, text: document.querySelector('iframe').contentDocument.body.innerText.slice(0,120) }));
  assert.ok(slides.title);
  assert.equal(slides.url, '/posts/gemini-enterprise/slides/');
  check('existing slide iframe', slides);
  await go('/posts/gemini-enterprise/slides/');
  await page.waitForFunction(() => document.querySelector('#navDots a[aria-current="page"]'));
  const slideA11y = await page.evaluate(() => ({
    navTag: document.querySelector('#navDots').tagName,
    navLabel: document.querySelector('#navDots').getAttribute('aria-label'),
    current: document.querySelector('#navDots a[aria-current="page"]')?.hash,
    dots: [...document.querySelectorAll('#navDots a')].map((dot) => ({ label: dot.getAttribute('aria-label'), width: dot.getBoundingClientRect().width, height: dot.getBoundingClientRect().height })),
    video: { paused: document.querySelector('[data-motion-video]').paused, sources: [...document.querySelectorAll('[data-motion-video] source')].map((source) => source.type) },
  }));
  assert.equal(slideA11y.navTag, 'NAV');
  assert.equal(slideA11y.navLabel, '슬라이드 이동');
  assert.equal(slideA11y.current, '#s1');
  assert.ok(slideA11y.dots.every((dot) => dot.label && dot.width >= 24 && dot.height >= 24));
  assert.deepEqual(slideA11y.video.sources, ['video/mp4']);
  check('standalone slides accessible navigation and optimized video', slideA11y);
  await page.press('body', 'ArrowRight');
  await page.waitForFunction(() => document.querySelector('#navDots a.active')?.hash === '#s2');
  await page.waitForTimeout(500);
  await page.press('body', 'ArrowLeft');
  await page.waitForFunction(() => document.querySelector('#navDots a.active')?.hash === '#s1');
  check('standalone slides keyboard navigation', 'passed');
  await page.cdp('Emulation.setEmulatedMedia', { media: 'screen', features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await go('/posts/gemini-enterprise/slides/');
  await page.waitForFunction(() => document.querySelector('[data-motion-video]')?.paused === true);
  const reducedMotion = await page.evaluate(() => ({ paused: document.querySelector('[data-motion-video]').paused, animationDuration: getComputedStyle(document.querySelector('.brand-mark')).animationDuration }));
  assert.equal(reducedMotion.paused, true);
  assert.ok(parseFloat(reducedMotion.animationDuration) <= 0.001);
  check('standalone slides reduced-motion behavior', reducedMotion);
  await page.cdp('Emulation.setEmulatedMedia', { media: 'screen', features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });

  for (const route of ['/posts/', '/series/', '/series/psa/psc-guide/', '/series/gemini-enterprise/', '/tags/', '/archives/']) {
    await go(route);
    assert.ok(await page.evaluate(() => document.querySelector('main h1')?.textContent));
    assert.deepEqual(await page.evaluate(() => window.__blogErrors), [], route);
  }
  check('navigation pages', '6 routes passed');
  await go('/about/');
  await page.waitForFunction(() => location.pathname === '/');
  assert.equal(await page.evaluate(() => location.pathname), '/');
  check('legacy about URL redirects home', 'passed');
  await go('/');
  await page.evaluate(() => { localStorage.setItem('pref-theme', 'light'); });
  await go('/');
  check('theme persistence and reset for preview', await page.evaluate(() => document.documentElement.dataset.theme));
  await fs.writeFile(path.join(options.outputDirectory, 'kktae-browser-results.json'), JSON.stringify(report, null, 2));
  console.log(`PASS: ${report.length} browser scenario groups`);
} finally {
  await page.cdp('Page.removeScriptToEvaluateOnNewDocument', { identifier: injected.identifier });
  await page.cdp('Network.setBlockedURLs', { urls: [] });
  await page.cdp('Network.setCacheDisabled', { cacheDisabled: false });
  await page.cdp('Emulation.setEmulatedMedia', { media: '' });
  await page.cdp('Emulation.clearDeviceMetricsOverride', {});
}
