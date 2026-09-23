import {
  escapeXML,
  measureText,
  svgOpen,
  svgThemeStyle,
} from './common.mjs';

function parseData(value) {
  return value.split(',').map(item => Number.parseFloat(item.trim()));
}

export function parseXYChart(source) {
  const lines = source.split('\n').map(line => line.trim()).filter(line => line && !line.startsWith('%%'));
  const xAxis = {};
  const yAxis = {};
  const series = [];
  let horizontal = false;
  let title;

  for (const line of lines) {
    if (/^xychart(-beta)?\b/i.test(line)) {
      if (/\bhorizontal\b/i.test(line)) horizontal = true;
      continue;
    }

    let match = line.match(/^title\s+"([^"]+)"/);
    if (match) {
      title = match[1];
      continue;
    }

    match = line.match(/^x-axis\s+(?:"([^"]*)"\s*)?\[([^\]]+)\]/);
    if (match) {
      if (match[1]) xAxis.title = match[1];
      xAxis.categories = match[2].split(',').map(item => item.trim());
      continue;
    }

    match = line.match(/^x-axis\s+(?:"([^"]*)"\s+)?(-?\d+(?:\.\d+)?)\s*-->\s*(-?\d+(?:\.\d+)?)/);
    if (match) {
      if (match[1]) xAxis.title = match[1];
      xAxis.range = { min: Number.parseFloat(match[2]), max: Number.parseFloat(match[3]) };
      continue;
    }

    match = line.match(/^y-axis\s+(?:"([^"]*)"\s+)?(-?\d+(?:\.\d+)?)\s*-->\s*(-?\d+(?:\.\d+)?)/);
    if (match) {
      if (match[1]) yAxis.title = match[1];
      yAxis.range = { min: Number.parseFloat(match[2]), max: Number.parseFloat(match[3]) };
      continue;
    }

    match = line.match(/^y-axis\s+"([^"]+)"\s*$/);
    if (match) {
      yAxis.title = match[1];
      continue;
    }

    match = line.match(/^bar\s+\[([^\]]+)\]/);
    if (match) {
      series.push({ type: 'bar', data: parseData(match[1]) });
      continue;
    }

    match = line.match(/^line\s+\[([^\]]+)\]/);
    if (match) series.push({ type: 'line', data: parseData(match[1]) });
  }

  if (!yAxis.range && series.length) {
    const values = series.flatMap(item => item.data);
    let min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min || 1;
    min -= span * 0.1;
    if (min > 0 && min < span * 0.5) min = 0;
    yAxis.range = { min, max: max + span * 0.1 };
  }
  if (!yAxis.range) yAxis.range = { min: 0, max: 100 };

  return { type: 'xychart', title, horizontal, xAxis, yAxis, series };
}

function niceTicks(min, max) {
  const span = max - min;
  if (span <= 0) return [min];
  let step = span / 6;
  const base = 10 ** Math.floor(Math.log10(step));
  const normalized = step / base;
  step = normalized <= 1.5 ? base : normalized <= 3 ? 2 * base : normalized <= 7 ? 5 * base : 10 * base;
  let current = Math.ceil(min / step) * step;
  const result = [];
  while (current <= max + step * 0.001) {
    result.push(Math.round(current * 1e10) / 1e10);
    current += step;
  }
  return result;
}

function formatTick(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(Math.abs(value) < 10 ? 1 : 0);
}

function formatValue(value) {
  return Number.isInteger(value) ? value.toLocaleString('en-US') : value.toFixed(Math.abs(value) < 10 ? 1 : 0);
}

function categoryCount(model) {
  if (model.xAxis.categories) return model.xAxis.categories.length;
  for (const series of model.series) if (series.data.length) return series.data.length;
  return 1;
}

function categories(model, count) {
  if (model.xAxis.categories) return model.xAxis.categories;
  if (model.xAxis.range) {
    const min = model.xAxis.range.min;
    const max = model.xAxis.range.max;
    const step = count > 1 ? (max - min) / (count - 1) : 0;
    return Array.from({ length: count }, (_, index) => formatTick(min + step * index));
  }
  return Array.from({ length: count }, (_, index) => String(index + 1));
}

function categoryTicks(model, xScale, axisY) {
  const count = categoryCount(model);
  return categories(model, count).map((label, index) => ({
    label,
    x: xScale(index),
    y: axisY,
    tx: xScale(index),
    ty: axisY + 4,
    labelX: xScale(index),
    labelY: axisY + 18,
    textAnchor: 'middle',
  }));
}

