export function scrollInto(container, node, margin = 14) {
  const c = container.getBoundingClientRect();
  const n = node.getBoundingClientRect();
  if (n.top < c.top + margin) container.scrollTop -= c.top + margin - n.top;
  else if (n.bottom > c.bottom - margin) container.scrollTop += n.bottom - (c.bottom - margin);
}

export function createGrid(scroller) {
  const g = { rows: [], r: 0, c: 0, last: null, scroller, onChange: null };

  g.reset = () => {
    g.rows = [];
    g.r = 0;
    g.c = 0;
    g.last = null;
  };

  g.row = holder => {
    const row = { holder, items: [] };
    g.rows.push(row);
    return row;
  };

  g.ctl = () => {
    const row = g.rows[g.r];
    return row ? row.items[Math.min(g.c, row.items.length - 1)] : null;
  };

  function locate(ctl) {
    for (let r = 0; r < g.rows.length; r++) {
      const c = g.rows[r].items.indexOf(ctl);
      if (c >= 0) return [r, c];
    }
    return null;
  }

  g.set = (r, c) => {
    g.r = r;
    g.c = c;
    const cur = g.ctl();
    g.rows.forEach(row => row.items.forEach(x => x.el.classList.toggle('on', x === cur)));
    if (cur !== g.last) {
      g.last = cur;
      if (g.onChange) g.onChange(cur);
    }
  };

  g.focus = (r, c, scroll = true) => {
    g.set(r, c);
    const ctl = g.ctl();
    if (!ctl) return;
    if (ctl.input) ctl.input.focus({ preventScroll: true });
    else if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
    if (scroll) scrollInto(scroller, ctl.el);
  };

  g.focusCtl = (ctl, scroll) => {
    const p = locate(ctl);
    if (p) g.focus(p[0], p[1], scroll);
  };

  g.focusKey = (key, scroll) => {
    for (let r = 0; r < g.rows.length; r++) {
      const c = g.rows[r].items.findIndex(x => x.key === key);
      if (c >= 0) { g.focus(r, c, scroll); return true; }
    }
    return false;
  };

  g.add = (row, node, opts = {}) => {
    const ctl = { el: node, ...opts };
    row.items.push(ctl);
    row.holder.appendChild(node);
    if (ctl.input) {
      ctl.input.addEventListener('focus', () => {
        const p = locate(ctl);
        if (p) g.set(p[0], p[1]);
      });
    } else {
      if (node.tagName === 'BUTTON') node.tabIndex = -1;
      node.addEventListener('click', ev => {
        if (node.tagName === 'BUTTON') node.blur();
        g.focusCtl(ctl, false);
        if (ctl.act) ctl.act(ev);
      });
    }
    return ctl;
  };

  g.moveRow = step => {
    if (!g.rows.length) return;
    const r = (g.r + step + g.rows.length) % g.rows.length;
    g.focus(r, Math.min(g.c, g.rows[r].items.length - 1));
  };

  g.moveCol = step => {
    const n = g.rows[g.r].items.length;
    const cur = Math.min(g.c, n - 1);
    const c = Math.max(0, Math.min(n - 1, cur + step));
    if (c !== cur) g.focus(g.r, c);
  };

  g.linear = step => {
    const flat = [];
    g.rows.forEach((row, r) => row.items.forEach((_, c) => flat.push([r, c])));
    const cur = Math.min(g.c, g.rows[g.r].items.length - 1);
    let i = flat.findIndex(p => p[0] === g.r && p[1] === cur);
    i = (i + step + flat.length) % flat.length;
    g.focus(flat[i][0], flat[i][1]);
  };

  g.key = e => {
    const ctl = g.ctl();
    if (!ctl) return false;
    const typing = !!ctl.input && document.activeElement === ctl.input;
    const key = e.key.toLowerCase();

    if (key === 'tab') { e.preventDefault(); g.linear(e.shiftKey ? -1 : 1); return true; }

    if (typing) {
      if (key === 'escape') { e.preventDefault(); ctl.input.blur(); return true; }
      if (!ctl.multiline) {
        if (key === 'arrowdown') { e.preventDefault(); g.moveRow(1); }
        else if (key === 'arrowup') { e.preventDefault(); g.moveRow(-1); }
        else if (key === 'enter') { e.preventDefault(); g.linear(1); }
      }
      return true;
    }

    if (key === 'arrowdown' || key === 's') { e.preventDefault(); g.moveRow(1); return true; }
    if (key === 'arrowup' || key === 'w') { e.preventDefault(); g.moveRow(-1); return true; }
    if (key === 'arrowleft' || key === 'a') { e.preventDefault(); g.moveCol(-1); return true; }
    if (key === 'arrowright' || key === 'd') { e.preventDefault(); g.moveCol(1); return true; }
    if (key === 'pagedown') { e.preventDefault(); scroller.scrollBy({ top: 300 }); return true; }
    if (key === 'pageup') { e.preventDefault(); scroller.scrollBy({ top: -300 }); return true; }
    if (key === 'enter' || key === ' ') {
      e.preventDefault();
      if (ctl.act) ctl.act(e);
      else if (ctl.input) ctl.input.focus();
      return true;
    }
    return false;
  };

  return g;
}