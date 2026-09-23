const root = document.documentElement;
const themeButton = document.getElementById('theme-toggle');

function syncThemeLabel() {
  themeButton?.setAttribute('aria-label', root.dataset.theme === 'dark' ? '밝은 테마로 전환' : '어두운 테마로 전환');
}

if (themeButton) {
  themeButton.hidden = false;
  syncThemeLabel();
  themeButton.addEventListener('click', () => {
    root.dataset.theme = root.dataset.theme === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem('pref-theme', root.dataset.theme); } catch { /* Keep the in-page preference. */ }
    syncThemeLabel();
  });
  window.addEventListener('storage', (event) => {
    if (event.key === 'pref-theme' && ['light', 'dark'].includes(event.newValue)) {
      root.dataset.theme = event.newValue;
      syncThemeLabel();
    }
  });
}

const toc = document.querySelector('[data-persistent-toc]');
if (toc) {
  const tocPreferenceKey = 'pref-toc-open';
  try {
    const saved = localStorage.getItem(tocPreferenceKey);
    if (saved === 'open') toc.open = true;
    else if (saved === 'closed') toc.open = false;
  } catch { /* Keep the default expanded state. */ }

  toc.addEventListener('toggle', () => {
    try { localStorage.setItem(tocPreferenceKey, toc.open ? 'open' : 'closed'); } catch { /* Keep the in-page preference. */ }
  });

  window.addEventListener('storage', (event) => {
    if (event.key !== tocPreferenceKey) return;
    if (event.newValue === 'open') toc.open = true;
    else if (event.newValue === 'closed') toc.open = false;
  });

  const sections = [...toc.querySelectorAll('a[href^="#"]')].flatMap((link) => {
    try {
      const heading = document.getElementById(decodeURIComponent(link.hash.slice(1)));
      return heading ? [{ link, heading }] : [];
    } catch { return []; }
  });
  let scheduled = false;
  let current;
  const highlight = () => {
    scheduled = false;
    let active = sections[0];
    for (const section of sections) {
      if (section.heading.getBoundingClientRect().top <= 96) active = section;
      else break;
    }
    if (active !== current) {
      current?.link.removeAttribute('aria-current');
      active?.link.setAttribute('aria-current', 'location');
      current = active;
    }
  };
  const scheduleHighlight = () => {
    if (!scheduled) { scheduled = true; requestAnimationFrame(highlight); }
  };
  window.addEventListener('scroll', scheduleHighlight, { passive: true });
  window.addEventListener('resize', scheduleHighlight, { passive: true });
  highlight();
}

for (const button of document.querySelectorAll('[data-print]')) {
  button.hidden = false;
  button.addEventListener('click', () => window.print());
}

for (const code of document.querySelectorAll('.post-content pre > code')) {
  if (code.closest('.lntd')?.querySelector('.lnt')) continue;
  const pre = code.parentElement;
  const header = code.closest('.code-block')?.querySelector('.code-block-header');
  const buttonHost = header ?? pre;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'copy-code';
  button.textContent = '복사';
  button.setAttribute('aria-label', '코드 복사');
  button.setAttribute('aria-live', 'polite');
  buttonHost.append(button);
  let reset;
  button.addEventListener('click', async () => {
    clearTimeout(reset);
    button.disabled = true;
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(code.textContent ?? '');
      button.textContent = '복사됨';
    } catch {
      button.textContent = '직접 선택하여 복사';
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(code);
      selection?.removeAllRanges();
      selection?.addRange(range);
    } finally {
      button.disabled = false;
      reset = setTimeout(() => { button.textContent = '복사'; }, 2500);
    }
  });
}
