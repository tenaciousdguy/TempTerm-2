import {
  watchConnection, signInGuest,
  fbCreateRoom, fbJoinRoom, fbLeaveRoom, fbCleanup,
  fbSendMessage, fbWatchRoom, fbListRooms,
} from './firebase.js';

// ---------- state ----------
function randomGuestName() {
  return 'guest_' + (1000 + Math.floor(Math.random() * 9000));
}

const me = { name: randomGuestName(), uid: null };
let account = null; // null means guest
let room = null;    // the room you're currently in
let busy = false;   // stops double presses while something is loading

// ---------- screens ----------
function show(id) {
  clearInterval(search.timer);
  document.querySelectorAll('.screen').forEach(s => s.hidden = s.id !== id);
  if (id === 'menu' && !account) me.name = randomGuestName();
  if (id === 'create') { create.step = 0; create.type = 0; create.limit = 10; busy = false; renderCreate(); }
  if (id === 'search') openSearch();
  if (id === 'chat') enterChat();
}

// ---------- boot ----------
function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function setStatus(on) {
  const el = document.getElementById('status');
  el.textContent = on ? '● server: connected' : '● server: not connected';
  el.classList.toggle('on', on);
}

function waitForServer(timeout) {
  return new Promise(resolve => {
    let done = false;
    const timer = setTimeout(() => { if (!done) { done = true; resolve(false); } }, timeout);
    watchConnection(on => {
      setStatus(on);
      if (on && !done) { done = true; clearTimeout(timer); resolve(true); }
    });
  });
}

const steps = [
  { label: 'connecting to server', run: () => waitForServer(8000) },
  { label: 'signing in',
    run: async () => {
      try {
        me.uid = await signInGuest();
        const last = localStorage.getItem('lastRoom');
        if (last) { await fbCleanup(last).catch(() => {}); localStorage.removeItem('lastRoom'); }
        return true;
      } catch (err) { console.error(err); return false; }
    },
    okText: () => account ? 'ok' : 'guest' },
  { label: 'loading themes', run: async () => true },
  { label: 'syncing settings', run: async () => true },
];

async function boot() {
  const out = document.getElementById('boot');
  for (const step of steps) {
    out.innerHTML += step.label + '...';
    const [ok] = await Promise.all([step.run(), wait(300 + Math.random() * 900)]);
    const text = step.okText ? step.okText() : 'ok';
    out.innerHTML += ok ? ' <span class="ok">' + text + '</span>\n' : ' <span class="fail">failed</span>\n';
  }
  document.getElementById('tap').classList.add('show');

  const go = () => {
    document.removeEventListener('click', go);
    document.removeEventListener('keydown', onKey);
    show('menu');
  };
  const onKey = e => { if (e.key === 'Enter' || e.key === ' ') go(); };
  document.addEventListener('click', go);
  document.addEventListener('keydown', onKey);
}

// ---------- menu ----------
const items = [
  { label: 'Room Searcher', screen: 'search' },
  { label: 'Create Room', screen: 'create' },
  { label: 'Profile', screen: 'profile', needsAccount: true },
  { label: 'Settings', screen: 'settings' },
  { label: 'Changelog & Socials', screen: 'changelog' },
  { label: 'Credits', screen: 'credits' },
  { label: 'Quit', action: 'quit' },
];

let selected = 1;   // 0 = the account box. 1 and up = the menu items

function renderAccount() {
  const el = document.getElementById('account');
  el.classList.toggle('selected', selected === 0);
  el.textContent = '';
  const name = document.createElement('span');
  name.textContent = account ? account.display + ' // ' + account.username : 'guest';
  const btn = document.createElement('span');
  btn.className = 'dim';
  btn.textContent = account ? '[log out]' : '[sign in]';
  el.append(name, btn);
}

function renderMenu() {
  const nav = document.getElementById('menu-items');
  nav.innerHTML = '';
  items.forEach((item, i) => {
    const div = document.createElement('div');
    div.className = 'item';
    if (i + 1 === selected) div.classList.add('selected');
    if (item.needsAccount && !account) div.classList.add('disabled');

    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = item.label;

    if (i + 1 === selected) {
      const mark = document.createElement('span');
      mark.className = 'mark';
      mark.textContent = '>';
      label.appendChild(mark);
    }

    div.appendChild(label);
    nav.appendChild(div);
  });
}

function render() {
  renderAccount();
  renderMenu();
}

function say(text) {
  document.getElementById('sys').textContent = text;
}

