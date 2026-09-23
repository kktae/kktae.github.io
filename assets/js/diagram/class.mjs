import {
  cleanLabel,
  escapeXML,
  escapeText,
  measureMultiline,
  measureText,
  svgOpen,
  svgText,
  svgThemeStyle,
} from './common.mjs';

function ensureClass(classes, id) {
  let value = classes.get(id);
  if (!value) {
    value = { id, label: id, attributes: [], methods: [] };
    classes.set(id, value);
  }
  return value;
}

function parseMember(value) {
  let text = value.trim().replace(/;$/, '');
  if (!text) return null;

  let visibility = '';
  if (/^[+\-#~]/.test(text)) {
    visibility = text[0];
    text = text.slice(1).trim();
  }

  const method = text.match(/^(.+?)\(([^)]*)\)(?:\s*(.+))?$/);
  if (method) {
    let name = method[1].trim();
    const params = method[2]?.trim() || undefined;
    const type = method[3]?.trim() || undefined;
    const isStatic = name.endsWith('$') || text.includes('$');
    const isAbstract = name.endsWith('*') || text.includes('*');
    name = name.replace(/[$*]$/, '');
    return {
      isMethod: true,
      member: { visibility, name, type, isStatic, isAbstract, isMethod: true, params },
    };
  }

  const pieces = text.split(/\s+/);
  let type;
  let name;
  if (pieces.length >= 2) {
    type = pieces[0];
    name = pieces.slice(1).join(' ');
  } else {
    name = pieces[0] ?? text;
  }
  const isStatic = name.endsWith('$');
  const isAbstract = name.endsWith('*');
  return {
    isMethod: false,
    member: {
      visibility,
      name: name.replace(/[$*]$/, ''),
      type,
      isStatic,
      isAbstract,
      isMethod: false,
    },
  };
}

function relationshipType(token) {
  const map = {
    '<|--': { type: 'inheritance', markerAt: 'from' },
    '--|>': { type: 'inheritance', markerAt: 'to' },
    '<|..': { type: 'realization', markerAt: 'from' },
    '..|>': { type: 'realization', markerAt: 'to' },
    '*--': { type: 'composition', markerAt: 'from' },
    '--*': { type: 'composition', markerAt: 'to' },
    'o--': { type: 'aggregation', markerAt: 'from' },
    '--o': { type: 'aggregation', markerAt: 'to' },
    '-->': { type: 'association', markerAt: 'to' },
    '<--': { type: 'association', markerAt: 'from' },
    '..>': { type: 'dependency', markerAt: 'to' },
    '<..': { type: 'dependency', markerAt: 'from' },
    '--': { type: 'association', markerAt: 'to' },
  };
  return map[token.trim()] ?? null;
}

