const PALETTE = ['#ffffff', '#000000', '#f87171', '#fb923c', '#facc15', '#4ade80', '#67e8f9', '#3b82f6', '#a78bfa', '#f472b6'];
const BRUSH = [3, 7, 14];
const DOTS = [6, 10, 15];
const WORK_MAX = 1600;
const OUT_MAX = 900;
const CAP = 150000;
const MIN_SEL = 8;
const HINT_KEY = 'imgEditHint';

const CURSORS = {
  nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize',
  n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize',
  move: 'move', new: 'crosshair',
};

let S = null;

function node(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function copyCanvas(src) {
  const c = makeCanvas(src.width, src.height);
  c.getContext('2d').drawImage(src, 0, 0);
  return c;
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const unit = s => Math.max(s.base.width, s.base.height) / 800;

function chip(label, onClick, cls) {
  const b = node('button', 'chip' + (cls ? ' ' + cls : ''), label);
  b.tabIndex = -1;
  b.addEventListener('click', () => { b.blur(); onClick(); });
  return b;
}

function say(s, text, bad) {
  if (!s.msg) return;
  s.msg.textContent = text;
  s.msg.className = 'ie-msg ' + (bad ? 'fail' : 'dim');
}

function firstTime() {
  try { return localStorage.getItem(HINT_KEY) !== '1'; } catch { return false; }
}

function markSeen() {
  try { localStorage.setItem(HINT_KEY, '1'); } catch { /* storage unavailable */ }
}

export function openEditor(root, opts) {
  closeEditor();
  let base;
  if (opts.image) {
    const w0 = opts.image.naturalWidth || opts.image.width;
    const h0 = opts.image.naturalHeight || opts.image.height;
    const k = Math.min(1, WORK_MAX / Math.max(w0, h0));
    base = makeCanvas(Math.max(1, Math.round(w0 * k)), Math.max(1, Math.round(h0 * k)));
    const x = base.getContext('2d');
    x.imageSmoothingQuality = 'high';
    x.drawImage(opts.image, 0, 0, base.width, base.height);
  } else {
    base = makeCanvas(opts.blank.w, opts.blank.h);
    const x = base.getContext('2d');
    x.fillStyle = opts.blank.bg;
    x.fillRect(0, 0, base.width, base.height);
  }
  const s = {
    root, opts, base,
    original: copyCanvas(base),
    ink: makeCanvas(base.width, base.height),
    strokes: [], cur: null, tool: 'draw', color: '#f87171', size: 1,
    sel: null, drag: null,
    mode: opts.image ? 'preview' : 'edit',
    fromPreview: !!opts.image,
    showFirst: !!opts.image && firstTime(),
    caption: '',
    t0: Date.now(),
    view: null, prev: null, stage: null, cap: null, hint: null, msg: null,
    paint: null, pick: null, applyRow: null,
    swatches: [], sizeBtns: [], toolBtns: {},
  };
  S = s;
  if (s.showFirst) markSeen();
  showMode(s);
}

export function closeEditor() {
  if (!S) return;
  S.root.replaceChildren();
  S.root.hidden = true;
  S = null;
}

function showMode(s) {
  s.swatches = [];
  s.sizeBtns = [];
  s.toolBtns = {};
  s.cur = null;
  s.drag = null;
  s.root.replaceChildren();
  if (s.mode === 'preview') buildPreview(s); else buildEdit(s);
  s.root.hidden = false;
  layout(s);
  requestAnimationFrame(() => { if (S === s) layout(s); });
}

function layout(s) {
  if (!s.stage) return;
  const aw = Math.max(80, s.stage.clientWidth - 24);
  const hintH = s.mode === 'preview' && s.showFirst ? 34 : 0;
  const ah = Math.max(80, s.stage.clientHeight - 24 - hintH);
  if (s.mode === 'preview') {
    const sc = Math.min(aw / s.base.width, ah / s.base.height, 1);
    s.prev.width = Math.max(1, Math.round(s.base.width * sc));
    s.prev.height = Math.max(1, Math.round(s.base.height * sc));
    const x = s.prev.getContext('2d');
    x.imageSmoothingQuality = 'high';
    x.drawImage(s.base, 0, 0, s.prev.width, s.prev.height);
    x.drawImage(s.ink, 0, 0, s.prev.width, s.prev.height);
  } else {
    const sc = Math.min(aw / s.base.width, ah / s.base.height, 2);
    s.view.width = Math.max(1, Math.round(s.base.width * sc));
    s.view.height = Math.max(1, Math.round(s.base.height * sc));
    redraw(s);
  }
}

// ---------- preview ----------
function buildPreview(s) {
  const top = node('div', 'ie-top');
  top.appendChild(node('span', 'ie-title', s.opts.title || 'Send picture'));

  const stage = node('div', 'ie-stage');
  if (s.showFirst) stage.appendChild(node('p', 'ie-first', 'edit your image by clicking on it!'));
  const frame = node('div', 'ie-frame');
  const prev = node('canvas', 'ie-prev');
  const over = node('div', 'ie-over');
  over.append(node('span', 'ie-pencil', '✎'), node('span', 'ie-edit', 'edit'));
  frame.append(prev, over);
  frame.addEventListener('click', () => enterEdit(s));
  stage.appendChild(frame);
  s.stage = stage;
  s.prev = prev;

  const bottom = node('div', 'ie-bottom');
  const cap = node('input', 'ie-cap');
  cap.type = 'text';
  cap.maxLength = 300;
  cap.placeholder = 'Add a comment (optional)';
  cap.autocomplete = 'off';
  cap.spellcheck = false;
  cap.value = s.caption;
  cap.addEventListener('input', () => { s.caption = cap.value; });
  s.cap = cap;
  bottom.append(cap, chip('Send (Enter)', () => sendNow(s), 'go'), chip('Cancel (Esc)', () => cancelNow(s)));

  s.msg = node('p', 'ie-msg dim');
  s.hint = node('p', 'ie-hint', 'Enter = send | Esc = cancel | click the picture to edit it | just start typing to add a comment');
  s.root.append(top, stage, s.msg, bottom, s.hint);
  requestAnimationFrame(() => { if (S === s && s.cap) s.cap.focus(); });
}

function enterEdit(s) {
  s.showFirst = false;
  s.mode = 'edit';
  s.tool = 'draw';
  s.sel = null;
  showMode(s);
}

function backToPreview(s) {
  s.mode = 'preview';
  s.tool = 'draw';
  s.sel = null;
  showMode(s);
}

// ---------- edit mode ----------
function buildEdit(s) {
  const top = node('div', 'ie-top');
  top.appendChild(node('span', 'ie-title', s.fromPreview ? 'Edit picture' : (s.opts.title || 'Drawing pad')));

  const tools = node('div', 'ie-group');
  s.toolBtns.draw = chip('✎ Draw', () => setTool(s, 'draw'));
  s.toolBtns.crop = chip('⌗ Crop', () => setTool(s, 'crop'));
  tools.append(s.toolBtns.draw, s.toolBtns.crop);

  const paint = node('div', 'ie-group');
  PALETTE.forEach(c => {
    const b = node('button', 'ie-sw');
    b.style.background = c;
    b.tabIndex = -1;
    b.title = c;
    b.addEventListener('click', () => { b.blur(); setColor(s, c); });
    s.swatches.push({ b, c });
    paint.appendChild(b);
  });
  const pick = node('input', 'ie-pick');
  pick.type = 'color';
  pick.value = s.color;
  pick.tabIndex = -1;
  pick.addEventListener('input', () => setColor(s, pick.value));
  s.pick = pick;
  paint.appendChild(pick);
  DOTS.forEach((d, i) => {
    const b = node('button', 'ie-size');
    b.tabIndex = -1;
    b.title = 'brush size ' + (i + 1);
    const dot = node('span', 'ie-dot');
    dot.style.width = d + 'px';
    dot.style.height = d + 'px';
    b.appendChild(dot);
    b.addEventListener('click', () => { b.blur(); setSize(s, i); });
    s.sizeBtns.push(b);
    paint.appendChild(b);
  });
  s.paint = paint;

  const acts = node('div', 'ie-group');
  acts.append(chip('Undo', () => undo(s)), chip('Reset', () => reset(s)));

  top.append(tools, paint, acts);

  const stage = node('div', 'ie-stage');
  const view = node('canvas', 'ie-view');
  stage.appendChild(view);
  s.stage = stage;
  s.view = view;
  bindPointer(s);

  const bottom = node('div', 'ie-bottom');
  s.applyRow = node('div', 'ie-group');
  s.applyRow.append(chip('Apply crop (Enter)', () => applyCrop(s), 'go'), chip('Cancel crop (Esc)', () => setTool(s, 'draw')));
  bottom.appendChild(s.applyRow);

  if (s.fromPreview) {
    s.cap = null;
    s.doneBtn = chip('Done (Enter)', () => backToPreview(s), 'go');
    bottom.appendChild(s.doneBtn);
  } else {
    const cap = node('input', 'ie-cap');
    cap.type = 'text';
    cap.maxLength = 300;
    cap.placeholder = 'Add a comment (optional)';
    cap.autocomplete = 'off';
    cap.spellcheck = false;
    cap.value = s.caption;
    cap.addEventListener('input', () => { s.caption = cap.value; });
    s.cap = cap;
    s.doneBtn = chip('Send (Enter)', () => sendNow(s), 'go');
    bottom.append(cap, s.doneBtn, chip('Cancel (Esc)', () => cancelNow(s)));
  }

  s.msg = node('p', 'ie-msg dim');
  s.hint = node('p', 'ie-hint');
  s.root.append(top, stage, s.msg, bottom, s.hint);

  setColor(s, s.color);
  setSize(s, s.size);
  setTool(s, s.tool);
}

function redraw(s) {
  const v = s.view;
  if (!v) return;
  const x = v.getContext('2d');
  x.clearRect(0, 0, v.width, v.height);
  x.imageSmoothingQuality = 'high';
  x.drawImage(s.base, 0, 0, v.width, v.height);
  x.drawImage(s.ink, 0, 0, v.width, v.height);
  if (s.tool === 'crop' && s.sel) drawSel(s, x);
}

function drawSel(s, x) {
  const v = s.view;
  const k = v.width / s.base.width;
  const r = { x: s.sel.x * k, y: s.sel.y * k, w: s.sel.w * k, h: s.sel.h * k };
  x.save();
  x.fillStyle = 'rgba(0, 0, 0, 0.55)';
  x.fillRect(0, 0, v.width, r.y);
  x.fillRect(0, r.y + r.h, v.width, v.height - r.y - r.h);
  x.fillRect(0, r.y, r.x, r.h);
  x.fillRect(r.x + r.w, r.y, v.width - r.x - r.w, r.h);
  x.strokeStyle = '#ffffff';
  x.lineWidth = 1;
  x.strokeRect(r.x + 0.5, r.y + 0.5, Math.max(0, r.w - 1), Math.max(0, r.h - 1));
  x.fillStyle = '#ffffff';
  const hs = 7;
  const xs = [r.x, r.x + r.w / 2, r.x + r.w];
  const ys = [r.y, r.y + r.h / 2, r.y + r.h];
  xs.forEach((px, i) => ys.forEach((py, j) => {
    if (i === 1 && j === 1) return;
    x.fillRect(px - hs / 2, py - hs / 2, hs, hs);
  }));
  x.restore();
}

function toBase(s, e) {
  const r = s.view.getBoundingClientRect();
  const x = (e.clientX - r.left) / (r.width || 1) * s.base.width;
  const y = (e.clientY - r.top) / (r.height || 1) * s.base.height;
  return [clamp(x, 0, s.base.width), clamp(y, 0, s.base.height)];
}

function hitCrop(s, e) {
  const v = s.view.getBoundingClientRect();
  const k = (v.width || 1) / s.base.width;
  const px = e.clientX - v.left;
  const py = e.clientY - v.top;
  const r = { x: s.sel.x * k, y: s.sel.y * k, w: s.sel.w * k, h: s.sel.h * k };
  const t = 10;
  const nearL = Math.abs(px - r.x) <= t;
  const nearR = Math.abs(px - (r.x + r.w)) <= t;
  const nearT = Math.abs(py - r.y) <= t;
  const nearB = Math.abs(py - (r.y + r.h)) <= t;
  const inX = px >= r.x - t && px <= r.x + r.w + t;
  const inY = py >= r.y - t && py <= r.y + r.h + t;
  if (inX && inY) {
    if (nearT && nearL) return 'nw';
    if (nearT && nearR) return 'ne';
    if (nearB && nearL) return 'sw';
    if (nearB && nearR) return 'se';
    if (nearT) return 'n';
    if (nearB) return 's';
    if (nearL) return 'w';
    if (nearR) return 'e';
    if (px > r.x && px < r.x + r.w && py > r.y && py < r.y + r.h) return 'move';
  }
  return 'new';
}

function cropDrag(s, p) {
  const d = s.drag;
  const W = s.base.width;
  const H = s.base.height;
  if (d.mode === 'new') {
    const [x0, y0] = d.start;
    s.sel = { x: Math.min(x0, p[0]), y: Math.min(y0, p[1]), w: Math.abs(p[0] - x0), h: Math.abs(p[1] - y0) };
  } else if (d.mode === 'move') {
    const dx = p[0] - d.start[0];
    const dy = p[1] - d.start[1];
    s.sel = { x: clamp(d.orig.x + dx, 0, W - d.orig.w), y: clamp(d.orig.y + dy, 0, H - d.orig.h), w: d.orig.w, h: d.orig.h };
  } else {
    let x = d.orig.x;
    let y = d.orig.y;
    let x2 = x + d.orig.w;
    let y2 = y + d.orig.h;
    if (d.mode.includes('w')) x = clamp(p[0], 0, x2 - MIN_SEL);
    if (d.mode.includes('e')) x2 = clamp(p[0], x + MIN_SEL, W);
    if (d.mode.includes('n')) y = clamp(p[1], 0, y2 - MIN_SEL);
    if (d.mode.includes('s')) y2 = clamp(p[1], y + MIN_SEL, H);
    s.sel = { x, y, w: x2 - x, h: y2 - y };
  }
  redraw(s);
}

function fullSel(s) {
  return { x: 0, y: 0, w: s.base.width, h: s.base.height };
}

function strokeSeg(s, st, i) {
  const x = s.ink.getContext('2d');
  const k = unit(s);
  x.lineCap = 'round';
  x.lineJoin = 'round';
  x.strokeStyle = st.color;
  x.fillStyle = st.color;
  x.lineWidth = st.size * k;
  const a = st.pts[i];
  const b = st.pts[i + 1];
  if (!b) {
    x.beginPath();
    x.arc(a[0], a[1], st.size * k / 2, 0, Math.PI * 2);
    x.fill();
  } else {
    x.beginPath();
    x.moveTo(a[0], a[1]);
    x.lineTo(b[0], b[1]);
    x.stroke();
  }
}

function rerenderInk(s) {
  const x = s.ink.getContext('2d');
  x.clearRect(0, 0, s.ink.width, s.ink.height);
  s.strokes.forEach(st => {
    if (st.pts.length === 1) strokeSeg(s, st, 0);
    else for (let i = 0; i < st.pts.length - 1; i++) strokeSeg(s, st, i);
  });
}

function bindPointer(s) {
  const v = s.view;
  v.addEventListener('pointerdown', e => {
    if (S !== s || s.mode !== 'edit') return;
    e.preventDefault();
    v.setPointerCapture(e.pointerId);
    const p = toBase(s, e);
    if (s.tool === 'draw') {
      s.cur = { color: s.color, size: BRUSH[s.size], pts: [p] };
      strokeSeg(s, s.cur, 0);
      redraw(s);
    } else if (s.sel) {
      const mode = hitCrop(s, e);
      if (mode === 'new') {
        s.drag = { mode, start: p };
        s.sel = { x: p[0], y: p[1], w: 0, h: 0 };
      } else {
        s.drag = { mode, start: p, orig: { ...s.sel } };
      }
      redraw(s);
    }
  });
  v.addEventListener('pointermove', e => {
    if (S !== s || s.mode !== 'edit') return;
    if (s.cur) {
      s.cur.pts.push(toBase(s, e));
      strokeSeg(s, s.cur, s.cur.pts.length - 2);
      redraw(s);
    } else if (s.drag) {
      cropDrag(s, toBase(s, e));
    } else if (s.tool === 'crop' && s.sel) {
      v.style.cursor = CURSORS[hitCrop(s, e)];
    }
  });
  const end = () => {
    if (s.cur) { s.strokes.push(s.cur); s.cur = null; }
    if (s.drag) {
      const wasNew = s.drag.mode === 'new';
      s.drag = null;
      if (wasNew && s.sel && (s.sel.w < MIN_SEL || s.sel.h < MIN_SEL)) s.sel = fullSel(s);
      redraw(s);
    }
  };
  v.addEventListener('pointerup', end);
  v.addEventListener('pointercancel', end);
}

function setTool(s, tool) {
  s.tool = tool;
  s.sel = tool === 'crop' ? fullSel(s) : null;
  s.toolBtns.draw.classList.toggle('sel', tool === 'draw');
  s.toolBtns.crop.classList.toggle('sel', tool === 'crop');
  s.paint.style.visibility = tool === 'draw' ? 'visible' : 'hidden';
  s.applyRow.style.display = tool === 'crop' ? 'flex' : 'none';
  if (s.doneBtn) s.doneBtn.style.display = tool === 'crop' ? 'none' : '';
  s.view.style.cursor = tool === 'draw' ? 'crosshair' : 'crosshair';
  s.hint.textContent = tool === 'crop'
    ? 'drag the edges or corners to crop | drag inside to move it | Enter = apply | Esc = cancel the crop'
    : 'drag on the picture to draw | 1 2 3 = brush size | Z = undo | C = crop | ' +
      (s.fromPreview ? 'Enter = done | Esc = back' : 'Enter = send | Esc = cancel | Tab = write a comment');
  say(s, '', false);
  redraw(s);
}

function setColor(s, c) {
  s.color = c;
  s.swatches.forEach(x => x.b.classList.toggle('sel', x.c === c));
  if (s.pick && /^#[0-9a-f]{6}$/i.test(c)) s.pick.value = c;
  if (s.tool !== 'draw' && s.toolBtns.draw) setTool(s, 'draw');
}

function setSize(s, i) {
  s.size = i;
  s.sizeBtns.forEach((b, n) => b.classList.toggle('sel', n === i));
}

function undo(s) {
  if (!s.strokes.length) return;
  s.strokes.pop();
  rerenderInk(s);
  redraw(s);
}

function reset(s) {
  s.base = copyCanvas(s.original);
  s.ink = makeCanvas(s.base.width, s.base.height);
  s.strokes = [];
  s.sel = s.tool === 'crop' ? fullSel(s) : null;
  say(s, 'back to the original picture.', false);
  layout(s);
}

function applyCrop(s) {
  if (!s.sel) return;
  const x = clamp(Math.round(s.sel.x), 0, s.base.width - 4);
  const y = clamp(Math.round(s.sel.y), 0, s.base.height - 4);
  const w = clamp(Math.round(s.sel.w), 4, s.base.width - x);
  const h = clamp(Math.round(s.sel.h), 4, s.base.height - y);
  const isFull = x <= 1 && y <= 1 && w >= s.base.width - 1 && h >= s.base.height - 1;
  if (!isFull) {
    const out = makeCanvas(w, h);
    const c = out.getContext('2d');
    c.drawImage(s.base, x, y, w, h, 0, 0, w, h);
    c.drawImage(s.ink, x, y, w, h, 0, 0, w, h);
    s.base = out;
    s.ink = makeCanvas(w, h);
    s.strokes = [];
  }
  s.sel = null;
  s.tool = 'draw';
  layout(s);
  setTool(s, 'draw');
  say(s, isFull ? '' : 'cropped. (Reset puts the original back.)', false);
}

function exportUrl(s) {
  const full = makeCanvas(s.base.width, s.base.height);
  const fx = full.getContext('2d');
  fx.drawImage(s.base, 0, 0);
  fx.drawImage(s.ink, 0, 0);
  let scale = Math.min(1, OUT_MAX / Math.max(full.width, full.height));
  for (let attempt = 0; attempt < 6; attempt++) {
    const w = Math.max(1, Math.round(full.width * scale));
    const h = Math.max(1, Math.round(full.height * scale));
    const c = makeCanvas(w, h);
    const x = c.getContext('2d');
    x.fillStyle = '#161616';
    x.fillRect(0, 0, w, h);
    x.imageSmoothingQuality = 'high';
    x.drawImage(full, 0, 0, w, h);
    for (const q of [0.85, 0.72, 0.58, 0.45]) {
      const url = c.toDataURL('image/jpeg', q);
      if (url.length <= CAP) return url;
    }
    scale *= 0.8;
  }
  return null;
}

function sendNow(s) {
  const url = exportUrl(s);
  if (!url) return say(s, 'that picture is too detailed to send. try cropping it.', true);
  s.opts.onSend(url, s.caption.trim());
}

function cancelNow(s) {
  s.opts.onCancel();
}

export function editorKey(e) {
  const s = S;
  if (!s) return false;
  if (Date.now() - s.t0 < 250) { e.preventDefault(); return true; }
  return s.mode === 'preview' ? previewKey(s, e) : editKey(s, e);
}

function previewKey(s, e) {
  const key = e.key;
  if (key === 'Enter') { e.preventDefault(); sendNow(s); }
  else if (key === 'Escape') { e.preventDefault(); cancelNow(s); }
  else if ((e.ctrlKey || e.metaKey) && key.toLowerCase() === 'e') { e.preventDefault(); enterEdit(s); }
  return true;
}

function editKey(s, e) {
  const key = e.key;
  const lk = key.toLowerCase();

  if (s.cap && document.activeElement === s.cap) {
    if (key === 'Enter') { e.preventDefault(); sendNow(s); }
    else if (key === 'Escape') { e.preventDefault(); s.cap.blur(); }
    return true;
  }

  if (key === 'Enter') {
    e.preventDefault();
    if (s.tool === 'crop') applyCrop(s);
    else if (s.fromPreview) backToPreview(s);
    else sendNow(s);
  } else if (key === 'Escape') {
    e.preventDefault();
    if (s.tool === 'crop') setTool(s, 'draw');
    else if (s.fromPreview) backToPreview(s);
    else cancelNow(s);
  } else if (lk === 'z') {
    e.preventDefault();
    undo(s);
  } else if (lk === 'd') {
    setTool(s, 'draw');
  } else if (lk === 'c') {
    setTool(s, 'crop');
  } else if (key >= '1' && key <= '3') {
    setSize(s, Number(key) - 1);
    if (s.tool !== 'draw') setTool(s, 'draw');
  } else if (key === 'Tab' && s.cap) {
    e.preventDefault();
    s.cap.focus();
  }
  return true;
}
