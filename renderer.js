import {
  watchConnection, fbInit, fbLoadProfile, fbSaveProfile, fbUsernameFree, fbSignUp, fbSignIn, fbSignOut, fbSendReset,
  fbEmailVerified, fbResendVerification,
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
let verifyTimer = null;

function show(id) {
  clearInterval(search.timer);
  clearInterval(verifyTimer);
  current = id;
  document.querySelectorAll('.screen').forEach(s => s.hidden = s.id !== id);
  if (id === 'menu') {
    if (!account) me.name = randomGuestName();
    render();
    if (account && !account.verified) {
      checkVerified();
      verifyTimer = setInterval(checkVerified, 20000);
    }
  }
  if (id === 'create') { create.step = 0; create.type = 0; create.limit = 10; busy = false; renderCreate(); }
  if (id === 'search') openSearch();
  if (id === 'chat') enterChat();
  if (id === 'changelog') { oldOpen = false; renderChangelog(); document.getElementById('cl-scroll').scrollTop = 0; }
  if (id === 'settings') openSettings();
  if (id === 'profile') renderProfile();
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
        const info = await fbInit();
        me.uid = info.uid;
        if (!info.anonymous) {
          const profile = await fbLoadProfile(info.uid);
          if (profile) { setAccount(info.uid, profile); account.verified = await fbEmailVerified(); }
          else me.uid = await fbSignOut();
        }
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
  renderVerify();
}

function say(text) {
  document.getElementById('sys').textContent = text;
}

function activate() {
  say('');
  if (selected === 0) {
    if (account) logout(); else openSignin();
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
    else if (key === 'v') resendVerify();
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
    'Accounts / Profiles',
    'Tutorial when you first open the app',
    'Settings re-built',
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

  body.appendChild(el('p', 'vhead first ok', '2.0 PR 1 Updates:'));
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

// ---------- accounts ----------
const USERNAME_RE = /^[A-Za-z0-9_]{3,16}$/;
const RESERVED_RE = /^(admin|dev|mod|moderator|tempterm|system|staff|owner|guest.*)$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function setAccount(uid, profile) {
  account = { uid, username: profile.username, display: profile.display, verified: false, profile };
  me.uid = uid;
  me.name = profile.display;
}

async function logout() {
  say('');
  try {
    me.uid = await fbSignOut();
    account = null;
    me.name = randomGuestName();
    render();
    say('[system]: logged out. you are a guest again.');
  } catch (e) {
    console.error(e);
    say('[system]: could not log out.');
  }
}

function finishAuth(text) {
  show('menu');
  say(text);
}

const form = { cfg: null, rows: [], cur: 0, busy: false, token: 0 };

function formMsg(text, kind) {
  const m = $('f-msg');
  m.textContent = text;
  m.className = 'setmsg small ' + (kind === 'err' ? 'fail' : kind === 'ok' ? 'ok' : 'dim');
}

function formValues() {
  const v = {};
  form.rows.forEach(r => { if (r.field) v[r.field.key] = r.input.value; });
  return v;
}

function formMark(i) {
  form.cur = i;
  form.rows.forEach((r, n) => r.row.classList.toggle('on', n === i));
}

function formFocus(i) {
  formMark(i);
  const r = form.rows[i];
  if (r.input) r.input.focus();
  else if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
  r.row.scrollIntoView({ block: 'nearest' });
}

function formMove(step) {
  formFocus((form.cur + step + form.rows.length) % form.rows.length);
}

function openForm(cfg) {
  form.cfg = cfg;
  form.rows = [];
  form.busy = false;
  form.token++;
  $('f-title').textContent = cfg.title;
  $('f-corner').hidden = !cfg.corner;
  const body = $('f-body');
  body.innerHTML = '';
  const card = el('div', 'fcard');
  body.appendChild(card);
  if (cfg.intro) card.appendChild(el('p', 'fintro dim small', cfg.intro));

  cfg.fields.forEach(f => {
    const row = el('div', 'frow');
    row.appendChild(el('label', 'flabel', f.label));
    const input = el('input', 'finput');
    input.type = f.type;
    input.maxLength = f.max || 64;
    input.autocomplete = 'off';
    input.spellcheck = false;
    const note = el('span', 'fnote dim');
    row.append(input, note);
    if (f.onInput) input.addEventListener('input', () => f.onInput(input.value, note));
    const i = form.rows.length;
    input.addEventListener('focus', () => formMark(i));
    card.appendChild(row);
    form.rows.push({ row, input, field: f, note });
  });

  const btns = el('div', 'fbtns');
  card.appendChild(btns);
  cfg.buttons.forEach((b, n) => {
    const btn = el('button', 'fbtn ' + (n === 0 ? 'primary' : 'link'), b.label);
    btn.tabIndex = -1;
    const i = form.rows.length;
    btn.addEventListener('click', () => { btn.blur(); formMark(i); b.action(); });
    btns.appendChild(btn);
    form.rows.push({ row: btn, button: b });
  });

  show('form');
  $('f-scroll').scrollTop = 0;
  formMsg('', 'dim');
  formFocus(0);
}

async function formSubmit() {
  if (form.busy) return;
  form.busy = true;
  try { await form.cfg.submit(formValues()); }
  catch (e) { console.error(e); formMsg('something went wrong. try again.', 'err'); }
  form.busy = false;
}

function formEnter() {
  const r = form.rows[form.cur];
  if (r.button) return r.button.action();
  const inputs = form.rows.filter(x => x.input);
  if (r === inputs[inputs.length - 1]) return formSubmit();
  formMove(1);
}

screens.form = {
  key: e => {
    const r = form.rows[form.cur];
    const typing = !!(r && r.input);
    const key = e.key.toLowerCase();
    if (key === 'arrowdown' || (!typing && key === 's')) { e.preventDefault(); formMove(1); }
    else if (key === 'arrowup' || (!typing && key === 'w')) { e.preventDefault(); formMove(-1); }
    else if (key === 'tab') { e.preventDefault(); formMove(e.shiftKey ? -1 : 1); }
    else if (key === 'enter') { e.preventDefault(); formEnter(); }
    else if (key === 'escape') form.cfg.back();
  },
  wheel: dir => formMove(dir),
};

$('f-corner').addEventListener('click', () => openSignin());

let nameTimer = null;

function checkUsername(value, note) {
  clearTimeout(nameTimer);
  const name = value.trim();
  const token = ++form.token;
  const say2 = (text, cls) => { note.textContent = text; note.className = 'fnote ' + cls; };
  if (!name) return say2('', 'dim');
  if (!USERNAME_RE.test(name)) return say2('3-16 letters, numbers or _', 'fail');
  if (RESERVED_RE.test(name)) return say2('that name is reserved', 'fail');
  say2('checking...', 'dim');
  nameTimer = setTimeout(async () => {
    try {
      const free = await fbUsernameFree(name);
      if (token === form.token) say2(free ? 'available' : 'taken', free ? 'ok' : 'fail');
    } catch {
      if (token === form.token) say2('', 'dim');
    }
  }, 400);
}

function openSignup() {
  openForm({
    title: 'Create your account',
    corner: true,
    intro: 'pick a unique username, a display name for chat, and your email.',
    back: () => show('menu'),
    fields: [
      { key: 'username', label: 'Username', type: 'text', max: 16, onInput: checkUsername },
      { key: 'display', label: 'Display name', type: 'text', max: 20 },
      { key: 'email', label: 'Email', type: 'text', max: 100 },
      { key: 'password', label: 'Password', type: 'password', max: 64 },
      { key: 'confirm', label: 'Confirm password', type: 'password', max: 64 },
    ],
    buttons: [
      { label: 'Create account', action: formSubmit },
      { label: 'I already have an account', action: openSignin },
      { label: 'Continue as guest', action: () => show('menu') },
    ],
    submit: doSignup,
  });
}

async function doSignup(v) {
  const username = v.username.trim();
  const display = v.display.trim() || username;
  const email = v.email.trim();
  const fail = (text, row) => { formMsg(text, 'err'); formFocus(row); };
  if (!USERNAME_RE.test(username)) return fail('username: 3-16 letters, numbers or _', 0);
  if (RESERVED_RE.test(username)) return fail('that username is reserved.', 0);
  if (display.length > 20) return fail('display name: 20 characters max.', 1);
  if (!EMAIL_RE.test(email)) return fail('that email address does not look right.', 2);
  if (v.password.length < 8) return fail('password: at least 8 characters.', 3);
  if (v.password !== v.confirm) return fail('the passwords do not match.', 4);

  formMsg('creating your account...', 'dim');
  const res = await fbSignUp({ username, display, email, password: v.password });
  if (res.error) return formMsg(res.error, 'err');
  const full = await fbLoadProfile(res.uid);
  setAccount(res.uid, full || res.profile);
  finishAuth('[system]: welcome, ' + res.profile.display + '! check your email to verify your address.');
}

function openSignin() {
  openForm({
    title: 'Sign in',
    corner: false,
    intro: 'use the email you signed up with. (username sign-in is not available yet.)',
    back: () => show('menu'),
    fields: [
      { key: 'email', label: 'Email', type: 'text', max: 100 },
      { key: 'password', label: 'Password', type: 'password', max: 64 },
    ],
    buttons: [
      { label: 'Sign in', action: formSubmit },
      { label: 'Forgot your password?', action: openForgot },
      { label: 'Create an account', action: openSignup },
      { label: 'Continue as guest', action: () => show('menu') },
    ],
    submit: doSignin,
  });
}

async function doSignin(v) {
  const email = v.email.trim();
  if (!email.includes('@')) {
    formMsg('use your email to sign in. username sign-in is not available yet.', 'err');
    return formFocus(0);
  }
  if (!v.password) { formMsg('enter your password.', 'err'); return formFocus(1); }

  formMsg('signing in...', 'dim');
  const res = await fbSignIn(email, v.password);
  if (res.error) {
    if (res.uid) me.uid = res.uid;
    return formMsg(res.error, 'err');
  }
  if (!res.profile) {
    me.uid = await fbSignOut();
    return formMsg('this account has no profile yet. contact the developer.', 'err');
  }
  setAccount(res.uid, res.profile);
  account.verified = await fbEmailVerified();
  finishAuth('[system]: signed in as ' + res.profile.display + '.');
}

function openForgot() {
  openForm({
    title: 'Reset your password',
    corner: false,
    intro: "enter your account's email and we'll send a reset link.",
    back: openSignin,
    fields: [{ key: 'email', label: 'Email', type: 'text', max: 100 }],
    buttons: [
      { label: 'Send reset link', action: formSubmit },
      { label: 'Back to sign in', action: openSignin },
    ],
    submit: async v => {
      const email = v.email.trim();
      if (!EMAIL_RE.test(email)) return formMsg('that email address does not look right.', 'err');
      formMsg('sending...', 'dim');
      const res = await fbSendReset(email);
      if (res.error) return formMsg(res.error, 'err');
      formMsg('if that email has an account, a reset link is on its way. check spam too.', 'ok');
    },
  });
}

// ---------- email verification ----------
const verify = { state: 'idle', until: 0, text: '' };

function renderVerify() {
  const box = $('verify');
  const visible = !!account && !account.verified && current === 'menu' && !tut.active;
  box.hidden = !visible;
  if (!visible) return;
  const idle = verify.state === 'idle';
  $('verify-text').textContent = idle ? 'make sure to verify your email! ' : verify.text;
  $('verify-link').hidden = !idle;
  $('verify-key').hidden = !idle;
}

async function checkVerified() {
  if (!account || account.verified) return;
  account.verified = await fbEmailVerified();
  renderVerify();
}

function setVerifyState(state, text, ms) {
  verify.state = state;
  verify.text = text || '';
  renderVerify();
  if (ms) setTimeout(() => { verify.state = 'idle'; renderVerify(); }, ms);
}

async function resendVerify() {
  if (!account || account.verified || verify.state !== 'idle') return;
  if (Date.now() < verify.until) {
    return setVerifyState('note', 'please wait a minute before sending another one.', 3500);
  }
  verify.until = Date.now() + 60000;
  setVerifyState('note', 'sending...');
  const res = await fbResendVerification();
  if (res.error) {
    verify.until = 0;
    return setVerifyState('note', res.error, 5000);
  }
  setVerifyState('note', 'verification email sent! check your inbox and your spam folder.', 6000);
}

$('verify-link').addEventListener('click', e => { e.stopPropagation(); resendVerify(); });

// ---------- profile ----------
const PATTERNS = { dither: '░▒▓█▓▒░ ', grid: '+---', waves: '~^~_', stars: '. * ˙ ' };
const RULE = '─'.repeat(200);
const HEX = /^#[0-9a-f]{6}$/i;
const PNG = /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/;
const isSmooth = url => url.startsWith('data:image/jpeg');

function frameEl(box, title) {
  const top = el('div', 'ft');
  const left = el('span', '', '┌─ ');
  left.appendChild(el('span', 'tt2', title));
  left.appendChild(document.createTextNode(' '));
  top.append(left, el('span', 'fl', RULE), el('span', '', '┐'));
  const bottom = el('div', 'ft fb');
  bottom.append(el('span', '', '└'), el('span', 'fl', RULE), el('span', '', '┘'));
  box.classList.add('fr');
  box.prepend(top);
  box.append(bottom);
}

function withDefaults(p) {
  const display = p.display || p.username || '?';
  const pfpImg = PNG.test(p.pfpImg || '') ? p.pfpImg : '';
  const bannerImg = PNG.test(p.bannerImg || '') ? p.bannerImg : '';
  let bannerMode = ['dither', 'grid', 'waves', 'stars', 'image'].includes(p.bannerMode) ? p.bannerMode : 'dither';
  if (bannerMode === 'image' && !bannerImg) bannerMode = 'dither';
  return {
    username: p.username || '',
    display,
    created: p.created || 0,
    badges: p.badges || '',
    layout: [1, 2, 3].includes(p.layout) ? p.layout : 1,
    accent: HEX.test(p.accent || '') ? p.accent : '#4ade80',
    bio: p.bio || '',
    letter: p.letter || Array.from(display)[0].toUpperCase(),
    pfpMode: p.pfpMode === 'image' && pfpImg ? 'image' : 'letter',
    pfpImg, bannerMode, bannerImg,
  };
}

function pfpNode(p, size) {
  const px = size + 'px';
  if (p.pfpMode === 'image') {
    const img = el('img', 'pfpb');
    img.src = p.pfpImg;
    img.alt = '';
    img.style.imageRendering = isSmooth(p.pfpImg) ? 'auto' : 'pixelated';
    img.style.width = px;
    img.style.height = px;
    return img;
  }
  const d = el('div', 'pfpb', p.letter);
  d.style.width = px;
  d.style.height = px;
  d.style.background = p.accent;
  d.style.fontSize = Math.round(size / 2) + 'px';
  return d;
}

function bannerNode(p, rows, height) {
  if (p.bannerMode === 'image') {
    const img = el('img', 'pbanner');
    img.src = p.bannerImg;
    img.alt = '';
    img.style.imageRendering = isSmooth(p.bannerImg) ? 'auto' : 'pixelated';
    img.style.height = height + 'px';
    return img;
  }
  const pat = PATTERNS[p.bannerMode] || PATTERNS.dither;
  let line = '';
  while (line.length < 140) line += pat;
  const lines = [];
  for (let i = 0; i < rows; i++) lines.push(i % 2 ? line.slice(2) : line);
  const d = el('div', 'pbn', lines.join('\n'));
  d.style.color = p.accent;
  d.style.height = (rows * 12) + 'px';
  return d;
}

function infoNode(p) {
  const d = el('div', 'pinfo');
  const row = (label, value) => {
    const line = el('div');
    line.append(el('span', 'c', label + ' '), document.createTextNode(value));
    d.appendChild(line);
  };
  row('Login:', p.username);
  row('Name:', p.display);
  row('Joined:', p.created ? new Date(p.created).toISOString().slice(0, 10) : '—');
  const tags = String(p.badges).split(',').map(t => t.trim()).filter(Boolean);
  if (tags.length) d.appendChild(el('div', 'y', tags.map(t => '[' + t + ']').join(' ')));
  return d;
}

function bioNode(p) {
  const d = el('div', 'pbio');
  d.appendChild(el('span', 'dim', 'bio'));
  d.appendChild(document.createTextNode('\n'));
  d.appendChild(p.bio ? document.createTextNode(p.bio) : el('span', 'dim italic', 'no bio yet.'));
  return d;
}

function profileNode(raw) {
  const p = withDefaults(raw);
  const box = el('div', 'pbox');
  if (p.layout === 1) {
    box.appendChild(bannerNode(p, 4, 56));
    const row = el('div', 'prow1');
    row.append(pfpNode(p, 64), el('b', '', p.display));
    box.append(row, infoNode(p));
  } else if (p.layout === 2) {
    const row = el('div', 'prow2');
    const side = el('div', 'pside');
    side.appendChild(bannerNode(p, 5, 64));
    row.append(pfpNode(p, 64), side);
    box.append(row, infoNode(p));
  } else {
    const row = el('div', 'prow3');
    row.append(pfpNode(p, 64), infoNode(p));
    const strip = el('div', 'pdiv');
    strip.appendChild(bannerNode(p, 1, 20));
    box.append(row, strip);
  }
  box.appendChild(bioNode(p));
  frameEl(box, 'finger ' + p.username);
  return box;
}

function renderProfile() {
  const body = $('pf-body');
  body.innerHTML = '';
  if (!account) return;
  body.appendChild(profileNode(account.profile));
  $('pf-scroll').scrollTop = 0;
}

screens.profile = {
  key: e => {
    const box = $('pf-scroll');
    const key = e.key.toLowerCase();
    if (key === 'enter' || key === 'e') openEditProfile();
    else if (key === 'arrowdown' || key === 's') box.scrollBy({ top: 60 });
    else if (key === 'arrowup' || key === 'w') box.scrollBy({ top: -60 });
    else if (key === 'escape') show('menu');
  },
};

// ---------- edit profile ----------
const ep = { s: null, rows: [], r: 0, c: 0, busy: false, armed: false, sel: [], art: [], idx: {}, resetBtn: null };

function epMsg(text, kind) {
  const m = $('ep-msg');
  m.textContent = text;
  m.className = 'setmsg small ' + (kind === 'err' ? 'fail' : kind === 'ok' ? 'ok' : 'dim');
}

function epCtl() {
  const row = ep.rows[ep.r];
  return row.items[Math.min(ep.c, row.items.length - 1)];
}

function epDisarm() {
  if (!ep.armed) return;
  ep.armed = false;
  ep.resetBtn.textContent = 'Reset profile';
}

function epSet(r, c) {
  if (r !== ep.r || c !== ep.c) epDisarm();
  ep.r = r;
  ep.c = c;
  ep.rows.forEach((row, ri) => row.items.forEach((ctl, ci) => ctl.el.classList.toggle('on', ri === r && ci === c)));
}

function epFocus(r, c) {
  epSet(r, c);
  const ctl = ep.rows[r].items[c];
  if (ctl.input) ctl.input.focus();
  else if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
  ctl.el.scrollIntoView({ block: 'nearest' });
}

function epLinear(step) {
  const flat = [];
  ep.rows.forEach((row, r) => row.items.forEach((_, c) => flat.push([r, c])));
  let i = flat.findIndex(p => p[0] === ep.r && p[1] === ep.c);
  i = (i + step + flat.length) % flat.length;
  epFocus(flat[i][0], flat[i][1]);
}

function epRow(step) {
  const r = (ep.r + step + ep.rows.length) % ep.rows.length;
  epFocus(r, Math.min(ep.c, ep.rows[r].items.length - 1));
}

function epCol(step) {
  const n = ep.rows[ep.r].items.length;
  const c = Math.max(0, Math.min(n - 1, ep.c + step));
  if (c !== ep.c) epFocus(ep.r, c);
}

function epRefresh() {
  ep.sel.forEach(s => s.el.classList.toggle('sel', s.test()));
  ep.art.forEach(fn => fn());
}

function openEditProfile() {
  const p = withDefaults(account.profile);
  ep.s = {
    layout: p.layout, accent: p.accent, display: p.display, bio: p.bio, letter: p.letter,
    pfpMode: p.pfpMode, pfpImg: p.pfpImg, bannerMode: p.bannerMode, bannerImg: p.bannerImg,
  };
  ep.rows = [];
  ep.sel = [];
  ep.art = [];
  ep.idx = {};
  ep.r = 0;
  ep.c = 0;
  ep.busy = false;
  ep.armed = false;
  const body = $('ep-body');
  body.innerHTML = '';

  const section = title => {
    const sec = el('div', 'esec');
    if (title) sec.appendChild(el('p', 'etitle', title));
    body.appendChild(sec);
    return sec;
  };

  const newRow = (parent, cls) => {
    const holder = el('div', cls || 'etiles');
    parent.appendChild(holder);
    const row = { holder, items: [] };
    ep.rows.push(row);
    return row;
  };

  const add = (row, node, kind, act, input) => {
    const ctl = { el: node, kind, act, input };
    row.items.push(ctl);
    const r = ep.rows.indexOf(row);
    const c = row.items.length - 1;
    if (input) input.addEventListener('focus', () => epSet(r, c));
    else node.addEventListener('click', ev => { epFocus(r, c); if (act) act(ev); });
    row.holder.appendChild(node);
    return ctl;
  };

  const tile = (row, art, caption, act, isSel) => {
    const b = el('button', 'tile');
    b.tabIndex = -1;
    b.append(art, el('span', 'tcap', caption));
    b.addEventListener('click', () => b.blur());
    if (isSel) ep.sel.push({ el: b, test: isSel });
    return add(row, b, 'tile', act);
  };

  const field = (parent, label, key, max, opts = {}) => {
    const row = newRow(parent, 'frow');
    if (opts.id) ep.idx[opts.id] = ep.rows.length - 1;
    const wrap = el('div', 'fwrap');
    wrap.appendChild(el('label', 'flabel', label));
    const input = el(opts.area ? 'textarea' : 'input', 'finput' + (opts.area ? ' area' : '') + (opts.cls ? ' ' + opts.cls : ''));
    if (!opts.area) input.type = 'text';
    input.maxLength = max;
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.value = ep.s[key];
    input.addEventListener('input', () => {
      if (opts.upper) input.value = input.value.toUpperCase();
      ep.s[key] = input.value;
      epRefresh();
    });
    wrap.appendChild(input);
    add(row, wrap, opts.area ? 'area' : 'input', null, input);
  };

  const layoutSec = section('Layout');
  const lrow = newRow(layoutSec);
  [[1, 'Banner on top'], [2, 'Banner beside picture'], [3, 'Banner as divider']].forEach(([n, cap]) => {
    const wf = el('div', 'wf l' + n);
    ['b', 'p', 't1', 't2'].forEach(k => wf.appendChild(el('i', k)));
    if (n === 3) wf.appendChild(el('i', 't3'));
    tile(lrow, wf, cap, () => { ep.s.layout = n; epRefresh(); }, () => ep.s.layout === n);
  });

  const details = section('Details');
  field(details, 'Display name', 'display', 20, { id: 'display' });
  field(details, 'Bio', 'bio', 200, { area: true });
  const colorRow = newRow(details, 'frow');
  const sw = el('div', 'swatchrow');
  sw.appendChild(el('span', 'flabel', 'Accent color'));
  const cin = el('input', 'tcolor');
  cin.type = 'color';
  cin.value = ep.s.accent;
  const hex = el('span', 'dim', ep.s.accent);
  cin.addEventListener('input', () => { ep.s.accent = cin.value; hex.textContent = cin.value; epRefresh(); });
  sw.append(cin, hex);
  add(colorRow, sw, 'color', ev => { if (ev && ev.target === cin) return; cin.click(); });

  const pic = section('Profile picture');
  const prow = newRow(pic);
  const letterArt = el('div', 'tart');
  tile(prow, letterArt, 'Letter', () => { ep.s.pfpMode = 'letter'; epRefresh(); }, () => ep.s.pfpMode === 'letter');
  ep.art.push(() => { letterArt.textContent = ep.s.letter || '?'; letterArt.style.background = ep.s.accent; });

  const imgArt = el('div', 'tart');
  const imgTile = tile(prow, imgArt, 'Image', () => {
    if (ep.s.pfpImg && ep.s.pfpMode !== 'image') { ep.s.pfpMode = 'image'; epRefresh(); }
    else epUpload('pfp');
  }, () => ep.s.pfpMode === 'image');
  const imgCap = imgTile.el.querySelector('.tcap');
  ep.art.push(() => {
    imgArt.replaceChildren();
    if (ep.s.pfpImg) {
      const im = el('img');
      im.src = ep.s.pfpImg;
      im.alt = '';
      im.style.imageRendering = isSmooth(ep.s.pfpImg) ? 'auto' : 'pixelated';
      imgArt.appendChild(im);
    } else imgArt.appendChild(el('span', 'dim', '+'));
    imgCap.textContent = !ep.s.pfpImg ? 'Image (upload)' : ep.s.pfpMode === 'image' ? 'Image (click to replace)' : 'Image (your last one)';
  });

  tile(prow, el('div', 'tart glyph', '✎'), 'Drawing', () => epMsg('the drawing pad comes later.', 'dim'));
  field(pic, 'Picture letter', 'letter', 1, { cls: 'short', upper: true, id: 'letter' });

  const ban = section('Banner');
  const crow = newRow(ban, 'chips');
  ['dither', 'grid', 'waves', 'stars'].forEach(name => {
    const b = el('button', 'chip', name);
    b.tabIndex = -1;
    add(crow, b, 'chip', () => { ep.s.bannerMode = name; epRefresh(); });
    ep.sel.push({ el: b, test: () => ep.s.bannerMode === name });
  });

  const brow = newRow(ban);
  const bannerArt = el('div', 'tart wide');
  const bannerTile = tile(brow, bannerArt, 'Image', () => {
    if (ep.s.bannerImg && ep.s.bannerMode !== 'image') { ep.s.bannerMode = 'image'; epRefresh(); }
    else epUpload('banner');
  }, () => ep.s.bannerMode === 'image');
  const bannerCap = bannerTile.el.querySelector('.tcap');
  ep.art.push(() => {
    bannerArt.replaceChildren();
    if (ep.s.bannerImg) {
      const im = el('img');
      im.src = ep.s.bannerImg;
      im.alt = '';
      im.style.imageRendering = isSmooth(ep.s.bannerImg) ? 'auto' : 'pixelated';
      bannerArt.appendChild(im);
    } else bannerArt.appendChild(el('span', 'dim', '+'));
    bannerCap.textContent = !ep.s.bannerImg ? 'Image (upload)' : ep.s.bannerMode === 'image' ? 'Image (click to replace)' : 'Image (your last one)';
  });
  tile(brow, el('div', 'tart wide glyph', '✎'), 'Drawing', () => epMsg('the drawing pad comes later.', 'dim'));

  const actions = section('');
  const btnRow = (label, cls, fn) => {
    const row = newRow(actions, 'ebtn');
    const b = el('button', 'fbtn ' + cls, label);
    b.tabIndex = -1;
    b.addEventListener('click', () => b.blur());
    add(row, b, 'btn', fn);
    return b;
  };
  btnRow('Save', 'primary', epSave);
  btnRow('Cancel', 'link', () => show('profile'));
  ep.resetBtn = btnRow('Reset profile', 'danger', epReset);

  epRefresh();
  epMsg('', 'dim');
  show('editprofile');
  $('ep-scroll').scrollTop = 0;
  epFocus(0, 0);
}

async function refreshAccountProfile() {
  const fresh = await fbLoadProfile(account.uid);
  if (fresh) {
    account.profile = fresh;
    account.display = fresh.display;
    me.name = fresh.display;
  }
}

async function epSave() {
  if (ep.busy) return;
  const s = ep.s;
  const display = s.display.trim();
  const letter = Array.from(s.letter.trim())[0] || '';
  if (!display) { epMsg("display name can't be empty.", 'err'); return epFocus(ep.idx.display, 0); }
  if (!letter) { epMsg('pick one character for the picture letter.', 'err'); return epFocus(ep.idx.letter, 0); }

  ep.busy = true;
  epMsg('saving...', 'dim');
  const res = await fbSaveProfile(account.uid, {
    layout: s.layout,
    accent: s.accent,
    display,
    bio: s.bio.trim() || null,
    letter,
    pfpMode: s.pfpMode,
    pfpImg: s.pfpImg || null,
    bannerMode: s.bannerMode,
    bannerImg: s.bannerImg || null,
  });
  ep.busy = false;
  if (res.error) return epMsg(res.error, 'err');
  await refreshAccountProfile();
  show('profile');
}

async function epReset() {
  if (ep.busy) return;
  if (!ep.armed) {
    ep.armed = true;
    ep.resetBtn.textContent = 'Click again to confirm';
    return epMsg('this resets your name, bio, pictures and layout.', 'err');
  }
  ep.armed = false;
  ep.busy = true;
  epMsg('resetting...', 'dim');
  const res = await fbSaveProfile(account.uid, {
    layout: null, accent: null, display: account.username, bio: null, letter: null,
    pfpMode: null, pfpImg: null, bannerMode: null, bannerImg: null,
  });
  ep.busy = false;
  if (res.error) return epMsg(res.error, 'err');
  await refreshAccountProfile();
  show('profile');
}

screens.editprofile = {
  key: e => {
    const ctl = epCtl();
    const typing = !!ctl.input && document.activeElement === ctl.input;
    const key = e.key.toLowerCase();

    if (key === 'tab') { e.preventDefault(); return epLinear(e.shiftKey ? -1 : 1); }

    if (typing) {
      if (key === 'escape') { e.preventDefault(); ctl.input.blur(); return; }
      if (ctl.kind === 'input') {
        if (key === 'arrowdown') { e.preventDefault(); epRow(1); }
        else if (key === 'arrowup') { e.preventDefault(); epRow(-1); }
        else if (key === 'enter') { e.preventDefault(); epLinear(1); }
      }
      return;
    }

    if (key === 'arrowdown' || key === 's') { e.preventDefault(); epRow(1); }
    else if (key === 'arrowup' || key === 'w') { e.preventDefault(); epRow(-1); }
    else if (key === 'arrowleft' || key === 'a') { e.preventDefault(); epCol(-1); }
    else if (key === 'arrowright' || key === 'd') { e.preventDefault(); epCol(1); }
    else if (key === 'enter') {
      e.preventDefault();
      if (ctl.act) ctl.act();
      else if (ctl.input) ctl.input.focus();
    }
    else if (key === 'escape') show('profile');
  },
  wheel: dir => epRow(dir),
};

// ---------- image picking and cropping ----------
function pickFile() {
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.addEventListener('change', () => resolve(input.files[0] || null));
    input.addEventListener('cancel', () => resolve(null));
    input.click();
  });
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('bad image')); };
    img.src = url;
  });
}