export function parseClassDiagram(source) {
  const lines = source.split('\n').map(line => line.trim()).filter(line => line && !line.startsWith('%%'));

  const model = { type: 'class', classes: [], relationships: [], namespaces: [] };
  const classes = new Map();
  let namespace = null;
  let currentClass = null;
  let classDepth = 0;

  for (const line of lines.slice(1)) {
    if (currentClass && classDepth > 0) {
      if (line === '}') {
        classDepth -= 1;
        if (classDepth === 0) currentClass = null;
        continue;
      }
      let match = line.match(/^<<(\w+)>>$/);
      if (match) {
        currentClass.annotation = match[1];
        continue;
      }
      const parsed = parseMember(line);
      if (parsed) {
        if (parsed.isMethod) currentClass.methods.push(parsed.member);
        else currentClass.attributes.push(parsed.member);
      }
      continue;
    }

    let match = line.match(/^namespace\s+(\S+)\s*\{$/);
    if (match) {
      namespace = { name: match[1], classIds: [] };
      continue;
    }
    if (line === '}' && namespace) {
      model.namespaces.push(namespace);
      namespace = null;
      continue;
    }

    match = line.match(/^class\s+(\S+?)(?:\s*~(\w+)~)?\s*\{$/);
    if (match) {
      const id = match[1];
      const generic = match[2];
      const cls = ensureClass(classes, id);
      if (generic) cls.label = id + '<' + generic + '>';
      currentClass = cls;
      classDepth = 1;
      if (namespace) namespace.classIds.push(id);
      continue;
    }

    match = line.match(/^class\s+(\S+?)(?:\s*~(\w+)~)?\s*$/);
    if (match) {
      const id = match[1];
      const generic = match[2];
      const cls = ensureClass(classes, id);
      if (generic) cls.label = id + '<' + generic + '>';
      if (namespace) namespace.classIds.push(id);
      continue;
    }

    match = line.match(/^class\s+(\S+?)\s*\{\s*<<(\w+)>>\s*\}$/);
    if (match) {
      ensureClass(classes, match[1]).annotation = match[2];
      continue;
    }

    match = line.match(/^(\S+?)\s*:\s*(.+)$/);
    if (match && !match[2].match(/<\|--|--|\*--|o--|-->|\.{2}>|\.{2}\|>/)) {
      const cls = ensureClass(classes, match[1]);
      const parsed = parseMember(match[2]);
      if (parsed) {
        if (parsed.isMethod) cls.methods.push(parsed.member);
        else cls.attributes.push(parsed.member);
      }
      continue;
    }

    match = line.match(/^(\S+?)\s+(?:"([^"]*?)"\s+)?(<\|--|<\|\.\.|\*--|o--|-->|--\*|--o|--\|>|\.\.>|\.\.\|>|<--|<\.\.?|--)\s+(?:"([^"]*?)"\s+)?(\S+?)(?:\s*:\s*(.+))?$/);
    if (!match) continue;

    const relation = relationshipType(match[3]);
    if (!relation) continue;
    const from = match[1];
    const to = match[5];
    ensureClass(classes, from);
    ensureClass(classes, to);
    model.relationships.push({
      from,
      to,
      type: relation.type,
      markerAt: relation.markerAt,
      label: match[6]?.trim() ? cleanLabel(match[6].trim()) : undefined,
      fromCardinality: match[2] ? cleanLabel(match[2]) : undefined,
      toCardinality: match[4] ? cleanLabel(match[4]) : undefined,
    });
  }

  model.classes = [...classes.values()];
  return model;
}

function memberWidth(members) {
  let width = 0;
  for (const member of members) {
    const text =
      (member.visibility ? member.visibility + ' ' : '') +
      (member.isMethod ? member.name + '(' + (member.params || '') + ')' : member.name) +
      (member.type ? ': ' + member.type : '');
    width = Math.max(width, text.length * 11 * 0.6);
  }
  return width;
}

export async function layoutClassDiagram(model, elk) {
  if (!model.classes.length) return { width: 0, height: 0, classes: [], relationships: [] };

  const sizes = new Map();
  for (const cls of model.classes) {
    const headerHeight = cls.annotation ? 48 : 32;
    const attrHeight = cls.attributes.length ? cls.attributes.length * 20 + 8 : 8;
    const methodHeight = cls.methods.length ? cls.methods.length * 20 + 8 : 8;
    sizes.set(cls.id, {
      width: Math.max(
        120,
        measureText(cls.label, 13, 500) + 16,
        memberWidth(cls.attributes) + 16,
        memberWidth(cls.methods) + 16,
      ),
      height: headerHeight + attrHeight + methodHeight,
      headerHeight,
      attrHeight,
      methodHeight,
    });
  }

  const graph = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'DOWN',
      'elk.spacing.nodeNode': '40',
      'elk.layered.spacing.nodeNodeBetweenLayers': '60',
      'elk.padding': '[top=40,left=40,bottom=40,right=40]',
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.edgeLabels.placement': 'CENTER',
    },
    children: [],
    edges: [],
  };

  for (const cls of model.classes) {
    const size = sizes.get(cls.id);
    graph.children.push({ id: cls.id, width: size.width, height: size.height });
  }
  model.relationships.forEach((relation, index) => {
    const edge = { id: 'e' + index, sources: [relation.from], targets: [relation.to] };
    if (relation.label) {
      const measured = measureMultiline(relation.label, 11, 400);
      edge.labels = [{ text: relation.label, width: measured.width + 8, height: measured.height + 6 }];
    }
    graph.edges.push(edge);
  });

  const layout = await elk.layout(graph);
  const classMap = new Map(model.classes.map(cls => [cls.id, cls]));
  const classes = [];
  for (const child of layout.children ?? []) {
    const cls = classMap.get(child.id);
    if (!cls) continue;
    const size = sizes.get(cls.id);
    classes.push({
      ...cls,
      x: child.x ?? 0,
      y: child.y ?? 0,
      width: child.width ?? size.width,
      height: child.height ?? size.height,
      headerHeight: size.headerHeight,
      attrHeight: size.attrHeight,
      methodHeight: size.methodHeight,
    });
  }

  const relationships = [];
  for (let index = 0; index < (layout.edges?.length ?? 0); index += 1) {
    const edge = layout.edges[index];
    const relation = model.relationships[index];
    const points = [];
    const section = edge.sections?.[0];
    if (section) {
      points.push({ x: section.startPoint.x, y: section.startPoint.y });
      for (const point of section.bendPoints ?? []) points.push({ x: point.x, y: point.y });
      points.push({ x: section.endPoint.x, y: section.endPoint.y });
    }
    let labelPosition;
    const label = edge.labels?.[0];
    if (label?.x != null && label?.y != null) {
      labelPosition = {
        x: label.x + (label.width ?? 0) / 2,
        y: label.y + (label.height ?? 0) / 2,
      };
    }
    relationships.push({ ...relation, points, labelPosition });
  }

  return {
    width: layout.width ?? 600,
    height: layout.height ?? 400,
    classes,
    relationships,
  };
}