function activate() {
  say('');
  if (selected === 0) {
    say(account ? "[system]: log out isn't built yet." : "[system]: sign in isn't built yet.");
    return;
  }
  const item = items[selected - 1];
  if (item.action === 'quit') return window.close();
  if (item.needsAccount && !account) {
    say('[system]: sign in to use profiles.');
    return;
  }
  if (document.getElementById(item.screen)) show(item.screen);
  else say('[system]: ' + item.label + " isn't built yet.");
}

function move(step) {
  const total = items.length + 1;
  selected = (selected + step + total) % total;
  render();
}

// ---------- menu input ----------
document.addEventListener('keydown', e => {
  if (document.getElementById('menu').hidden) return;
  if (e.target.matches('input, textarea')) return;
  const key = e.key.toLowerCase();
  if (key === 'arrowdown' || key === 's') move(1);
  else if (key === 'arrowup' || key === 'w') move(-1);
  else if (key === 'enter') { activate(); e.stopImmediatePropagation(); }
});

let lastWheel = 0;
document.addEventListener('wheel', e => {
  if (document.getElementById('menu').hidden) return;
  const now = Date.now();
  if (now - lastWheel < 120) return;
  lastWheel = now;
  move(e.deltaY > 0 ? 1 : -1);
});

// ---------- create room ----------
const create = { step: 0, type: 0, limit: 10 };

const types = [
  { label: 'Public — anyone can join', value: 'public' },
  { label: 'Private — code is needed to join', value: 'private' },
];

function renderCreate() {
  const q = document.getElementById('cr-q');
  const body = document.getElementById('cr-body');
  const hint = document.getElementById('cr-hint');
  body.innerHTML = '';

  if (create.step === 0) {
    q.textContent = 'Public or Private?';
    types.forEach((t, i) => {
      const row = document.createElement('div');
      row.className = 'opt' + (i === create.type ? ' selected' : '');
      const label = document.createElement('span');
      label.className = 'label';
      label.textContent = t.label;
      if (i === create.type) {
        const mark = document.createElement('span');
        mark.className = 'mark';
        mark.textContent = '>';
        label.appendChild(mark);
      }
      row.appendChild(label);
      body.appendChild(row);
    });
    hint.textContent = '↑ ↓ to choose | Enter = Confirm | Escape = Cancel';
  } else {
    q.textContent = 'Set player limit (2-10)';
    const n = document.createElement('p');
    n.className = 'bignum';
    n.textContent = create.limit;
    body.appendChild(n);
    hint.textContent = '↑ ↓ to adjust | Enter = Confirm | Escape = Back';
  }
}

async function startRoom() {
  if (busy) return;
  busy = true;
  const hint = document.getElementById('cr-hint');
  hint.textContent = '[system]: creating room...';
  try {
    const code = await fbCreateRoom({
      type: types[create.type].value,
      limit: create.limit,
      hostName: me.name,
    });
    const err = await enterRoom(code, true);
    if (err) hint.textContent = '[system]: ' + err;
  } catch (e) {
    console.error(e);
    hint.textContent = '[system]: could not create the room.';
  }
  busy = false;
}

function createMove(dir) {
  if (create.step === 0) {
    create.type = (create.type + dir + types.length) % types.length;
  } else {
    create.limit = Math.min(10, Math.max(2, create.limit - dir)); // up raises, down lowers
  }
  renderCreate();
}

document.addEventListener('keydown', e => {
  if (document.getElementById('create').hidden) return;
  const key = e.key.toLowerCase();
  if (key === 'arrowdown' || key === 's') createMove(1);
  else if (key === 'arrowup' || key === 'w') createMove(-1);
  else if (key === 'enter') {
    if (create.step === 0) { create.step = 1; renderCreate(); }
    else startRoom();
  } else if (key === 'escape') {
    if (create.step === 1) { create.step = 0; renderCreate(); }
    else show('menu');
  }
});

document.addEventListener('wheel', e => {
  if (document.getElementById('create').hidden) return;
  const now = Date.now();
  if (now - lastWheel < 120) return;
  lastWheel = now;
  createMove(e.deltaY > 0 ? 1 : -1);
});

// ---------- room searcher ----------
// Three modes: 'list' (move with arrows / W S / wheel), 'text' (typing a search), 'code' (entering a private code).
const search = { rooms: [], selLid: null, mode: 'list', timer: null };
const sqInput = document.getElementById('sq');
const codeInput = document.getElementById('code-in');

const hints = {
  list: '↑ ↓ / W S / scroll = choose | Enter = Join | / = Search | R = Refresh | Escape = Back',
  text: 'type to search | Enter or ↓ = back to the list | Escape = back to the list',
  code: 'Enter = Join | Escape = Cancel',
};

