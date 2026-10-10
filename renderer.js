import {
  watchConnection, signInGuest,
  fbCreateRoom, fbJoinRoom, fbLeaveRoom, fbCleanup,
  fbSendMessage, fbWatchRoom, fbListRooms,
} from './firebase.js';
import { settings, save, THEMES, SIZES, applyTheme, applyColors, applyUi, applySize, getTheme, newThemeId } from './settings.js';

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
const firstRun = localStorage.getItem('tutorialDone') !== '1';

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
  if (current === 'splash' && splashReady) leaveSplash();
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
    if (!firstRun) out.innerHTML += step.label + '...';
    const [ok] = await Promise.all([step.run(), wait(firstRun ? 200 : 300 + Math.random() * 900)]);
    if (!firstRun) {
      const text = step.okText ? step.okText() : 'ok';
      out.innerHTML += ok ? ' <span class="ok">' + text + '</span>\n' : ' <span class="fail">failed</span>\n';
    }
  }
  document.getElementById('tap').classList.add('show');
  splashReady = true;
}

function leaveSplash() {
  show('menu');
  if (firstRun) startTutorial();
}

screens.splash = {
  key: e => { if (splashReady && (e.key === 'Enter' || e.key === ' ')) leaveSplash(); },
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
    if (tut.active) return tutKey(e);
    const key = e.key.toLowerCase();
    if (key === 'arrowdown' || key === 's') move(1);
    else if (key === 'arrowup' || key === 'w') move(-1);
    else if (key === 'enter') activate();
  },
  wheel: dir => {
    if (tut.active) return tutWheel(dir);
    move(dir);
  },
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
const $ = id => document.getElementById(id);
const set = { selectable: [], cur: 0, customOpen: false, flash: '', confirmDelete: null, pendingFocus: null };
const SELECTABLE = ['radio', 'toggle', 'cycle', 'link', 'dropout'];

function themeRows() {
  const rows = [];
  Object.keys(THEMES).forEach(name => rows.push({ type: 'radio', key: 'theme', value: name, text: name }));

  const list = settings.custom;
  const inline = list.length < 5;
  if (!inline) {
    rows.push({ type: 'dropout', text: (set.customOpen ? '[-]' : '[+]') + ' Custom Themes (' + list.length + ')' });
  }
  if (inline || set.customOpen) {
    list.forEach(t => rows.push({
      type: 'radio', key: 'theme', value: 'custom:' + t.id, text: t.name, custom: true, id: t.id, sub: !inline,
    }));
  }
  rows.push({ type: 'link', value: 'new', text: '+ New Custom Theme' });
  return rows;
}

