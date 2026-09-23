const NARROW = new Set("iltfjI1!|.,:;'".split(''));
const WIDE = new Set(['W', 'M']);
const SEMI_WIDE = new Set('wm@%'.split(''));
const PUNCT = new Set(['(', ')', '[', ']', '{', '}', '/', '\\', '-', '"', '`']);
const EMOJI = /[\u{1F300}-\u{1F5FF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F900}-\u{1F9FF}]/u;

export const PALETTES = Object.freeze({
  light: Object.freeze({
    bg: '#FFFFFF',
    fg: '#3B3B3B',
    line: '#3B3B3B',
    accent: '#005FB8',
    muted: '#3B3B3BCC',
    surface: '#F8F8F8',
    border: '#3B3B3B',
  }),
  dark: Object.freeze({
    bg: '#1F1F1F',
    fg: '#CCCCCC',
    line: '#CCCCCC',
    accent: '#0078D4',
    muted: '#CCCCCCCC',
    surface: '#181818',
    border: '#CCCCCC',
  }),
});

export function decodeEntities(value) {
  const entities = {
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&apos;': "'",
  };
  return value.replace(/&amp;|&lt;|&gt;|&quot;|&apos;/g, token => entities[token] ?? token);
}

export function escapeXML(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function cleanLabel(value) {
  let label = value.trim();
  if (label.startsWith('"') && label.endsWith('"')) label = label.slice(1, -1);
  return label
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/\\n/g, '\n')
    .replace(/<\/?(?:sub|sup|small|mark)\s*>/gi, '')
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/(^|[^*])\*([^\s*](?:[^*]*[^\s*])?)\*(?!\*)/g, '$1<i>$2</i>')
    .replace(/~~(.+?)~~/g, '<s>$1</s>');
}

export function stripRichMarkup(value) {
  return value.replace(/<\/?(?:b|strong|i|em|u|s|del)\s*>/gi, '');
}

function isCombining(code) {
  return (
    (code >= 0x0300 && code <= 0x036f) ||
    (code >= 0x1ab0 && code <= 0x1aff) ||
    (code >= 0x1dc0 && code <= 0x1dff) ||
    (code >= 0x20d0 && code <= 0x20ff) ||
    (code >= 0xfe20 && code <= 0xfe2f)
  );
}

function isWideCodePoint(code, character) {
  return (
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2e80 && code <= 0x2eff) ||
    (code >= 0x2f00 && code <= 0x2fdf) ||
    (code >= 0x3000 && code <= 0x303f) ||
    (code >= 0x3040 && code <= 0x309f) ||
    (code >= 0x30a0 && code <= 0x30ff) ||
    (code >= 0x3100 && code <= 0x312f) ||
    (code >= 0x3130 && code <= 0x318f) ||
    (code >= 0x3190 && code <= 0x31ff) ||
    (code >= 0x3200 && code <= 0x33ff) ||
    (code >= 0x3400 && code <= 0x4dbf) ||
    (code >= 0x4e00 && code <= 0x9fff) ||
    (code >= 0xac00 && code <= 0xd7af) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xfff0) ||
    code >= 0x20000 ||
    EMOJI.test(character)
  );
}

export function measureText(value, fontSize, fontWeight = 400) {
  const factor = fontWeight >= 600 ? 0.6 : fontWeight >= 500 ? 0.57 : 0.54;
  let units = 0;
  for (const character of value) {
    const code = character.codePointAt(0);
    let width = 1;
    if (code === undefined || isCombining(code)) width = 0;
    else if (isWideCodePoint(code, character)) width = 2;
    else if (character === ' ') width = 0.3;
    else if (WIDE.has(character)) width = 1.5;
    else if (SEMI_WIDE.has(character)) width = 1.2;
    else if (NARROW.has(character)) width = 0.4;
    else if (PUNCT.has(character)) width = 0.5;
    else if (character === 'r') width = 0.8;
    else if (code >= 65 && code <= 90) width = 1.2;
    units += width;
  }
  return units * fontSize * factor + fontSize * 0.15;
}

export function measureMultiline(value, fontSize, fontWeight = 400) {
  const lines = value.split('\n');
  const lineHeight = fontSize * 1.3;
  let width = 0;
  for (const line of lines) {
    width = Math.max(width, measureText(stripRichMarkup(line), fontSize, fontWeight));
  }
  return { width, height: lines.length * lineHeight, lines, lineHeight };
}

function richSegments(line) {
  const pieces = line.split(/(<\/?(?:b|strong|i|em|u|s|del)>)/gi);
  const state = { bold: false, italic: false, underline: false, strike: false };
  const segments = [];
  for (const piece of pieces) {
    if (!piece) continue;
    const tag = piece.match(/^<\/?([^>]+)>$/i);
    if (tag) {
      const closing = piece.startsWith('</');
      const name = tag[1].toLowerCase();
      if (name === 'b' || name === 'strong') state.bold = !closing;
      else if (name === 'i' || name === 'em') state.italic = !closing;
      else if (name === 'u') state.underline = !closing;
      else if (name === 's' || name === 'del') state.strike = !closing;
      continue;
    }
    segments.push({ text: piece, ...state });
  }
  return segments;
}