async function epUpload(kind) {
  const file = await pickFile();
  if (!file) return;
  epMsg('opening image...', 'dim');
  let img;
  try { img = await loadImage(file); }
  catch (e) { console.error(e); return epMsg('could not read that image.', 'err'); }

  openCrop(kind, img,
    url => {
      if (kind === 'pfp') { ep.s.pfpImg = url; ep.s.pfpMode = 'image'; }
      else { ep.s.bannerImg = url; ep.s.bannerMode = 'image'; }
      epRefresh();
      show('editprofile');
      epMsg((kind === 'pfp' ? 'picture' : 'banner') + ' ready. press Save to keep it.', 'ok');
    },
    () => { show('editprofile'); epMsg('', 'dim'); });
}

const CROP = {
  pfp: { view: [240, 240], title: 'Crop picture', res: [[16, 16], [32, 32], [64, 64]], smooth: [128, 128], cap: 30000, out: [96, 96] },
  banner: { view: [480, 120], title: 'Crop banner', res: [[48, 12], [96, 24], [192, 48]], smooth: [384, 96], cap: 60000, out: [192, 48] },
};
const cr = { kind: null, img: null, zoom: 1, ox: 0, oy: 0, res: 1, done: null, cancel: null, drag: null };
const crView = $('cr-view');

