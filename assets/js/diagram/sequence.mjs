import {
  cleanLabel,
  escapeXML,
  measureMultiline,
  measureText,
  svgOpen,
  svgText,
  svgThemeStyle,
} from './common.mjs';
import { svgPolyline } from './geometry.mjs';

function ensureActor(model, ids, id) {
  if (ids.has(id)) return;
  ids.add(id);
  model.actors.push({ id, label: id, type: 'participant' });
}

export function parseSequence(source) {
  const lines = source.split('\n').map(line => line.trim()).filter(line => line && !line.startsWith('%%'));

  const model = { type: 'sequence', actors: [], messages: [], blocks: [], notes: [] };
  const actorIds = new Set();
  const blockStack = [];

  for (const line of lines.slice(1)) {
    let match = line.match(/^(participant|actor)\s+(\S+?)(?:\s+as\s+(.+))?$/);
    if (match) {
      const type = match[1];
      const id = match[2];
      const label = cleanLabel(match[3]?.trim() ?? id);
      if (!actorIds.has(id)) {
        actorIds.add(id);
        model.actors.push({ id, label, type });
      }
      continue;
    }

    if (/^autonumber\s*$/i.test(line)) continue;

    match = line.match(/^Note\s+(left of|right of|over)\s+([^:]+):\s*(.+)$/i);
    if (match) {
      const positionText = match[1].toLowerCase();
      const actors = match[2].trim().split(',').map(value => value.trim());
      for (const id of actors) ensureActor(model, actorIds, id);
      const position = positionText === 'left of' ? 'left' : positionText === 'right of' ? 'right' : 'over';
      model.notes.push({
        actorIds: actors,
        text: cleanLabel(match[3].trim()),
        position,
        afterIndex: model.messages.length - 1,
      });
      continue;
    }

    match = line.match(/^(loop|alt|opt|par|critical|break|rect)\s*(.*)$/);
    if (match) {
      blockStack.push({
        type: match[1],
        label: cleanLabel(match[2]?.trim() ?? ''),
        startIndex: model.messages.length,
        dividers: [],
      });
      continue;
    }

    match = line.match(/^(else|and)\s*(.*)$/);
    if (match && blockStack.length) {
      blockStack[blockStack.length - 1].dividers.push({
        index: model.messages.length,
        label: cleanLabel(match[2]?.trim() ?? ''),
      });
      continue;
    }

    if (line === 'end' && blockStack.length) {
      const block = blockStack.pop();
      model.blocks.push({
        ...block,
        endIndex: Math.max(model.messages.length - 1, block.startIndex),
      });
      continue;
    }

    // Covers Mermaid sequence arrows used by Antigravity, including activation
    // suffixes placed before the target actor.
    match = line.match(/^(\S+?)\s*(--?>?>|--?[)x]|--?>>|--?>)\s*([+-]?)(\S+?)\s*:\s*(.+)$/);
    if (!match) {
      match = line.match(/^(\S+?)\s*(->>|-->|-\)|--\)|-x|--x|->|-->)\s*([+-]?)(\S+?)\s*:\s*(.+)$/);
    }
    if (!match) continue;

    const from = match[1];
    const token = match[2];
    const activation = match[3];
    const to = match[4];
    const label = cleanLabel(match[5].trim());
    ensureActor(model, actorIds, from);
    ensureActor(model, actorIds, to);

    const message = {
      from,
      to,
      label,
      lineStyle: token.startsWith('--') ? 'dashed' : 'solid',
      arrowHead: token.includes('>>') || token.includes('x') ? 'filled' : 'open',
    };
    if (activation === '+') message.activate = true;
    if (activation === '-') message.deactivate = true;
    model.messages.push(message);
  }

  while (blockStack.length) {
    const block = blockStack.pop();
    model.blocks.push({
      ...block,
      endIndex: Math.max(model.messages.length - 1, block.startIndex),
    });
  }
  return model;
}