function barsVertical(model, xScale, yScale, slotWidth, baseline, labels, colorIndexes) {
  const barSeriesCount = model.series.filter(series => series.type === 'bar').length;
  if (!barSeriesCount) return [];

  let barWidth = slotWidth * 0.8;
  barWidth = Math.min(barSeriesCount > 1 ? barWidth / barSeriesCount : barWidth, 40);
  const groupWidth = barSeriesCount > 1 ? barWidth * barSeriesCount : barWidth;

  const bars = [];
  let barSeries = 0;
  let seriesIndex = 0;
  for (const series of model.series) {
    if (series.type === 'bar') {
      for (let index = 0; index < series.data.length; index += 1) {
        const x = xScale(index) - groupWidth / 2 + barSeries * barWidth;
        const valueY = yScale(series.data[index]);
        const zeroY = yScale(Math.max(0, baseline));
        bars.push({
          x,
          y: Math.min(valueY, zeroY),
          width: barWidth,
          height: Math.abs(zeroY - valueY),
          value: series.data[index],
          label: labels[index],
          seriesIndex: barSeries,
          colorIndex: colorIndexes[seriesIndex],
        });
      }
      barSeries += 1;
    }
    seriesIndex += 1;
  }
  return bars;
}

function linesVertical(model, xScale, yScale, labels, colorIndexes) {
  const lines = [];
  let lineSeries = 0;
  let overall = 0;
  for (const series of model.series) {
    if (series.type !== 'line') {
      overall += 1;
      continue;
    }
    lines.push({
      points: series.data.map((value, index) => ({
        x: xScale(index),
        y: yScale(value),
        value,
        label: labels[index],
      })),
      seriesIndex: lineSeries,
      colorIndex: colorIndexes[overall],
    });
    lineSeries += 1;
    overall += 1;
  }
  return lines;
}

function legend(model, centerX, y, colorIndexes) {
  const entries = [];
  let barIndex = 0;
  let lineIndex = 0;
  for (let index = 0; index < model.series.length; index += 1) {
    const series = model.series[index];
    entries.push({
      label: series.type === 'bar' ? 'Bar ' + (barIndex + 1) : 'Line ' + (lineIndex + 1),
      x: 0,
      y,
      type: series.type,
      seriesIndex: series.type === 'bar' ? barIndex : lineIndex,
      colorIndex: colorIndexes[index],
    });
    if (series.type === 'bar') barIndex += 1;
    else lineIndex += 1;
  }

  const widths = entries.map(entry => 20 + measureText(entry.label, 14, 400));
  const total = widths.reduce((sum, width) => sum + width, 0) + Math.max(entries.length - 1, 0) * 16;
  let x = centerX - total / 2;
  entries.forEach((entry, index) => {
    entry.x = x;
    x += widths[index] + 16;
  });
  return entries;
}

export function layoutXYChart(model) {
  return model.horizontal ? layoutHorizontal(model) : layoutVertical(model);
}

function layoutVertical(model) {
  const hasTitle = Boolean(model.title);
  const hasXTitle = Boolean(model.xAxis.title);
  const hasYTitle = Boolean(model.yAxis.title);
  const hasLegend = model.series.length > 1;
  const range = model.yAxis.range;
  const ticks = niceTicks(range.min, range.max);
  const yLabelWidth = Math.max(...ticks.map(value => measureText(formatTick(value), 14, 400)), 58);

  const top = 22 + (hasTitle ? 42 : 0) + (hasLegend ? 28 : 0);
  const left = 22 + yLabelWidth + 18 + (hasYTitle ? 30 : 0);
  const width = left + 600 + 22;
  const height = top + 340 + (60 + (hasXTitle ? 30 : 0));
  const plotArea = { x: left, y: top, width: 600, height: 340 };

  const count = categoryCount(model);
  const xScale = index => left + 600 / count * (index + 0.5);
  const slotWidth = 600 / count;
  const yScale = value => top + 340 - (value - range.min) / (range.max - range.min || 1) * 340;

  const xTicks = categoryTicks(model, xScale, top + 340);
  const yTicks = ticks.map(value => ({
    label: formatTick(value),
    x: left,
    y: yScale(value),
    tx: left - 4,
    ty: yScale(value),
    labelX: left - 18,
    labelY: yScale(value),
    textAnchor: 'end',
  }));
  const gridLines = ticks.map(value => ({
    x1: left,
    y1: yScale(value),
    x2: left + 600,
    y2: yScale(value),
  }));

  const labels = categories(model, count);
  const colorIndexes = model.series.map((_, index) => index);
  const bars = barsVertical(model, xScale, yScale, slotWidth, range.min, labels, colorIndexes);
  const lines = linesVertical(model, xScale, yScale, labels, colorIndexes);

  return {
    width,
    height,
    horizontal: false,
    title: hasTitle ? { text: model.title, x: width / 2, y: 40 } : undefined,
    xAxis: {
      ticks: xTicks,
      line: { x1: left, y1: top + 340, x2: left + 600, y2: top + 340 },
      ...(hasXTitle ? { title: { text: model.xAxis.title, x: left + 300, y: height - 22 } } : {}),
    },
    yAxis: {
      ticks: yTicks,
      line: { x1: left, y1: top, x2: left, y2: top + 340 },
      ...(hasYTitle ? { title: { text: model.yAxis.title, x: 26, y: top + 170, rotate: -90 } } : {}),
    },
    plotArea,
    bars,
    lines,
    gridLines,
    legend: hasLegend ? legend(model, width / 2, 22 + (hasTitle ? 42 : 0) + 14, colorIndexes) : [],
  };
}

