const PALETTE = ['#ffffff', '#000000', '#f87171', '#fb923c', '#facc15', '#4ade80', '#67e8f9', '#3b82f6', '#a78bfa', '#f472b6'];
const BRUSH = [3, 7, 14];
const WORK_MAX = 1600;
const OUT_MAX = 900;
const CAP = 150000;

const HINTS = {
  draw: 'Draw: drag on the picture | 1 2 3 = brush size | Z = undo | C = crop | Tab = write a comment | Enter = send | Esc = cancel',
  crop: 'Crop: drag to choose an area | Enter = apply the crop | Esc = clear the selection | D = back to drawing',
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
  s.msg.textContent = text;
  s.msg.className = 'ie-msg ' + (bad ? 'fail' : 'dim');
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
    view: null, stage: null, cap: null, hint: null, msg: null, paint: null, pick: null,
    swatches: [], sizeBtns: [], toolBtns: {},
  };
  S = s;
  build(s);
  root.hidden = false;
  layout(s);
  requestAnimationFrame(() => { if (S === s) layout(s); });
}

export function closeEditor() {
  if (!S) return;
  S.root.replaceChildren();
  S.root.hidden = true;
  S = null;
}

function build(s) {
  s.root.replaceChildren();

  const top = node('div', 'ie-top');
  top.appendChild(node('span', 'ie-title', s.opts.title || 'Send image'));

  const tools = node('div', 'ie-group');
  s.toolBtns.draw = chip('Draw (D)', () => setTool(s, 'draw'));
  s.toolBtns.crop = chip('Crop (C)', () => setTool(s, 'crop'));
  tools.append(s.toolBtns.draw, s.toolBtns.crop);

  const paint = node('div', 'ie-group');
  PALETTE.forEach(c => {
    const b = node('button', 'ie-sw');
    b.style.background = c;
    b.tabIndex = -1;
    b.title = c;
    b.addEventListener('click', () => { b.blur(); setColor(s, c); setTool(s, 'draw'); });
    s.swatches.push({ b, c });
    paint.appendChild(b);
  });
  const pick = node('input', 'ie-pick');
  pick.type = 'color';
  pick.value = s.color;
  pick.tabIndex = -1;
  pick.addEventListener('input', () => { setColor(s, pick.value); setTool(s, 'draw'); });
  s.pick = pick;
  paint.appendChild(pick);
  ['S', 'M', 'L'].forEach((label, i) => {
    const b = chip(label, () => setSize(s, i));
    s.sizeBtns.push(b);
    paint.appendChild(b);
  });
  s.paint = paint;

  const acts = node('div', 'ie-group');
  acts.append(chip('Undo (Z)', () => undo(s)), chip('Reset', () => reset(s)));

  top.append(tools, paint, acts);

  const stage = node('div', 'ie-stage');
  const view = node('canvas', 'ie-view');
  stage.appendChild(view);
  s.stage = stage;
  s.view = view;
  bindPointer(s);

  const bottom = node('div', 'ie-bottom');
  const cap = node('input', 'ie-cap');
  cap.type = 'text';
  cap.maxLength = 300;
  cap.placeholder = 'Add a comment (optional)';
  cap.autocomplete = 'off';
  cap.spellcheck = false;
  s.cap = cap;
  bottom.append(cap, chip('Send (Enter)', () => sendNow(s), 'go'), chip('Cancel (Esc)', () => cancelNow(s)));

  s.msg = node('p', 'ie-msg dim');
  s.hint = node('p', 'ie-hint');
  s.root.append(top, stage, s.msg, bottom, s.hint);

  setColor(s, s.color);
  setSize(s, s.size);
  setTool(s, 'draw');
}

function layout(s) {
  const aw = Math.max(80, s.stage.clientWidth - 24);
  const ah = Math.max(80, s.stage.clientHeight - 24);
  const sc = Math.min(aw / s.base.width, ah / s.base.height, 2);
  s.view.width = Math.max(1, Math.round(s.base.width * sc));
  s.view.height = Math.max(1, Math.round(s.base.height * sc));
  redraw(s);
}

function redraw(s) {
  const v = s.view;
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
  x.setLineDash([6, 4]);
  x.lineWidth = 1;
  x.strokeRect(r.x + 0.5, r.y + 0.5, Math.max(0, r.w - 1), Math.max(0, r.h - 1));
  x.restore();
}

