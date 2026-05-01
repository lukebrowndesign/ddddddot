const Halftone = (() => {
  function clamp(v, min, max) { return v < min ? min : v > max ? max : v; }

  function sampleLum(data, width, height, cx, cy, cellSize) {
    const half = Math.floor(cellSize / 2);
    const step = Math.max(1, Math.floor(cellSize / 3));
    const x0 = clamp(Math.floor(cx - half), 0, width - 1);
    const x1 = clamp(Math.ceil(cx + half), 0, width - 1);
    const y0 = clamp(Math.floor(cy - half), 0, height - 1);
    const y1 = clamp(Math.ceil(cy + half), 0, height - 1);

    let sum = 0, count = 0;
    for (let y = y0; y <= y1; y += step) {
      for (let x = x0; x <= x1; x += step) {
        const b = (y * width + x) * 4;
        sum += 0.2126 * data[b] + 0.7152 * data[b+1] + 0.0722 * data[b+2];
        count++;
      }
    }
    return count > 0 ? sum / count : 0;
  }

  function sampleChannel(data, width, height, x, y, ch) {
    const px = clamp(Math.round(x), 0, width - 1);
    const py = clamp(Math.round(y), 0, height - 1);
    return data[(py * width + px) * 4 + ch];
  }

  function applyAdjust(lum, brightness, contrast) {
    if (brightness !== 0) lum = clamp(lum + brightness * 2.55, 0, 255);
    if (contrast !== 0) {
      const cf = (259 * (contrast + 255)) / (255 * (259 - contrast));
      lum = clamp(cf * (lum - 128) + 128, 0, 255);
    }
    return lum;
  }

  function hexToRgb(hex) {
    const r = parseInt(hex.slice(1,3), 16);
    const g = parseInt(hex.slice(3,5), 16);
    const b = parseInt(hex.slice(5,7), 16);
    return [r, g, b];
  }

  // --- Shape drawers (ctx already translated+rotated to dot center) ---
  function drawCircle(ctx, r) {
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawSquare(ctx, r) {
    const s = r * 1.35;
    ctx.fillRect(-s, -s, s * 2, s * 2);
  }

  function drawDiamond(ctx, r) {
    const s = r * 1.4;
    ctx.beginPath();
    ctx.moveTo(0, -s);
    ctx.lineTo(s, 0);
    ctx.lineTo(0, s);
    ctx.lineTo(-s, 0);
    ctx.closePath();
    ctx.fill();
  }

  function drawCross(ctx, r) {
    const arm = r, w = r * 0.38;
    ctx.fillRect(-arm, -w, arm * 2, w * 2);
    ctx.fillRect(-w, -arm, w * 2, arm * 2);
  }

  function drawLine(ctx, r, cellSize) {
    ctx.fillRect(-r, -cellSize * 0.5, r * 2, cellSize);
  }

  function drawTriangle(ctx, r) {
    const h = r * 1.3;
    ctx.beginPath();
    ctx.moveTo(0, -h);
    ctx.lineTo(h, h * 0.6);
    ctx.lineTo(-h, h * 0.6);
    ctx.closePath();
    ctx.fill();
  }

  function drawRing(ctx, r) {
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.arc(0, 0, r * 0.45, 0, Math.PI * 2, true);
    ctx.fill();
  }

  function getShapeFn(shape) {
    switch (shape) {
      case 'square':   return drawSquare;
      case 'diamond':  return drawDiamond;
      case 'cross':    return drawCross;
      case 'line':     return drawLine;
      case 'triangle': return drawTriangle;
      case 'ring':     return drawRing;
      default:         return drawCircle;
    }
  }

  function gridLoop(outputCtx, sourceData, options, getRadius, getColor) {
    const { width, height } = outputCtx.canvas;
    const { cellSize, angle, shape, dotScale } = options;
    const shapeFn = getShapeFn(shape);
    const rad = (angle * Math.PI) / 180;
    const cos = Math.cos(rad), sin = Math.sin(rad);
    const cx = width / 2, cy = height / 2;
    const diag = Math.ceil(Math.sqrt(width * width + height * height) / 2) + cellSize * 2;

    for (let gy = -diag; gy <= diag; gy += cellSize) {
      for (let gx = -diag; gx <= diag; gx += cellSize) {
        const px = cx + gx * cos - gy * sin;
        const py = cy + gx * sin + gy * cos;

        if (px < -cellSize || px > width + cellSize || py < -cellSize || py > height + cellSize) continue;

        const r = getRadius(sourceData, px, py, options);
        if (r < 0.3) continue;

        const color = getColor ? getColor(sourceData, px, py) : null;
        if (color) outputCtx.fillStyle = color;

        outputCtx.save();
        outputCtx.translate(px, py);
        outputCtx.rotate(rad);
        if (shape === 'line') {
          drawLine(outputCtx, r, cellSize);
        } else {
          shapeFn(outputCtx, r);
        }
        outputCtx.restore();
      }
    }
  }

  function render(outputCtx, imageData, options) {
    const { width, height } = outputCtx.canvas;
    const { cellSize = 12, dotScale = 0.9, invert = false,
            foreground = '#000000', background = '#ffffff',
            brightness = 0, contrast = 0 } = options;

    outputCtx.fillStyle = background;
    outputCtx.fillRect(0, 0, width, height);
    outputCtx.fillStyle = foreground;

    const { data, width: sw, height: sh } = imageData;

    function getRadius(srcData, px, py, opts) {
      let lv = sampleLum(data, sw, sh, px, py, opts.cellSize);
      lv = applyAdjust(lv, brightness, contrast);
      let t = lv / 255;
      if (!invert) t = 1 - t;
      return t * opts.cellSize * 0.5 * dotScale;
    }

    gridLoop(outputCtx, imageData, options, getRadius, null);
  }

  function renderRGB(outputCtx, imageData, options) {
    const { width, height } = outputCtx.canvas;
    const { cellSize = 12, dotScale = 0.9, invert = false } = options;
    const { data, width: sw, height: sh } = imageData;

    outputCtx.fillStyle = '#000000';
    outputCtx.fillRect(0, 0, width, height);

    const channels = [
      { color: '#ff0000', ch: 0, angle: options.angle },
      { color: '#00ff00', ch: 1, angle: (options.angle + 30) % 90 },
      { color: '#0000ff', ch: 2, angle: (options.angle + 60) % 90 },
    ];

    const prev = outputCtx.globalCompositeOperation;
    outputCtx.globalCompositeOperation = 'screen';

    for (const { color, ch, angle } of channels) {
      outputCtx.fillStyle = color;
      const opts = { ...options, angle };
      const chIdx = ch;
      const makeR = (srcData, px, py, o) => {
        let v = sampleChannel(data, sw, sh, px, py, chIdx);
        let t = v / 255;
        if (invert) t = 1 - t;
        return t * o.cellSize * 0.5 * dotScale;
      };
      gridLoop(outputCtx, imageData, opts, makeR, null);
    }

    outputCtx.globalCompositeOperation = prev;
  }

  function renderCMYK(outputCtx, imageData, options) {
    const { width, height } = outputCtx.canvas;
    const { cellSize = 12, dotScale = 0.9, invert = false } = options;
    const { data, width: sw, height: sh } = imageData;

    outputCtx.fillStyle = '#ffffff';
    outputCtx.fillRect(0, 0, width, height);

    // CMYK channels at classic screen angles
    const channels = [
      { color: '#00ffff', angle: (options.angle + 15) % 90, idx: 'c' },
      { color: '#ff00ff', angle: (options.angle + 75) % 90, idx: 'm' },
      { color: '#ffff00', angle: (options.angle + 0)  % 90, idx: 'y' },
      { color: '#1a1a1a', angle: (options.angle + 45) % 90, idx: 'k' },
    ];

    const prev = outputCtx.globalCompositeOperation;
    outputCtx.globalCompositeOperation = 'multiply';

    for (const { color, angle, idx } of channels) {
      outputCtx.fillStyle = color;
      const opts = { ...options, angle };
      const chName = idx;
      const makeR = (srcData, px, py, o) => {
        const px2 = clamp(Math.round(px), 0, sw - 1);
        const py2 = clamp(Math.round(py), 0, sh - 1);
        const b = (py2 * sw + px2) * 4;
        const r = data[b] / 255, g = data[b+1] / 255, bl = data[b+2] / 255;
        const k = 1 - Math.max(r, g, bl);
        const div = (1 - k) || 1;
        const c = (1 - r - k) / div;
        const m = (1 - g - k) / div;
        const y = (1 - bl - k) / div;
        const vals = { c, m, y, k };
        let v = clamp(vals[chName] || 0, 0, 1);
        if (invert) v = 1 - v;
        return v * o.cellSize * 0.5 * dotScale;
      };
      gridLoop(outputCtx, imageData, opts, makeR, null);
    }

    outputCtx.globalCompositeOperation = prev;
  }

  return { render, renderRGB, renderCMYK };
})();