function cropGeom() {
  const [vw, vh] = CROP[cr.kind].view;
  const iw = cr.img.naturalWidth, ih = cr.img.naturalHeight;
  const scale = Math.max(vw / iw, vh / ih) * cr.zoom;
  const dw = iw * scale, dh = ih * scale;
  const mx = Math.max(0, (dw - vw) / 2), my = Math.max(0, (dh - vh) / 2);
  cr.ox = Math.max(-mx, Math.min(mx, cr.ox));
  cr.oy = Math.max(-my, Math.min(my, cr.oy));
  return { vw, vh, scale, dw, dh, left: vw / 2 + cr.ox - dw / 2, top: vh / 2 + cr.oy - dh / 2 };
}

function cropSize() {
  const cfg = CROP[cr.kind];
  return cr.res < 3 ? cfg.res[cr.res] : cfg.smooth;
}

function cropRender(g, w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const x = c.getContext('2d');
  x.fillStyle = '#0c0c0c';
  x.fillRect(0, 0, w, h);
  x.imageSmoothingEnabled = true;
  x.imageSmoothingQuality = 'high';
  x.drawImage(cr.img, -g.left / g.scale, -g.top / g.scale, g.vw / g.scale, g.vh / g.scale, 0, 0, w, h);
  return c;
}

