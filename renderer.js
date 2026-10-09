import {
  watchConnection, signInGuest,
  fbCreateRoom, fbJoinRoom, fbLeaveRoom, fbCleanup,
  fbSendMessage, fbWatchRoom, fbListRooms,
} from './firebase.js';
import { settings, save, THEMES, SIZES, applyTheme, applyUi, applySize } from './settings.js';

// ---------- state ----------
function randomGuestName() {
  return 'guest_' + (1000 + Math.floor(Math.random() * 9000));
}

const me = { name: randomGuestName(), uid: null };
let account = null;
let room = null;
let busy = false;
let current = 'splash';
let splashReady = false;

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

// ---------- key router ----------
// Every screen registers its own handlers here. One listener sends each key
// (and each scroll of the wheel) to whichever screen is open, so a key that
// opens a screen can never also be handled by the screen it opens.
const screens = {};

document.addEventListener('keydown', e => {
  const s = screens[current];
  if (s && s.key) s.key(e);
});

let lastWheel = 0;
document.addEventListener('wheel', e => {
  const s = screens[current];
  if (!s || !s.wheel) return;
  const now = Date.now();
  if (now - lastWheel < 120) return;
  lastWheel = now;
  s.wheel(e.deltaY > 0 ? 1 : -1);
});

document.addEventListener('click', () => {
  if (current === 'splash' && splashReady) show('menu');
});

// ---------- screens ----------
function show(id) {
  clearInterval(search.timer);
  current = id;
  document.querySelectorAll('.screen').forEach(s => s.hidden = s.id !== id);
  if (id === 'menu' && !account) me.name = randomGuestName();
  if (id === 'create') { create.step = 0; create.type = 0; create.limit = 10; busy = false; renderCreate(); }
  if (id === 'search') openSearch();
  if (id === 'chat') enterChat();
  if (id === 'changelog') { oldOpen = false; renderChangelog(); document.getElementById('cl-scroll').scrollTop = 0; }
  if (id === 'settings') openSettings();
}

// ---------- boot ----------
function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function setStatus(on) {
  const status = document.getElementById('status');
  status.textContent = on ? '● server: connected' : '● server: not connected';
  status.classList.toggle('on', on);
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
  { label: 'loading themes', run: async () => { applyTheme(); applyUi(); return true; } },
  { label: 'syncing settings', run: async () => { applySize(); return true; } },
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
  splashReady = true;
}

screens.splash = {
  key: e => { if (splashReady && (e.key === 'Enter' || e.key === ' ')) show('menu'); },
};

// ---------- menu ----------
const items = [
  { label: 'Room Searcher', screen: 'search' },
  { label: 'Create Room', screen: 'create' },
  { label: 'Profile', screen: 'profile', needsAccount: true },
  { label: 'Settings', screen: 'settings' },
  { label: 'Changelog', screen: 'changelog' },
  { label: 'Credits', screen: 'credits' },
  { label: 'Quit', action: 'quit' },
];

let selected = 1;

function renderAccount() {
  const box = document.getElementById('account');
  box.classList.toggle('selected', selected === 0);
  box.textContent = '';
  const name = document.createElement('span');
  name.textContent = account ? account.display + ' // ' + account.username : 'guest';
  const btn = document.createElement('span');
  btn.className = 'dim';
  btn.textContent = account ? '[log out]' : '[sign in]';
  box.append(name, btn);
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

screens.menu = {
  key: e => {
    const key = e.key.toLowerCase();
    if (key === 'arrowdown' || key === 's') move(1);
    else if (key === 'arrowup' || key === 'w') move(-1);
    else if (key === 'enter') activate();
  },
  wheel: dir => move(dir),
};

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
    create.limit = Math.min(10, Math.max(2, create.limit - dir));
  }
  renderCreate();
}

screens.create = {
  key: e => {
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
  },
  wheel: dir => createMove(dir),
};

// ---------- room searcher ----------
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
  search.timer = setInterval(refreshRooms, 5000);
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

screens.search = {
  key: e => {
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
  },
  wheel: dir => { if (search.mode === 'list') moveSearch(dir); },
};

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
  const name = me.name;
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

function isAfter(a, b) {
  const ta = Number(a.dataset.ts), tb = Number(b.dataset.ts);
  return ta !== tb ? ta > tb : a.dataset.key > b.dataset.key;
}

