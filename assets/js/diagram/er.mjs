import {
  cleanLabel,
  escapeXML,
  measureMultiline,
  measureText,
  svgOpen,
  svgText,
  svgThemeStyle,
} from './common.mjs';

function ensureEntity(entities, id) {
  let entity = entities.get(id);
  if (!entity) {
    entity = { id, label: id, attributes: [] };
    entities.set(id, entity);
  }
  return entity;
}

function cardinality(value) {
  const normalized = value.split('').sort().join('');
  if (normalized === '||') return 'one';
  if (normalized === 'o|') return 'zero-one';
  if (normalized === '|}' || normalized === '{|') return 'many';
  if (normalized === '{o' || normalized === 'o{') return 'zero-many';
  return null;
}

export function parseERDiagram(source) {
  const lines = source.split('\n').map(line => line.trim()).filter(line => line && !line.startsWith('%%'));
  if (!lines.length || !/^erDiagram\s*$/i.test(lines[0])) throw new Error('Invalid erDiagram header');

  const model = { type: 'er', entities: [], relationships: [] };
  const entities = new Map();
  let current = null;

  for (const line of lines.slice(1)) {
    if (current) {
      if (line === '}') {
        current = null;
        continue;
      }
      const match = line.match(/^(\S+)\s+(\S+)(?:\s+(.+))?$/);
      if (!match) continue;
      const type = match[1];
      const name = match[2];
      let remainder = match[3]?.trim() ?? '';
      const keys = [];
      let comment;
      const quoted = remainder.match(/"([^"]*)"/);
      if (quoted) comment = cleanLabel(quoted[1]);
      remainder = remainder.replace(/"[^"]*"/, '').trim();
      for (const token of remainder.split(/\s+/)) {
        const key = token.toUpperCase();
        if (key === 'PK' || key === 'FK' || key === 'UK') keys.push(key);
      }
      current.attributes.push({ type, name, keys, comment });
      continue;
    }

    let match = line.match(/^(\S+)\s*\{$/);
    if (match) {
      current = ensureEntity(entities, match[1]);
      continue;
    }

    match = line.match(/^(\S+)\s+([|o}{]+(?:--|\.\.)[|o}{]+)\s+(\S+)\s*:\s*(.+)$/);
    if (!match) continue;
    const left = match[1];
    const relationToken = match[2];
    const right = match[3];
    const label = cleanLabel(match[4].trim().replace(/^["']|["']$/g, ''));
    const parts = relationToken.match(/^([|o}{]+)(--|\.\.?)([|o}{]+)$/);
    if (!parts) continue;
    const cardinality1 = cardinality(parts[1]);
    const cardinality2 = cardinality(parts[3]);
    if (!cardinality1 || !cardinality2) continue;

    ensureEntity(entities, left);
    ensureEntity(entities, right);
    model.relationships.push({
      entity1: left,
      entity2: right,
      cardinality1,
      cardinality2,
      label,
      identifying: parts[2] === '--',
    });
  }

  model.entities = [...entities.values()];
  return model;
}

export async function layoutERDiagram(model, elk) {
  if (!model.entities.length) return { width: 0, height: 0, entities: [], relationships: [] };

  const sizes = new Map();
  for (const entity of model.entities) {
    let attributeWidth = 0;
    for (const attribute of entity.attributes) {
      const text = attribute.type + '  ' + attribute.name +
        (attribute.keys.length ? '  ' + attribute.keys.join(',') : '');
      attributeWidth = Math.max(attributeWidth, text.length * 11 * 0.6);
    }
    sizes.set(entity.id, {
      width: Math.max(140, measureText(entity.label, 13, 500) + 28, attributeWidth + 28),
      height: 34 + Math.max(entity.attributes.length, 1) * 22,
    });
  }

  const graph = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'RIGHT',
      'elk.spacing.nodeNode': '70',
      'elk.layered.spacing.nodeNodeBetweenLayers': '90',
      'elk.padding': '[top=40,left=40,bottom=40,right=40]',
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.edgeLabels.placement': 'CENTER',
    },
    children: [],
    edges: [],
  };

  for (const entity of model.entities) {
    const size = sizes.get(entity.id);
    graph.children.push({ id: entity.id, width: size.width, height: size.height });
  }
  model.relationships.forEach((relationship, index) => {
    const edge = { id: 'e' + index, sources: [relationship.entity1], targets: [relationship.entity2] };
    if (relationship.label) {
      const measured = measureMultiline(relationship.label, 11, 400);
      edge.labels = [{ text: relationship.label, width: measured.width + 8, height: measured.height + 6 }];
    }
    graph.edges.push(edge);
  });

  const layout = await elk.layout(graph);
  const entityMap = new Map(model.entities.map(entity => [entity.id, entity]));
  const entities = [];
  for (const child of layout.children ?? []) {
    const entity = entityMap.get(child.id);
    if (!entity) continue;
    const size = sizes.get(entity.id);
    entities.push({
      ...entity,
      x: child.x ?? 0,
      y: child.y ?? 0,
      width: child.width ?? size.width,
      height: child.height ?? size.height,
      headerHeight: 34,
      rowHeight: 22,
    });
  }

  const relationships = [];
  for (let index = 0; index < (layout.edges?.length ?? 0); index += 1) {
    const edge = layout.edges[index];
    const relationship = model.relationships[index];
    const points = [];
    const section = edge.sections?.[0];
    if (section) {
      points.push({ x: section.startPoint.x, y: section.startPoint.y });
      for (const point of section.bendPoints ?? []) points.push({ x: point.x, y: point.y });
      points.push({ x: section.endPoint.x, y: section.endPoint.y });
    }
    relationships.push({ ...relationship, points });
  }

  return {
    width: layout.width ?? 600,
    height: layout.height ?? 400,
    entities,
    relationships,
  };
}

function midpoint(points) {
  if (!points.length) return { x: 0, y: 0 };
  if (points.length === 1) return points[0];
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    total += Math.hypot(points[index].x - points[index - 1].x, points[index].y - points[index - 1].y);
  }
  if (!total) return points[0];
  let remaining = total / 2;
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1];
    const b = points[index];
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (remaining <= length) {
      const ratio = length > 0 ? remaining / length : 0;
      return { x: a.x + (b.x - a.x) * ratio, y: a.y + (b.y - a.y) * ratio };
    }
    remaining -= length;
  }
  return points[points.length - 1];
}

