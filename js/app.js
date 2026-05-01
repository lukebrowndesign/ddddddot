(function () {
  const MAX_DITHER_W = 720;

  const state = {
    mode: 'halftone',
    source: 'none',
    shape: 'circle',
    ditherAlgo: 'floyd-steinberg',
    cellSize: 12,
    angle: 45,
    dotScale: 0.9,
    threshold: 128,
    brightness: 0,
    contrast: 0,
    blur: 0,
    mirror: false,
    invert: false,
    colorMode: 'mono',
    fgColor: '#000000',
    bgColor: '#ffffff',
    cameraStream: null,
    animFrame: null,
    isLive: false,
    uploadedImage: null,
    lastFrameTime: 0,
    fps: 15,
  };

  const outputCanvas = document.getElementById('output-canvas');
  const outputCtx = outputCanvas.getContext('2d');
  const video = document.getElementById('video');

  const srcCanvas = document.createElement('canvas');
  const srcCtx = srcCanvas.getContext('2d', { willReadFrequently: true });

  const procCanvas = document.createElement('canvas');
  const procCtx = procCanvas.getContext('2d', { willReadFrequently: true });

  // ── Canvas sizing ────────────────────────────────────────────────────────────

  function resizeCanvas() {
    const area = document.querySelector('.canvas-area');
    outputCanvas.width = area.clientWidth;
    outputCanvas.height = area.clientHeight;
    triggerRender();
  }

  // ── Source: Camera ───────────────────────────────────────────────────────────

  async function startCamera() {
    try {
      if (state.cameraStream) {
        state.cameraStream.getTracks().forEach(t => t.stop());
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } }
      });
      state.cameraStream = stream;
      video.srcObject = stream;
      await video.play();
      state.source = 'camera';
      state.isLive = true;
      setActiveSource('camera');
      showStatus('SPACE to freeze');
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
    if (state.cameraStream) {
      state.cameraStream.getTracks().forEach(t => t.stop());
      state.cameraStream = null;
    }
  }

  // ── Animation loop ───────────────────────────────────────────────────────────

  function scheduleFrame() {
    if (!state.isLive) return;
    state.animFrame = requestAnimationFrame(onFrame);
  }

  function onFrame(ts) {
    if (!state.isLive) return;
    const interval = 1000 / state.fps;
    if (ts - state.lastFrameTime >= interval) {
      state.lastFrameTime = ts;
      if (video.readyState >= 2) processAndRender();
    }
    scheduleFrame();
  }

  // ── Processing pipeline ──────────────────────────────────────────────────────

  function drawSourceToCanvas(source, srcW, srcH) {
    const cw = outputCanvas.width, ch = outputCanvas.height;
    srcCanvas.width = cw;
    srcCanvas.height = ch;

    const srcAspect = srcW / srcH;
    const canvasAspect = cw / ch;
    let dw, dh;
    if (srcAspect > canvasAspect) { dh = ch; dw = dh * srcAspect; }
    else                           { dw = cw; dh = dw / srcAspect; }
    const dx = (cw - dw) / 2;
    const dy = (ch - dh) / 2;

    srcCtx.clearRect(0, 0, cw, ch);
    srcCtx.save();
    if (state.mirror) { srcCtx.translate(cw, 0); srcCtx.scale(-1, 1); }
    srcCtx.filter = state.blur > 0 ? `blur(${state.blur}px)` : 'none';
    srcCtx.drawImage(source, dx, dy, dw, dh);
    srcCtx.filter = 'none';
    srcCtx.restore();
  }

  function processAndRender() {
    const src = state.source === 'camera' ? video : state.uploadedImage;
    if (!src) return;
    const srcW = state.source === 'camera' ? video.videoWidth  : state.uploadedImage.naturalWidth;
    const srcH = state.source === 'camera' ? video.videoHeight : state.uploadedImage.naturalHeight;
    if (!srcW || !srcH) return;

    drawSourceToCanvas(src, srcW, srcH);

    const cw = outputCanvas.width, ch = outputCanvas.height;
    const opts = getOptions();

    if (state.mode === 'halftone') {
      const imgData = srcCtx.getImageData(0, 0, cw, ch);
      if (state.colorMode === 'cmyk')  Halftone.renderCMYK(outputCtx, imgData, opts);
      else if (state.colorMode === 'rgb') Halftone.renderRGB(outputCtx, imgData, opts);
      else                             Halftone.render(outputCtx, imgData, opts);
    } else {
      // Dither: process at capped resolution for perf, then upscale
      const scale = Math.min(1, MAX_DITHER_W / cw);
      const pw = Math.round(cw * scale);
      const ph = Math.round(ch * scale);
      procCanvas.width = pw; procCanvas.height = ph;
      procCtx.imageSmoothingEnabled = true;
      procCtx.drawImage(srcCanvas, 0, 0, pw, ph);
      const imgData = procCtx.getImageData(0, 0, pw, ph);
      const gray = Dither.apply(imgData, state.ditherAlgo, opts);
      renderDitherOutput(gray, pw, ph, opts);
    }
  }

  function renderDitherOutput(gray, pw, ph, opts) {
    const { fgColor, bgColor, invert } = opts;
    const fg = hexToRgb(invert ? bgColor : fgColor);
    const bg = hexToRgb(invert ? fgColor : bgColor);

    const imgData = procCtx.createImageData(pw, ph);
    for (let i = 0; i < pw * ph; i++) {
      const ink = gray[i] === 0;
      const c = ink ? fg : bg;
      imgData.data[i*4]   = c[0];
      imgData.data[i*4+1] = c[1];
      imgData.data[i*4+2] = c[2];
      imgData.data[i*4+3] = 255;
    }
    procCtx.putImageData(imgData, 0, 0);

    const cw = outputCanvas.width, ch = outputCanvas.height;
    outputCtx.imageSmoothingEnabled = false;
    outputCtx.fillStyle = opts.bgColor;
    outputCtx.fillRect(0, 0, cw, ch);
    outputCtx.drawImage(procCanvas, 0, 0, cw, ch);
    outputCtx.imageSmoothingEnabled = true;
  }

  function hexToRgb(hex) {
    return [
      parseInt(hex.slice(1,3), 16),
      parseInt(hex.slice(3,5), 16),
      parseInt(hex.slice(5,7), 16)
    ];
  }

  function getOptions() {
    return {
      cellSize:  state.cellSize,
      angle:     state.angle,
      shape:     state.shape,
      dotScale:  state.dotScale,
      threshold: state.threshold,
      brightness:state.brightness,
      contrast:  state.contrast,
      invert:    state.invert,
      fgColor:   state.fgColor,
      bgColor:   state.bgColor,
      foreground:state.fgColor,
      background:state.bgColor,
      colorMode: state.colorMode,
      ditherAlgo:state.ditherAlgo,
    };
  }

  // ── UI helpers ───────────────────────────────────────────────────────────────

  function triggerRender() {
    if (state.source === 'upload' && state.uploadedImage) processAndRender();
  }

  function showStatus(msg) {
    const el = document.getElementById('status');
    if (el) el.textContent = msg;
  }

  function showNoSource(visible) {
    const el = document.getElementById('no-source');
    if (el) el.style.display = visible ? '' : 'none';
  }

  function setActiveSource(src) {
    document.getElementById('btn-camera').classList.toggle('active', src === 'camera');
    document.getElementById('btn-upload').classList.toggle('active', src === 'upload');
  }

  function setFPS(mode) {
    state.fps = mode === 'dither' ? 8 : 15;
  }

  // ── Control binding ──────────────────────────────────────────────────────────

  function bindSlider(id, key, displayId, fmt) {
    const el = document.getElementById(id);
    const disp = document.getElementById(displayId);
    el.addEventListener('input', () => {
      state[key] = parseFloat(el.value);
      if (disp) disp.textContent = fmt ? fmt(state[key]) : state[key];
      triggerRender();
    });
  }

  function bindCheck(id, key) {
    document.getElementById(id).addEventListener('change', e => {
      state[key] = e.target.checked;
      triggerRender();
    });
  }

  function bindSelect(id, key, onChange) {
    document.getElementById(id).addEventListener('change', e => {
      state[key] = e.target.value;
      if (onChange) onChange(state[key]);
      triggerRender();
    });
  }

  function bindColor(id, key) {
    document.getElementById(id).addEventListener('input', e => {
      state[key] = e.target.value;
      triggerRender();
    });
  }

  function bindControls() {
    // Source
    document.getElementById('btn-camera').addEventListener('click', () => {
      stopCamera();
      startCamera();
    });

    document.getElementById('btn-upload').addEventListener('click', () => {
      document.getElementById('file-input').click();
    });

    document.getElementById('file-input').addEventListener('change', e => {
      const file = e.target.files[0];
      if (!file) return;
      loadImageFile(file);
    });

    // Mode tabs
    document.querySelectorAll('.mode-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.mode = btn.dataset.mode;
        setFPS(state.mode);
        syncModeUI();
        triggerRender();
      });
    });

    // Shapes
    document.querySelectorAll('.shape-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.shape-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.shape = btn.dataset.shape;
        triggerRender();
      });
    });

    // Halftone sliders
    bindSlider('cell-size', 'cellSize', 'cell-size-val');
    bindSlider('angle', 'angle', 'angle-val', v => v + '°');
    bindSlider('dot-scale', 'dotScale', 'dot-scale-val', v => v.toFixed(2));

    // Dither
    bindSelect('dither-algo', 'ditherAlgo');
    bindSlider('threshold', 'threshold', 'threshold-val');

    // Image
    bindSlider('brightness', 'brightness', 'brightness-val', v => (v > 0 ? '+' : '') + v);
    bindSlider('contrast', 'contrast', 'contrast-val', v => (v > 0 ? '+' : '') + v);
    bindSlider('blur', 'blur', 'blur-val', v => v.toFixed(1));
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
      e.preventDefault();
      area.classList.remove('drag-over');
      const file = Array.from(e.dataTransfer.files).find(f => f.type.startsWith('image/'));
      if (file) loadImageFile(file);
    });

    // Paste
    document.addEventListener('paste', e => {
      const item = Array.from(e.clipboardData.items).find(i => i.type.startsWith('image/'));
      if (item) loadImageFile(item.getAsFile());
    });

    // Spacebar: freeze / resume camera
    document.addEventListener('keydown', e => {
      if (e.code === 'Space' && e.target === document.body) {
        e.preventDefault();
        if (state.source === 'camera') {
          if (state.isLive) {
            state.isLive = false;
            if (state.animFrame) { cancelAnimationFrame(state.animFrame); state.animFrame = null; }
            showStatus('Frozen — SPACE to resume');
          } else {
            state.isLive = true;
            showStatus('SPACE to freeze');
            scheduleFrame();
          }
        }
      }
    });
  }

  function loadImageFile(file) {
    stopCamera();
    setActiveSource('upload');
    showStatus('');
    showNoSource(false);
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      state.uploadedImage = img;
      state.source = 'upload';
      processAndRender();
      URL.revokeObjectURL(url);
    };
    img.src = url;
  }

  function syncModeUI() {
    const isHalftone = state.mode === 'halftone';
    document.getElementById('halftone-section').classList.toggle('hidden', !isHalftone);
    document.getElementById('dither-section').classList.toggle('hidden', isHalftone);
    document.getElementById('color-section').classList.toggle('hidden', state.mode === 'halftone' && false);
    // Show color mode only for halftone
    document.getElementById('color-mode-row').classList.toggle('hidden', !isHalftone);
    syncColorUI(state.colorMode);
  }

  function syncColorUI(mode) {
    const isColor = mode === 'rgb' || mode === 'cmyk';
    document.getElementById('fg-row').classList.toggle('hidden', isColor);
    document.getElementById('bg-row').classList.toggle('hidden', isColor && mode === 'rgb');
  }

  // ── Presets ──────────────────────────────────────────────────────────────────

  const PRESETS = {
    newspaper: {
      mode: 'halftone', shape: 'circle', cellSize: 7, angle: 45,
      dotScale: 0.95, colorMode: 'mono', fgColor: '#1a1505', bgColor: '#f0e8d0',
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
      mode: 'dither', ditherAlgo: 'bayer-4', threshold: 128,
      colorMode: 'mono', fgColor: '#00ff41', bgColor: '#001100',
      brightness: 0, contrast: 35, blur: 0, invert: false
    },
    woodblock: {
      mode: 'halftone', shape: 'line', cellSize: 9, angle: 5,
      dotScale: 0.92, colorMode: 'mono', fgColor: '#2d1a0e', bgColor: '#f5e0c0',
      brightness: -5, contrast: 40, blur: 1, invert: false
    },
    blueprint: {
      mode: 'dither', ditherAlgo: 'floyd-steinberg', threshold: 128,
      colorMode: 'mono', fgColor: '#ffffff', bgColor: '#003380',
      brightness: 10, contrast: 20, blur: 0, invert: true
    },
    punk: {
      mode: 'dither', ditherAlgo: 'atkinson', threshold: 110,
      colorMode: 'mono', fgColor: '#ff2d55', bgColor: '#0a0a0a',
      brightness: 5, contrast: 40, blur: 0, invert: false
    },
    silk: {
      mode: 'halftone', shape: 'diamond', cellSize: 8, angle: 60,
      dotScale: 0.8, colorMode: 'mono', fgColor: '#4a0080', bgColor: '#fff8f0',
      brightness: 0, contrast: 20, blur: 0.5, invert: false
    },
  };

  function applyPreset(name) {
    const p = PRESETS[name];
    if (!p) return;
    Object.assign(state, p);
    updateAllUI();
    triggerRender();
  }

  // ── Sync UI from state ───────────────────────────────────────────────────────

  function setSliderUI(id, displayId, value, fmt) {
    const el = document.getElementById(id);
    const disp = document.getElementById(displayId);
    if (el) el.value = value;
    if (disp) disp.textContent = fmt ? fmt(value) : value;
  }

  function updateAllUI() {
    // Mode
    document.querySelectorAll('.mode-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === state.mode));
    syncModeUI();

    // Shapes
    document.querySelectorAll('.shape-btn').forEach(b => b.classList.toggle('active', b.dataset.shape === state.shape));

    // Sliders
    setSliderUI('cell-size', 'cell-size-val', state.cellSize);
    setSliderUI('angle', 'angle-val', state.angle, v => v + '°');
    setSliderUI('dot-scale', 'dot-scale-val', state.dotScale, v => parseFloat(v).toFixed(2));
    setSliderUI('threshold', 'threshold-val', state.threshold);
    setSliderUI('brightness', 'brightness-val', state.brightness, v => (v > 0 ? '+' : '') + v);
    setSliderUI('contrast', 'contrast-val', state.contrast, v => (v > 0 ? '+' : '') + v);
    setSliderUI('blur', 'blur-val', state.blur, v => parseFloat(v).toFixed(1));

    // Checks
    document.getElementById('mirror').checked = state.mirror;
    document.getElementById('invert').checked = state.invert;

    // Selects
    document.getElementById('dither-algo').value = state.ditherAlgo;
    document.getElementById('color-mode').value = state.colorMode;

    // Colors
    document.getElementById('fg-color').value = state.fgColor;
    document.getElementById('bg-color').value = state.bgColor;

    setFPS(state.mode);
  }

  // ── Download ─────────────────────────────────────────────────────────────────

  function downloadPNG() {
    if (!state.uploadedImage && !state.cameraStream) return;
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

    showStatus('Requesting camera…');
    startCamera();
  }

  init();
})();