function settingsRows() {
  const rows = [];
  rows.push({ type: 'head', text: 'appearance' });
  rows.push({ type: 'label', text: 'Theme' });
  themeRows().forEach(r => rows.push(r));
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

function selectableRows() {
  return settingsRows().filter(r => SELECTABLE.includes(r.type));
}

function rowText(r) {
  if (r.type === 'radio') return '(' + (settings[r.key] === r.value ? '*' : ' ') + ') ' + r.text;
  if (r.type === 'toggle') return r.text + ': ' + (settings[r.key] ? 'ON' : 'OFF');
  if (r.type === 'cycle') return r.text + ': ' + r.labels[settings[r.key]];
  return r.text;
}

function renderSettings() {
  const body = $('set-body');
  body.innerHTML = '';
  const rows = settingsRows();
  set.selectable = rows.filter(r => SELECTABLE.includes(r.type));
  set.cur = Math.max(0, Math.min(set.cur, set.selectable.length - 1));
  const cursorRow = set.selectable[set.cur];

  applyTheme(cursorRow && cursorRow.key === 'theme' ? cursorRow.value : settings.theme);

  let cursorNode = null;
  rows.forEach(r => {
    const div = el('div', 'srow ' + r.type + (r.sub ? ' sub' : ''));
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

  let msg = set.flash;
  if (!msg && cursorRow && cursorRow.key === 'theme') {
    msg = cursorRow.custom ? 'Enter = use | E = edit | Delete = remove' : 'Enter = use this theme';
  }
  $('set-msg').textContent = msg;

  if (set.cur === 0) $('set-scroll').scrollTop = 0;
  else if (cursorNode) cursorNode.scrollIntoView({ block: 'nearest' });
}

function openSettings() {
  set.flash = '';
  set.confirmDelete = null;
  const focus = set.pendingFocus || settings.theme;
  set.pendingFocus = null;
  if (focus.startsWith('custom:') && settings.custom.length >= 5) set.customOpen = true;
  const idx = selectableRows().findIndex(r => r.value === focus);
  set.cur = idx >= 0 ? idx : 0;
  renderSettings();
}

function moveSetting(step) {
  set.flash = '';
  set.confirmDelete = null;
  set.cur = (set.cur + step + set.selectable.length) % set.selectable.length;
  renderSettings();
}

function activateSetting() {
  const r = set.selectable[set.cur];
  set.flash = '';
  set.confirmDelete = null;
  if (r.type === 'radio') {
    settings[r.key] = r.value;
    if (r.key === 'size') applySize();
  } else if (r.type === 'toggle') {
    settings[r.key] = !settings[r.key];
  } else if (r.type === 'cycle') {
    const i = r.options.indexOf(settings[r.key]);
    settings[r.key] = r.options[(i + 1) % r.options.length];
    if (r.key === 'ui') applyUi();
  } else if (r.type === 'dropout') {
    set.customOpen = !set.customOpen;
  } else if (r.type === 'link') {
    openThemeEdit(null);
    show('themeedit');
    return;
  }
  save();
  renderSettings();
}

function editSetting() {
  const r = set.selectable[set.cur];
  if (!r || !r.custom) return;
  openThemeEdit(settings.custom.find(t => t.id === r.id));
  show('themeedit');
}

function deleteSetting() {
  const r = set.selectable[set.cur];
  if (!r || !r.custom) return;
  if (set.confirmDelete !== r.id) {
    set.confirmDelete = r.id;
    set.flash = 'press Delete again to remove "' + r.text + '".';
    return renderSettings();
  }
  settings.custom = settings.custom.filter(t => t.id !== r.id);
  if (settings.theme === 'custom:' + r.id) settings.theme = 'Default';
  set.confirmDelete = null;
  set.flash = 'deleted.';
  save();
  renderSettings();
}

screens.settings = {
  key: e => {
    const key = e.key.toLowerCase();
    if (key === 'arrowdown' || key === 's') moveSetting(1);
    else if (key === 'arrowup' || key === 'w') moveSetting(-1);
    else if (key === 'enter') activateSetting();
    else if (key === 'e') editSetting();
    else if (key === 'delete' || key === 'x' || key === 'backspace') deleteSetting();
    else if (key === 'escape') { applyTheme(); show('menu'); }
  },
  wheel: dir => moveSetting(dir),
};

// ---------- theme editor ----------
const EDIT_FIELDS = [
  { key: 'bg', label: 'Background' },
  { key: 'text', label: 'Text' },
  { key: 'bright', label: 'Highlight' },
  { key: 'dim', label: 'Dim text' },
  { key: 'accent', label: 'Accent' },
];
const ed = { id: null, colors: {}, cur: 0, rows: [] };

function markEditor() {
  ed.rows.forEach((row, i) => row.classList.toggle('on', i === ed.cur));
}

function openThemeEdit(theme) {
  ed.id = theme ? theme.id : null;
  ed.colors = { ...(theme ? theme.colors : getTheme(settings.theme)) };
  ed.cur = 0;
  ed.rows = [];
  $('te-msg').textContent = '';
  const body = $('te-body');
  body.innerHTML = '';

  const addRow = build => {
    const row = el('div', 'trow');
    row.appendChild(el('span', 'smark', '>'));
    build(row);
    const i = ed.rows.length;
    row.addEventListener('click', () => { ed.cur = i; markEditor(); });
    body.appendChild(row);
    ed.rows.push(row);
    return row;
  };

  addRow(row => {
    row.appendChild(el('span', 'tlabel', 'Name'));
    const input = el('input', 'tname');
    input.id = 'te-name';
    input.type = 'text';
    input.maxLength = 16;
    input.placeholder = 'My Theme';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.value = theme ? theme.name : '';
    row.appendChild(input);
  });

  EDIT_FIELDS.forEach(f => addRow(row => {
    row.appendChild(el('span', 'tlabel', f.label));
    const input = el('input', 'tcolor');
    input.type = 'color';
    input.value = ed.colors[f.key];
    const hex = el('span', 'dim', ed.colors[f.key]);
    input.addEventListener('input', () => {
      ed.colors[f.key] = input.value;
      hex.textContent = input.value;
      applyColors(ed.colors);
    });
    row.append(input, hex);
  }));

  addRow(row => row.appendChild(el('span', '', '[save]'))).addEventListener('click', saveThemeEdit);
  addRow(row => row.appendChild(el('span', '', '[cancel]'))).addEventListener('click', cancelThemeEdit);

  applyColors(ed.colors);
  markEditor();
}

function moveEditor(step) {
  if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
  ed.cur = (ed.cur + step + ed.rows.length) % ed.rows.length;
  markEditor();
}

function closeThemeEdit(focus) {
  applyTheme();
  set.pendingFocus = focus;
  show('settings');
}

function cancelThemeEdit() {
  closeThemeEdit(ed.id ? 'custom:' + ed.id : 'new');
}

function saveThemeEdit() {
  const nameEl = $('te-name');
  const name = nameEl.value.trim();
  if (!name) {
    $('te-msg').textContent = '[system]: give your theme a name.';
    ed.cur = 0;
    markEditor();
    nameEl.focus();
    return;
  }
  let theme = ed.id && settings.custom.find(t => t.id === ed.id);
  if (theme) {
    theme.name = name;
    theme.colors = { ...ed.colors };
  } else {
    theme = { id: newThemeId(), name, colors: { ...ed.colors } };
    settings.custom.push(theme);
  }
  settings.theme = 'custom:' + theme.id;
  save();
  closeThemeEdit('custom:' + theme.id);
}

screens.themeedit = {
  key: e => {
    const nameEl = $('te-name');
    if (document.activeElement === nameEl) {
      if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); nameEl.blur(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); moveEditor(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); moveEditor(-1); }
      return;
    }
    const key = e.key.toLowerCase();
    if (key === 'arrowdown' || key === 's') moveEditor(1);
    else if (key === 'arrowup' || key === 'w') moveEditor(-1);
    else if (key === 'escape') cancelThemeEdit();
    else if (key === 'enter') {
      e.preventDefault();
      const last = ed.rows.length - 1;
      if (ed.cur === 0) nameEl.focus();
      else if (ed.cur <= EDIT_FIELDS.length) ed.rows[ed.cur].querySelector('.tcolor').click();
      else if (ed.cur === last - 1) saveThemeEdit();
      else cancelThemeEdit();
    }
  },
  wheel: dir => moveEditor(dir),
};

// ---------- tutorial ----------
const tut = { active: false, step: 0, steps: [], last: 0, shown: false, filled: false, timers: [] };
const GAP = 350;

const K = k => ({ k });

function keyNodes(parts) {
  const frag = document.createDocumentFragment();
  parts.forEach(p => {
    if (typeof p === 'string') frag.appendChild(document.createTextNode(p));
    else frag.appendChild(el('span', 'kbd', p.k));
  });
  return frag;
}

function tutSteps() {
  const label = i => () => document.querySelectorAll('#menu-items .item .label')[i];
  const tour = (sel, i, text) => ({ type: 'enter', sel, target: label(i), text });
  return [
    { type: 'down', bar: ['Move down the menu: press ', K('↓'), ' or ', K('S'), ', or scroll down'] },
    { type: 'up', bar: ['Now move back up: press ', K('↑'), ' or ', K('W'), ', or scroll up'] },
    { type: 'enter', bar: ['Press ', K('Enter'), ' to select the highlighted item. First, a quick tour: press ', K('Enter')] },
    tour(1, 0, 'Room Searcher: find rooms other people made, or join one with a code'),
    tour(2, 1, 'Create Room: make your own room, public or private'),
    tour(3, 2, 'Profile: your page, with your picture and bio (needs an account)'),
    tour(4, 3, 'Settings: themes, window size and more'),
    tour(5, 4, "Changelog: see what's new in TempTerm"),
    tour(6, 5, 'Credits: the people behind TempTerm'),
    tour(7, 6, 'Quit: close TempTerm'),
    { type: 'enter', sel: 0, target: () => $('account'), text: "and here's where you make your account!", last: true },
  ];
}

function clearTutTimers() {
  tut.timers.forEach(clearTimeout);
  tut.timers = [];
}

function setBar(parts) {
  const bar = $('tut-bar');
  bar.classList.remove('on');
  tut.timers.push(setTimeout(() => {
    bar.replaceChildren(keyNodes(parts));
    bar.classList.add('on');
  }, tut.filled ? 200 : 0));
  tut.filled = true;
}

function startTutorial() {
  tut.active = true;
  tut.step = 0;
  tut.steps = tutSteps();
  tut.last = Date.now();
  tut.shown = false;
  tut.filled = false;
  selected = 1;
  render();
  document.body.classList.add('tut-active');
  $('tut-hint').textContent = 'Esc = skip tutorial';
  $('tut').hidden = false;
  void $('tut').offsetWidth;
  $('tut').classList.add('show');
  showTutStep();
}

function showTutStep() {
  clearTutTimers();
  const s = tut.steps[tut.step];
  const spot = $('tut-spot');
  const tip = $('tut-tip');
  const text = $('tut-text');

  setBar(s.bar || ['Press ', K('Enter'), s.last ? ' to finish' : ' to continue']);
  if (s.sel !== undefined) { selected = s.sel; render(); }

  if (!s.target) {
    spot.classList.remove('on');
    tip.classList.remove('on');
    tut.shown = false;
    return;
  }

  requestAnimationFrame(() => {
    if (!tut.active) return;
    const base = $('menu').getBoundingClientRect();
    const r = s.target().getBoundingClientRect();
    const left = r.left - base.left - 32;
    const top = r.top - base.top - 6;
    const width = r.width + 46;
    const height = r.height + 12;
    const fresh = !tut.shown;

    if (fresh) { spot.classList.add('jump'); tip.classList.add('jump'); }
    spot.style.width = width + 'px';
    spot.style.height = height + 'px';
    spot.style.transform = 'translate(' + left + 'px,' + top + 'px)';

    const place = () => {
      text.textContent = s.text;
      tip.style.maxWidth = Math.max(160, base.width - (left + width + 20) - 24) + 'px';
      const x = left + width + 20;
      const y = top + height / 2 - tip.offsetHeight / 2;
      tip.style.transform = 'translate(' + x + 'px,' + y + 'px)';
      text.classList.remove('out');
      tip.classList.add('on');
    };

    if (fresh) place();
    else {
      text.classList.add('out');
      tut.timers.push(setTimeout(place, 180));
    }

    if (fresh) {
      void spot.offsetWidth;
      spot.classList.remove('jump');
      tip.classList.remove('jump');
      tut.shown = true;
    }
    spot.classList.add('on');
  });
}

function canAct() {
  return Date.now() - tut.last >= GAP;
}

function tutAdvance() {
  tut.last = Date.now();
  if (tut.step === tut.steps.length - 1) return endTutorial();
  tut.step++;
  showTutStep();
}

function endTutorial() {
  tut.active = false;
  clearTutTimers();
  localStorage.setItem('tutorialDone', '1');
  document.body.classList.remove('tut-active');
  $('tut').classList.remove('show');
  setTimeout(() => { if (!tut.active) $('tut').hidden = true; }, 450);
  selected = 1;
  render();
  say("[system]: account setup isn't built yet.");
}

function tutNope() {
  const bar = $('tut-bar');
  bar.classList.remove('nope');
  void bar.offsetWidth;
  bar.classList.add('nope');
}

function tutKey(e) {
  e.preventDefault();
  if (e.repeat) return;
  const key = e.key.toLowerCase();
  if (['shift', 'control', 'alt', 'meta', 'capslock'].includes(key)) return;
  if (key === 'escape') return endTutorial();

  const s = tut.steps[tut.step];
  const down = key === 'arrowdown' || key === 's';
  const up = key === 'arrowup' || key === 'w';
  const match = (s.type === 'down' && down) || (s.type === 'up' && up) || (s.type === 'enter' && key === 'enter');

  if (!canAct()) return;
  if (!match) return tutNope();
  if (s.type === 'down') move(1);
  if (s.type === 'up') move(-1);
  tutAdvance();
}

function tutWheel(dir) {
  const s = tut.steps[tut.step];
  if (!canAct()) return;
  if (s.type === 'down' && dir > 0) { move(1); tutAdvance(); }
  else if (s.type === 'up' && dir < 0) { move(-1); tutAdvance(); }
}

// ---------- dev reset ----------
const devBtn = $('dev-reset');
let devArmed = null;

if (window.tt && window.tt.isDev) {
  window.tt.isDev().then(on => { devBtn.hidden = !on; });
}

devBtn.addEventListener('click', e => {
  e.stopPropagation();
  devBtn.blur();
  if (!devArmed) {
    devBtn.textContent = 'click again to wipe ALL data';
    devArmed = setTimeout(() => { devArmed = null; devBtn.textContent = 'reset'; }, 3000);
    return;
  }
  clearTimeout(devArmed);
  devBtn.textContent = 'resetting...';
  window.tt.resetAll();
});

// ---------- start ----------
applyTheme();
applyUi();
if (firstRun) {
  document.getElementById('splash-title').textContent = 'Welcome to TempTerm!';
  document.getElementById('splash-ver').hidden = true;
}
render();
boot();