function relationshipLine(relationship) {
  if (relationship.points.length < 2) return '';
  const points = relationship.points.map(point => point.x + ',' + point.y).join(' ');
  const dash = relationship.identifying ? '' : ' stroke-dasharray="6 4"';
  const label = relationship.label ? ' data-label="' + escapeXML(relationship.label) + '"' : '';
  const attrs = [
    'class="er-relationship"',
    'data-entity1="' + escapeXML(relationship.entity1) + '"',
    'data-entity2="' + escapeXML(relationship.entity2) + '"',
    'data-cardinality1="' + relationship.cardinality1 + '"',
    'data-cardinality2="' + relationship.cardinality2 + '"',
    'data-identifying="' + relationship.identifying + '"',
  ].join(' ');
  return '<polyline ' + attrs + label + ' points="' + points +
    '" fill="none" stroke="var(--_line)" stroke-width="1"' + dash + ' />';
}

function cardinalitySVG(point, neighbour, kind) {
  const values = [];
  let dx = point.x - neighbour.x;
  let dy = point.y - neighbour.y;
  const length = Math.hypot(dx, dy);
  if (!length) return '';
  dx /= length;
  dy /= length;
  const perpendicularX = -dy;
  const baseX = point.x - dx * 4;
  const baseY = point.y - dy * 4;
  const endX = point.x - dx * 16;
  const endY = point.y - dy * 16;
  const many = kind === 'many' || kind === 'zero-many';
  const optional = kind === 'zero-one' || kind === 'zero-many';

  if (kind === 'one' || kind === 'zero-one') {
    values.push(
      '<line x1="' + (baseX + perpendicularX * 6) + '" y1="' + (baseY + dx * 6) +
      '" x2="' + (baseX - perpendicularX * 6) + '" y2="' + (baseY - dx * 6) +
      '" stroke="var(--_line)" stroke-width="1.25" />'
    );
    const secondX = baseX - dx * 4;
    const secondY = baseY - dy * 4;
    values.push(
      '<line x1="' + (secondX + perpendicularX * 6) + '" y1="' + (secondY + dx * 6) +
      '" x2="' + (secondX - perpendicularX * 6) + '" y2="' + (secondY - dx * 6) +
      '" stroke="var(--_line)" stroke-width="1.25" />'
    );
  }

  if (many) {
    values.push(
      '<line x1="' + (baseX + perpendicularX * 7) + '" y1="' + (baseY + dx * 7) +
      '" x2="' + endX + '" y2="' + endY + '" stroke="var(--_line)" stroke-width="1.25" />'
    );
    values.push(
      '<line x1="' + baseX + '" y1="' + baseY + '" x2="' + endX + '" y2="' + endY +
      '" stroke="var(--_line)" stroke-width="1.25" />'
    );
    values.push(
      '<line x1="' + (baseX - perpendicularX * 7) + '" y1="' + (baseY - dx * 7) +
      '" x2="' + endX + '" y2="' + endY + '" stroke="var(--_line)" stroke-width="1.25" />'
    );
  }

  if (optional) {
    const distance = many ? 20 : 12;
    values.push(
      '<circle cx="' + (point.x - dx * distance) + '" cy="' + (point.y - dy * distance) +
      '" r="4" fill="var(--bg)" stroke="var(--_line)" stroke-width="1.25" />'
    );
  }
  return values.join('\n');
}