function setSearchMsg(text) {
  document.getElementById('s-msg').textContent = text;
}

function setMode(mode) {
  search.mode = mode;
  document.getElementById('cp').hidden = mode !== 'code';
  document.getElementById('s-hint').textContent = hints[mode];
  if (mode === 'text') sqInput.focus(); else sqInput.blur();
  if (mode === 'code') { codeInput.value = ''; codeInput.focus(); } else codeInput.blur();
}

function visibleRooms() {
  const q = sqInput.value.trim().toLowerCase();
  return search.rooms.filter(r =>
    !q || r.hostName.toLowerCase().includes(q) || (r.code && r.code.toLowerCase().includes(q)));
}

function selectedRoom() {
  return visibleRooms().find(r => r.lid === search.selLid) || null;
}

function renderRooms() {
  const box = document.getElementById('rl');
  const list = visibleRooms();
  if (list.length && !list.some(r => r.lid === search.selLid)) search.selLid = list[0].lid;
  box.innerHTML = '';

  if (!list.length) {
    const p = document.createElement('p');
    p.className = 'dim italic';
    p.textContent = 'no rooms found.';
    box.appendChild(p);
    return;
  }

  list.forEach(r => {
    const on = r.lid === search.selLid;
    const row = document.createElement('div');
    row.className = 'room' + (on ? ' selected' : '');
    if (on) {
      const mark = document.createElement('span');
      mark.className = 'rmark';
      mark.textContent = '>';
      row.appendChild(mark);
    }
    const isPrivate = r.type === 'private';
    const code = document.createElement('span');
    code.className = 'code' + (isPrivate ? ' hidden' : '');
    code.textContent = isPrivate ? '••••••' : (r.code || '');
    const host = document.createElement('span');
    host.className = 'host';
    host.textContent = r.hostName;
    const tag = document.createElement('span');
    tag.className = 'tag';
    tag.textContent = isPrivate ? '[private]' : '';
    const num = document.createElement('span');
    num.className = 'num';
    num.textContent = r.count + '/' + r.limit;
    row.append(code, host, tag, num);
    box.appendChild(row);
    if (on) row.scrollIntoView({ block: 'nearest' });
  });
}

async function refreshRooms() {
  try {
    search.rooms = await fbListRooms();
  } catch (e) {
    console.error(e);
    setSearchMsg('[system]: could not load rooms.');
  }
  renderRooms();
}

function openSearch() {
  sqInput.value = '';
  search.rooms = [];
  search.selLid = null;
  setSearchMsg('');
  renderRooms();
  setMode('list');
  refreshRooms();
  search.timer = setInterval(refreshRooms, 5000); // the list refreshes itself
}

function moveSearch(step) {
  const list = visibleRooms();
  if (!list.length) return;
  let i = list.findIndex(r => r.lid === search.selLid);
  if (i < 0) i = 0;
  i = (i + step + list.length) % list.length;
  search.selLid = list[i].lid;
  renderRooms();
}

async function tryJoin(code, lid) {
  busy = true;
  setSearchMsg('[system]: joining...');
  const err = await enterRoom(code, false, lid);
  busy = false;
  if (err) setSearchMsg('[system]: ' + err);
  return err;
}

function chooseRoom() {
  if (busy) return;
  const r = selectedRoom();
  if (!r) return setSearchMsg('[system]: no room selected.');
  setSearchMsg('');
  if (r.type === 'private') return setMode('code');
  if (!r.code) return setSearchMsg('[system]: that room cannot be joined.');
  tryJoin(r.code, null);
}

async function submitCode() {
  if (busy) return;
  const r = selectedRoom();
  if (!r) return setMode('list');
  const code = codeInput.value.trim().toUpperCase();
  if (!/^[A-Z0-9]{6}$/.test(code)) return setSearchMsg('[system]: codes are 6 characters.');
  const err = await tryJoin(code, r.lid);
  if (err) { codeInput.value = ''; codeInput.focus(); }
}

function submitSearch() {
  if (busy) return;
  const typed = sqInput.value.trim().toUpperCase();
  if (!visibleRooms().length && /^[A-Z0-9]{6}$/.test(typed)) { tryJoin(typed, null); return; }
  setMode('list');
}

sqInput.addEventListener('input', () => { search.selLid = null; renderRooms(); });