function renderRichLine(line) {
  const segments = richSegments(line);
  if (!segments.some(segment => segment.bold || segment.italic || segment.underline || segment.strike)) {
    return escapeXML(line);
  }
  return segments.map(segment => {
    const attrs = [];
    if (segment.bold) attrs.push('font-weight="bold"');
    if (segment.italic) attrs.push('font-style="italic"');
    const decorations = [];
    if (segment.underline) decorations.push('underline');
    if (segment.strike) decorations.push('line-through');
    if (decorations.length) attrs.push('text-decoration="' + decorations.join(' ') + '"');
    return attrs.length
      ? '<tspan ' + attrs.join(' ') + '>' + escapeXML(segment.text) + '</tspan>'
      : escapeXML(segment.text);
  }).join('');
}

export function svgText(value, x, y, fontSize, attrs = '') {
  const lines = value.split('\n');
  if (lines.length === 1) {
    return '<text x="' + x + '" y="' + y + '" ' + attrs + ' dy="' + (fontSize * 0.35) + '">' +
      renderRichLine(value) + '</text>';
  }
  const lineHeight = fontSize * 1.3;
  const firstDy = -((lines.length - 1) / 2) * lineHeight + fontSize * 0.35;
  const tspans = lines.map((line, index) =>
    '<tspan x="' + x + '" dy="' + (index === 0 ? firstDy : lineHeight) + '">' +
      renderRichLine(line) + '</tspan>'
  ).join('');
  return '<text x="' + x + '" y="' + y + '" ' + attrs + '>' + tspans + '</text>';
}

export function svgThemeStyle(font = 'Inter', mono = false) {
  const imports = [
    "@import url('https://fonts.googleapis.com/css2?family=" + encodeURIComponent(font) + ":wght@400;500;600;700&amp;display=swap');",
  ];
  if (mono) {
    imports.push("@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500&amp;display=swap');");
  }
  return '<style>\n  ' + imports.join('\n  ') +
    "\n  text { font-family: '" + font + "', system-ui, sans-serif; }" +
    (mono ? "\n  .mono { font-family: 'JetBrains Mono', 'SF Mono', 'Fira Code', ui-monospace, monospace; }" : '') +
    '\n  svg {' +
    '\n    /* Derived from --bg and --fg (overridable via --line, --accent, etc.) */' +
    '\n    --_text:          var(--fg);' +
    '\n    --_text-sec:      var(--muted, color-mix(in srgb, var(--fg) 60%, var(--bg)));' +
    '\n    --_text-muted:    var(--muted, color-mix(in srgb, var(--fg) 40%, var(--bg)));' +
    '\n    --_text-faint:    color-mix(in srgb, var(--fg) 25%, var(--bg));' +
    '\n    --_line:          var(--line, color-mix(in srgb, var(--fg) 50%, var(--bg)));' +
    '\n    --_arrow:         var(--accent, color-mix(in srgb, var(--fg) 85%, var(--bg)));' +
    '\n    --_node-fill:     var(--surface, color-mix(in srgb, var(--fg) 3%, var(--bg)));' +
    '\n    --_node-stroke:   var(--border, color-mix(in srgb, var(--fg) 20%, var(--bg)));' +
    '\n    --_group-fill:    var(--bg);' +
    '\n    --_group-hdr:     color-mix(in srgb, var(--fg) 5%, var(--bg));' +
    '\n    --_inner-stroke:  color-mix(in srgb, var(--fg) 12%, var(--bg));' +
    '\n    --_key-badge:     color-mix(in srgb, var(--fg) 10%, var(--bg));' +
    '\n  }\n</style>';
}

export function svgOpen(width, height, palette, transparent = false) {
  const vars = [
    '--bg:' + palette.bg,
    '--fg:' + palette.fg,
    palette.line ? '--line:' + palette.line : '',
    palette.accent ? '--accent:' + palette.accent : '',
    palette.muted ? '--muted:' + palette.muted : '',
    palette.surface ? '--surface:' + palette.surface : '',
    palette.border ? '--border:' + palette.border : '',
  ].filter(Boolean).join(';');
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + width + ' ' + height +
    '" width="' + width + '" height="' + height + '" style="' + vars +
    (transparent ? '' : ';background:var(--bg)') + '">';
}

export function parseStyleMap(value) {
  const style = {};
  const cleaned = value.replace(/;\s*$/, '');
  for (const part of cleaned.split(',')) {
    const colon = part.indexOf(':');
    if (colon <= 0) continue;
    const key = part.slice(0, colon).trim();
    const val = part.slice(colon + 1).trim();
    if (key && val) style[key] = val;
  }
  return style;
}