function layoutHorizontal(model) {
  const hasTitle = Boolean(model.title);
  const hasXTitle = Boolean(model.xAxis.title);
  const hasYTitle = Boolean(model.yAxis.title);
  const hasLegend = model.series.length > 1;
  const range = model.yAxis.range;
  const numericTicks = niceTicks(range.min, range.max);
  const count = categoryCount(model);
  const labels = categories(model, count);
  const categoryLabelWidth = Math.max(...labels.map(label => measureText(label, 14, 400)), 40);

  const top = 22 + (hasTitle ? 42 : 0) + (hasLegend ? 28 : 0);
  const left = 22 + categoryLabelWidth + 18 + (hasXTitle ? 30 : 0);
  const width = left + 600 + 22;
  const height = top + 340 + (60 + (hasYTitle ? 30 : 0));
  const plotArea = { x: left, y: top, width: 600, height: 340 };

  const xScale = value => left + (value - range.min) / (range.max - range.min || 1) * 600;
  const rowHeight = 340 / count;

  const xTicks = numericTicks.map(value => ({
    label: formatTick(value),
    x: xScale(value),
    y: top + 340,
    tx: xScale(value),
    ty: top + 344,
    labelX: xScale(value),
    labelY: top + 358,
    textAnchor: 'middle',
  }));
  const yTicks = labels.map((label, index) => ({
    label,
    x: left,
    y: top + (index + 0.5) * rowHeight,
    tx: left - 4,
    ty: top + (index + 0.5) * rowHeight,
    labelX: left - 18,
    labelY: top + (index + 0.5) * rowHeight,
    textAnchor: 'end',
  }));
  const gridLines = numericTicks.map(value => ({
    x1: xScale(value),
    y1: top,
    x2: xScale(value),
    y2: top + 340,
  }));

  const colorIndexes = model.series.map((_, index) => index);
  const barSeriesCount = model.series.filter(series => series.type === 'bar').length;
  const bars = [];
  if (barSeriesCount > 0) {
    let barHeight = rowHeight * 0.8;
    barHeight = Math.min(barSeriesCount > 1 ? barHeight / barSeriesCount : barHeight, 40);
    const groupHeight = barSeriesCount > 1 ? barHeight * barSeriesCount : barHeight;
    let barSeries = 0;
    let overall = 0;
    for (const series of model.series) {
      if (series.type === 'bar') {
        for (let index = 0; index < series.data.length; index += 1) {
          const y = top + (index + 0.5) * rowHeight - groupHeight / 2 + barSeries * barHeight;
          const valueX = xScale(Math.max(series.data[index], range.min));
          const zeroX = xScale(Math.max(0, range.min));
          bars.push({
            x: Math.min(zeroX, valueX),
            y,
            width: Math.abs(valueX - zeroX),
            height: barHeight,
            value: series.data[index],
            label: labels[index],
            seriesIndex: barSeries,
            colorIndex: colorIndexes[overall],
          });
        }
        barSeries += 1;
      }
      overall += 1;
    }
  }

  const lines = [];
  let lineSeries = 0;
  let overall = 0;
  for (const series of model.series) {
    if (series.type !== 'line') {
      overall += 1;
      continue;
    }
    lines.push({
      points: series.data.map((value, index) => ({
        x: xScale(value),
        y: top + (index + 0.5) * rowHeight,
        value,
        label: labels[index],
      })),
      seriesIndex: lineSeries,
      colorIndex: colorIndexes[overall],
    });
    lineSeries += 1;
    overall += 1;
  }

  return {
    width,
    height,
    horizontal: true,
    title: hasTitle ? { text: model.title, x: width / 2, y: 40 } : undefined,
    xAxis: {
      ticks: xTicks,
      line: { x1: left, y1: top + 340, x2: left + 600, y2: top + 340 },
      ...(hasYTitle ? { title: { text: model.yAxis.title, x: left + 300, y: height - 22 } } : {}),
    },
    yAxis: {
      ticks: yTicks,
      line: { x1: left, y1: top, x2: left, y2: top + 340 },
      ...(hasXTitle ? { title: { text: model.xAxis.title, x: 26, y: top + 170, rotate: -90 } } : {}),
    },
    plotArea,
    bars,
    lines,
    gridLines,
    legend: hasLegend ? legend(model, width / 2, 22 + (hasTitle ? 42 : 0) + 14, colorIndexes) : [],
  };
}