function cropDraw() {
  const g = cropGeom();
  const x = crView.getContext('2d');
  x.fillStyle = '#0c0c0c';
  x.fillRect(0, 0, g.vw, g.vh);
  x.imageSmoothingQuality = 'high';
  x.drawImage(cr.img, g.left, g.top, g.dw, g.dh);

  const [w, h] = cropSize();
  const out = $('cr-out');
  out.width = w;
  out.height = h;
  out.getContext('2d').drawImage(cropRender(g, w, h), 0, 0);
  out.style.imageRendering = cr.res < 3 ? 'pixelated' : 'auto';
  out.style.width = CROP[cr.kind].out[0] + 'px';
  out.style.height = CROP[cr.kind].out[1] + 'px';

  const zoom = $('cr-zoom');
  if (Number(zoom.value) !== Math.round(cr.zoom * 100)) zoom.value = Math.round(cr.zoom * 100);
}

function cropChips() {
  const cfg = CROP[cr.kind];
  const box = $('cr-chips');
  box.innerHTML = '';
  const labels = cfg.res.map(([w, h], i) => (i + 1) + ' · ' + w + '×' + h).concat(['4 · Smooth (no pixelation)']);
  labels.forEach((text, i) => {
    const b = el('button', 'chip' + (i === cr.res ? ' sel' : ''), text);
    b.tabIndex = -1;
    b.addEventListener('click', () => { b.blur(); setCropRes(i); });
    box.appendChild(b);
  });
  $('cr-note').textContent = 'Smooth keeps the full look but shrinks it to ' + cfg.smooth[0] + '×' + cfg.smooth[1] + ' so profiles load fast.';
}