export function layoutSequence(model) {
  if (!model.actors.length) {
    return { width: 0, height: 0, actors: [], lifelines: [], messages: [], activations: [], blocks: [], notes: [] };
  }

  const widths = model.actors.map(actor => Math.max(measureText(actor.label, 13, 500) + 32, 80));
  const actorOffsets = model.actors.map(actor =>
    actor.type === 'actor' ? 54 + measureMultiline(actor.label, 13, 500).height / 2 : 40
  );
  const maxActorOffset = Math.max(...actorOffsets);

  const positions = [];
  let cursor = 30 + widths[0] / 2;
  for (let index = 0; index < model.actors.length; index += 1) {
    if (index > 0) cursor += Math.max(140, (widths[index - 1] + widths[index]) / 2 + 40);
    positions.push(cursor);
  }

  const actorIndex = new Map(model.actors.map((actor, index) => [actor.id, index]));
  const actors = model.actors.map((actor, index) => ({
    id: actor.id,
    label: actor.label,
    type: actor.type,
    x: positions[index],
    y: 30,
    width: widths[index],
    height: 40,
  }));

  let y = 30 + maxActorOffset + 20;
  const messages = [];
  const blockSpacing = new Map();
  for (const block of model.blocks) {
    blockSpacing.set(block.startIndex, Math.max(blockSpacing.get(block.startIndex) ?? 0, 28));
    for (const divider of block.dividers) {
      blockSpacing.set(divider.index, Math.max(blockSpacing.get(divider.index) ?? 0, 24));
    }
  }

  const notesAfter = new Map();
  for (const note of model.notes) {
    if (!notesAfter.has(note.afterIndex)) notesAfter.set(note.afterIndex, []);
    notesAfter.get(note.afterIndex).push(note);
  }

  const notes = [];
  const active = new Map();
  const activations = [];

  for (let index = 0; index < model.messages.length; index += 1) {
    const source = model.messages[index];
    const fromIndex = actorIndex.get(source.from) ?? 0;
    const toIndex = actorIndex.get(source.to) ?? 0;
    const self = source.from === source.to;
    const before = blockSpacing.get(index) ?? 0;
    if (before > 0) y += before;

    messages.push({
      from: source.from,
      to: source.to,
      label: source.label,
      lineStyle: source.lineStyle,
      arrowHead: source.arrowHead,
      x1: positions[fromIndex],
      x2: positions[toIndex],
      y,
      isSelf: self,
    });

    if (source.activate) {
      if (!active.has(source.to)) active.set(source.to, []);
      const stack = active.get(source.to);
      stack.push({ startY: y, depth: stack.length });
    }

    if (source.deactivate) {
      const stack = active.get(source.from);
      if (stack?.length) {
        const activation = stack.pop();
        const actorPosition = positions[actorIndex.get(source.from) ?? 0];
        activations.push({
          actorId: source.from,
          x: actorPosition - 5 + activation.depth * 4,
          topY: activation.startY,
          bottomY: y,
          width: 10,
        });
      }
    }

    y += self ? 70 : 40;

    const pendingNotes = notesAfter.get(index);
    if (pendingNotes?.length) {
      let noteY = messages[index].y + (self ? 30 : 0) + 8;
      for (const note of pendingNotes) {
        const width = Math.max(60, measureText(note.text, 11, 400) + 24);
        const first = actorIndex.get(note.actorIds[0] ?? '') ?? 0;
        let x;
        if (note.position === 'left') {
          x = positions[first] - widths[first] / 2 - width - 10;
        } else if (note.position === 'right') {
          x = positions[first] + widths[first] / 2 + 10;
        } else if (note.actorIds.length > 1) {
          const last = actorIndex.get(note.actorIds[note.actorIds.length - 1] ?? '') ?? first;
          x = (positions[first] + positions[last]) / 2 - width / 2;
        } else {
          x = positions[first] - width / 2;
        }
        notes.push({
          text: note.text,
          x,
          y: noteY,
          width,
          height: 23,
          position: note.position,
          actors: note.actorIds,
        });
        noteY += 27;
        y = Math.max(y, noteY + 20);
      }
    }
  }

  for (const [actorId, stack] of active) {
    for (const activation of stack) {
      const actorPosition = positions[actorIndex.get(actorId) ?? 0];
      activations.push({
        actorId,
        x: actorPosition - 5 + activation.depth * 4,
        topY: activation.startY,
        bottomY: y - 20,
        width: 10,
      });
    }
  }

  const blocks = model.blocks.map(block => {
    const top = (messages[block.startIndex]?.y ?? y) - 40;
    const bottom = (messages[block.endIndex]?.y ?? y) + 20;
    const actorSet = new Set();
    for (let index = block.startIndex; index <= block.endIndex; index += 1) {
      const message = model.messages[index];
      if (!message) continue;
      actorSet.add(actorIndex.get(message.from) ?? 0);
      actorSet.add(actorIndex.get(message.to) ?? 0);
    }
    if (!actorSet.size) {
      for (let index = 0; index < model.actors.length; index += 1) actorSet.add(index);
    }

    const minIndex = Math.min(...actorSet);
    const maxIndex = Math.max(...actorSet);
    const x = positions[minIndex] - widths[minIndex] / 2 - 10;
    const right = positions[maxIndex] + widths[maxIndex] / 2 + 10;
    const dividers = block.dividers.map(divider => {
      const message = messages[divider.index];
      const dividerY = message?.y ?? y;
      let spacing = 28;
      if (divider.label && message?.label) {
        const dividerWidth = measureText('[' + divider.label + ']', 11, 400);
        const dividerStart = x + 8;
        const dividerEnd = dividerStart + dividerWidth;
        const messageWidth = measureText(message.label, 11, 400);
        const messageStart = message.isSelf
          ? message.x1 + 36
          : (message.x1 + message.x2) / 2 - messageWidth / 2;
        if (dividerEnd > messageStart && dividerStart < messageStart + messageWidth) spacing = 36;
      }
      return { y: dividerY - spacing, label: divider.label };
    });
    return {
      type: block.type,
      label: block.label,
      x,
      y: top,
      width: right - x,
      height: bottom - top,
      dividers,
    };
  });

  const height = y + 30;
  let left = 30;
  let right = 0;
  for (const actor of actors) {
    left = Math.min(left, actor.x - actor.width / 2);
    right = Math.max(right, actor.x + actor.width / 2);
  }
  for (const block of blocks) {
    left = Math.min(left, block.x);
    right = Math.max(right, block.x + block.width);
    for (const divider of block.dividers) {
      if (divider.label) {
        const start = block.x + 8;
        left = Math.min(left, start);
        right = Math.max(right, start + measureText('[' + divider.label + ']', 11, 400));
      }
    }
  }
  for (const note of notes) {
    left = Math.min(left, note.x);
    right = Math.max(right, note.x + note.width);
  }
  for (const message of messages) {
    if (message.isSelf && message.label) {
      right = Math.max(right, message.x1 + 46 + measureText(message.label, 11, 400));
    }
    if (message.label) {
      const width = measureText(message.label, 11, 400);
      const start = message.isSelf ? message.x1 + 36 : (message.x1 + message.x2) / 2 - width / 2;
      left = Math.min(left, start);
      right = Math.max(right, start + width);
    }
  }

  const shift = left < 30 ? 30 - left : 0;
  if (shift > 0) {
    for (const actor of actors) actor.x += shift;
    for (const message of messages) {
      message.x1 += shift;
      message.x2 += shift;
    }
    for (const activation of activations) activation.x += shift;
    for (const block of blocks) block.x += shift;
    for (const note of notes) note.x += shift;
    for (let index = 0; index < positions.length; index += 1) positions[index] += shift;
  }

  const lifelines = model.actors.map((actor, index) => ({
    actorId: actor.id,
    x: positions[index],
    topY: 30 + actorOffsets[index],
    bottomY: height - 30,
  }));

  return {
    width: Math.max(right + shift + 30, 200),
    height: Math.max(height, 100),
    actors,
    lifelines,
    messages,
    activations,
    blocks,
    notes,
  };
}