function markerId(type) {
  if (type === 'inheritance' || type === 'realization') return 'cls-inherit';
  if (type === 'composition') return 'cls-composition';
  if (type === 'aggregation') return 'cls-aggregation';
  if (type === 'association' || type === 'dependency') return 'cls-arrow';
  return null;
}

function markerAttr(relation) {
  const marker = markerId(relation.type);
  if (!marker) return '';
  return relation.markerAt === 'from'
    ? ' marker-start="url(#' + marker + ')"'
    : ' marker-end="url(#' + marker + ')"';
}

function relationshipSVG(relation) {
  if (relation.points.length < 2) return '';
  const points = relation.points.map(point => point.x + ',' + point.y).join(' ');
  const dash = relation.type === 'dependency' || relation.type === 'realization'
    ? ' stroke-dasharray="6 4"'
    : '';
  const attrs = [
    'class="class-relationship"',
    'data-from="' + escapeXML(relation.from) + '"',
    'data-to="' + escapeXML(relation.to) + '"',
    'data-type="' + relation.type + '"',
    'data-marker-at="' + relation.markerAt + '"',
  ];
  if (relation.label) attrs.push('data-label="' + escapeXML(relation.label) + '"');
  if (relation.fromCardinality) attrs.push('data-from-cardinality="' + escapeXML(relation.fromCardinality) + '"');
  if (relation.toCardinality) attrs.push('data-to-cardinality="' + escapeXML(relation.toCardinality) + '"');
  return '<polyline ' + attrs.join(' ') + ' points="' + points +
    '" fill="none" stroke="var(--_line)" stroke-width="1"' + dash + markerAttr(relation) + ' />';
}

function memberSVG(member, x, y) {
  const styles = [];
  if (member.isAbstract) styles.push('font-style="italic"');
  if (member.isStatic) styles.push('text-decoration="underline"');
  const pieces = [];
  if (member.visibility) {
    pieces.push('<tspan fill="var(--_text-faint)">' + escapeText(member.visibility) + ' </tspan>');
  }
  pieces.push(
    '<tspan fill="var(--_text-sec)">' +
    escapeText(member.isMethod ? member.name + '(' + (member.params || '') + ')' : member.name) +
    '</tspan>'
  );
  if (member.type) {
    pieces.push('<tspan fill="var(--_text-faint)">: </tspan>');
    pieces.push('<tspan fill="var(--_text-muted)">' + escapeText(member.type) + '</tspan>');
  }
  return '<text x="' + x + '" y="' + y + '" class="mono" dy="0.35em" font-size="11" font-weight="400"' +
    (styles.length ? ' ' + styles.join(' ') : '') + '>' + pieces.join('') + '</text>';
}

function cardinalityOffset(point, neighbour) {
  const dx = neighbour.x - point.x;
  const dy = neighbour.y - point.y;
  return Math.abs(dx) > Math.abs(dy)
    ? { x: dx > 0 ? 14 : -14, y: -10 }
    : { x: -14, y: dy > 0 ? 14 : -14 };
}