function setCropRes(i) {
  cr.res = i;
  cropChips();
  cropDraw();
}

function openCrop(kind, img, done, cancel) {
  cr.kind = kind;
  cr.img = img;
  cr.zoom = 1;
  cr.ox = 0;
  cr.oy = 0;
  cr.res = 1;
  cr.done = done;
  cr.cancel = cancel;
  cr.drag = null;
  const cfg = CROP[kind];
  $('cr-title').textContent = cfg.title;
  crView.width = cfg.view[0];
  crView.height = cfg.view[1];
  $('cr-msg').textContent = '';
  $('cr-msg').className = 'setmsg small dim';
  cropChips();
  show('crop');
  cropDraw();
}

function cropConfirm() {
  const g = cropGeom();
  const [w, h] = cropSize();
  const cap = CROP[cr.kind].cap;
  const c = cropRender(g, w, h);
  let url = null;
  if (cr.res < 3) {
    const png = c.toDataURL('image/png');
    if (png.length < cap) url = png;
  } else {
    for (const q of [0.88, 0.75, 0.6, 0.45]) {
      const jpg = c.toDataURL('image/jpeg', q);
      if (jpg.length < cap) { url = jpg; break; }
    }
  }
  if (!url) {
    $('cr-msg').textContent = 'that is too detailed to save. try a lower pixelation option.';
    $('cr-msg').className = 'setmsg small fail';
    return;
  }
  cr.done(url);
}

