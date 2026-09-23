export function polylineMidpoint(points) {
  if (!points.length) return { x: 0, y: 0 };
  if (points.length === 1) return points[0];

  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    total += Math.hypot(points[index].x - points[index - 1].x, points[index].y - points[index - 1].y);
  }

  let remaining = total / 2;
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const length = Math.hypot(current.x - previous.x, current.y - previous.y);
    if (remaining <= length) {
      const ratio = length > 0 ? remaining / length : 0;
      return {
        x: previous.x + (current.x - previous.x) * ratio,
        y: previous.y + (current.y - previous.y) * ratio,
      };
    }
    remaining -= length;
  }
  return points[points.length - 1];
}

export function roundedPolylinePath(points, radius = 0) {
  if (!points.length) return '';
  if (points.length === 1) return 'M ' + points[0].x + ' ' + points[0].y;

  const cornerRadius = Math.max(0, Number(radius) || 0);
  const parts = ['M ' + points[0].x + ' ' + points[0].y];

  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const next = points[index + 1];
    const incomingX = current.x - previous.x;
    const incomingY = current.y - previous.y;
    const outgoingX = next.x - current.x;
    const outgoingY = next.y - current.y;
    const incomingLength = Math.hypot(incomingX, incomingY);
    const outgoingLength = Math.hypot(outgoingX, outgoingY);
    const cross = incomingX * outgoingY - incomingY * outgoingX;

    if (!cornerRadius || !incomingLength || !outgoingLength || Math.abs(cross) < 1e-9) {
      parts.push('L ' + current.x + ' ' + current.y);
      continue;
    }

    const effectiveRadius = Math.min(cornerRadius, incomingLength / 2, outgoingLength / 2);
    const before = {
      x: current.x - incomingX / incomingLength * effectiveRadius,
      y: current.y - incomingY / incomingLength * effectiveRadius,
    };
    const after = {
      x: current.x + outgoingX / outgoingLength * effectiveRadius,
      y: current.y + outgoingY / outgoingLength * effectiveRadius,
    };
    parts.push(
      'L ' + before.x + ' ' + before.y,
      'Q ' + current.x + ' ' + current.y + ' ' + after.x + ' ' + after.y
    );
  }

  const last = points[points.length - 1];
  parts.push('L ' + last.x + ' ' + last.y);
  return parts.join(' ');
}

export function svgPolyline(points, attrs = '', suffix = '', cornerRadius = 0) {
  const prefix = attrs ? attrs + ' ' : '';
  if (cornerRadius > 0) {
    return '<path ' + prefix + 'd="' + roundedPolylinePath(points, cornerRadius) + '"' + suffix + ' />';
  }
  const values = points.map(point => point.x + ',' + point.y).join(' ');
  return '<polyline ' + prefix + 'points="' + values + '"' + suffix + ' />';
}