function rgbToHsl(hex) {
  const value = hex.replace('#', '');
  const r = Number.parseInt(value.slice(0, 2), 16) / 255;
  const g = Number.parseInt(value.slice(2, 4), 16) / 255;
  const b = Number.parseInt(value.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2;
  if (max === min) return [0, 0, lightness * 100];
  const delta = max - min;
  const saturation = (lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min)) * 100;
  let hue;
  if (max === r) hue = ((g - b) / delta + (g < b ? 6 : 0)) / 6;
  else if (max === g) hue = ((b - r) / delta + 2) / 6;
  else hue = ((r - g) / delta + 4) / 6;
  return [hue * 360, saturation, lightness * 100];
}

function seriesColor(index, baseColor, background) {
  if (index === 0) return baseColor;
  const bg = /^#[0-9a-fA-F]{6}$/.test(background) ? background : undefined;
  const source = /^#[0-9a-fA-F]{6}$/.test(baseColor) ? baseColor : '#3b82f6';
  let [hue, saturation] = rgbToHsl(source);
  const step = Math.ceil(index / 2);
  const odd = index % 2 === 1;
  const variant = bg && rgbToHsl(bg)[2] < 50 ? !odd : odd;
  hue = ((hue + (variant ? -8 : 12) * step) % 360 + 360) % 360;
  const lightness = (variant ? Math.max(25, 48 - step * 13) : Math.min(78, 55 + step * 11)) / 100;
  saturation = Math.max(55, Math.min(85, saturation)) / 100 * (1 - Math.abs(2 * lightness - 1));
  const x = saturation * (1 - Math.abs((hue / 60) % 2 - 1));
  const m = lightness - saturation / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (hue < 60) [r, g] = [saturation, x];
  else if (hue < 120) [r, g] = [x, saturation];
  else if (hue < 180) [g, b] = [saturation, x];
  else if (hue < 240) [g, b] = [x, saturation];
  else if (hue < 300) [r, b] = [x, saturation];
  else [r, b] = [saturation, x];
  return '#' + [r, g, b].map(channel =>
    Math.round((channel + m) * 255).toString(16).padStart(2, '0')
  ).join('');
}

function round(value) {
  return String(Math.round(value * 10) / 10);
}

function singleTooltip(x, y, text) {
  const width = measureText(text, 15, 500) + 28;
  const top = Math.max(4, y - 12 - 32 - 6);
  const bottom = top + 32;
  return '<rect x="' + round(x - width / 2) + '" y="' + round(top) + '" width="' + round(width) +
    '" height="32" rx="8" class="xychart-tip xychart-tip-bg"/>' +
    '<polygon points="' + round(x - 6) + ',' + round(bottom) + ' ' + round(x + 6) + ',' + round(bottom) + ' ' +
    round(x) + ',' + round(bottom + 6) + '" class="xychart-tip xychart-tip-ptr"/>' +
    '<text x="' + round(x) + '" y="' + round(top + 16) +
    '" text-anchor="middle" dy="0.35em" class="xychart-tip xychart-tip-text">' + escapeXML(text) + '</text>';
}