function insertLine(node, key, ts) {
  node.dataset.key = key;
  node.dataset.ts = ts || 0;
  const log = document.getElementById('log');
  let prev = log.lastElementChild;
  while (prev && isAfter(prev, node)) prev = prev.previousElementSibling;
  log.insertBefore(node, prev ? prev.nextSibling : log.firstChild);
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
      const node = m.type === 'system' ? lineEl('[system]: ' + m.text, 'dim') : msgEl(m.name, m.text);
      insertLine(node, key, m.ts);
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

document.getElementById('log').addEventListener('mouseup', () => {
  if (!window.getSelection().toString()) msgInput.focus();
});

screens.chat = {
  key: e => { if (e.key === 'Escape') leaveCurrentRoom(); },
};

// ---------- changelog ----------
const changelog = {
  current: [
    'Rebuilt from scratch',
    'New boot screen',
    'Guest mode: a fresh guest name every time you load the menu',
  ],
  old: [
    { v: '1.5', notes: [
      'Voice calls',
      'Screensharing (for when in voice call)',
      'Kick command',
      'Voice Messages (May be buggy)',
      'Multiple language support (English, Spanish, French and German)',
      'Custom themes',
      'Fixed GIFs and images breaking the app',
      "Can't use certain special characters in username",
    ] },
    { v: '1.4', notes: [
      'Settings Menu - Includes many themes and a few toggles',
      'Image uploading',
      'GIFs (paste a tenor URL if you want to)',
      'More drawing pad features',
      '[more] button (see what else i might be working on!)',
      'You can no longer manually resize the window',
      'New fun commands :]',
      'Hold ESC to close app',
    ] },
    { v: '1.3.1', notes: [
      'Added reserved usernames for admins and stuff + specials tags',
      'System messages are all in bold',
      'Chatter in room limit + display in room searcher',
      'Username character limit',
      'Various bug fixes',
    ] },
    { v: '1.3', notes: [
      'Room searcher',
      'You can now move the drawing pad',
      'Leave/Join system messages are in bold now for some reason lol',
      'You can now see how many chatters are in your room',
      'You can see your ping now (hidden behind the music player)',
      'SPLASH TEXTS',
      'Made lots of socials! Go follow! :D',
    ] },
    { v: '1.2.2', notes: [
      'Icon',
      'Added a few animations',
      'Fixed inactivity timer announcements showing up on main menu',
      'Moved the music widget stuff around',
    ] },
    { v: '1.2.1', notes: [
      'Updated drawing pad again',
      'Added inactivity timer to prevent AFK users from clogging up rooms',
      'Added volume slider to music',
    ] },
    { v: '1.2', notes: [
      'You can now copy and paste images into the chat',
      'Changed version numbering',
      'Changed menu music and let you skip songs now',
      'Added a check for room creation to prevent server message spam',
      'Fixed menu spacing',
      'Drawing pad got new features!',
      'Made Updates screen scrollable',
    ] },
    { v: '1.1.1', notes: [
      'Messages ACTUALLY clear from the servers',
      'Added /clear command',
      'Added room code checks',
    ] },
    { v: '1.1', notes: [
      'Updates screen added',
      'HUD controls added',
      'Version numbering',
      'Added "username typing..." indicator',
      'Added drawing pad',
      'Fixed menu navigation bugs',
    ] },
    { v: '1.0', notes: [
      'Real-time anonymous chat',
      'Room creation and joining',
      'Sound effects and music',
      'Ephemeral messages',
    ] },
  ],
};

let oldOpen = false;

function renderChangelog() {
  const body = document.getElementById('cl-body');
  body.innerHTML = '';

  body.appendChild(el('p', 'vhead first ok', '2.0 Updates:'));
  changelog.current.forEach(note => body.appendChild(el('p', 'ok', '- ' + note)));

  const toggle = el('p', 'toggle', '> ' + (oldOpen ? '[-]' : '[+]') + ' 1.x Updates:');
  toggle.id = 'cl-toggle';
  body.appendChild(toggle);

  if (oldOpen) {
    changelog.old.forEach(ver => {
      body.appendChild(el('p', 'vhead dim', ver.v));
      ver.notes.forEach(note => body.appendChild(el('p', '', '- ' + note)));
    });
  }
}

screens.changelog = {
  key: e => {
    const box = document.getElementById('cl-scroll');
    const key = e.key.toLowerCase();
    if (key === 'arrowdown' || key === 's') box.scrollBy({ top: 60 });
    else if (key === 'arrowup' || key === 'w') box.scrollBy({ top: -60 });
    else if (key === 'pagedown') box.scrollBy({ top: 300 });
    else if (key === 'pageup') box.scrollBy({ top: -300 });
    else if (key === 'enter') {
      oldOpen = !oldOpen;
      renderChangelog();
      document.getElementById('cl-toggle').scrollIntoView({ block: 'nearest' });
    } else if (key === 'escape') show('menu');
  },
};

// ---------- credits ----------
screens.credits = {
  key: e => { if (e.key === 'Escape') show('menu'); },
};

// ---------- settings ----------
const set = { selectable: [], cur: 0 };
const SELECTABLE = ['radio', 'toggle', 'cycle', 'link'];

function settingsRows() {
  const rows = [];
  rows.push({ type: 'head', text: 'appearance' });
  rows.push({ type: 'label', text: 'Theme' });
  Object.keys(THEMES).forEach(name => rows.push({ type: 'radio', key: 'theme', value: name, text: name }));
  rows.push({ type: 'link', text: '+ New Custom Theme' });
  rows.push({ type: 'head', text: 'window' });
  rows.push({ type: 'label', text: 'Size (applies instantly)' });
  SIZES.forEach(size => rows.push({ type: 'radio', key: 'size', value: size, text: size }));
  rows.push({ type: 'head', text: 'toggles' });
  rows.push({ type: 'toggle', key: 'pfps', text: 'PFPs in room', hint: '(no effect until profiles exist)' });
  rows.push({
    type: 'cycle', key: 'ui', text: 'UI style',
    options: ['modern', 'classic'], labels: { modern: '2.0', classic: '1.0' },
    hint: '(no visible change until 1.0 is merged in)',
  });
  rows.push({ type: 'head', text: 'language' });
  rows.push({ type: 'radio', key: 'language', value: 'English', text: 'English' });
  rows.push({ type: 'note', text: 'more languages come much later.' });
  return rows;
}

function rowText(r) {
  if (r.type === 'radio') return '(' + (settings[r.key] === r.value ? '*' : ' ') + ') ' + r.text;
  if (r.type === 'toggle') return r.text + ': ' + (settings[r.key] ? 'ON' : 'OFF');
  if (r.type === 'cycle') return r.text + ': ' + r.labels[settings[r.key]];
  return r.text;
}

function setMsg(text) {
  document.getElementById('set-msg').textContent = text;
}

function renderSettings() {
  const body = document.getElementById('set-body');
  body.innerHTML = '';
  const rows = settingsRows();
  set.selectable = rows.filter(r => SELECTABLE.includes(r.type));
  const cursorRow = set.selectable[set.cur];
  let cursorNode = null;

  rows.forEach(r => {
    const div = el('div', 'srow ' + r.type);
    if (r.type === 'head') div.textContent = '— ' + r.text + ' —';
    else if (r.type === 'label' || r.type === 'note') div.textContent = r.text;
    else {
      div.textContent = rowText(r);
      if (r.hint) div.appendChild(el('span', 'dim small', '  ' + r.hint));
      if (r.type === 'radio' && settings[r.key] === r.value) div.classList.add('active');
      if (r === cursorRow) {
        div.classList.add('on');
        div.prepend(el('span', 'smark', '>'));
        cursorNode = div;
      }
    }
    body.appendChild(div);
  });

  if (set.cur === 0) document.getElementById('set-scroll').scrollTop = 0;
  else if (cursorNode) cursorNode.scrollIntoView({ block: 'nearest' });
}

function openSettings() {
  set.cur = 0;
  setMsg('');
  renderSettings();
}

function moveSetting(step) {
  set.cur = (set.cur + step + set.selectable.length) % set.selectable.length;
  renderSettings();
}

function activateSetting() {
  const r = set.selectable[set.cur];
  setMsg('');
  if (r.type === 'radio') {
    settings[r.key] = r.value;
    if (r.key === 'theme') applyTheme();
    if (r.key === 'size') applySize();
  } else if (r.type === 'toggle') {
    settings[r.key] = !settings[r.key];
  } else if (r.type === 'cycle') {
    const i = r.options.indexOf(settings[r.key]);
    settings[r.key] = r.options[(i + 1) % r.options.length];
    if (r.key === 'ui') applyUi();
  } else if (r.type === 'link') {
    setMsg('[system]: the custom theme editor is the next step.');
  }
  save();
  renderSettings();
}

screens.settings = {
  key: e => {
    const key = e.key.toLowerCase();
    if (key === 'arrowdown' || key === 's') moveSetting(1);
    else if (key === 'arrowup' || key === 'w') moveSetting(-1);
    else if (key === 'enter') activateSetting();
    else if (key === 'escape') show('menu');
  },
  wheel: dir => moveSetting(dir),
};

// ---------- start ----------
applyTheme();
applyUi();
render();
boot();