export function renderClassLayout(layout, palette, options = {}) {
  const font = options.font ?? 'Inter';
  const transparent = options.transparent ?? false;
  const lines = [svgOpen(layout.width, layout.height, palette, transparent), svgThemeStyle(font, true), '<defs>'];
  lines.push(
    '  <marker id="cls-inherit" markerWidth="12" markerHeight="10" refX="12" refY="5" orient="auto-start-reverse">\n' +
    '    <polygon points="0 0, 12 5, 0 10" fill="var(--bg)" stroke="var(--_arrow)" stroke-width="1.5" />\n' +
    '  </marker>\n' +
    '  <marker id="cls-composition" markerWidth="12" markerHeight="10" refX="0" refY="5" orient="auto-start-reverse">\n' +
    '    <polygon points="6 0, 12 5, 6 10, 0 5" fill="var(--_arrow)" stroke="var(--_arrow)" stroke-width="1" />\n' +
    '  </marker>\n' +
    '  <marker id="cls-aggregation" markerWidth="12" markerHeight="10" refX="0" refY="5" orient="auto-start-reverse">\n' +
    '    <polygon points="6 0, 12 5, 6 10, 0 5" fill="var(--bg)" stroke="var(--_arrow)" stroke-width="1.5" />\n' +
    '  </marker>\n' +
    '  <marker id="cls-arrow" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto-start-reverse">\n' +
    '    <polyline points="0 0, 8 3, 0 6" fill="none" stroke="var(--_arrow)" stroke-width="1.5" />\n' +
    '  </marker>'
  );
  lines.push('</defs>');

  for (const relation of layout.relationships) lines.push(relationshipSVG(relation));

  for (const cls of layout.classes) {
    const values = [
      '<g class="class-node" data-id="' + escapeXML(cls.id) + '" data-label="' + escapeXML(cls.label) + '"' +
        (cls.annotation ? ' data-annotation="' + escapeXML(cls.annotation) + '"' : '') + '>',
      '  <rect x="' + cls.x + '" y="' + cls.y + '" width="' + cls.width + '" height="' + cls.height +
        '" rx="0" ry="0" fill="var(--_node-fill)" stroke="var(--_node-stroke)" stroke-width="1" />',
      '  <rect x="' + cls.x + '" y="' + cls.y + '" width="' + cls.width + '" height="' + cls.headerHeight +
        '" rx="0" ry="0" fill="var(--_group-hdr)" stroke="var(--_node-stroke)" stroke-width="1" />',
    ];

    let titleY = cls.y + cls.headerHeight / 2;
    if (cls.annotation) {
      values.push(
        '  <text x="' + (cls.x + cls.width / 2) + '" y="' + (cls.y + 12) +
        '" text-anchor="middle" dy="0.35em" font-size="10" font-weight="500" font-style="italic" fill="var(--_text-muted)">&lt;&lt;' +
        escapeText(cls.annotation) + '&gt;&gt;</text>'
      );
      titleY += 6;
    }
    values.push(
      '  ' + svgText(cls.label, cls.x + cls.width / 2, titleY, 13,
        'text-anchor="middle" font-size="13" font-weight="700" fill="var(--_text)"')
    );

    const attrTop = cls.y + cls.headerHeight;
    values.push(
      '  <line x1="' + cls.x + '" y1="' + attrTop + '" x2="' + (cls.x + cls.width) + '" y2="' + attrTop +
      '" stroke="var(--_node-stroke)" stroke-width="0.75" />'
    );
    cls.attributes.forEach((member, index) => {
      values.push('  ' + memberSVG(member, cls.x + 8, attrTop + 4 + index * 20 + 10));
    });

    const methodTop = attrTop + cls.attrHeight;
    values.push(
      '  <line x1="' + cls.x + '" y1="' + methodTop + '" x2="' + (cls.x + cls.width) + '" y2="' + methodTop +
      '" stroke="var(--_node-stroke)" stroke-width="0.75" />'
    );
    cls.methods.forEach((member, index) => {
      values.push('  ' + memberSVG(member, cls.x + 8, methodTop + 4 + index * 20 + 10));
    });
    values.push('</g>');
    lines.push(values.join('\n'));
  }

  for (const relation of layout.relationships) {
    if ((!relation.label && !relation.fromCardinality && !relation.toCardinality) || relation.points.length < 2) {
      lines.push('');
      continue;
    }
    const labels = [];
    if (relation.label) {
      const position = relation.labelPosition ?? relation.points[Math.floor(relation.points.length / 2)] ?? { x: 0, y: 0 };
      labels.push(
        svgText(relation.label, position.x, position.y - 8, 11,
          'font-size="11" text-anchor="middle" font-weight="400" fill="var(--_text-muted)"')
      );
    }
    if (relation.fromCardinality) {
      const point = relation.points[0];
      const offset = cardinalityOffset(point, relation.points[1]);
      labels.push(
        svgText(relation.fromCardinality, point.x + offset.x, point.y + offset.y, 11,
          'font-size="11" text-anchor="middle" font-weight="400" fill="var(--_text-muted)"')
      );
    }
    if (relation.toCardinality) {
      const point = relation.points[relation.points.length - 1];
      const offset = cardinalityOffset(point, relation.points[relation.points.length - 2]);
      labels.push(
        svgText(relation.toCardinality, point.x + offset.x, point.y + offset.y, 11,
          'font-size="11" text-anchor="middle" font-weight="400" fill="var(--_text-muted)"')
      );
    }
    lines.push(labels.join('\n'));
  }

  lines.push('</svg>');
  return lines.join('\n');
}

export async function renderClassDiagram(source, { elk, palette, font = 'Inter', transparent = false } = {}) {
  if (!elk) throw new Error('ELK instance is required');
  const model = parseClassDiagram(source);
  const layout = await layoutClassDiagram(model, elk);
  return {
    type: 'class',
    model,
    layout,
    svg: renderClassLayout(layout, palette, { font, transparent }),
  };
}
