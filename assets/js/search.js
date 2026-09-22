import * as params from '@params';
import Fuse from './vendor/fuse.mjs';

const input = document.getElementById('searchInput');
const results = document.getElementById('searchResults');
const status = document.getElementById('searchStatus');
const retry = document.getElementById('searchRetry');
const box = document.getElementById('searchbox');
const settings = params.options ?? {};
let engine;
let composing = false;
let loading = false;

function render() {
  if (!engine || composing) return;
  const query = input.value.trim();
  results.replaceChildren();
  if (!query) {
    status.textContent = '검색어를 입력하세요.';
    return;
  }
  const matches = engine.search(query, { limit: settings.limit ?? 20 });
  status.textContent = matches.length ? `${matches.length}개의 글을 찾았습니다.` : '검색 결과가 없습니다. 다른 키워드로 검색해 보세요.';
  const fragment = document.createDocumentFragment();
  for (const { item } of matches) {
    const row = document.createElement('li');
    const link = document.createElement('a');
    link.href = item.permalink;
    const title = document.createElement('h2');
    title.textContent = item.title;
    const description = document.createElement('p');
    description.textContent = item.summary;
    link.append(title, description);
    row.append(link);
    fragment.append(row);
  }
  results.append(fragment);
}

async function loadIndex() {
  if (loading) return;
  loading = true;
  retry.hidden = true;
  status.textContent = '검색을 준비하고 있습니다.';
  try {
    const response = await fetch(params.indexURL, { signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`Search index: HTTP ${response.status}`);
    const data = await response.json();
    if (!Array.isArray(data)) throw new Error('Invalid search index');
    const entries = data.filter((entry) => {
      if (!entry || typeof entry.title !== 'string' || typeof entry.content !== 'string' || typeof entry.permalink !== 'string') return false;
      try {
        const target = new URL(entry.permalink, location.href);
        return target.origin === location.origin && ['http:', 'https:'].includes(target.protocol);
      } catch { return false; }
    });
    engine = new Fuse(entries, {
      threshold: settings.threshold ?? 0.35,
      ignoreLocation: settings.ignorelocation ?? true,
      minMatchCharLength: settings.minmatchcharlength ?? 1,
      keys: [{ name: 'title', weight: 3 }, { name: 'summary', weight: 2 }, 'content'],
    });
    render(); // A visitor may already have typed while the index was loading.
  } catch {
    status.textContent = '검색을 불러오지 못했습니다. 연결을 확인하고 다시 시도해 주세요.';
    retry.hidden = false;
  } finally {
    loading = false;
  }
}

input.addEventListener('compositionstart', () => { composing = true; });
input.addEventListener('compositionend', () => { composing = false; render(); });
input.addEventListener('input', (event) => { if (!event.isComposing) render(); });
input.addEventListener('search', render);
retry.addEventListener('click', loadIndex);
box.addEventListener('keydown', (event) => {
  if (event.isComposing || composing) return;
  const links = [...results.querySelectorAll('a')];
  const active = document.activeElement;
  if (event.key === 'Escape') {
    event.preventDefault();
    input.value = '';
    render();
    input.focus();
  } else if (event.key === 'ArrowDown' && links.length && (active === input || links.includes(active))) {
    event.preventDefault();
    links[Math.min(links.indexOf(active) + 1, links.length - 1)].focus();
  } else if (event.key === 'ArrowUp' && links.includes(active)) {
    event.preventDefault();
    const previous = links.indexOf(active) - 1;
    (previous < 0 ? input : links[previous]).focus();
  }
});
loadIndex();
