(function () {

  const state = {
    mode:       'dither',
    source:     'none',
    // halftone
    shape:      'circle',
    dotScale:   0.9,
    // char
    char:       '.',
    charMode:   'ramp',      // 'ramp' | 'size'
    fontFamily: "'JetBrains Mono', monospace",
    // dither
    ditherAlgo: 'bayer-8',
    threshold:  50,
    pixelSize:  1,           // 1 = full res; larger = coarser / bigger crosshatch
    // shared grid
    cellSize:   12,
    angle:      45,
    // image
    brightness: 0,
    contrast:   3,
    blur:       0,
    mirror:     false,
    invert:     false,
    // color
    colorMode:  'mono',
    fgColor:    '#000000',
    bgColor:    '#b4b4b4',
    // runtime
    cameraStream: null,
    animFrame:    null,
    isLive:       false,
    uploadedImage:null,
    lastFrameTime:0,
    fps:          15,
  };

  const outputCanvas = document.getElementById('output-canvas');
  const outputCtx    = outputCanvas.getContext('2d');
  const video        = document.getElementById('video');

  const srcCanvas  = document.createElement('canvas');
  const srcCtx     = srcCanvas.getContext('2d', { willReadFrequently: true });

  const procCanvas = document.createElement('canvas');
  const procCtx    = procCanvas.getContext('2d', { willReadFrequently: true });

  // ── Canvas sizing ────────────────────────────────────────────────────────────

  function resizeCanvas() {
    const area = document.querySelector('.canvas-area');
    outputCanvas.width  = area.clientWidth;
    outputCanvas.height = area.clientHeight;
    triggerRender();
  }

  // ── Camera ───────────────────────────────────────────────────────────────────

  async function startCamera() {
    try {
      if (state.cameraStream) state.cameraStream.getTracks().forEach(t => t.stop());
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } }
      });
      state.cameraStream = stream;
      video.srcObject = stream;
      await video.play();
      state.source = 'camera';
      state.isLive = true;
      setActiveSource('camera');
      showStatus('Press SPACE to start photobooth');
      showNoSource(false);
      scheduleFrame();
    } catch (e) {
      showStatus('Camera unavailable — drop or upload an image');
      showNoSource(true);
    }
  }

  function stopCamera() {
    state.isLive = false;
    if (state.animFrame) { cancelAnimationFrame(state.animFrame); state.animFrame = null; }
    if (state.cameraStream) { state.cameraStream.getTracks().forEach(t => t.stop()); state.cameraStream = null; }
  }

  function scheduleFrame() {
    if (!state.isLive) return;
    state.animFrame = requestAnimationFrame(onFrame);
  }

  function onFrame(ts) {
    if (!state.isLive) return;
    if (ts - state.lastFrameTime >= 1000 / state.fps) {
      state.lastFrameTime = ts;
      if (video.readyState >= 2) processAndRender();
    }
    scheduleFrame();
  }

  // ── Draw source to srcCanvas ─────────────────────────────────────────────────

  function drawSource() {
    const src  = state.source === 'camera' ? video : state.uploadedImage;
    if (!src) return false;
    const sw   = state.source === 'camera' ? video.videoWidth  : src.naturalWidth;
    const sh   = state.source === 'camera' ? video.videoHeight : src.naturalHeight;
    if (!sw || !sh) return false;

    const cw = outputCanvas.width, ch = outputCanvas.height;
    srcCanvas.width = cw; srcCanvas.height = ch;

    const sa = sw / sh, ca = cw / ch;
    let dw, dh;
    if (sa > ca) { dh = ch; dw = dh * sa; }
    else         { dw = cw; dh = dw / sa; }
    const dx = (cw - dw) / 2, dy = (ch - dh) / 2;

    srcCtx.clearRect(0, 0, cw, ch);
    srcCtx.save();
    if (state.mirror) { srcCtx.translate(cw, 0); srcCtx.scale(-1, 1); }
    srcCtx.filter = state.blur > 0 ? `blur(${state.blur}px)` : 'none';
    srcCtx.drawImage(src, dx, dy, dw, dh);
    srcCtx.filter = 'none';
    srcCtx.restore();
    return true;
  }

  // ── Main render ──────────────────────────────────────────────────────────────

  function processAndRender() {
    if (!drawSource()) return;
    const cw = outputCanvas.width, ch = outputCanvas.height;
    const opts = getOptions();

    if (state.mode === 'halftone') {
      const imgData = srcCtx.getImageData(0, 0, cw, ch);
      if      (state.colorMode === 'cmyk') Halftone.renderCMYK(outputCtx, imgData, opts);
      else if (state.colorMode === 'rgb')  Halftone.renderRGB(outputCtx, imgData, opts);
      else                                 Halftone.render(outputCtx, imgData, opts);

    } else if (state.mode === 'char') {
      const imgData = srcCtx.getImageData(0, 0, cw, ch);
      Halftone.renderChar(outputCtx, imgData, opts);

    } else {
      // Dither — process at cw/pixelSize resolution, then scale up
      const ps = state.pixelSize;
      const pw = Math.max(1, Math.round(cw / ps));
      const ph = Math.max(1, Math.round(ch / ps));
      procCanvas.width = pw; procCanvas.height = ph;
      procCtx.imageSmoothingEnabled = ps > 1;
      procCtx.drawImage(srcCanvas, 0, 0, pw, ph);
      const imgData = procCtx.getImageData(0, 0, pw, ph);
      const gray    = Dither.apply(imgData, state.ditherAlgo, opts);
      renderDitherOut(gray, pw, ph, opts);
    }
  }

  function renderDitherOut(gray, pw, ph, opts) {
    const fg = hexToRgb(opts.invert ? opts.bgColor : opts.fgColor);
    const bg = hexToRgb(opts.invert ? opts.fgColor : opts.bgColor);

    const img = procCtx.createImageData(pw, ph);
    for (let i = 0; i < pw * ph; i++) {
      const c = gray[i] === 0 ? fg : bg;
      img.data[i*4]   = c[0];
      img.data[i*4+1] = c[1];
      img.data[i*4+2] = c[2];
      img.data[i*4+3] = 255;
    }
    procCtx.putImageData(img, 0, 0);

    const cw = outputCanvas.width, ch = outputCanvas.height;
    outputCtx.imageSmoothingEnabled = false;
    outputCtx.fillStyle = opts.bgColor;
    outputCtx.fillRect(0, 0, cw, ch);
    outputCtx.drawImage(procCanvas, 0, 0, cw, ch);
    outputCtx.imageSmoothingEnabled = true;
  }

  function hexToRgb(hex) {
    return [parseInt(hex.slice(1,3),16), parseInt(hex.slice(3,5),16), parseInt(hex.slice(5,7),16)];
  }

  function getOptions() {
    return {
      // halftone
      shape:      state.shape,
      dotScale:   state.dotScale,
      // char
      char:       state.char,
      charMode:   state.charMode,
      fontFamily: state.fontFamily,
      // shared
      cellSize:   state.cellSize,
      angle:      state.angle,
      // dither
      threshold:  state.threshold,
      ditherAlgo: state.ditherAlgo,
      // image
      brightness: state.brightness,
      contrast:   state.contrast,
      invert:     state.invert,
      // color
      colorMode:  state.colorMode,
      fgColor:    state.fgColor,
      bgColor:    state.bgColor,
      foreground: state.fgColor,
      background: state.bgColor,
    };
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  function triggerRender() {
    if (state.source !== 'none') processAndRender();
  }

  function showStatus(msg)       { const e = document.getElementById('status');    if (e) e.textContent = msg; }
  function showNoSource(visible) { const e = document.getElementById('no-source'); if (e) e.style.display = visible ? '' : 'none'; }
  function setActiveSource(src)  {
    document.getElementById('btn-camera').classList.toggle('active', src === 'camera');
    document.getElementById('btn-upload').classList.toggle('active', src === 'upload');
  }

  // ── Control binding ──────────────────────────────────────────────────────────

  function bindSlider(id, key, displayId, fmt) {
    const el = document.getElementById(id), disp = document.getElementById(displayId);
    if (!el) return;
    el.addEventListener('input', () => {
      state[key] = parseFloat(el.value);
      if (disp) disp.textContent = fmt ? fmt(state[key]) : state[key];
      triggerRender();
    });
  }

  function bindCheck(id, key) {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('change', e => { state[key] = e.target.checked; triggerRender(); });
  }

  function bindSelect(id, key, cb) {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('change', e => { state[key] = e.target.value; if (cb) cb(state[key]); triggerRender(); });
  }

  function bindColor(id, key) {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('input', e => { state[key] = e.target.value; triggerRender(); });
  }

  function bindControls() {
    // Source
    document.getElementById('btn-camera').addEventListener('click', () => { stopCamera(); startCamera(); });
    document.getElementById('btn-upload').addEventListener('click', () => document.getElementById('file-input').click());
    document.getElementById('file-input').addEventListener('change', e => { if (e.target.files[0]) loadFile(e.target.files[0]); });

    // Mode tabs
    document.querySelectorAll('.mode-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.mode = btn.dataset.mode;
        syncModeUI();
        triggerRender();
      });
    });

    // Halftone shapes
    document.querySelectorAll('.shape-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.shape-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.shape = btn.dataset.shape;
        triggerRender();
      });
    });

    // Halftone sliders
    bindSlider('dot-scale', 'dotScale', 'dot-scale-val', v => v.toFixed(2));

    // Char controls
    const charInput = document.getElementById('char-input');
    if (charInput) {
      charInput.addEventListener('input', () => {
        // Accept the full string — empty falls back to '.' in renderChar
        state.char = charInput.value;
        triggerRender();
      });
    }
    document.querySelectorAll('.char-pick').forEach(btn => {
      btn.addEventListener('click', () => {
        // Append to existing string (or replace if input is empty/single default)
        const current = (charInput && charInput.value.length > 0 && charInput.value !== '.') ? charInput.value : '';
        state.char = current + btn.dataset.char;
        if (charInput) charInput.value = state.char;
        triggerRender();
      });
    });
    document.querySelectorAll('.char-mode-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.char-mode-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.charMode = btn.dataset.charmode;
        triggerRender();
      });
    });
    bindSelect('font-family', 'fontFamily');

    // Dither
    bindSelect('dither-algo', 'ditherAlgo');
    bindSlider('threshold',  'threshold',  'threshold-val');
    bindSlider('pixel-size', 'pixelSize',  'pixel-size-val');

    // Shared grid
    bindSlider('cell-size', 'cellSize', 'cell-size-val');
    bindSlider('angle',     'angle',    'angle-val', v => v + '°');

    // Image
    bindSlider('brightness', 'brightness', 'brightness-val', v => (v > 0 ? '+' : '') + v);
    bindSlider('contrast',   'contrast',   'contrast-val',   v => (v > 0 ? '+' : '') + v);
    bindSlider('blur',       'blur',       'blur-val',       v => parseFloat(v).toFixed(1));
    bindCheck('mirror', 'mirror');
    bindCheck('invert', 'invert');

    // Color
    bindSelect('color-mode', 'colorMode', syncColorUI);
    bindColor('fg-color', 'fgColor');
    bindColor('bg-color', 'bgColor');

    // Presets
    document.querySelectorAll('.preset-btn').forEach(btn => {
      btn.addEventListener('click', () => applyPreset(btn.dataset.preset));
    });

    // Download
    document.getElementById('btn-download').addEventListener('click', downloadPNG);

    // Drag & drop
    const area = document.querySelector('.canvas-area');
    area.addEventListener('dragover', e => { e.preventDefault(); area.classList.add('drag-over'); });
    area.addEventListener('dragleave', () => area.classList.remove('drag-over'));
    area.addEventListener('drop', e => {
      e.preventDefault(); area.classList.remove('drag-over');
      const f = Array.from(e.dataTransfer.files).find(f => f.type.startsWith('image/'));
      if (f) loadFile(f);
    });

    // Paste
    document.addEventListener('paste', e => {
      const item = Array.from(e.clipboardData.items).find(i => i.type.startsWith('image/'));
      if (item) loadFile(item.getAsFile());
    });

    // Spacebar — photobooth trigger
    document.addEventListener('keydown', e => {
      if (e.code === 'Space' && e.target === document.body) {
        e.preventDefault();
        if (state.source === 'camera' && state.isLive) {
          Photobooth.onSpace();
        }
      }
    });
  }

  function loadFile(file) {
    stopCamera(); setActiveSource('upload'); showStatus(''); showNoSource(false);
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { state.uploadedImage = img; state.source = 'upload'; processAndRender(); URL.revokeObjectURL(url); };
    img.src = url;
  }

  // ── UI sync ──────────────────────────────────────────────────────────────────

  function syncModeUI() {
    const m = state.mode;
    document.getElementById('halftone-section').classList.toggle('hidden', m !== 'halftone');
    document.getElementById('char-section').classList.toggle('hidden', m !== 'char');
    document.getElementById('dither-section').classList.toggle('hidden', m !== 'dither');
    // Hide entire grid section in dither mode (uses pixelSize instead)
    const gridSection = document.getElementById('grid-section');
    if (gridSection) gridSection.classList.toggle('hidden', m === 'dither');
    // Hide angle in char mode? No — keep it, rotation is useful
    const angleRow = document.getElementById('angle-row');
    if (angleRow) angleRow.classList.toggle('hidden', m === 'dither');
    // Hide CMYK/RGB options in dither/char modes
    const cmRow = document.getElementById('color-mode-row');
    if (cmRow) cmRow.classList.toggle('hidden', m === 'dither');
    syncColorUI(state.colorMode);
  }

  function syncColorUI(mode) {
    const isMultiChannel = mode === 'rgb' || mode === 'cmyk';
    const fgRow = document.getElementById('fg-row');
    const bgRow = document.getElementById('bg-row');
    if (fgRow) fgRow.classList.toggle('hidden', isMultiChannel);
    if (bgRow) bgRow.classList.toggle('hidden', isMultiChannel && mode === 'rgb');
  }

  // ── Presets ──────────────────────────────────────────────────────────────────

  const PRESETS = {
    newspaper: {
      mode: 'dither', ditherAlgo: 'floyd-steinberg', threshold: 128, pixelSize: 1,
      colorMode: 'mono', fgColor: '#1a1505', bgColor: '#f0e8d0',
      brightness: -5, contrast: 25, blur: 0.5, invert: false
    },
    'offset-print': {
      mode: 'halftone', shape: 'circle', cellSize: 10, angle: 45,
      dotScale: 1.0, colorMode: 'cmyk', fgColor: '#000000', bgColor: '#ffffff',
      brightness: 0, contrast: 10, blur: 0, invert: false
    },
    risograph: {
      mode: 'halftone', shape: 'circle', cellSize: 6, angle: 30,
      dotScale: 0.85, colorMode: 'mono', fgColor: '#e63946', bgColor: '#f1faee',
      brightness: 5, contrast: 15, blur: 0, invert: false
    },
    lcd: {
      mode: 'dither', ditherAlgo: 'bayer-4', threshold: 100, pixelSize: 1,
      colorMode: 'mono', fgColor: '#00ff41', bgColor: '#001100',
      brightness: 0, contrast: 35, blur: 0, invert: false
    },
    woodblock: {
      mode: 'halftone', shape: 'line', cellSize: 9, angle: 5,
      dotScale: 0.92, colorMode: 'mono', fgColor: '#2d1a0e', bgColor: '#f5e0c0',
      brightness: -5, contrast: 40, blur: 1, invert: false
    },
    blueprint: {
      mode: 'dither', ditherAlgo: 'floyd-steinberg', threshold: 128, pixelSize: 1,
      colorMode: 'mono', fgColor: '#ffffff', bgColor: '#003380',
      brightness: 10, contrast: 20, blur: 0, invert: true
    },
    punk: {
      mode: 'dither', ditherAlgo: 'atkinson', threshold: 110, pixelSize: 1,
      colorMode: 'mono', fgColor: '#ff2d55', bgColor: '#0a0a0a',
      brightness: 5, contrast: 40, blur: 0, invert: false
    },
    silk: {
      mode: 'halftone', shape: 'diamond', cellSize: 8, angle: 60,
      dotScale: 0.8, colorMode: 'mono', fgColor: '#4a0080', bgColor: '#fff8f0',
      brightness: 0, contrast: 20, blur: 0.5, invert: false
    },
    monitor: {
      mode: 'char', char: '.', charMode: 'ramp', fontFamily: "'JetBrains Mono', monospace",
      cellSize: 7, angle: 0,
      colorMode: 'mono', fgColor: '#c8c8c8', bgColor: '#0a0a0a',
      brightness: 0, contrast: 20, blur: 0, invert: false
    },
    typewriter: {
      mode: 'char', char: '@', charMode: 'size', fontFamily: "'JetBrains Mono', monospace",
      cellSize: 14, angle: 0,
      colorMode: 'mono', fgColor: '#1a1a1a', bgColor: '#f5f0e8',
      brightness: 0, contrast: 25, blur: 0.5, invert: false
    },
  };

  function applyPreset(name) {
    const p = PRESETS[name]; if (!p) return;
    Object.assign(state, p);
    updateAllUI();
    triggerRender();
  }

  // ── Full UI sync from state ───────────────────────────────────────────────────

  function sv(id, displayId, value, fmt) {
    const el = document.getElementById(id), disp = document.getElementById(displayId);
    if (el)   el.value = value;
    if (disp) disp.textContent = fmt ? fmt(value) : value;
  }

  function updateAllUI() {
    // Mode tabs
    document.querySelectorAll('.mode-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === state.mode));
    syncModeUI();

    // Shapes
    document.querySelectorAll('.shape-btn').forEach(b => b.classList.toggle('active', b.dataset.shape === state.shape));

    // Char
    const ci = document.getElementById('char-input'); if (ci) ci.value = state.char;
    document.querySelectorAll('.char-mode-btn').forEach(b => b.classList.toggle('active', b.dataset.charmode === state.charMode));
    const ff = document.getElementById('font-family'); if (ff) ff.value = state.fontFamily;

    // Sliders
    sv('dot-scale',  'dot-scale-val',  state.dotScale,  v => parseFloat(v).toFixed(2));
    sv('threshold',  'threshold-val',  state.threshold);
    sv('pixel-size', 'pixel-size-val', state.pixelSize);
    sv('cell-size',  'cell-size-val',  state.cellSize);
    sv('angle',      'angle-val',      state.angle,     v => v + '°');
    sv('brightness', 'brightness-val', state.brightness, v => (v > 0 ? '+' : '') + v);
    sv('contrast',   'contrast-val',   state.contrast,  v => (v > 0 ? '+' : '') + v);
    sv('blur',       'blur-val',       state.blur,      v => parseFloat(v).toFixed(1));

    // Checks
    document.getElementById('mirror').checked = state.mirror;
    document.getElementById('invert').checked = state.invert;

    // Selects
    const da = document.getElementById('dither-algo'); if (da) da.value = state.ditherAlgo;
    const cm = document.getElementById('color-mode');  if (cm) cm.value = state.colorMode;

    // Colors
    document.getElementById('fg-color').value = state.fgColor;
    document.getElementById('bg-color').value = state.bgColor;
  }

  // ── Download ─────────────────────────────────────────────────────────────────

  function downloadPNG() {
    if (state.source === 'none') return;
    const a = document.createElement('a');
    a.download = `ddddddot_${Date.now()}.png`;
    a.href = outputCanvas.toDataURL('image/png');
    a.click();
  }

  // ── Init ─────────────────────────────────────────────────────────────────────

  function init() {
    resizeCanvas();
    bindControls();
    updateAllUI();
    window.addEventListener('resize', resizeCanvas);
    Photobooth.init(outputCanvas);
    showStatus('Requesting camera…');
    startCamera();
  }

  init();
})();