function multiTooltip(x, y, label, entries) {
  const labelWidth = measureText(label, 15, 600);
  const rowWidth = Math.max(...entries.map(entry =>
    measureText(entry.legendLabel, 15, 500) + 10 + measureText(entry.text, 15, 500)
  ));
  const width = Math.max(labelWidth, rowWidth) + 28;
  const height = 26 + entries.length * 20 + 6;
  const top = Math.max(4, y - 12 - height - 6);
  const left = x - width / 2;
  const bottom = top + height;
  let svg = '<rect x="' + round(left) + '" y="' + round(top) + '" width="' + round(width) +
    '" height="' + height + '" rx="8" class="xychart-tip xychart-tip-bg"/>';
  svg += '<polygon points="' + round(x - 6) + ',' + round(bottom) + ' ' + round(x + 6) + ',' + round(bottom) + ' ' +
    round(x) + ',' + round(bottom + 6) + '" class="xychart-tip xychart-tip-ptr"/>';
  let textY = top + 6 + 10;
  svg += '<text x="' + round(x) + '" y="' + round(textY) +
    '" text-anchor="middle" font-weight="600" font-size="15" dy="0.35em" class="xychart-tip xychart-tip-text">' +
    escapeXML(label) + '</text>';
  const leftText = left + 14;
  const rightText = left + width - 14;
  for (const entry of entries) {
    textY += 20;
    svg += '<text x="' + round(leftText) + '" y="' + round(textY) +
      '" text-anchor="start" font-size="15" font-weight="500" dy="0.35em" class="xychart-tip xychart-tip-text">' +
      escapeXML(entry.legendLabel) + '</text>';
    svg += '<text x="' + round(rightText) + '" y="' + round(textY) +
      '" text-anchor="end" font-size="15" font-weight="500" dy="0.35em" class="xychart-tip xychart-tip-text">' +
      escapeXML(entry.text) + '</text>';
  }
  return svg;
}

function verticalBarPath(x, y, width, height) {
  const radius = Math.min(8, width / 2, height / 2);
  if (radius <= 0) return 'M' + round(x) + ',' + round(y) + ' h' + round(width) + ' v' + round(height) + ' h' + round(-width) + ' Z';
  return [
    'M' + round(x) + ',' + round(y + radius),
    'Q' + round(x) + ',' + round(y) + ' ' + round(x + radius) + ',' + round(y),
    'L' + round(x + width - radius) + ',' + round(y),
    'Q' + round(x + width) + ',' + round(y) + ' ' + round(x + width) + ',' + round(y + radius),
    'L' + round(x + width) + ',' + round(y + height - radius),
    'Q' + round(x + width) + ',' + round(y + height) + ' ' + round(x + width - radius) + ',' + round(y + height),
    'L' + round(x + radius) + ',' + round(y + height),
    'Q' + round(x) + ',' + round(y + height) + ' ' + round(x) + ',' + round(y + height - radius),
    'Z',
  ].join(' ');
}

function horizontalBarPath(x, y, width, height) {
  const radius = Math.min(8, width / 2, height / 2);
  if (radius <= 0) return 'M' + round(x) + ',' + round(y) + ' h' + round(width) + ' v' + round(height) + ' h' + round(-width) + ' Z';
  return [
    'M' + round(x + radius) + ',' + round(y),
    'L' + round(x + width - radius) + ',' + round(y),
    'Q' + round(x + width) + ',' + round(y) + ' ' + round(x + width) + ',' + round(y + radius),
    'L' + round(x + width) + ',' + round(y + height - radius),
    'Q' + round(x + width) + ',' + round(y + height) + ' ' + round(x + width - radius) + ',' + round(y + height),
    'L' + round(x + radius) + ',' + round(y + height),
    'Q' + round(x) + ',' + round(y + height) + ' ' + round(x) + ',' + round(y + height - radius),
    'L' + round(x) + ',' + round(y + radius),
    'Q' + round(x) + ',' + round(y) + ' ' + round(x + radius) + ',' + round(y),
    'Z',
  ].join(' ');
}

