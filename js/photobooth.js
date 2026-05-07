const Photobooth = (() => {
  const MAX = 4;

  let photos   = [];
  let mode     = 'idle';   // idle | countdown | prompt | building
  let timer    = null;
  let canvas   = null;     // the output canvas to capture from

  // DOM refs (populated by init)
  let overlayEl, countdownEl, promptEl, promptCountEl, thumbsEl,
      flashEl, modalEl, stripCanvasEl;

  // ── Init ─────────────────────────────────────────────────────────────────────

  function init(outputCanvas) {
    canvas = outputCanvas;

    overlayEl    = document.getElementById('pb-overlay');
    countdownEl  = document.getElementById('pb-countdown');
    promptEl     = document.getElementById('pb-prompt');
    promptCountEl= document.getElementById('pb-prompt-count');
    thumbsEl     = document.getElementById('pb-thumbs');
    flashEl      = document.getElementById('pb-flash');
    modalEl      = document.getElementById('pb-modal');
    stripCanvasEl= document.getElementById('pb-strip');

    document.getElementById('pb-btn-dl').addEventListener('click', downloadStrip);
    document.getElementById('pb-btn-wall').addEventListener('click', addToWall);
    document.getElementById('pb-btn-retake').addEventListener('click', reset);

    // Clicking the prompt triggers next shot
    promptEl.addEventListener('click', () => { if (mode === 'prompt') startCountdown(); });

    // ESC cancels / closes
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        if (!modalEl.classList.contains('pb-hidden')) {
          modalEl.classList.add('pb-hidden');
          reset();
        } else if (mode !== 'idle') {
          reset();
        }
      }
    });
  }

  // ── Public API ───────────────────────────────────────────────────────────────

  function onSpace() {
    if (mode === 'idle' || mode === 'prompt') startCountdown();
    // ignore during countdown or building
  }

  function isActive() { return mode !== 'idle'; }

  // ── Countdown ─────────────────────────────────────────────────────────────────

  function startCountdown() {
    mode = 'countdown';
    promptEl.classList.add('pb-hidden');
    overlayEl.classList.remove('pb-hidden');

    let n = 3;
    tick(n);

    timer = setInterval(() => {
      n--;
      if (n <= 0) {
        clearInterval(timer);
        timer = null;
        capturePhoto();
      } else {
        tick(n);
      }
    }, 1000);
  }

  function tick(n) {
    countdownEl.textContent = n;
    countdownEl.classList.remove('pb-tick');
    void countdownEl.offsetWidth; // reflow to restart animation
    countdownEl.classList.add('pb-tick');
  }

  // ── Capture ──────────────────────────────────────────────────────────────────

  function capturePhoto() {
    countdownEl.textContent = '';
    countdownEl.classList.remove('pb-tick');

    // Capture processed canvas
    const url = canvas.toDataURL('image/jpeg', 0.92);
    photos.push(url);

    // Flash effect
    doFlash();

    // Add thumbnail
    addThumb(url);

    if (photos.length >= MAX) {
      mode = 'building';
      setTimeout(buildStrip, 600);
    } else {
      mode = 'prompt';
      promptCountEl.textContent = `${photos.length} / ${MAX}`;
      promptEl.classList.remove('pb-hidden');
    }
  }

  function doFlash() {
    flashEl.style.transition = 'none';
    flashEl.style.opacity    = '1';
    // Next frame: start fade
    requestAnimationFrame(() => requestAnimationFrame(() => {
      flashEl.style.transition = 'opacity 0.5s ease-out';
      flashEl.style.opacity    = '0';
    }));
  }

  function addThumb(url) {
    const img = document.createElement('img');
    img.src = url;
    img.className = 'pb-thumb';
    thumbsEl.appendChild(img);
  }

  // ── Strip ────────────────────────────────────────────────────────────────────

  async function buildStrip() {
    overlayEl.classList.add('pb-hidden');

    const cw  = canvas.width;
    const ch  = canvas.height;
    const pad = Math.max(12, Math.round(cw * 0.012));
    const labelH = pad * 3;

    const stripW = 2 * cw + 3 * pad;
    const stripH = 2 * ch + 3 * pad + labelH;

    stripCanvasEl.width  = stripW;
    stripCanvasEl.height = stripH;
    const ctx = stripCanvasEl.getContext('2d');

    // Background — warm off-white
    ctx.fillStyle = '#ede8e0';
    ctx.fillRect(0, 0, stripW, stripH);

    // Load and draw all 4 photos
    await Promise.all(photos.map((url, i) => new Promise(resolve => {
      const img = new Image();
      img.onload = () => {
        const col = i % 2, row = Math.floor(i / 2);
        const x = pad + col * (cw + pad);
        const y = pad + row * (ch + pad);
        ctx.save();
        ctx.shadowColor = 'rgba(0,0,0,0.18)';
        ctx.shadowBlur  = pad * 1.5;
        ctx.drawImage(img, x, y, cw, ch);
        ctx.restore();
        resolve();
      };
      img.src = url;
    })));

    // Branding label
    const fSize = Math.round(labelH * 0.45);
    ctx.fillStyle   = '#aaa';
    ctx.font        = `700 ${fSize}px 'JetBrains Mono', monospace`;
    ctx.textAlign   = 'center';
    ctx.textBaseline= 'middle';
    ctx.fillText('DDDDDDOT', stripW / 2, stripH - labelH / 2);

    modalEl.classList.remove('pb-hidden');
  }

  // ── Actions ──────────────────────────────────────────────────────────────────

  function downloadStrip() {
    const a = document.createElement('a');
    a.download = `ddddddot_booth_${Date.now()}.jpg`;
    a.href = stripCanvasEl.toDataURL('image/jpeg', 0.95);
    a.click();
  }

  function addToWall() {
    // Scale down for storage (~800px wide)
    const maxW  = 800;
    const scale = Math.min(1, maxW / stripCanvasEl.width);
    const small = document.createElement('canvas');
    small.width  = Math.round(stripCanvasEl.width  * scale);
    small.height = Math.round(stripCanvasEl.height * scale);
    small.getContext('2d').drawImage(stripCanvasEl, 0, 0, small.width, small.height);
    const dataUrl = small.toDataURL('image/jpeg', 0.72);

    try {
      const wall = JSON.parse(localStorage.getItem('ddddddot_wall') || '[]');
      wall.unshift({ dataUrl, ts: Date.now() });
      if (wall.length > 120) wall.length = 120;
      localStorage.setItem('ddddddot_wall', JSON.stringify(wall));

      const btn = document.getElementById('pb-btn-wall');
      const orig = btn.textContent;
      btn.textContent = '✓ Added!';
      btn.disabled = true;
      setTimeout(() => { btn.textContent = orig; btn.disabled = false; }, 2500);
    } catch (e) {
      alert('Storage full — download the strip instead.');
    }
  }

  // ── Reset ─────────────────────────────────────────────────────────────────────

  function reset() {
    if (timer) { clearInterval(timer); timer = null; }
    photos = [];
    mode   = 'idle';
    overlayEl.classList.add('pb-hidden');
    modalEl.classList.add('pb-hidden');
    promptEl.classList.add('pb-hidden');
    countdownEl.textContent = '';
    countdownEl.classList.remove('pb-tick');
    thumbsEl.innerHTML = '';
  }

  return { init, onSpace, isActive, reset };
})();