export function renderERLayout(layout, palette, options = {}) {
  const font = options.font ?? 'Inter';
  const transparent = options.transparent ?? false;
  const lines = [svgOpen(layout.width, layout.height, palette, transparent), svgThemeStyle(font, true), '<defs>', '</defs>'];

  for (const relationship of layout.relationships) lines.push(relationshipLine(relationship));

  for (const entity of layout.entities) {
    const values = [
      '<g class="entity" data-id="' + escapeXML(entity.id) + '" data-label="' + escapeXML(entity.label) + '">',
      '  <rect x="' + entity.x + '" y="' + entity.y + '" width="' + entity.width + '" height="' + entity.height +
        '" rx="0" ry="0" fill="var(--_node-fill)" stroke="var(--_node-stroke)" stroke-width="1" />',
      '  <rect x="' + entity.x + '" y="' + entity.y + '" width="' + entity.width + '" height="' + entity.headerHeight +
        '" rx="0" ry="0" fill="var(--_group-hdr)" stroke="var(--_node-stroke)" stroke-width="1" />',
      '  ' + svgText(entity.label, entity.x + entity.width / 2, entity.y + entity.headerHeight / 2, 13,
        'text-anchor="middle" font-size="13" font-weight="700" fill="var(--_text)"'),
    ];

    const rowTop = entity.y + entity.headerHeight;
    values.push(
      '  <line x1="' + entity.x + '" y1="' + rowTop + '" x2="' + (entity.x + entity.width) +
      '" y2="' + rowTop + '" stroke="var(--_node-stroke)" stroke-width="0.75" />'
    );

    entity.attributes.forEach((attribute, index) => {
      const centerY = rowTop + index * entity.rowHeight + entity.rowHeight / 2;
      const row = [];
      const hasComment = Boolean(attribute.comment);
      if (hasComment) row.push('<g><title>' + escapeXML(attribute.comment.replace(/<br\s*\/?>/gi, '\n')) + '</title>');
      let badgeWidth = 0;
      if (attribute.keys.length) {
        const keyText = attribute.keys.join(',');
        badgeWidth = measureText(keyText, 9, 600) + 8;
        row.push(
          '<rect x="' + (entity.x + 6) + '" y="' + (centerY - 7) + '" width="' + badgeWidth +
          '" height="14" rx="2" ry="2" fill="var(--_key-badge)" />'
        );
        row.push(
          '<text x="' + (entity.x + 6 + badgeWidth / 2) + '" y="' + centerY +
          '" text-anchor="middle" dy="0.35em" font-size="9" font-weight="600" fill="var(--_text-sec)">' +
          escapeXML(keyText) + '</text>'
        );
      }
      row.push(
        '<text x="' + (entity.x + 8 + (badgeWidth > 0 ? badgeWidth + 6 : 0)) + '" y="' + centerY +
        '" class="mono" dy="0.35em" font-size="11" font-weight="400"><tspan fill="var(--_text-muted)">' +
        escapeXML(attribute.type) + '</tspan></text>'
      );
      row.push(
        '<text x="' + (entity.x + entity.width - 8) + '" y="' + centerY +
        '" class="mono" text-anchor="end" dy="0.35em" font-size="11" font-weight="400"><tspan fill="var(--_text-sec)">' +
        escapeXML(attribute.name) + '</tspan></text>'
      );
      if (hasComment) row.push('</g>');
      values.push('  ' + row.join('\n').replace(/\n/g, '\n  '));
    });

    if (!entity.attributes.length) {
      values.push(
        '  <text x="' + (entity.x + entity.width / 2) + '" y="' + (rowTop + entity.rowHeight / 2) +
        '" text-anchor="middle" dy="0.35em" font-size="11" fill="var(--_text-faint)" font-style="italic">(no attributes)</text>'
      );
    }
    values.push('</g>');
    lines.push(values.join('\n'));
  }

  for (const relationship of layout.relationships) {
    if (relationship.points.length < 2) continue;
    lines.push(cardinalitySVG(relationship.points[0], relationship.points[1], relationship.cardinality1));
    lines.push(cardinalitySVG(
      relationship.points[relationship.points.length - 1],
      relationship.points[relationship.points.length - 2],
      relationship.cardinality2,
    ));
  }

  for (const relationship of layout.relationships) {
    if (!relationship.label || relationship.points.length < 2) continue;
    const position = midpoint(relationship.points);
    const measured = measureMultiline(relationship.label, 11, 400);
    const width = measured.width + 8;
    const height = measured.height + 6;
    lines.push(
      '<rect x="' + (position.x - width / 2) + '" y="' + (position.y - height / 2) +
      '" width="' + width + '" height="' + height +
      '" rx="2" ry="2" fill="var(--bg)" stroke="var(--_inner-stroke)" stroke-width="0.5" />\n' +
      svgText(relationship.label, position.x, position.y, 11,
        'text-anchor="middle" font-size="11" font-weight="400" fill="var(--_text-muted)"')
    );
  }

  lines.push('</svg>');
  return lines.join('\n');
}

export async function renderERDiagram(source, { elk, palette, font = 'Inter', transparent = false } = {}) {
  if (!elk) throw new Error('ELK instance is required');
  const model = parseERDiagram(source);
  const layout = await layoutERDiagram(model, elk);
  return {
    type: 'er',
    model,
    layout,
    svg: renderERLayout(layout, palette, { font, transparent }),
  };
}
