// SVG geometry normalization ported from the Quarto renderer for browser runtime use.
const NUMBER = '-?\\d*\\.?\\d+(?:[eE][+-]?\\d+)?';

export function pathPoints(path) {
  const tokens = [...path.matchAll(new RegExp(`([ML])(${NUMBER})[ ,]+(${NUMBER})`, 'g'))];
  if (!tokens.length || tokens[0][1] !== 'M' || tokens.slice(1).some(m=>m[1]!=='L') ||
      tokens.map(m=>m[0]).join('') !== path) return null;
  return tokens.map(m=>({x:Number(m[2]),y:Number(m[3])}));
}

const pathString = points => points.map((p,i)=>`${i?'L':'M'}${p.x},${p.y}`).join('');
const routeLength = points => points.slice(1).reduce((sum,p,i)=>sum+Math.hypot(p.x-points[i].x,p.y-points[i].y),0);

export function pathMidpoint(points) {
  let remaining = routeLength(points)/2;
  for (let i=1;i<points.length;i++) {
    const a=points[i-1],b=points[i],length=Math.hypot(b.x-a.x,b.y-a.y);
    if (length && remaining<=length) return {x:a.x+(b.x-a.x)*remaining/length,y:a.y+(b.y-a.y)*remaining/length};
    remaining-=length;
  }
  return points.at(-1) ?? {x:0,y:0};
}

export function sharpCorners(path) {
  // ELK 0.2.3 emits M/L/Q paths: Q's control point is the original
  // orthogonal corner. Keep the renderer's clipped endpoints and markers.
  const pair = `(${NUMBER})[ ,]+(${NUMBER})`;
  return path.replace(new RegExp(`Q${pair}[ ,]+${pair}`, 'g'),
    (_, x1, y1, x2, y2) => `L${x1},${y1}L${x2},${y2}`);
}

export function orthogonalPath(path) {
  const sharp = sharpCorners(path);
  // Shape intersections (notably diamonds) can add a short diagonal even
  // to ELK's orthogonal route. Collapse its collinear interpolation points,
  // then add an outward dogleg, keeping both endpoint coordinates unchanged.
  const input = pathPoints(sharp);
  if (!input) return sharp;
  const points = [];
  for (const next of input) {
    if (points.length >= 2) {
      const a = points.at(-2), b = points.at(-1);
      const cross = (b.x-a.x)*(next.y-b.y) - (b.y-a.y)*(next.x-b.x);
      const dot = (b.x-a.x)*(next.x-b.x) + (b.y-a.y)*(next.y-b.y);
      if (Math.abs(cross) < 1e-6 && dot >= 0) points.pop();
    }
    points.push(next);
  }
  let result = `M${points[0].x},${points[0].y}`;
  for (let i = 1; i < points.length; i++) {
    const a = points[i-1], b = points[i];
    const dx = b.x-a.x, dy = b.y-a.y;
    if (Math.abs(dx) > 1e-6 && Math.abs(dy) > 1e-6) {
      result += Math.abs(dx) >= Math.abs(dy) ? `L${b.x},${a.y}` : `L${a.x},${b.y}`;
    }
    result += `L${b.x},${b.y}`;
  }
  return result;
}

export function crossesBox(points, box) {
  return points.slice(1).some((b, i) => {
    const a = points[i];
    return Math.abs(a.x-b.x) < .01
      ? a.x > box.x && a.x < box.x+box.width && Math.max(a.y,b.y) > box.y && Math.min(a.y,b.y) < box.y+box.height
      : Math.abs(a.y-b.y) < .01 && a.y > box.y && a.y < box.y+box.height && Math.max(a.x,b.x) > box.x && Math.min(a.x,b.x) < box.x+box.width;
  });
}

function routeFeedback(svg) {
  const boxInSvg = element => {
    const b = element.getBBox();
    const matrix = svg.getCTM().inverse().multiply(element.getCTM());
    const a = new DOMPoint(b.x,b.y).matrixTransform(matrix);
    const z = new DOMPoint(b.x+b.width,b.y+b.height).matrixTransform(matrix);
    return { x:a.x, y:a.y, width:z.x-a.x, height:z.y-a.y };
  };
  const headers = [...svg.querySelectorAll('.mermaid-group-header')].map(boxInSvg);
  const nodes = [...svg.querySelectorAll('.node')].map(boxInSvg);
  let offset = 0;
  for (const edge of svg.querySelectorAll('.flowchart-link')) {
    if (edge.dataset.antigravityRouted) continue;
    const localPoints = pathPoints(edge.getAttribute('d'));
    if (!localPoints) continue;
    const matrix = svg.getCTM().inverse().multiply(edge.getCTM());
    const points = localPoints.map(p=>new DOMPoint(p.x,p.y).matrixTransform(matrix));
    const route = feedbackRoute(points,nodes,headers,offset);
    if (!route) continue;
    const inverse = matrix.inverse();
    edge.setAttribute('d', pathString(route.map(p=>new DOMPoint(p.x,p.y).matrixTransform(inverse))));
    edge.dataset.antigravityRouted = 'true';
    // Keep the edge label attached to its new outside vertical segment.
    const edgeId = edge.getAttribute('data-id');
    const label = [...svg.querySelectorAll('g.edgeLabel > .label')]
      .find(e=>e.getAttribute('data-id')===edgeId)?.parentElement;
    if (label) {
      const middle = pathMidpoint(route);
      const transform = label.parentElement.getCTM().inverse().multiply(svg.getCTM());
      const position = new DOMPoint(middle.x,middle.y).matrixTransform(transform);
      label.setAttribute('transform',`translate(${position.x},${position.y})`);
    }
    offset += 20;
  }
}