function smoothPath(points) {
  if (!points.length) return '';
  if (points.length === 1) return 'M' + round(points[0].x) + ',' + round(points[0].y);
  if (points.length === 2) {
    return 'M' + round(points[0].x) + ',' + round(points[0].y) +
      ' L' + round(points[1].x) + ',' + round(points[1].y);
  }

  const count = points.length;
  const dx = [];
  const slopes = [];
  for (let index = 0; index < count - 1; index += 1) {
    dx.push(points[index + 1].x - points[index].x);
    slopes.push(dx[index] === 0 ? 0 : (points[index + 1].y - points[index].y) / dx[index]);
  }

  const second = Array(count).fill(0);
  const upper = Array(count).fill(0);
  const rhs = Array(count).fill(0);
  for (let index = 1; index < count - 1; index += 1) {
    let diagonal = 2 * (dx[index - 1] + dx[index]);
    const value = 3 * (slopes[index] - slopes[index - 1]);
    if (index === 1) {
      upper[index] = dx[index] / diagonal;
      rhs[index] = value / diagonal;
    } else {
      diagonal -= dx[index - 1] * upper[index - 1];
      upper[index] = dx[index] / diagonal;
      rhs[index] = (value - dx[index - 1] * rhs[index - 1]) / diagonal;
    }
  }
  for (let index = count - 2; index >= 1; index -= 1) {
    second[index] = rhs[index] - upper[index] * second[index + 1];
  }

  const first = Array(count).fill(0);
  for (let index = 0; index < count - 1; index += 1) {
    first[index] = slopes[index] - dx[index] * (2 * second[index] + second[index + 1]) / 3;
  }
  first[count - 1] = slopes[count - 2] + dx[count - 2] * second[count - 2] / 3;

  let path = 'M' + round(points[0].x) + ',' + round(points[0].y);
  for (let index = 0; index < count - 1; index += 1) {
    const step = dx[index] / 3;
    path += ' C' +
      round(points[index].x + step) + ',' + round(points[index].y + first[index] * step) + ' ' +
      round(points[index + 1].x - step) + ',' + round(points[index + 1].y - first[index + 1] * step) + ' ' +
      round(points[index + 1].x) + ',' + round(points[index + 1].y);
  }
  return path;
}

function chartStyle(layout, interactive, accent, background) {
  const base = accent ?? '#3b82f6';
  const indexes = new Set();
  for (const bar of layout.bars) indexes.add(bar.colorIndex);
  for (const line of layout.lines) indexes.add(line.colorIndex);

  const vars = [];
  const rules = [];
  for (const index of [...indexes].sort((a, b) => a - b)) {
    const color = index === 0 ? 'var(--accent, #3b82f6)' : seriesColor(index, base, background);
    vars.push('    --xychart-color-' + index + ': ' + color + ';');
    vars.push('    --xychart-bar-fill-' + index + ': color-mix(in srgb, var(--bg) 75%, var(--xychart-color-' + index + ') 25%);');
    rules.push('  .xychart-bar.xychart-color-' + index + ' { stroke: var(--xychart-color-' + index + '); fill: var(--xychart-bar-fill-' + index + '); }');
    rules.push('  path.xychart-color-' + index + ', line.xychart-color-' + index + ' { stroke: var(--xychart-color-' + index + '); }');
    rules.push('  circle.xychart-color-' + index + ' { fill: var(--xychart-color-' + index + '); }');
  }

  const tooltip = interactive
    ? '\n  .xychart-tip { opacity: 0; pointer-events: none; }\n' +
      '  .xychart-tip-bg { fill: var(--_text); filter: drop-shadow(0 1px 3px color-mix(in srgb, var(--fg) 20%, transparent)); }\n' +
      '  .xychart-tip-text { fill: var(--bg); font-size: 15px; font-weight: 500; }\n' +
      '  .xychart-tip-ptr { fill: var(--_text); }\n' +
      '  .xychart-bar-group:hover .xychart-tip,\n' +
      '  .xychart-dot-group:hover .xychart-tip { opacity: 1; }'
    : '';

  return '<style>\n' +
    '  .xychart-grid { fill: var(--_inner-stroke); stroke: none; opacity: 0.65; }\n' +
    '  .xychart-bar { stroke-width: 1.5; }\n' +
    '  .xychart-line { fill: none; stroke-width: 2.5; stroke-linecap: round; stroke-linejoin: round; }\n' +
    '  .xychart-line-shadow { fill: none; stroke-width: 5; stroke-linecap: round; stroke-linejoin: round; opacity: 0.12; }\n' +
    '  .xychart-dot { stroke: var(--bg); stroke-width: 2; }\n' +
    '  .xychart-label { fill: var(--_text-muted); }\n' +
    '  .xychart-axis-title { fill: var(--_text-sec); }\n' +
    '  .xychart-title { fill: var(--_text); }' +
    (vars.length ? '\n  svg {\n' + vars.join('\n') + '\n  }' : '') + '\n' +
    rules.join('\n') + tooltip + '\n</style>';
}