document.addEventListener('keydown', e => {
  if (document.getElementById('search').hidden) return;

  if (search.mode === 'code') {
    if (e.key === 'Enter') submitCode();
    else if (e.key === 'Escape') setMode('list');
    return;
  }
  if (search.mode === 'text') {
    if (e.key === 'Enter') submitSearch();
    else if (e.key === 'Escape' || e.key === 'ArrowDown') { e.preventDefault(); setMode('list'); }
    return;
  }

  const key = e.key.toLowerCase();
  if (key === 'arrowdown' || key === 's') moveSearch(1);
  else if (key === 'arrowup' || key === 'w') moveSearch(-1);
  else if (e.key === 'Enter') chooseRoom();
  else if (e.key === '/' || e.key === 'Tab') { e.preventDefault(); setMode('text'); }
  else if (key === 'r') refreshRooms();
  else if (e.key === 'Escape') show('menu');
});

document.addEventListener('wheel', e => {
  if (document.getElementById('search').hidden || search.mode !== 'list') return;
  const now = Date.now();
  if (now - lastWheel < 120) return;
  lastWheel = now;
  moveSearch(e.deltaY > 0 ? 1 : -1);
});

// ---------- chat ----------
let stopWatch = null;

async function enterRoom(code, fresh = false, lid = null) {
  if (!me.uid) return 'not signed in. check your connection.';
  try {
    const res = await fbJoinRoom(code, me.name, { fresh, lid });
    if (res.error) return res.error;
    room = { code, ...res.meta };
    localStorage.setItem('lastRoom', code);
    show('chat');
    return null;
  } catch (e) {
    console.error(e);
    return 'could not join the room.';
  }
}

async function leaveCurrentRoom() {
  if (!room) return;
  const { code, lid } = room;
  const name = me.name; // grab it before show('menu') picks a new guest name
  if (stopWatch) { stopWatch(); stopWatch = null; }
  room = null;
  localStorage.removeItem('lastRoom');
  show('menu');
  try { await fbLeaveRoom(code, name, lid); } catch (e) { console.error(e); }
}

function lineEl(text, cls) {
  const p = document.createElement('p');
  p.className = cls || '';
  p.textContent = text;
  return p;
}

function msgEl(name, text) {
  const p = document.createElement('p');
  const who = document.createElement('span');
  who.className = 'who';
  who.textContent = name;
  p.append(who, ': ' + text);
  return p;
}

// Lines are placed by server time so it always shows in the right order
function isAfter(a, b) {
  const ta = Number(a.dataset.ts), tb = Number(b.dataset.ts);
  return ta !== tb ? ta > tb : a.dataset.key > b.dataset.key;
}

function insertLine(el, key, ts) {
  el.dataset.key = key;
  el.dataset.ts = ts || 0;
  const log = document.getElementById('log');
  let node = log.lastElementChild;
  while (node && isAfter(node, el)) node = node.previousElementSibling;
  log.insertBefore(el, node ? node.nextSibling : log.firstChild);
  log.scrollTop = log.scrollHeight;
}

function addLocalLine(text) {
  const log = document.getElementById('log');
  log.appendChild(lineEl(text, 'dim'));
  log.scrollTop = log.scrollHeight;
}

function enterChat() {
  document.getElementById('log').innerHTML = '';
  document.getElementById('msg').value = '';
  document.getElementById('count').textContent = '';

  stopWatch = fbWatchRoom(room.code, {
    onMessage: (key, m) => {
      const el = m.type === 'system' ? lineEl('[system]: ' + m.text, 'dim') : msgEl(m.name, m.text);
      insertLine(el, key, m.ts);
    },
    onMembers: members => {
      const n = Object.keys(members).length;
      document.getElementById('count').textContent =
        n + ' chatter' + (n === 1 ? '' : 's') + ' in room (limit ' + room.limit + ')';
    },
  });

  document.getElementById('msg').focus();
}

const msgInput = document.getElementById('msg');

msgInput.addEventListener('keydown', e => {
  if (e.key !== 'Enter' || !room) return;
  const text = msgInput.value.trim();
  if (!text) return;
  msgInput.value = '';
  fbSendMessage(room.code, me.name, text).catch(err => {
    console.error(err);
    addLocalLine('[system]: message failed to send.');
  });
});

// Clicking the chat gives the typing box focus back unless you're selecting text to copy
document.getElementById('log').addEventListener('mouseup', () => {
  if (!window.getSelection().toString()) msgInput.focus();
});

document.addEventListener('keydown', e => {
  if (document.getElementById('chat').hidden) return;
  if (e.key === 'Escape') leaveCurrentRoom();
});

// ---------- start ----------
render();
boot();