function toBase(s, e) {
  const r = s.view.getBoundingClientRect();
  const x = (e.clientX - r.left) / (r.width || 1) * s.base.width;
  const y = (e.clientY - r.top) / (r.height || 1) * s.base.height;
  return [clamp(x, 0, s.base.width), clamp(y, 0, s.base.height)];
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
    if (S !== s) return;
    e.preventDefault();
    v.setPointerCapture(e.pointerId);
    const p = toBase(s, e);
    if (s.tool === 'draw') {
      s.cur = { color: s.color, size: BRUSH[s.size], pts: [p] };
      strokeSeg(s, s.cur, 0);
      redraw(s);
    } else {
      s.drag = p;
      s.sel = { x: p[0], y: p[1], w: 0, h: 0 };
      redraw(s);
    }
  });
  v.addEventListener('pointermove', e => {
    if (S !== s) return;
    if (s.cur) {
      s.cur.pts.push(toBase(s, e));
      strokeSeg(s, s.cur, s.cur.pts.length - 2);
      redraw(s);
    } else if (s.drag) {
      const p = toBase(s, e);
      const [x0, y0] = s.drag;
      s.sel = { x: Math.min(x0, p[0]), y: Math.min(y0, p[1]), w: Math.abs(p[0] - x0), h: Math.abs(p[1] - y0) };
      redraw(s);
    }
  });
  const end = () => {
    if (s.cur) { s.strokes.push(s.cur); s.cur = null; }
    if (s.drag) {
      s.drag = null;
      if (s.sel && (s.sel.w < 8 || s.sel.h < 8)) s.sel = null;
      redraw(s);
    }
  };
  v.addEventListener('pointerup', end);
  v.addEventListener('pointercancel', end);
}

function setTool(s, tool) {
  s.tool = tool;
  if (tool !== 'crop') s.sel = null;
  s.toolBtns.draw.classList.toggle('sel', tool === 'draw');
  s.toolBtns.crop.classList.toggle('sel', tool === 'crop');
  s.paint.style.visibility = tool === 'draw' ? 'visible' : 'hidden';
  s.view.style.cursor = tool === 'draw' ? 'crosshair' : 'cell';
  s.hint.textContent = HINTS[tool];
  say(s, '', false);
  redraw(s);
}

function setColor(s, c) {
  s.color = c;
  s.swatches.forEach(x => x.b.classList.toggle('sel', x.c === c));
  if (/^#[0-9a-f]{6}$/i.test(c)) s.pick.value = c;
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
  s.sel = null;
  say(s, 'back to the original picture.', false);
  layout(s);
}

function applyCrop(s) {
  if (!s.sel) return;
  const x = clamp(Math.round(s.sel.x), 0, s.base.width - 4);
  const y = clamp(Math.round(s.sel.y), 0, s.base.height - 4);
  const w = clamp(Math.round(s.sel.w), 4, s.base.width - x);
  const h = clamp(Math.round(s.sel.h), 4, s.base.height - y);
  const out = makeCanvas(w, h);
  const c = out.getContext('2d');
  c.drawImage(s.base, x, y, w, h, 0, 0, w, h);
  c.drawImage(s.ink, x, y, w, h, 0, 0, w, h);
  s.base = out;
  s.ink = makeCanvas(w, h);
  s.strokes = [];
  s.sel = null;
  say(s, 'cropped. (Reset puts the original back.)', false);
  layout(s);
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
  s.opts.onSend(url, s.cap.value.trim());
}

function cancelNow(s) {
  s.opts.onCancel();
}

export function editorKey(e) {
  const s = S;
  if (!s) return false;
  const key = e.key;
  const lk = key.toLowerCase();

  if (document.activeElement === s.cap) {
    if (key === 'Enter') { e.preventDefault(); sendNow(s); }
    else if (key === 'Escape') { e.preventDefault(); s.cap.blur(); }
    return true;
  }

  if (key === 'Enter') {
    e.preventDefault();
    if (s.tool === 'crop' && s.sel) applyCrop(s); else sendNow(s);
  } else if (key === 'Escape') {
    e.preventDefault();
    if (s.tool === 'crop' && s.sel) { s.sel = null; redraw(s); } else cancelNow(s);
  } else if (lk === 'z') {
    e.preventDefault();
    undo(s);
  } else if (lk === 'd') {
    setTool(s, 'draw');
  } else if (lk === 'c') {
    setTool(s, 'crop');
  } else if (key >= '1' && key <= '3') {
    setSize(s, Number(key) - 1);
    setTool(s, 'draw');
  } else if (key === 'Tab') {
    e.preventDefault();
    s.cap.focus();
  }
  return true;
}