export function renderXYChartLayout(layout, palette, options = {}) {
  const font = options.font ?? 'Inter';
  const transparent = options.transparent ?? false;
  const interactive = options.interactive ?? false;
  const maxColor = Math.max(0, ...layout.bars.map(item => item.colorIndex), ...layout.lines.map(item => item.colorIndex));
  const open = svgOpen(layout.width, layout.height, palette, transparent)
    .replace('<svg ', '<svg data-xychart-colors="' + maxColor + '" ');
  const output = [open, svgThemeStyle(font, false), chartStyle(layout, interactive, palette.accent, palette.bg)];

  const linePointCount = Math.max(...layout.lines.map(line => line.points.length), 0);
  const showDots = linePointCount > 0 && linePointCount <= 12;

  const plot = layout.plotArea;
  const xCoordinates = layout.xAxis.ticks.map(tick => tick.x);
  const yCoordinates = layout.horizontal
    ? layout.yAxis.ticks.map(tick => tick.y)
    : layout.gridLines.map(line => line.y1);
  let xStep = xCoordinates.length > 1 ? Math.abs(xCoordinates[1] - xCoordinates[0]) : plot.width / 6;
  let yStep = yCoordinates.length > 1 ? Math.abs(yCoordinates[1] - yCoordinates[0]) : plot.height / 6;
  xStep /= Math.max(1, Math.round(xStep / 20));
  yStep /= Math.max(1, Math.round(yStep / 20));

  const xFirst = xCoordinates[0] ?? plot.x;
  const yFirst = yCoordinates[0] ?? plot.y;
  const xStart = xFirst - Math.ceil((xFirst - plot.x) / xStep) * xStep;
  const yStart = yFirst - Math.ceil((yFirst - plot.y) / yStep) * yStep;
  for (let y = yStart; y <= plot.y + plot.height + 0.5; y += yStep) {
    for (let x = xStart; x <= plot.x + plot.width + 0.5; x += xStep) {
      output.push('<circle cx="' + round(x) + '" cy="' + round(y) + '" r="1.5" class="xychart-grid"/>');
    }
  }

  const barTooltips = [];
  for (const bar of layout.bars) {
    const data = ' data-value="' + bar.value + '"' +
      (bar.label ? ' data-label="' + escapeXML(bar.label) + '"' : '');
    const path = layout.horizontal
      ? horizontalBarPath(bar.x, bar.y, bar.width, bar.height)
      : verticalBarPath(bar.x, bar.y, bar.width, bar.height);
    output.push('<path d="' + path + '" class="xychart-bar xychart-color-' + bar.colorIndex + '"' + data + '/>');

    if (interactive) {
      const valueText = formatValue(bar.value);
      const title = bar.label ? bar.label + ': ' + valueText : valueText;
      const tooltip = singleTooltip(bar.x + bar.width / 2, bar.y, valueText);
      barTooltips.push(
        '<g class="xychart-bar-group"><rect x="' + round(bar.x) + '" y="' + round(bar.y) +
        '" width="' + round(bar.width) + '" height="' + round(bar.height) +
        '" fill="transparent"/><title>' + escapeXML(title) + '</title>' + tooltip + '</g>'
      );
    }
  }

  for (const line of layout.lines) {
    if (!line.points.length) continue;
    const path = smoothPath(line.points);
    output.push('<path d="' + path + '" class="xychart-line-shadow xychart-color-' + line.colorIndex + '" transform="translate(0,2)"/>');
    output.push('<path d="' + path + '" class="xychart-line xychart-color-' + line.colorIndex + '"/>');
  }

  const lineTooltips = [];
  if (interactive || showDots) {
    const lineLegendLabels = new Map();
    for (const entry of layout.legend) {
      if (entry.type === 'line') lineLegendLabels.set(entry.seriesIndex, entry.label);
    }

    const groupedPoints = new Map();
    for (const line of layout.lines) {
      for (const point of line.points) {
        const key = round(point.x);
        if (!groupedPoints.has(key)) groupedPoints.set(key, []);
        groupedPoints.get(key).push({
          ...point,
          seriesIndex: line.seriesIndex,
          colorIndex: line.colorIndex,
        });
      }
    }

    for (const points of groupedPoints.values()) {
      const x = points[0].x;
      const label = points[0].label || '';

      if (interactive && points.length > 1) {
        const minY = Math.min(...points.map(point => point.y));
        const maxY = Math.max(...points.map(point => point.y));
        let group = '<g class="xychart-dot-group"><rect x="' + round(x - 15) +
          '" y="' + round(minY - 15) + '" width="30" height="' + round(maxY - minY + 30) +
          '" fill="transparent" class="xychart-hit"/>';
        const entries = points.map(point => ({
          text: formatValue(point.value),
          legendLabel: lineLegendLabels.get(point.seriesIndex) || 'Line ' + (point.seriesIndex + 1),
        }));
        for (const point of points) {
          const data = ' data-value="' + point.value + '"' +
            (point.label ? ' data-label="' + escapeXML(point.label) + '"' : '');
          group += '<circle cx="' + round(point.x) + '" cy="' + round(point.y) +
            '" r="5" class="xychart-dot xychart-color-' + point.colorIndex + '"' + data + '/>';
        }
        const values = entries.map(entry => entry.text);
        const title = label ? label + ': ' + values.join(' · ') : values.join(' · ');
        group += '<title>' + escapeXML(title) + '</title>' +
          multiTooltip(x, minY - 5, label, entries) + '</g>';
        lineTooltips.push(group);
        continue;
      }

      if (interactive) {
        const point = points[0];
        const data = ' data-value="' + point.value + '"' +
          (point.label ? ' data-label="' + escapeXML(point.label) + '"' : '');
        const valueText = formatValue(point.value);
        const title = point.label ? point.label + ': ' + valueText : valueText;
        let group = '<g class="xychart-dot-group">';
        if (showDots) {
          group += '<circle cx="' + round(x) + '" cy="' + round(point.y) +
            '" r="15" fill="transparent" class="xychart-hit"/>';
        }
        group += '<circle cx="' + round(point.x) + '" cy="' + round(point.y) +
          '" r="5" class="xychart-dot xychart-color-' + point.colorIndex + '"' + data + '/>' +
          '<title>' + escapeXML(title) + '</title>' +
          singleTooltip(x, point.y - 5, valueText) + '</g>';
        lineTooltips.push(group);
        continue;
      }

      for (const point of points) {
        const data = ' data-value="' + point.value + '"' +
          (point.label ? ' data-label="' + escapeXML(point.label) + '"' : '');
        output.push(
          '<circle cx="' + round(point.x) + '" cy="' + round(point.y) +
          '" r="5" class="xychart-dot xychart-color-' + point.colorIndex + '"' + data + '/>'
        );
      }
    }
  }

  for (const tick of layout.xAxis.ticks) {
    output.push(
      '<text x="' + tick.labelX + '" y="' + tick.labelY + '" text-anchor="' + tick.textAnchor +
      '" font-size="14" font-weight="400" dy="0.35em" class="xychart-label">' + escapeXML(tick.label) + '</text>'
    );
  }
  for (const tick of layout.yAxis.ticks) {
    output.push(
      '<text x="' + tick.labelX + '" y="' + tick.labelY + '" text-anchor="' + tick.textAnchor +
      '" font-size="14" font-weight="400" dy="0.35em" class="xychart-label">' + escapeXML(tick.label) + '</text>'
    );
  }

  const axisTitle = axis => {
    if (!axis?.title) return;
    const title = axis.title;
    output.push(
      '<text x="' + title.x + '" y="' + title.y + '" text-anchor="middle"' +
      (title.rotate ? ' transform="rotate(' + title.rotate + ',' + title.x + ',' + title.y + ')"' : '') +
      ' font-size="15" font-weight="500" dy="0.35em" class="xychart-axis-title">' +
      escapeXML(title.text) + '</text>'
    );
  };
  axisTitle(layout.xAxis);
  axisTitle(layout.yAxis);

  if (layout.title) {
    output.push(
      '<text x="' + layout.title.x + '" y="' + layout.title.y +
      '" text-anchor="middle" font-size="18" font-weight="600" dy="0.35em" class="xychart-title">' +
      escapeXML(layout.title.text) + '</text>'
    );
  }

  for (const entry of layout.legend) {
    if (entry.type === 'bar') {
      output.push(
        '<rect x="' + entry.x + '" y="' + (entry.y - 7) +
        '" width="14" height="14" rx="3" class="xychart-bar xychart-color-' + entry.colorIndex + '"/>'
      );
    } else {
      output.push(
        '<line x1="' + entry.x + '" y1="' + entry.y + '" x2="' + (entry.x + 14) + '" y2="' + entry.y +
        '" stroke-width="2.5" stroke-linecap="round" class="xychart-legend-line xychart-color-' + entry.colorIndex + '"/>'
      );
    }
    output.push(
      '<text x="' + (entry.x + 20) + '" y="' + entry.y +
      '" text-anchor="start" font-size="14" font-weight="400" dy="0.35em" class="xychart-label">' +
      escapeXML(entry.label) + '</text>'
    );
  }

  for (const tooltip of barTooltips) output.push(tooltip);
  for (const tooltip of lineTooltips) output.push(tooltip);

  output.push('</svg>');
  return output.join('\n');
}

export async function renderXYChart(source, { palette, font = 'Inter', transparent = false, interactive = false } = {}) {
  const model = parseXYChart(source);
  const layout = layoutXYChart(model);
  return {
    type: 'xychart',
    model,
    layout,
    svg: renderXYChartLayout(layout, palette, { font, transparent, interactive }),
  };
}