export function feedbackRoute(points,nodes,headers,offset=0) {
  if (points.length<2 || !nodes.length || points[0].y<=points.at(-1).y || !headers.some(h=>crossesBox(points,h))) return null;
  const distance = (p,b) => Math.hypot(Math.max(b.x-p.x,0,p.x-b.x-b.width),Math.max(b.y-p.y,0,p.y-b.y-b.height));
  const nearest = point => [...nodes].sort((a,b)=>distance(point,a)-distance(point,b)).find(b=>distance(point,b)<8);
  const start=points[0],source=nearest(start),target=nearest(points.at(-1));
  // Preserve the existing source port; never route back through its own body.
  if (!source || !target || source===target || start.y<source.y+source.height-1 || points[1].y<start.y) return null;
  const boxes=[...nodes,...headers],exitY=Math.max(start.y+16,points[1].y),endY=target.y+target.height/2;
  const sides=[
    {lane:Math.min(...boxes.map(b=>b.x))-24-offset,end:target.x-4},
    {lane:Math.max(...boxes.map(b=>b.x+b.width))+24+offset,end:target.x+target.width+4},
  ];
  const routes=sides.map(({lane,end})=>[start,{x:start.x,y:exitY},{x:lane,y:exitY},{x:lane,y:endY},{x:end,y:endY}])
    .filter(route=>!boxes.some(b=>crossesBox(route,b)));
  return routes.sort((a,b)=>routeLength(a)-routeLength(b))[0] ?? null;
}

export function decorate(svg) {
  // The shared cascade layer handles generated classDef rules. Only inline
  // presentation outranks it; remove those conflicts without duplicating CSS.
  for (const element of svg.querySelectorAll('.node, .node *, .cluster, .cluster *, .flowchart-link')) {
    for (const property of ['fill', 'stroke', 'stroke-width', 'color', 'font-family', 'font-size', 'font-weight'])
      element.style?.removeProperty(property);
  }
  for (const cluster of svg.querySelectorAll('g.cluster')) {
    if (cluster.querySelector(':scope > .mermaid-group-header')) continue;
    const body = cluster.querySelector(':scope > rect');
    const label = cluster.querySelector(':scope > .cluster-label');
    if (!body || !label) continue;
    const x = Number(body.getAttribute('x'));
    const y = Number(body.getAttribute('y'));
    const bounds = label.getBBox();
    const height = Math.max(28, bounds.height + 8);
    const header = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    for (const [key, value] of Object.entries({
      class: 'mermaid-group-header', x, y, width: body.getAttribute('width'), height,
      rx: 0, ry: 0, 'aria-hidden': 'true',
    })) header.setAttribute(key, value);
    body.after(header);
    label.setAttribute('transform',
      `translate(${x + 12 - bounds.x},${y + (height - bounds.height) / 2 - bounds.y})`);
  }
  for (const edge of svg.querySelectorAll('.flowchart-link')) {
    edge.setAttribute('d', orthogonalPath(edge.getAttribute('d') || ''));
  }
  routeFeedback(svg);
  // Font rounding must not clip the last glyph inside a foreignObject viewport.
  for (const label of svg.querySelectorAll('.node .label foreignObject')) {
    const content = label.firstElementChild;
    if (!content) continue;
    const oldWidth = Number(label.getAttribute('width'));
    const width = Math.max(oldWidth, content.scrollWidth) + 4;
    if (!label.dataset.antigravityPadded) {
      label.setAttribute('x', -(width-oldWidth)/2);
      label.setAttribute('width', width);
      label.dataset.antigravityPadded = 'true';
    }
  }
  // Include rerouted outside edges in the canvas, then fit the complete diagram.
  const bounds = svg.getBBox();
  const old = svg.viewBox.baseVal;
  const left = Math.min(old.x,bounds.x-8), top = Math.min(old.y,bounds.y-8);
  const right = Math.max(old.x+old.width,bounds.x+bounds.width+8);
  const bottom = Math.max(old.y+old.height,bounds.y+bounds.height+8);
  svg.setAttribute('viewBox',`${left} ${top} ${right-left} ${bottom-top}`);
  const width = right-left;
  if (width) {
    svg.style.width = `${width}px`;
    svg.style.maxWidth = '100%';
    svg.style.height = 'auto';
  }
}