function cropZoom(delta) {
  cr.zoom = Math.max(1, Math.min(4, cr.zoom + delta));
  cropDraw();
}

crView.addEventListener('pointerdown', e => {
  cr.drag = { x: e.clientX, y: e.clientY, ox: cr.ox, oy: cr.oy };
  crView.setPointerCapture(e.pointerId);
  crView.style.cursor = 'grabbing';
});
crView.addEventListener('pointermove', e => {
  if (!cr.drag) return;
  cr.ox = cr.drag.ox + e.clientX - cr.drag.x;
  cr.oy = cr.drag.oy + e.clientY - cr.drag.y;
  cropDraw();
});
crView.addEventListener('pointerup', () => { cr.drag = null; crView.style.cursor = 'grab'; });

$('cr-zoom').addEventListener('input', e => { cr.zoom = e.target.value / 100; cropDraw(); });
$('cr-zoom').addEventListener('change', e => e.target.blur());
$('cr-ok').addEventListener('click', e => { e.target.blur(); cropConfirm(); });
$('cr-no').addEventListener('click', e => { e.target.blur(); cr.cancel(); });

screens.crop = {
  key: e => {
    const step = e.shiftKey ? 40 : 10;
    const key = e.key;
    if (key === 'Enter') { e.preventDefault(); cropConfirm(); }
    else if (key === 'Escape') cr.cancel();
    else if (key === 'ArrowLeft') { e.preventDefault(); cr.ox -= step; cropDraw(); }
    else if (key === 'ArrowRight') { e.preventDefault(); cr.ox += step; cropDraw(); }
    else if (key === 'ArrowUp') { e.preventDefault(); cr.oy -= step; cropDraw(); }
    else if (key === 'ArrowDown') { e.preventDefault(); cr.oy += step; cropDraw(); }
    else if (key === '+' || key === '=') cropZoom(0.15);
    else if (key === '-' || key === '_') cropZoom(-0.15);
    else if (key >= '1' && key <= '4') setCropRes(Number(key) - 1);
  },
  wheel: dir => cropZoom(-dir * 0.15),
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
  openSignup();
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