const Dither = (() => {
  const BAYER_2 = [[0,2],[3,1]];

  const BAYER_4 = [
    [ 0, 8, 2,10],
    [12, 4,14, 6],
    [ 3,11, 1, 9],
    [15, 7,13, 5]
  ];

  const BAYER_8 = [
    [ 0,32, 8,40, 2,34,10,42],
    [48,16,56,24,50,18,58,26],
    [12,44, 4,36,14,46, 6,38],
    [60,28,52,20,62,30,54,22],
    [ 3,35,11,43, 1,33, 9,41],
    [51,19,59,27,49,17,57,25],
    [15,47, 7,39,13,45, 5,37],
    [63,31,55,23,61,29,53,21]
  ];

  const BAYER_16 = (() => {
    const m = new Array(16).fill(null).map(() => new Array(16));
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        const bx = x % 8, by = y % 8;
        const base = BAYER_8[by][bx];
        const quad = ((x >= 8) ? 2 : 0) + ((y >= 8) ? 1 : 0);
        const offsets = [0, 192, 48, 144];
        m[y][x] = base * 4 + [0,2,3,1][quad];
      }
    }
    return m;
  })();

  function lum(r, g, b) {
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  function clamp(v) {
    return v < 0 ? 0 : v > 255 ? 255 : v;
  }

  function toGray(imageData, brightness, contrast) {
    const { data, width, height } = imageData;
    const n = width * height;
    const gray = new Float32Array(n);
    const cf = contrast !== 0 ? (259 * (contrast + 255)) / (255 * (259 - contrast)) : 1;

    for (let i = 0; i < n; i++) {
      const b = i * 4;
      let v = lum(data[b], data[b+1], data[b+2]);
      if (brightness !== 0) v = clamp(v + brightness * 2.55);
      if (contrast !== 0) v = clamp(cf * (v - 128) + 128);
      gray[i] = v;
    }
    return gray;
  }

  function errorDiffuse(gray, width, height, threshold, weights) {
    const out = new Uint8Array(width * height);
    const err = new Float32Array(width * height);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        const old = clamp(gray[i] + err[i]);
        const nw = old > threshold ? 255 : 0;
        out[i] = nw;
        const e = old - nw;
        for (const [dx, dy, w] of weights) {
          const nx = x + dx, ny = y + dy;
          if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
            err[ny * width + nx] += e * w;
          }
        }
      }
    }
    return out;
  }

  const FLOYD_STEINBERG = [[1,0,7/16],[-1,1,3/16],[0,1,5/16],[1,1,1/16]];
  const ATKINSON = [[1,0,1/8],[2,0,1/8],[-1,1,1/8],[0,1,1/8],[1,1,1/8],[0,2,1/8]];
  const SIERRA = [
    [1,0,5/32],[2,0,3/32],
    [-2,1,2/32],[-1,1,4/32],[0,1,5/32],[1,1,4/32],[2,1,2/32],
    [-1,2,2/32],[0,2,3/32],[1,2,2/32]
  ];
  const SIERRA_TWO = [
    [1,0,4/16],[2,0,3/16],
    [-2,1,1/16],[-1,1,2/16],[0,1,3/16],[1,1,2/16],[2,1,1/16]
  ];
  const SIERRA_LITE = [[1,0,2/4],[-1,1,1/4],[0,1,1/4]];
  const STUCKI = [
    [1,0,8/42],[2,0,4/42],
    [-2,1,2/42],[-1,1,4/42],[0,1,8/42],[1,1,4/42],[2,1,2/42],
    [-2,2,1/42],[-1,2,2/42],[0,2,4/42],[1,2,2/42],[2,2,1/42]
  ];
  const BURKES = [
    [1,0,8/32],[2,0,4/32],
    [-2,1,2/32],[-1,1,4/32],[0,1,8/32],[1,1,4/32],[2,1,2/32]
  ];
  const JARVIS = [
    [1,0,7/48],[2,0,5/48],
    [-2,1,3/48],[-1,1,5/48],[0,1,7/48],[1,1,5/48],[2,1,3/48],
    [-2,2,1/48],[-1,2,3/48],[0,2,5/48],[1,2,3/48],[2,2,1/48]
  ];

  function bayer(gray, width, height, threshold, matrix) {
    const n = matrix.length;
    const scale = 255 / (n * n);
    const out = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        const offset = (matrix[y % n][x % n] * scale) - 127.5;
        out[i] = gray[i] + offset > threshold ? 255 : 0;
      }
    }
    return out;
  }

  function randomDither(gray, width, height, threshold) {
    const out = new Uint8Array(width * height);
    for (let i = 0; i < width * height; i++) {
      out[i] = gray[i] + (Math.random() - 0.5) * 128 > threshold ? 255 : 0;
    }
    return out;
  }

  function thresholdOnly(gray, width, height, threshold) {
    const out = new Uint8Array(width * height);
    for (let i = 0; i < width * height; i++) {
      out[i] = gray[i] > threshold ? 255 : 0;
    }
    return out;
  }

  function apply(imageData, algo, opts = {}) {
    const { threshold = 128, brightness = 0, contrast = 0 } = opts;
    const { width, height } = imageData;
    const gray = toGray(imageData, brightness, contrast);

    switch (algo) {
      case 'floyd-steinberg': return errorDiffuse(gray, width, height, threshold, FLOYD_STEINBERG);
      case 'atkinson':        return errorDiffuse(gray, width, height, threshold, ATKINSON);
      case 'sierra':          return errorDiffuse(gray, width, height, threshold, SIERRA);
      case 'sierra-two':      return errorDiffuse(gray, width, height, threshold, SIERRA_TWO);
      case 'sierra-lite':     return errorDiffuse(gray, width, height, threshold, SIERRA_LITE);
      case 'stucki':          return errorDiffuse(gray, width, height, threshold, STUCKI);
      case 'burkes':          return errorDiffuse(gray, width, height, threshold, BURKES);
      case 'jarvis':          return errorDiffuse(gray, width, height, threshold, JARVIS);
      case 'bayer-2':         return bayer(gray, width, height, threshold, BAYER_2);
      case 'bayer-4':         return bayer(gray, width, height, threshold, BAYER_4);
      case 'bayer-8':         return bayer(gray, width, height, threshold, BAYER_8);
      case 'bayer-16':        return bayer(gray, width, height, threshold, BAYER_16);
      case 'random':          return randomDither(gray, width, height, threshold);
      case 'threshold':       return thresholdOnly(gray, width, height, threshold);
      default:                return errorDiffuse(gray, width, height, threshold, FLOYD_STEINBERG);
    }
  }

  return { apply };
})();