export function renderSequenceLayout(layout, palette, options = {}) {
  const font = options.font ?? 'Inter';
  const transparent = options.transparent ?? false;
  const edgeCornerRadius = Math.max(0, Number(options.edgeCornerRadius) || 0);
  const lines = [svgOpen(layout.width, layout.height, palette, transparent), svgThemeStyle(font, false), '<defs>'];
  lines.push(
    '  <marker id="seq-arrow" markerWidth="8" markerHeight="5" refX="8" refY="2.5" orient="auto-start-reverse">\n' +
    '    <polygon points="0 0, 8 2.5, 0 5" fill="var(--_arrow)" />\n' +
    '  </marker>\n' +
    '  <marker id="seq-arrow-open" markerWidth="8" markerHeight="5" refX="8" refY="2.5" orient="auto-start-reverse">\n' +
    '    <polyline points="0 0, 8 2.5, 0 5" fill="none" stroke="var(--_arrow)" stroke-width="1" />\n' +
    '  </marker>'
  );
  lines.push('</defs>');

  for (const block of layout.blocks) {
    const blockLines = [
      '<g class="block" data-type="' + escapeXML(block.type) + '"' +
        (block.label ? ' data-label="' + escapeXML(block.label) + '"' : '') + '>',
      '  <rect x="' + block.x + '" y="' + block.y + '" width="' + block.width + '" height="' + block.height +
        '" rx="0" ry="0" fill="none" stroke="var(--_node-stroke)" stroke-width="1" />',
    ];
    const label = block.type + (block.label ? ' [' + block.label + ']' : '');
    const headerWidth = measureText(label.split('\n')[0], 11, 600) + 16;
    blockLines.push(
      '  <rect x="' + block.x + '" y="' + block.y + '" width="' + headerWidth +
      '" height="18" fill="var(--_group-hdr)" stroke="var(--_node-stroke)" stroke-width="1" />'
    );
    blockLines.push(
      '  ' + svgText(label, block.x + 6, block.y + 9, 11,
        'font-size="11" font-weight="600" fill="var(--_text-sec)"')
    );
    for (const divider of block.dividers) {
      blockLines.push(
        '  <line x1="' + block.x + '" y1="' + divider.y + '" x2="' + (block.x + block.width) +
        '" y2="' + divider.y + '" stroke="var(--_line)" stroke-width="0.75" stroke-dasharray="6 4" />'
      );
      if (divider.label) {
        blockLines.push(
          '  ' + svgText('[' + divider.label + ']', block.x + 8, divider.y + 14, 11,
            'font-size="11" text-anchor="start" font-weight="400" fill="var(--_text-muted)"')
        );
      }
    }
    blockLines.push('</g>');
    lines.push(blockLines.join('\n'));
  }

  for (const lifeline of layout.lifelines) {
    lines.push(
      '<line class="lifeline" data-actor="' + escapeXML(lifeline.actorId) + '" x1="' + lifeline.x +
      '" y1="' + lifeline.topY + '" x2="' + lifeline.x + '" y2="' + lifeline.bottomY +
      '" stroke="var(--_line)" stroke-width="0.75" stroke-dasharray="6 4" />'
    );
  }

  for (const activation of layout.activations) {
    lines.push(
      '<rect class="activation" data-actor="' + escapeXML(activation.actorId) + '" x="' + activation.x +
      '" y="' + activation.topY + '" width="' + activation.width + '" height="' +
      (activation.bottomY - activation.topY) +
      '" fill="var(--_node-fill)" stroke="var(--_node-stroke)" stroke-width="0.75" />'
    );
  }

  for (const message of layout.messages) {
    const dash = message.lineStyle === 'dashed' ? ' stroke-dasharray="6 4"' : '';
    const marker = message.arrowHead === 'filled' ? 'seq-arrow' : 'seq-arrow-open';
    const messageLines = [
      '<g class="message" data-from="' + escapeXML(message.from) + '" data-to="' + escapeXML(message.to) +
        '" data-label="' + escapeXML(message.label) + '" data-line-style="' + message.lineStyle +
        '" data-arrow-head="' + message.arrowHead + '" data-self="' + message.isSelf + '">',
    ];

    if (message.isSelf) {
      const selfPoints = [
        { x: message.x1, y: message.y },
        { x: message.x1 + 30, y: message.y },
        { x: message.x1 + 30, y: message.y + 20 },
        { x: message.x2, y: message.y + 20 },
      ];
      const suffix = ' fill="none" stroke="var(--_line)" stroke-width="1"' + dash +
        ' marker-end="url(#' + marker + ')"';
      messageLines.push('  ' + svgPolyline(selfPoints, '', suffix, edgeCornerRadius));
      messageLines.push(
        '  ' + svgText(message.label, message.x1 + 38, message.y + 10, 11,
          'font-size="11" text-anchor="start" font-weight="400" fill="var(--_text-muted)"')
      );
    } else {
      messageLines.push(
        '  <line x1="' + message.x1 + '" y1="' + message.y + '" x2="' + message.x2 + '" y2="' + message.y +
        '" stroke="var(--_line)" stroke-width="1"' + dash + ' marker-end="url(#' + marker + ')" />'
      );
      messageLines.push(
        '  ' + svgText(message.label, (message.x1 + message.x2) / 2, message.y - 10, 11,
          'font-size="11" text-anchor="middle" font-weight="400" fill="var(--_text-muted)"')
      );
    }
    messageLines.push('</g>');
    lines.push(messageLines.join('\n'));
  }

  for (const note of layout.notes) {
    const points = [
      note.x + ',' + note.y,
      (note.x + note.width - 6) + ',' + note.y,
      (note.x + note.width) + ',' + (note.y + 6),
      (note.x + note.width) + ',' + (note.y + note.height),
      note.x + ',' + (note.y + note.height),
    ].join(' ');
    const attrs = [
      note.position ? ' data-position="' + escapeXML(note.position) + '"' : '',
      note.actors?.length ? ' data-actors="' + note.actors.map(escapeXML).join(',') + '"' : '',
    ].join('');
    lines.push(
      '<g class="note"' + attrs + '>\n' +
      '  <polygon points="' + points + '" fill="var(--bg)" stroke="var(--_node-stroke)" stroke-width="0.75" />\n' +
      '  <polygon points="' + (note.x + note.width - 6) + ',' + note.y + ' ' +
        (note.x + note.width) + ',' + (note.y + 6) + ' ' +
        (note.x + note.width - 6) + ',' + (note.y + 6) +
        '" fill="var(--_inner-stroke)" stroke="var(--_node-stroke)" stroke-width="0.75" />\n' +
      '  ' + svgText(note.text, note.x + note.width / 2, note.y + note.height / 2, 11,
        'font-size="11" text-anchor="middle" font-weight="400" fill="var(--_text-muted)"') +
      '\n</g>'
    );
  }

  for (const actor of layout.actors) {
    const actorLines = [
      '<g class="actor" data-id="' + escapeXML(actor.id) + '" data-label="' + escapeXML(actor.label) +
        '" data-type="' + actor.type + '">',
    ];
    if (actor.type === 'actor') {
      const scale = actor.height / 24 * 0.9;
      const strokeWidth = 1 / scale;
      actorLines.push(
        '  <g transform="translate(' + (actor.x - 12 * scale) + ',' +
        (actor.y + (actor.height - 24 * scale) / 2) + ') scale(' + scale + ')">\n' +
        '    <path d="M21 12C21 16.9706 16.9706 21 12 21C7.02944 21 3 16.9706 3 12C3 7.02944 7.02944 3 12 3C16.9706 3 21 7.02944 21 12Z" fill="none" stroke="var(--_line)" stroke-width="' + strokeWidth + '" />\n' +
        '    <path d="M15 10C15 11.6569 13.6569 13 12 13C10.3431 13 9 11.6569 9 10C9 8.34315 10.3431 7 12 7C13.6569 7 15 8.34315 15 10Z" fill="none" stroke="var(--_line)" stroke-width="' + strokeWidth + '" />\n' +
        '    <path d="M5.62842 18.3563C7.08963 17.0398 9.39997 16 12 16C14.6 16 16.9104 17.0398 18.3716 18.3563" fill="none" stroke="var(--_line)" stroke-width="' + strokeWidth + '" />\n' +
        '  </g>'
      );
      actorLines.push(
        '  ' + svgText(actor.label, actor.x, actor.y + actor.height + 14, 13,
          'font-size="13" text-anchor="middle" font-weight="500" fill="var(--_text)"')
      );
    } else {
      actorLines.push(
        '  <rect x="' + (actor.x - actor.width / 2) + '" y="' + actor.y + '" width="' + actor.width +
        '" height="' + actor.height + '" rx="4" ry="4" fill="var(--_node-fill)" stroke="var(--_node-stroke)" stroke-width="1" />'
      );
      actorLines.push(
        '  ' + svgText(actor.label, actor.x, actor.y + actor.height / 2, 13,
          'font-size="13" text-anchor="middle" font-weight="500" fill="var(--_text)"')
      );
    }
    actorLines.push('</g>');
    lines.push(actorLines.join('\n'));
  }

  lines.push('</svg>');
  return lines.join('\n');
}

export async function renderSequence(source, {
  palette,
  font = 'Inter',
  transparent = false,
  edgeCornerRadius = 0,
} = {}) {
  const model = parseSequence(source);
  const layout = layoutSequence(model);
  return {
    type: 'sequence',
    model,
    layout,
    svg: renderSequenceLayout(layout, palette, { font, transparent, edgeCornerRadius }),
  };
}
