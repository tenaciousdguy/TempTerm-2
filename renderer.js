import {
  watchConnection, fbInit, fbLoadProfile, fbSaveProfile, fbUsernameFree, fbSignUp, fbSignIn, fbSignOut,
  fbSendReset, fbEmailVerified, fbResendVerification, fbGetUser, fbSendReport,
  fbWatchNotices, fbClearNotice, fbWatchProfile, fbChangeUsername, fbLoadSettings,
  fbSaveSettings, fbFinishProfile, withTimeout,
  fbCreateRoom, fbJoinRoom, fbLeaveRoom, fbCleanup, fbSendMessage, fbWatchRoom, fbListRooms,
  fbChangePassword, fbChangeEmail, fbDeleteAccount, fbWatchStatus
} from './firebase.js';
import {
  settings, save, THEMES, SIZES, applyTheme, applyColors, applyUi, applyPfps, applySize,
  getTheme, newThemeId, setSaveHook, getSyncable, applyRemote,
} from './settings.js';
import { createGrid, scrollInto } from './ui.js';
import { openEditor, closeEditor, editorKey } from './editor.js';

const $ = id => document.getElementById(id);

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

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
let online = false;
let everOnline = false;
let sessionOk = false;
let needsSetup = false;
const firstRun = localStorage.getItem('tutorialDone') !== '1';
const APP_VERSION = '2.0.0';

// ---------- key router ----------
const screens = {};

document.addEventListener('keydown', e => {
  if (noticeUi.open) {
    e.preventDefault();
    if (e.key === 'Enter' || e.key === 'Escape' || e.key === ' ') dismissNotice();
    return;
  }
  const s = screens[current];
  if (s && s.key) s.key(e);
});

let lastWheel = 0;
document.addEventListener('wheel', e => {
  if (noticeUi.open) return;
  const s = screens[current];
  if (!s || !s.wheel) return;
  const now = Date.now();
  if (now - lastWheel < 120) return;
  lastWheel = now;
  s.wheel(e.deltaY > 0 ? 1 : -1);
});

document.addEventListener('click', () => {
  if (noticeUi.open) return;
  if (current === 'splash' && splashReady) leaveSplash();
});

// ---------- screens ----------
let verifyTimer = null;

function show(id) {
  clearInterval(search.timer);
  clearInterval(verifyTimer);
  cancelQuit();
  current = id;
  $('offline').hidden = online || id === 'splash';
  document.querySelectorAll('.screen').forEach(s => s.hidden = s.id !== id);
  if (id === 'menu') {
    if (!account) me.name = randomGuestName();
    pickSplashText();
    render();
    if (account && !account.verified) {
      checkVerified();
      verifyTimer = setInterval(checkVerified, 20000);
    }
  }
  if (id === 'create') { create.step = 0; create.type = 0; create.limit = 10; busy = false; renderCreate(); }
  if (id === 'search') openSearch();
  if (id === 'chat') enterChat();
  if (id === 'changelog') { oldOpen = false; renderChangelog(); $('cl-scroll').scrollTop = 0; }
  if (id === 'settings') openSettings();
  if (id === 'profile') renderProfile();
    if (id === 'credits') { renderCredits(); $('cred-scroll').scrollTop = 0; }
}

// ---------- boot ----------
function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function setStatus(on) {
  const status = $('status');
  status.textContent = on ? '● server: connected' : '● server: not connected';
  status.classList.toggle('on', on);
}

function connChanged(on) {
  const was = online;
  online = on;
  setStatus(on);
  const bar = $('offline');
  bar.textContent = room
    ? '● connection lost. you will rejoin the room on your own when it is back.'
    : '● connection lost. reconnecting...';
  bar.hidden = on || current === 'splash';
  if (on && !was && everOnline) onReconnected();
  if (on) everOnline = true;
}

function waitForServer(timeout) {
  return new Promise(resolve => {
    let done = false;
    const timer = setTimeout(() => { if (!done) { done = true; resolve(false); } }, timeout);
    watchConnection(on => {
      connChanged(on);
      if (on && !done) { done = true; clearTimeout(timer); resolve(true); }
    });
  });
}

async function initSession() {
  const info = await fbInit();
  me.uid = info.uid;
  if (!info.anonymous) {
    const profile = await fbLoadProfile(info.uid);
    if (profile) { setAccount(info.uid, profile); account.verified = await fbEmailVerified(); }
    else needsSetup = true;
  }
  startLive();
  sessionOk = true;
  const last = localStorage.getItem('lastRoom');
  if (last) { await fbCleanup(last).catch(() => {}); localStorage.removeItem('lastRoom'); }
}

async function onReconnected() {
  if (!sessionOk) {
    try {
      await withTimeout(initSession(), 12000);
      if (account) await pullSettings();
      if (current === 'menu') {
        render();
        say(needsSetup ? '[system]: connected. use the account box to finish setting up.' : '[system]: connected!');
      }
    } catch (e) { console.error(e); }
  }
  if (room) setTimeout(() => { if (room && online && !rj.busy) rejoinRoom(); }, 2500);
}

const steps = [
  { label: 'connecting to server', run: () => waitForServer(8000) },
  { label: 'signing in',
    run: async () => {
      try { await withTimeout(initSession(), 12000); return true; }
      catch (err) { console.error(err); return false; }
    },
    okText: () => account ? 'ok' : 'guest' },
  { label: 'loading themes', run: async () => { applyTheme(); applyUi(); return true; } },
  { label: 'syncing settings', run: async () => { if (account) await pullSettings(); applySize(); return true; } },
];

async function boot() {
  const out = $('boot');
  for (const step of steps) {
    if (!firstRun) out.innerHTML += step.label + '...';
    const [ok] = await Promise.all([step.run(), wait(firstRun ? 200 : 300 + Math.random() * 900)]);
    if (!firstRun) {
      const text = step.okText ? step.okText() : 'ok';
      out.innerHTML += ok ? ' <span class="ok">' + text + '</span>\n' : ' <span class="fail">failed</span>\n';
    }
  }
  $('tap').classList.add('show');
  splashReady = true;
}

function leaveSplash() {
  show('menu');
  if (firstRun) startTutorial();
  else if (needsSetup) openFinishSetup();
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
  const box = $('account');
  box.classList.toggle('selected', selected === 0);
  box.textContent = '';
  const name = document.createElement('span');
  name.textContent = account ? account.display + ' // ' + account.username : needsSetup ? 'finish setting up your account' : 'guest';
  const btn = document.createElement('span');
  btn.className = 'dim';
  btn.textContent = account ? '[log out]' : needsSetup ? '[finish]' : '[sign in]';
  box.append(name, btn);
}

function renderMenu() {
  const nav = $('menu-items');
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
  renderSplashText();
  renderBanner();
}

function say(text) {
  $('sys').textContent = text;
}

function activate() {
  say('');
  if (selected === 0) {
    if (account) logout();
    else if (needsSetup) openFinishSetup();
    else openSignin();
    return;
  }
  const item = items[selected - 1];
  if (item.action === 'quit') return window.close();
  if ((item.screen === 'search' || item.screen === 'create') && !online) {
    say('[system]: no connection to the server yet. it will connect on its own...');
    return;
  }
  if (item.screen === 'search' || item.screen === 'create') {
    if (!sessionOk) { say('[system]: still signing in. one moment...'); return; }
  }
  if (item.needsAccount && !account) {
    say('[system]: sign in to use profiles.');
    return;
  }
  if ($(item.screen)) show(item.screen);
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
    else if (key === 'escape' && !e.repeat) startQuitHold();
    else if (key === 'x') dismissBanner();
    else if (key === 'v') resendVerify();
  },
  wheel: dir => {
    if (tut.active) return tutWheel(dir);
    move(dir);
  },
};

const SPLASHES = [
  'hi lol',
  'type something. it will be gone soon.',
  'now with accounts!',
  'terminal chic since 1.0',
  'i miss skype',
  'be kind, it all disappears anyway',
  'room for ten',
  'insert will smith memory wipe gif',
  'made by one very tired person',
  'have you tried turning it off and on again?',
  'discord 2: the revenge',
  'thanks belgium.',
  'hello little stylus',
  'rip dream smp',
];
let splashText = '';
let lastSplash = -1;

function pickSplashText() {
  if (account && Math.random() < 0.2) { splashText = 'welcome back, ' + account.display + '!'; return; }
  let i;
  do { i = Math.floor(Math.random() * SPLASHES.length); } while (i === lastSplash && SPLASHES.length > 1);
  lastSplash = i;
  splashText = SPLASHES[i];
}

function renderSplashText() {
  $('splash-text').textContent = splashText;
}

const qh = { t0: 0, timer: null };

function cancelQuit() {
  if (!qh.timer) return;
  clearInterval(qh.timer);
  qh.timer = null;
  say('');
}

function startQuitHold() {
  if (qh.timer) return;
  qh.t0 = Date.now();
  qh.timer = setInterval(() => {
    const p = Math.min(1, (Date.now() - qh.t0) / 1500);
    const n = Math.round(p * 20);
    say('[system]: hold Esc to quit  [' + '█'.repeat(n) + '·'.repeat(20 - n) + ']');
    if (p >= 1) { cancelQuit(); window.close(); }
  }, 60);
}

document.addEventListener('keyup', e => { if (e.key === 'Escape') cancelQuit(); });
window.addEventListener('blur', cancelQuit);

// ---------- create room ----------
const create = { step: 0, type: 0, limit: 10 };

const types = [
  { label: 'Public — anyone can join', value: 'public' },
  { label: 'Private — code is needed to join', value: 'private' },
];

function renderCreate() {
  const q = $('cr-q');
  const body = $('cr-body');
  const hint = $('cr-hint');
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

let lastCreate = 0;

async function startRoom() {
  if (busy) return;
  const hint = $('cr-hint');
  if (!online) { hint.textContent = '[system]: offline. waiting for the server...'; return; }
  const left = 8000 - (Date.now() - lastCreate);
  if (left > 0) { hint.textContent = '[system]: wait ' + Math.ceil(left / 1000) + ' seconds before making another room.'; return; }
  busy = true;
  hint.textContent = '[system]: creating room...';
  try {
    const code = await fbCreateRoom({
      type: types[create.type].value,
      limit: create.limit,
      hostName: me.name,
    });
    lastCreate = Date.now();
    const err = await enterRoom(code, true);
    if (err) hint.textContent = '[system]: ' + err;
  } catch (e) {
    console.error(e);
    hint.textContent = '[system]: ' + (e.code === 'timeout' ? 'the server is not answering. try again.' : 'could not create the room.');
  } finally {
    busy = false;
  }
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
const sqInput = $('sq');
const codeInput = $('code-in');

const hints = {
  list: '↑ ↓ / W S / scroll = choose | Enter = Join | / = Search | R = Refresh | Escape = Back',
  text: 'type to search | Enter or ↓ = back to the list | Escape = back to the list',
  code: 'Enter = Join | Escape = Cancel',
};

function setSearchMsg(text) {
  $('s-msg').textContent = text;
}

function setMode(mode) {
  search.mode = mode;
  $('cp').hidden = mode !== 'code';
  $('s-hint').textContent = hints[mode];
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
  const box = $('rl');
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
  if (!online) { setSearchMsg('[system]: offline. waiting for the server...'); return; }
  try {
    search.rooms = await fbListRooms();
    const m = $('s-msg').textContent;
    if (m.includes('offline') || m.includes('load rooms')) setSearchMsg('');
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
let pinned = true;

async function enterRoom(code, fresh = false, lid = null) {
  if (!me.uid) return 'not signed in. check your connection.';
  if (!online) return 'offline. waiting for the server...';
  try {
    const res = await fbJoinRoom(code, me.name, { fresh, lid });
    if (res.error) return res.error;
    room = { code, ...res.meta };
    localStorage.setItem('lastRoom', code);
    show('chat');
    return null;
  } catch (e) {
    console.error(e);
    return e.code === 'timeout' ? 'the server is not answering. try again.' : 'could not join the room.';
  }
}

const rj = { busy: false, tries: [] };

function closedWhileAway(text) {
  if (stopWatch) { stopWatch(); stopWatch = null; }
  room = null;
  localStorage.removeItem('lastRoom');
  resetChatUi();
  show('menu');
  say('[system]: ' + text);
}

async function rejoinRoom() {
  if (rj.busy || !room || !me.uid) return;
  const now = Date.now();
  rj.tries = rj.tries.filter(t => now - t < 60000);
  if (rj.tries.length >= 5) return;
  rj.tries.push(now);
  rj.busy = true;
  const code = room.code;
  try {
    const res = await fbJoinRoom(code, me.name, { rejoin: true });
    if (!room || room.code !== code) return;
    if (res.error) return closedWhileAway(res.error === 'closed' ? 'the room closed while you were disconnected.' : res.error);
    restartWatch();
  } catch (e) {
    console.error(e);
  } finally {
    rj.busy = false;
  }
}

function renderChatHeader() {
  const c = $('count');
  c.replaceChildren();
  if (!room) return;
  const n = room.members ? Object.keys(room.members).length : 0;
  c.append(el('b', '', room.code), document.createTextNode('  ·  ' + room.type + '  ·  ' + n + '/' + room.limit + ' here'));
}

function startWatch() {
  stopWatch = fbWatchRoom(room.code, {
    onMessage: (key, m) => {
      const node = m.type === 'system' ? lineEl('[system]: ' + m.text) : msgEl(m);
      insertLine(node, key, m.ts, m.uid === me.uid);
    },
    onMembers: members => {
      room.members = members;
      renderChatHeader();
      if (online && me.uid && !members[me.uid] && !rj.busy) rejoinRoom();
    },
    onError: err => {
      console.warn('room listener stopped:', err.code);
      if (online) setTimeout(rejoinRoom, 500);
    },
  });
}

function restartWatch() {
  if (stopWatch) { stopWatch(); stopWatch = null; }
  $('log').innerHTML = '';
  pinned = true;
  startWatch();
}

async function leaveCurrentRoom() {
  if (!room) return;
  const { code, lid } = room;
  const name = me.name;
  resetChatUi();
  if (stopWatch) { stopWatch(); stopWatch = null; }
  room = null;
  localStorage.removeItem('lastRoom');
  show('menu');
  try { await fbLeaveRoom(code, name, lid); } catch (e) { console.error(e); }
}

function timeLabel(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function readable(hex) {
  if (!/^#[0-9a-f]{6}$/i.test(hex || '')) return null;
  const n = parseInt(hex.slice(1), 16);
  let r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  if (lum >= 110) return hex;
  const t = (110 - lum) / (255 - lum);
  r = Math.round(r + (255 - r) * t);
  g = Math.round(g + (255 - g) * t);
  b = Math.round(b + (255 - b) * t);
  return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
}

function lineEl(text) {
  return el('div', 'sysl', text);
}

function msgEl(m) {
  const node = el('div', 'm');
  node.dataset.uid = m.uid || '';

  const head = el('div', 'mhead');
  const who = el('span', 'who');
  who.dataset.uid = m.uid || '';
  who.dataset.name = m.name;
  const pf = el('span', 'pfsq cpf');
  who.append(pf, el('span', 'wname', m.name));
  head.append(who, el('span', 'mtime', timeLabel(m.ts)));
  node.appendChild(head);

  if (m.text) node.appendChild(el('div', 'mbody', m.text));

  if (m.img && PNG.test(m.img)) {
    const img = el('img', 'mimg');
    img.src = m.img;
    img.alt = 'picture';
    img.addEventListener('load', () => { if (pinned) toBottom(); });
    node.appendChild(img);
  }

  getUser(m.uid).then(u => {
    fillPfp(pf, u);
    const col = u ? readable(withDefaults(u).accent) : null;
    if (col) node.style.setProperty('--uc', col);
  });
  return node;
}

function isAfter(a, b) {
  const ta = Number(a.dataset.ts), tb = Number(b.dataset.ts);
  return ta !== tb ? ta > tb : a.dataset.key > b.dataset.key;
}

function regroup(node) {
  if (!node || !node.classList || !node.classList.contains('m')) return;
  const prev = node.previousElementSibling;
  const cont = !!(prev && prev.classList.contains('m') && node.dataset.uid
    && prev.dataset.uid === node.dataset.uid
    && Number(node.dataset.ts) - Number(prev.dataset.ts) < 300000);
  node.classList.toggle('cont', cont);
}

function toBottom() {
  const log = $('log');
  log.scrollTop = log.scrollHeight;
  $('newmsg').hidden = true;
}

function insertLine(node, key, ts, mine) {
  node.dataset.key = key;
  node.dataset.ts = ts || 0;
  const log = $('log');
  const stick = pinned || mine;
  let prev = log.lastElementChild;
  while (prev && isAfter(prev, node)) prev = prev.previousElementSibling;
  log.insertBefore(node, prev ? prev.nextSibling : log.firstChild);
  regroup(node);
  regroup(node.nextElementSibling);
  if (stick) { toBottom(); pinned = true; }
  else $('newmsg').hidden = false;
}

function addLocalLine(text) {
  $('log').appendChild(lineEl(text));
  if (pinned) toBottom();
}

function enterChat() {
  $('log').innerHTML = '';
  $('msg').value = '';
  userCache.clear();
  resetChatUi();
  room.members = {};
  rj.tries = [];
  pinned = true;
  $('newmsg').hidden = true;
  renderChatHeader();
  updateCmds();
  startWatch();
  $('msg').focus();
}

$('log').addEventListener('scroll', () => {
  const log = $('log');
  pinned = log.scrollHeight - log.scrollTop - log.clientHeight < 80;
  if (pinned) $('newmsg').hidden = true;
});

$('newmsg').addEventListener('click', () => { toBottom(); $('msg').focus(); });

// ---------- commands ----------
const commands = {
  image: { desc: 'send a picture', run: () => pickChatImage() },
  draw: { desc: 'draw something to send', run: () => openDrawPad() },
  gif: { desc: 'search for a gif (coming soon)', soon: true },
  kick: { desc: 'remove someone from the room (coming soon)', soon: true },
  voice: { desc: 'join a voice call (coming soon)', soon: true },
  leave: { desc: 'leave the room', run: () => leaveCurrentRoom() },
};

let cmdMatches = [];
let cmdSel = 0;
const msgInput = $('msg');

function pickCommand(name) {
  msgInput.value = '/' + name + ' ';
  cmdSel = 0;
  updateCmds();
  msgInput.focus();
}

function updateCmds() {
  const box = $('cmds');
  const v = msgInput.value.toLowerCase();
  cmdMatches = [];
  if (v.startsWith('/') && !v.includes(' ')) {
    cmdMatches = Object.keys(commands).filter(n => ('/' + n).startsWith(v));
  }
  if (!cmdMatches.length) { box.hidden = true; return; }
  cmdSel = Math.min(cmdSel, cmdMatches.length - 1);
  box.innerHTML = '';
  cmdMatches.forEach((n, i) => {
    const row = el('div', 'cmd' + (i === cmdSel ? ' sel' : '') + (commands[n].soon ? ' soon' : ''));
    row.append(el('span', 'name', '/' + n), el('span', 'desc', commands[n].desc));
    row.addEventListener('mousedown', ev => { ev.preventDefault(); pickCommand(n); });
    box.appendChild(row);
  });
  box.hidden = false;
}

function runCommand(text) {
  const name = text.slice(1).split(' ')[0].toLowerCase();
  const cmd = commands[name];
  if (!cmd) addLocalLine('[system]: unknown command: /' + name);
  else if (cmd.run) cmd.run();
  else addLocalLine('[system]: /' + name + ' is coming soon.');
}

// ---------- sending ----------
const sendTimes = [];
const imgTimes = [];

function sendText(text) {
  if (!online) return addLocalLine('[system]: you are offline. your message was not sent.');
  const now = Date.now();
  while (sendTimes.length && now - sendTimes[0] > 5000) sendTimes.shift();
  if (sendTimes.length >= 6) return addLocalLine('[system]: slow down a little.');
  sendTimes.push(now);
  msgInput.value = '';
  updateCmds();
  fbSendMessage(room.code, me.name, text).catch(err => {
    console.error(err);
    addLocalLine('[system]: message failed to send.');
  });
}

async function sendImageMessage(url, caption) {
  if (!room) return;
  if (!online) return addLocalLine('[system]: you are offline. the picture was not sent.');
  const now = Date.now();
  while (imgTimes.length && now - imgTimes[0] > 10000) imgTimes.shift();
  if (imgTimes.length >= 2) return addLocalLine('[system]: slow down, one picture at a time.');
  imgTimes.push(now);
  try {
    await fbSendMessage(room.code, me.name, caption, { img: url });
  } catch (err) {
    console.error(err);
    addLocalLine('[system]: the picture failed to send.');
  }
}

msgInput.addEventListener('input', () => { cmdSel = 0; updateCmds(); });

msgInput.addEventListener('keydown', e => {
  const open = !$('cmds').hidden;

  if (open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
    e.preventDefault();
    e.stopPropagation();
    cmdSel = (cmdSel + (e.key === 'ArrowDown' ? 1 : -1) + cmdMatches.length) % cmdMatches.length;
    updateCmds();
    return;
  }

  if (open && (e.key === 'Tab' || e.key === 'Enter')) {
    const pick = cmdMatches[cmdSel];
    if (e.key === 'Tab' || msgInput.value.trim().toLowerCase() !== '/' + pick) {
      e.preventDefault();
      e.stopPropagation();
      pickCommand(pick);
      return;
    }
  }

  if (open && e.key === 'Escape') {
    e.stopPropagation();
    $('cmds').hidden = true;
    return;
  }

  if (e.key !== 'Enter' || !room) return;
  const text = msgInput.value.trim();
  if (!text) return;
  if (text.startsWith('/')) {
    msgInput.value = '';
    updateCmds();
    runCommand(text);
    return;
  }
  sendText(text);
});

// ---------- pictures ----------
async function pickChatImage() {
  const file = await pickFile();
  if (file) openChatImageFromFile(file);
}

async function openChatImageFromFile(file) {
  if (!room || !file) return;
  if (!file.type || !file.type.startsWith('image/')) return addLocalLine('[system]: that is not a picture.');
  if (!online) return addLocalLine('[system]: you are offline.');
  try {
    const img = await loadImage(file);
    openChatEditor({ image: img, title: 'Send picture' });
  } catch (e) {
    console.error(e);
    addLocalLine('[system]: could not read that picture.');
  }
}

function openDrawPad() {
  if (!online) return addLocalLine('[system]: you are offline.');
  openChatEditor({ blank: { w: 640, h: 400, bg: '#ffffff' }, title: 'Drawing pad' });
}

function openChatEditor(src) {
  if (!room) return;
  closeCard();
  chatUi.ie = true;
  msgInput.blur();
  $('cmds').hidden = true;
  openEditor($('ie'), {
    ...src,
    onSend: (url, caption) => { closeChatEditor(); sendImageMessage(url, caption); },
    onCancel: () => closeChatEditor(),
  });
}

function closeChatEditor() {
  chatUi.ie = false;
  closeEditor();
  if (room) msgInput.focus();
}

$('attach').addEventListener('click', () => { $('attach').blur(); pickChatImage(); });

function chatBusy() {
  return chatUi.ie || chatUi.iv || chatUi.pv || chatUi.rp || chatUi.who;
}

document.addEventListener('paste', e => {
  if (current !== 'chat' || !room || chatBusy()) return;
  const items = e.clipboardData && e.clipboardData.items ? Array.from(e.clipboardData.items) : [];
  const it = items.find(i => i.kind === 'file' && i.type.startsWith('image/'));
  if (!it) return;
  e.preventDefault();
  openChatImageFromFile(it.getAsFile());
});

document.addEventListener('dragover', e => e.preventDefault());
document.addEventListener('drop', e => {
  e.preventDefault();
  if (current !== 'chat' || !room || chatBusy()) return;
  const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
  if (f && f.type && f.type.startsWith('image/')) openChatImageFromFile(f);
});

$('log').addEventListener('mouseup', () => {
  if (!window.getSelection().toString()) msgInput.focus();
});

screens.chat = {
  key: e => {
    if (chatUi.ie) return editorKey(e);
    if (chatUi.iv) return ivKey(e);
    if (chatUi.rp) return rpKey(e);
    if (chatUi.pv) return pvKey(e);
    if (chatUi.who) return whoKey(e);
    const log = $('log');
    if (e.key === 'PageUp') { e.preventDefault(); log.scrollBy({ top: -300 }); return; }
    if (e.key === 'PageDown') { e.preventDefault(); log.scrollBy({ top: 300 }); return; }
    if (e.key === 'End' && !msgInput.value) { e.preventDefault(); toBottom(); return; }
    if (e.key === 'Escape') {
      if (chatUi.card) return closeCard();
      return leaveCurrentRoom();
    }
    if (e.key === 'Tab') { e.preventDefault(); openWho(); }
  },
  wheel: dir => { if (chatUi.who) moveWho(dir); },
};

// ---------- people in chat ----------
const userCache = new Map();
const chatUi = { card: false, who: false, pv: false, rp: false, ie: false, iv: false, whoSel: 0, whoList: [], pvUid: null, pvUser: null };

function getUser(uid) {
  if (!uid) return Promise.resolve(null);
  if (account && uid === account.uid) return Promise.resolve(account.profile);
  if (!userCache.has(uid)) userCache.set(uid, fbGetUser(uid).catch(() => null));
  return userCache.get(uid);
}

function fillPfp(node, user, size) {
  node.replaceChildren();
  if (size) {
    node.style.width = size + 'px';
    node.style.height = size + 'px';
    node.style.fontSize = Math.round(size / 2) + 'px';
  }
  if (!user) { node.style.background = '#9a9a9a'; node.textContent = '?'; return; }
  const p = withDefaults(user);
  if (p.pfpMode === 'image') {
    const img = el('img');
    img.src = p.pfpImg;
    img.alt = '';
    img.style.imageRendering = isSmooth(p.pfpImg) ? 'auto' : 'pixelated';
    node.style.background = 'transparent';
    node.appendChild(img);
  } else {
    node.style.background = p.accent;
    node.textContent = p.letter;
  }
}

function guestNode(name) {
  const box = el('div', 'pbox');
  const row = el('div', 'prow3');
  const pf = el('div', 'pfb', '?');
  pf.style.cssText = 'width:64px;height:64px;background:#9a9a9a;font-size:32px';
  const info = el('div', 'pinfo');
  [['Login:', 'guest (no account)'], ['Name:', name || 'guest'], ['Joined:', 'just now']].forEach(([a, b]) => {
    const line = el('div');
    line.append(el('span', 'c', a + ' '), document.createTextNode(b));
    info.appendChild(line);
  });
  info.appendChild(el('div', 'dim', '[guest]'));
  row.append(pf, info);
  const bio = el('div', 'pbio');
  bio.append(el('span', 'dim', 'bio'),
    document.createTextNode('\nthis user is a guest.\nthey probably stink.'));
  box.append(row, bio);
  frameEl(box, 'finger guest');
  return box;
}

function closeCard() {
  chatUi.card = false;
  $('card').hidden = true;
}

function resetChatUi() {
  chatUi.card = chatUi.who = chatUi.pv = chatUi.rp = chatUi.ie = chatUi.iv = false;
  $('card').hidden = true;
  $('wl').hidden = true;
  $('pv').hidden = true;
  $('rp').hidden = true;
  $('iv').hidden = true;
  closeEditor();
}

async function openCard(anchor) {
  const uid = anchor.dataset.uid;
  const name = anchor.dataset.name;
  const user = await getUser(uid);
  const card = $('card');
  card.innerHTML = '';

  const top = el('div', 'pcrow');
  const pf = el('span', 'pfsq mpf');
  fillPfp(pf, user, 40);
  const text = el('div');
  text.appendChild(el('b', '', user ? (user.display || name) : name));
  text.appendChild(el('div', 'dim small', user ? '@' + user.username : 'guest'));
  top.append(pf, text);

  const btn = el('button', 'fbtn', 'View profile');
  btn.tabIndex = -1;
  btn.addEventListener('click', () => { btn.blur(); openProfileOverlay(uid, name); });
  card.append(top, btn);
  frameEl(card, 'card');
  card.hidden = false;
  chatUi.card = true;

  const base = $('chat').getBoundingClientRect();
  const r = anchor.getBoundingClientRect();
  const left = Math.max(8, Math.min(r.left - base.left, base.width - card.offsetWidth - 12));
  let topPos = r.top - base.top - card.offsetHeight - 6;
  if (topPos < 8) topPos = r.bottom - base.top + 6;
  card.style.left = left + 'px';
  card.style.top = topPos + 'px';
}

async function openProfileOverlay(uid, name) {
  closeCard();
  const holder = $('pv-card');
  holder.innerHTML = '';
  let node;
  let user = null;
  if (uid && account && uid === account.uid) node = profileNode(account.profile);
  else {
    user = uid ? await fbLoadProfile(uid).catch(() => null) : null;
    node = user ? profileNode(user) : guestNode(name);
  }
  holder.appendChild(node);
  chatUi.pvUid = uid;
  chatUi.pvUser = user;
  $('pv-report').hidden = !user;
  $('pv').hidden = false;
  $('pv').scrollTop = 0;
  chatUi.pv = true;
  msgInput.blur();
}

function closePv() {
  chatUi.pv = false;
  $('pv').hidden = true;
  msgInput.focus();
}

function pvKey(e) {
  const key = e.key.toLowerCase();
  e.preventDefault();
  if (key === 'escape' || key === 'enter') closePv();
  else if (key === 'arrowdown' || key === 's') $('pv').scrollBy({ top: 60 });
  else if (key === 'arrowup' || key === 'w') $('pv').scrollBy({ top: -60 });
  else if (key === 'r') openReport();
}

$('pv-report').addEventListener('click', e => { e.stopPropagation(); openReport(); });

function renderWho() {
  const box = $('wl');
  box.innerHTML = '';
  chatUi.whoList.forEach((m, i) => {
    const on = i === chatUi.whoSel;
    const row = el('div', 'wrow' + (on ? ' sel' : ''));
    const pf = el('span', 'pfsq mpf');
    row.append(el('span', 'wmark', on ? '>' : ''), pf, el('span', '', m.name + (m.uid === me.uid ? ' (you)' : '')));
    getUser(m.uid).then(u => fillPfp(pf, u));
    box.appendChild(row);
  });
  box.appendChild(el('div', 'dim small', '↑ ↓ = choose | Enter = view profile | Esc = close'));
  frameEl(box, 'in this room');
  box.hidden = false;
}

function openWho() {
  const members = room && room.members ? Object.entries(room.members) : [];
  if (!members.length) return;
  chatUi.whoList = members
    .map(([uid, m]) => ({ uid, name: m.name || 'guest' }))
    .sort((a, b) => a.name.localeCompare(b.name));
  chatUi.whoSel = Math.max(0, chatUi.whoList.findIndex(m => m.uid === me.uid));
  closeCard();
  chatUi.who = true;
  msgInput.blur();
  renderWho();
}

function closeWho() {
  chatUi.who = false;
  $('wl').hidden = true;
  msgInput.focus();
}

function moveWho(step) {
  chatUi.whoSel = (chatUi.whoSel + step + chatUi.whoList.length) % chatUi.whoList.length;
  renderWho();
}

function whoKey(e) {
  const key = e.key.toLowerCase();
  e.preventDefault();
  if (key === 'escape' || key === 'tab') closeWho();
  else if (key === 'arrowdown' || key === 's') moveWho(1);
  else if (key === 'arrowup' || key === 'w') moveWho(-1);
  else if (key === 'enter') {
    const m = chatUi.whoList[chatUi.whoSel];
    closeWho();
    openProfileOverlay(m.uid, m.name);
  }
}

function openViewer(src) {
  const box = $('iv');
  box.replaceChildren();
  const img = el('img', 'ivimg');
  img.src = src;
  img.alt = '';
  box.append(img, el('p', 'pvhint dim small', 'Enter, Esc or click = close'));
  box.hidden = false;
  chatUi.iv = true;
  msgInput.blur();
}

function closeViewer() {
  chatUi.iv = false;
  $('iv').hidden = true;
  msgInput.focus();
}

function ivKey(e) {
  e.preventDefault();
  if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') closeViewer();
}

$('iv').addEventListener('click', closeViewer);

$('log').addEventListener('click', e => {
  const pic = e.target.closest('.mimg');
  if (pic) { openViewer(pic.src); return; }
  const who = e.target.closest('.who');
  if (!who) return;
  e.stopPropagation();
  openCard(who);
});

$('chat').addEventListener('click', e => {
  if (chatUi.card && !e.target.closest('#card')) closeCard();
});
// ---------- reporting ----------
const RP_FIELDS = [
  ['username', 'Username'],
  ['display', 'Display name'],
  ['pfp', 'Profile picture'],
  ['banner', 'Banner'],
  ['bio', 'Bio'],
];
const rpt = { uid: null, user: null, rows: [], cur: 0, checks: {}, busy: false, input: null, allBox: null, boxes: {} };

function rpMsg(text, kind) {
  const m = $('rp-line');
  if (!m) return;
  m.textContent = text;
  m.className = 'rpmsg ' + (kind === 'err' ? 'fail' : kind === 'ok' ? 'ok' : 'dim');
}

function rpPreview(key, p) {
  const box = el('span', 'rpprev');
  if (key === 'username') box.textContent = '@' + p.username;
  else if (key === 'display') box.textContent = p.display;
  else if (key === 'bio') box.textContent = p.bio ? p.bio.slice(0, 60) : 'no bio';
  else if (key === 'pfp') {
    const pf = el('span', 'pfsq');
    fillPfp(pf, p, 24);
    box.append(pf, p.pfpMode === 'image' ? 'image' : 'letter ' + p.letter);
  } else if (key === 'banner') {
    if (p.bannerMode === 'image') {
      const img = el('img');
      img.src = p.bannerImg;
      img.alt = '';
      box.appendChild(img);
    } else box.textContent = p.bannerMode;
  }
  return box;
}

function rpSync() {
  RP_FIELDS.forEach(([key]) => { rpt.boxes[key].textContent = rpt.checks[key] ? '[x]' : '[ ]'; });
  rpt.allBox.textContent = RP_FIELDS.every(([key]) => rpt.checks[key]) ? '[x]' : '[ ]';
}

function rpFocus(i) {
  rpt.cur = i;
  rpt.rows.forEach((r, n) => r.row.classList.toggle('on', n === i));
  const r = rpt.rows[i];
  if (r.input) r.input.focus({ preventScroll: true });
  else if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
  scrollInto($('rp'), r.row);
}

function rpMove(step) {
  rpFocus((rpt.cur + step + rpt.rows.length) % rpt.rows.length);
}

function openReport() {
  const uid = chatUi.pvUid;
  const user = chatUi.pvUser;
  if (!uid || !user || (account && uid === account.uid)) return;
  rpt.uid = uid;
  rpt.user = withDefaults(user);
  rpt.checks = {};
  rpt.boxes = {};
  rpt.rows = [];
  rpt.cur = 0;
  rpt.busy = false;

  const body = $('rp-body');
  body.innerHTML = '';
  const card = el('div', 'rpcard');
  body.appendChild(card);
  card.appendChild(el('p', 'ptitle', 'Report ' + rpt.user.display));
  card.appendChild(el('p', 'fintro dim small', 'tick what is wrong. we attach it automatically (images as images, text as text) and add your message.'));

  const addRow = (row, kind, act, input) => {
    const i = rpt.rows.length;
    rpt.rows.push({ row, kind, act, input });
    row.addEventListener('click', ev => {
      if (input) { rpFocus(i); return; }
      rpFocus(i);
      if (act) act(ev);
    });
    card.appendChild(row);
  };

  RP_FIELDS.forEach(([key, label]) => {
    const row = el('div', 'rprow');
    const box = el('span', 'rpbox', '[ ]');
    rpt.boxes[key] = box;
    row.append(box, el('span', '', label), rpPreview(key, rpt.user));
    addRow(row, 'check', () => { rpt.checks[key] = !rpt.checks[key]; rpSync(); });
  });

  const all = el('div', 'rprow');
  rpt.allBox = el('span', 'rpbox', '[ ]');
  all.append(rpt.allBox, el('span', '', 'Everything'));
  addRow(all, 'check', () => {
    const on = !RP_FIELDS.every(([key]) => rpt.checks[key]);
    RP_FIELDS.forEach(([key]) => { rpt.checks[key] = on; });
    rpSync();
  });

  const msgRow = el('div', 'frow');
  msgRow.style.marginTop = '14px';
  msgRow.appendChild(el('label', 'flabel', 'Your message (optional)'));
  const input = el('input', 'finput');
  input.type = 'text';
  input.maxLength = 300;
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.placeholder = "what's wrong?";
  msgRow.appendChild(input);
  rpt.input = input;
  addRow(msgRow, 'input', null, input);
  input.addEventListener('focus', () => {
    const i = rpt.rows.findIndex(r => r.input === input);
    rpt.cur = i;
    rpt.rows.forEach((r, n) => r.row.classList.toggle('on', n === i));
  });

  const send = el('button', 'fbtn primary', 'Send report');
  send.tabIndex = -1;
  send.style.marginTop = '14px';
  send.addEventListener('click', () => send.blur());
  addRow(send, 'btn', rpSend);

  const cancel = el('button', 'fbtn link', 'Cancel');
  cancel.tabIndex = -1;
  cancel.addEventListener('click', () => cancel.blur());
  addRow(cancel, 'btn', () => closeReport(false));

  const line = el('p', 'rpmsg dim', '');
  line.id = 'rp-line';
  card.appendChild(line);
  card.appendChild(el('p', 'dim small', '↑ ↓ / W S = move | Enter or Space = choose | Escape = back'));

  rpSync();
  $('rp').hidden = false;
  $('rp').scrollTop = 0;
  chatUi.rp = true;
  $('msg').blur();
  rpFocus(0);
}

function closeReport(sent) {
  chatUi.rp = false;
  $('rp').hidden = true;
  if (sent) {
    closePv();
    addLocalLine('[system]: report sent. thank you!');
  }
}

async function rpSend() {
  if (rpt.busy) return;
  const picked = RP_FIELDS.map(f => f[0]).filter(k => rpt.checks[k]);
  if (!picked.length) return rpMsg('tick at least one thing to report.', 'err');

  rpt.busy = true;
  rpMsg('sending...', 'dim');
  try {
    const fresh = await fbGetUser(rpt.uid);
    if (!fresh) return rpMsg('that profile could not be loaded.', 'err');

    const snap = { username: fresh.username, display: fresh.display };
    if (picked.includes('bio') && fresh.bio) snap.bio = fresh.bio;
    if (picked.includes('pfp')) ['letter', 'pfpMode', 'pfpImg'].forEach(k => { if (fresh[k]) snap[k] = fresh[k]; });
    if (picked.includes('banner')) ['bannerMode', 'bannerImg'].forEach(k => { if (fresh[k]) snap[k] = fresh[k]; });

    const fields = {};
    picked.forEach(k => { fields[k] = true; });
    const message = rpt.input.value.trim() || '(no message)';

    const res = await fbSendReport({ target: rpt.uid, fields, message, snap });
    if (res.error) return rpMsg(res.error, 'err');
    closeReport(true);
  } catch (e) {
    console.error(e);
    rpMsg('something went wrong: ' + (e.message || e), 'err');
  } finally {
    rpt.busy = false;
  }
}

function rpKey(e) {
  const r = rpt.rows[rpt.cur];
  const typing = r.kind === 'input' && document.activeElement === r.input;
  const key = e.key.toLowerCase();

  if (key === 'tab') { e.preventDefault(); return rpMove(e.shiftKey ? -1 : 1); }

  if (typing) {
    if (key === 'escape') { e.preventDefault(); r.input.blur(); }
    else if (key === 'arrowdown' || key === 'enter') { e.preventDefault(); rpMove(1); }
    else if (key === 'arrowup') { e.preventDefault(); rpMove(-1); }
    return;
  }

  if (key === 'escape') return closeReport(false);
  e.preventDefault();
  if (key === 'arrowdown' || key === 's') rpMove(1);
  else if (key === 'arrowup' || key === 'w') rpMove(-1);
  else if (key === 'enter' || key === ' ') {
    if (r.act) r.act();
    else if (r.input) r.input.focus();
  }
}

// ---------- changelog ----------
const changelog = {
  current: [
    'Rebuilt from scratch',
    'Accounts: unique usernames, display names, email sign-in and password reset',
    'Guest mode: a fresh guest name every time you reach the menu',
    'Profiles with three layouts, pictures, banners and a bio',
    'Image cropper with pixelation options, or no pixelation at all',
    'PFPs next to names in chat, and click a name to see their mini-profile',
    'Report a profile, and get a thank-you when action is taken :)',
    'Settings and custom themes now sync to your account',
    'Reconnects on its own if your connection drops',
    'A first-launch tutorial and a new boot screen',
  ],
  soon: [
    'Music player and sounds',
    'Images and GIFs in chat',
    'Drawing pad',
    'Chat commands',
    'VC',
    'Minigames',
    'Moderation.',
    'More languages',
    'The classic 1.0 look',
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
  const body = $('cl-body');
  body.innerHTML = '';

  body.appendChild(el('p', 'vhead first ok', '2.0 Updates:'));
  changelog.current.forEach(note => body.appendChild(el('p', 'ok', '- ' + note)));
  body.appendChild(el('p', 'vhead dim', 'Coming soon:'));
  changelog.soon.forEach(note => body.appendChild(el('p', 'dim', '- ' + note)));

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
    const box = $('cl-scroll');
    const key = e.key.toLowerCase();
    if (key === 'arrowdown' || key === 's') box.scrollBy({ top: 60 });
    else if (key === 'arrowup' || key === 'w') box.scrollBy({ top: -60 });
    else if (key === 'pagedown') box.scrollBy({ top: 300 });
    else if (key === 'pageup') box.scrollBy({ top: -300 });
    else if (key === 'enter') {
      oldOpen = !oldOpen;
      renderChangelog();
      $('cl-toggle').scrollIntoView({ block: 'nearest' });
    } else if (key === 'escape') show('menu');
  },
};

// ---------- credits ----------
const credits = [
  ['development', ['spoon2K_yt']],
  ['early testers', ['']],
  ['ideas & suggestions', ['']],
  ['discord mods', ['']],
  ['promoters', ['']],
  ['translations', ['']],
];

function renderCredits() {
  const body = $('cred-body');
  body.innerHTML = '';
  credits.forEach(([title, names]) => {
    const sec = el('div', 'esec');
    sec.appendChild(el('p', 'etitle', '— ' + title + ' —'));
    names.forEach(n => sec.appendChild(el('p', '', n)));
    body.appendChild(sec);
  });
  body.appendChild(el('p', 'dim italic', 'thank you for using TempTerm.'));
  body.appendChild(el('p', 'dim italic', 'i miss skype'));
}

screens.credits = {
  key: e => {
    const box = $('cred-scroll');
    const key = e.key.toLowerCase();
    if (key === 'arrowdown' || key === 's') box.scrollBy({ top: 60 });
    else if (key === 'arrowup' || key === 'w') box.scrollBy({ top: -60 });
    else if (key === 'pagedown') box.scrollBy({ top: 300 });
    else if (key === 'pageup') box.scrollBy({ top: -300 });
    else if (key === 'escape') show('menu');
  },
};

// ---------- settings sync ----------
let syncTimer = null;

function scheduleSync() {
  if (!account) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => { if (account) fbSaveSettings(account.uid, getSyncable()); }, 800);
}

async function pullSettings() {
  if (!account) return;
  try {
    const remote = await fbLoadSettings(account.uid);
    if (remote && applyRemote(remote)) {
      applyTheme();
      applyUi();
      applySize();
    } else {
      await fbSaveSettings(account.uid, getSyncable());
    }
  } catch (e) {
    console.error(e);
  }
}

setSaveHook(scheduleSync);

// ---------- settings ----------
const set = { pendingFocus: null, customOpen: false, armed: null, armBtn: null };
const sg = createGrid($('set-scroll'));
let setSels = [];

function setFlash(text) {
  $('set-msg').textContent = text;
}

function disarmDelete() {
  if (!set.armed) return;
  if (set.armBtn) {
    set.armBtn.textContent = 'Delete';
    set.armBtn.classList.remove('arm');
  }
  set.armed = null;
  set.armBtn = null;
}

sg.onChange = ctl => {
  disarmDelete();
  applyTheme(ctl && ctl.theme ? ctl.theme : settings.theme);
  setFlash(ctl && ctl.hint ? ctl.hint : '');
};

function refreshSettings() {
  setSels.forEach(fn => fn());
}

function swatchArt(c) {
  const art = el('div', 'tswatch');
  art.style.background = c.bg;
  art.style.borderColor = c.dim;
  const aa = el('b', '', 'Aa');
  aa.style.color = c.text;
  const bars = el('div', 'bars');
  [c.bright, c.accent, c.dim].forEach(col => {
    const i = el('i');
    i.style.background = col;
    bars.appendChild(i);
  });
  art.append(aa, bars);
  return art;
}

function sSec(parent, title) {
  const sec = el('div', 'esec');
  sec.appendChild(el('p', 'etitle', title));
  parent.appendChild(sec);
  return sec;
}

function sRow(sec, cls) {
  const holder = el('div', cls || 'etiles');
  sec.appendChild(holder);
  return sg.row(holder);
}

function pickTheme(id) {
  settings.theme = id;
  save();
  refreshSettings();
  applyTheme(id);
  setFlash('using this theme.');
}

function themeTile(row, id, name, colors) {
  const tile = el('button', 'tile');
  tile.append(swatchArt(colors), el('span', 'tcap', name));
  sg.add(row, tile, { key: 'theme:' + id, theme: id, hint: 'Enter = use this theme', act: () => pickTheme(id) });
  setSels.push(() => tile.classList.toggle('sel', settings.theme === id));
}

function deleteCustom(t, btn) {
  if (set.armed !== t.id) {
    set.armed = t.id;
    set.armBtn = btn;
    btn.textContent = 'Click again to delete';
    btn.classList.add('arm');
    return;
  }
  settings.custom = settings.custom.filter(x => x.id !== t.id);
  if (settings.theme === 'custom:' + t.id) settings.theme = 'Default';
  set.armed = null;
  set.armBtn = null;
  save();
  buildSettings('new', true);
  setFlash('deleted.');
}

function buildSettings(focusKey, keepScroll) {
  const scroller = $('set-scroll');
  const top = keepScroll ? scroller.scrollTop : 0;
  const body = $('set-body');
  body.innerHTML = '';
  sg.reset();
  setSels = [];

  const themes = sSec(body, 'Theme');
  const names = Object.keys(THEMES);
  for (let i = 0; i < names.length; i += 3) {
    const row = sRow(themes);
    names.slice(i, i + 3).forEach(name => themeTile(row, name, name, THEMES[name]));
  }

  const customs = settings.custom;
  if (customs.length) {
    const collapsed = customs.length >= 5;
    if (collapsed) {
      const row = sRow(themes, 'ebtn');
      const b = el('button', 'fbtn', (set.customOpen ? '[-] ' : '[+] ') + 'Custom themes (' + customs.length + ')');
      sg.add(row, b, {
        key: 'dropout',
        hint: 'Enter = show or hide your custom themes',
        act: () => { set.customOpen = !set.customOpen; buildSettings('dropout', true); },
      });
    } else {
      themes.appendChild(el('p', 'etitle', 'Yours'));
    }
    if (!collapsed || set.customOpen) {
      customs.forEach(t => {
        const row = sRow(themes, 'crow');
        themeTile(row, 'custom:' + t.id, t.name, t.colors);
        const edit = el('button', 'chip', 'Edit');
        sg.add(row, edit, {
          key: 'edit:' + t.id, theme: 'custom:' + t.id, hint: 'Enter = edit this theme',
          act: () => { openThemeEdit(t); show('themeedit'); },
        });
        const del = el('button', 'chip', 'Delete');
        sg.add(row, del, {
          key: 'del:' + t.id, theme: 'custom:' + t.id, hint: 'Enter twice = delete this theme',
          act: () => deleteCustom(t, del),
        });
      });
    }
  }

  const nrow = sRow(themes, 'ebtn');
  sg.add(nrow, el('button', 'fbtn', '+ New custom theme'), {
    key: 'new', hint: 'Enter = make your own theme',
    act: () => { openThemeEdit(null); show('themeedit'); },
  });

  const win = sSec(body, 'Window size');
  const wrow = sRow(win, 'chips');
  SIZES.forEach(size => {
    const chip = el('button', 'chip', size);
    sg.add(wrow, chip, {
      key: 'size:' + size, hint: 'resizes the window right away',
      act: () => { settings.size = size; save(); applySize(); refreshSettings(); },
    });
    setSels.push(() => chip.classList.toggle('sel', settings.size === size));
  });

  const chat = sSec(body, 'Chat');
  const prow = sRow(chat, 'ewide');
  const pBtn = el('button', 'swrow');
  const pPill = el('span', 'pill');
  pBtn.append(el('span', '', 'Show PFPs in chat'), pPill);
  sg.add(prow, pBtn, {
    key: 'pfps', hint: 'small pictures next to names',
    act: () => { settings.pfps = !settings.pfps; applyPfps(); save(); refreshSettings(); },
  });
  setSels.push(() => {
    pPill.textContent = settings.pfps ? 'ON' : 'OFF';
    pPill.classList.toggle('yes', !!settings.pfps);
  });

  const ui = sSec(body, 'UI style');
  const urow = sRow(ui, 'chips');
  [['modern', '2.0 (new)'], ['classic', '1.0 (classic)']].forEach(([val, text]) => {
    const chip = el('button', 'chip', text);
    sg.add(urow, chip, {
      key: 'ui:' + val, hint: '1.0 hides chat pictures. more changes once 1.0 is merged in.',
      act: () => { settings.ui = val; applyUi(); save(); refreshSettings(); },
    });
    setSels.push(() => chip.classList.toggle('sel', settings.ui === val));
  });

  const lang = sSec(body, 'Language');
  const lrow = sRow(lang, 'chips');
  const eng = el('button', 'chip', 'English');
  sg.add(lrow, eng, {
    key: 'lang:English', hint: 'more languages come much later',
    act: () => { settings.language = 'English'; save(); refreshSettings(); },
  });
  setSels.push(() => eng.classList.toggle('sel', settings.language === 'English'));

  const acc = sSec(body, 'Account');
  acc.appendChild(el('p', 'snote dim', account
    ? 'Your settings are saved to your account and follow you to any PC.'
    : 'You are a guest, so settings are only saved on this PC.'));
  if (!account) {
    const arow = sRow(acc, 'ebtn');
    sg.add(arow, el('button', 'fbtn', 'Sign in to sync settings'), {
      key: 'signin', hint: 'opens the sign-in screen',
      act: () => { applyTheme(); openSignin(); },
    });
  } else {
    const erow = sRow(acc, 'ebtn');
    sg.add(erow, el('button', 'fbtn', 'Change email'), {
      key: 'chemail', hint: 'we send a link to the new address',
      act: () => { applyTheme(); openChangeEmail(); },
    });
    const prow2 = sRow(acc, 'ebtn');
    sg.add(prow2, el('button', 'fbtn', 'Change password'), {
      key: 'chpass', hint: 'you will need your current password',
      act: () => { applyTheme(); openChangePassword(); },
    });
    const drow = sRow(acc, 'ebtn');
    sg.add(drow, el('button', 'fbtn danger', 'Delete my account'), {
      key: 'delacct', hint: 'permanent. asks you to confirm.',
      act: () => { applyTheme(); openDeleteAccount(); },
    });
  }

  refreshSettings();
  scroller.scrollTop = top;
  if (!(focusKey && sg.focusKey(focusKey, !keepScroll))) sg.focus(0, 0, false);
}

function openSettings() {
  const pend = set.pendingFocus;
  set.pendingFocus = null;
  let key = 'theme:' + settings.theme;
  if (pend === 'new') key = 'new';
  else if (pend && pend.startsWith('custom:')) key = 'theme:' + pend;
  const wanted = pend && pend.startsWith('custom:') ? pend : settings.theme;
  if (wanted.startsWith('custom:') && settings.custom.length >= 5) set.customOpen = true;
  buildSettings(key, false);
}

screens.settings = {
  key: e => {
    if (sg.key(e)) return;
    if (e.key === 'Escape') { applyTheme(); show('menu'); }
  },
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
    startLive();
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
  if (r.input) r.input.focus({ preventScroll: true });
  else if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
  scrollInto($('f-scroll'), r.row);
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
    const btn = el('button', 'fbtn ' + (b.danger ? 'danger' : n === 0 ? 'primary' : 'link'), b.label);
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
  needsSetup = false;
  startLive();
  await pullSettings();
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
    if (res.uid) { me.uid = res.uid; startLive(); }
    return formMsg(res.error, 'err');
  }
  if (!res.profile) {
    me.uid = res.uid;
    needsSetup = true;
    startLive();
    return openFinishSetup();
  }
  setAccount(res.uid, res.profile);
  needsSetup = false;
  account.verified = await fbEmailVerified();
  await pullSettings();
  startLive();
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

function openFinishSetup() {
  openForm({
    title: 'Finish setting up your account',
    corner: false,
    intro: 'your sign-up did not finish saving. pick your username and display name to continue.',
    back: () => show('menu'),
    fields: [
      { key: 'username', label: 'Username', type: 'text', max: 16, onInput: checkUsername },
      { key: 'display', label: 'Display name', type: 'text', max: 20 },
    ],
    buttons: [
      { label: 'Finish setup', action: formSubmit },
      { label: 'Sign out', action: async () => { me.uid = await fbSignOut(); needsSetup = false; startLive(); show('menu'); } },
    ],
    submit: doFinish,
  });
}

async function doFinish(v) {
  const username = v.username.trim();
  const display = v.display.trim() || username;
  const fail = (text, row) => { formMsg(text, 'err'); formFocus(row); };
  if (!USERNAME_RE.test(username)) return fail('username: 3-16 letters, numbers or _', 0);
  if (RESERVED_RE.test(username)) return fail('that username is reserved.', 0);
  if (display.length > 20) return fail('display name: 20 characters max.', 1);
  formMsg('saving...', 'dim');
  const res = await fbFinishProfile({ username, display });
  if (res.error) return formMsg(res.error, 'err');
  const full = await fbLoadProfile(res.uid);
  setAccount(res.uid, full || res.profile);
  needsSetup = false;
  startLive();
  await pullSettings();
  finishAuth('[system]: all set, ' + res.profile.display + '! your account is ready.');
}

function openChangePassword() {
  openForm({
    title: 'Change your password',
    corner: false,
    intro: 'enter your current password, then pick a new one.',
    back: () => show('settings'),
    fields: [
      { key: 'current', label: 'Current password', type: 'password', max: 64 },
      { key: 'next', label: 'New password', type: 'password', max: 64 },
      { key: 'confirm', label: 'Confirm new password', type: 'password', max: 64 },
    ],
    buttons: [
      { label: 'Change password', action: formSubmit },
      { label: 'Back', action: () => show('settings') },
    ],
    submit: async v => {
      if (!v.current) { formMsg('enter your current password.', 'err'); return formFocus(0); }
      if (v.next.length < 8) { formMsg('new password: at least 8 characters.', 'err'); return formFocus(1); }
      if (v.next !== v.confirm) { formMsg('the new passwords do not match.', 'err'); return formFocus(2); }
      if (v.next === v.current) { formMsg('the new password is the same as the old one.', 'err'); return formFocus(1); }
      formMsg('changing...', 'dim');
      const res = await fbChangePassword(v.current, v.next);
      if (res.error) return formMsg(res.error, 'err');
      finishAuth('[system]: password changed.');
    },
  });
}

function openChangeEmail() {
  openForm({
    title: 'Change your email',
    corner: false,
    intro: 'we send a link to the new address. your email only changes once you click it.',
    back: () => show('settings'),
    fields: [
      { key: 'email', label: 'New email', type: 'text', max: 100 },
      { key: 'current', label: 'Current password', type: 'password', max: 64 },
    ],
    buttons: [
      { label: 'Send link', action: formSubmit },
      { label: 'Back', action: () => show('settings') },
    ],
    submit: async v => {
      const email = v.email.trim();
      if (!EMAIL_RE.test(email)) { formMsg('that email address does not look right.', 'err'); return formFocus(0); }
      if (!v.current) { formMsg('enter your current password.', 'err'); return formFocus(1); }
      formMsg('sending...', 'dim');
      const res = await fbChangeEmail(v.current, email);
      if (res.error) return formMsg(res.error, 'err');
      formMsg('link sent to ' + email + '. click it to finish. check spam too.', 'ok');
    },
  });
}

function openDeleteAccount() {
  openForm({
    title: 'Delete your account',
    corner: false,
    intro: 'this permanently deletes your login, profile and username. it cannot be undone. type your username and password to confirm.',
    back: () => show('settings'),
    fields: [
      { key: 'name', label: 'Type your username (' + account.username + ')', type: 'text', max: 24 },
      { key: 'current', label: 'Password', type: 'password', max: 64 },
    ],
    buttons: [
      { label: 'Delete my account forever', action: formSubmit, danger: true },
      { label: 'Cancel', action: () => show('settings') },
    ],
    submit: async v => {
      if (v.name.trim().toLowerCase() !== account.username.toLowerCase()) { formMsg('that is not your username.', 'err'); return formFocus(0); }
      if (!v.current) { formMsg('enter your password.', 'err'); return formFocus(1); }
      formMsg('deleting...', 'dim');
      const res = await fbDeleteAccount(v.current, account.username);
      if (res.error) return formMsg(res.error, 'err');
      account = null;
      needsSetup = false;
      me.uid = res.uid || null;
      me.name = randomGuestName();
      startLive();
      finishAuth('[system]: your account was deleted. you are a guest now.');
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
  if (ctl.input) ctl.input.focus({ preventScroll: true });
  else if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
  scrollInto($('ep-scroll'), ctl.el);
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

const LAYOUT_LABELS = { 1: 'Banner on top', 2: 'Banner beside picture', 3: 'Banner as divider' };

function openEditProfile() {
  const p = withDefaults(account.profile);
  ep.s = {
    layout: p.layout, accent: p.accent, display: p.display, bio: p.bio, letter: p.letter, username: '',
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
  [1, 2, 3].forEach(n => {
    const wf = el('div', 'wf l' + n);
    ['b', 'p', 't1', 't2'].forEach(k => wf.appendChild(el('i', k)));
    if (n === 3) wf.appendChild(el('i', 't3'));
    tile(lrow, wf, LAYOUT_LABELS[n], () => { ep.s.layout = n; epRefresh(); }, () => ep.s.layout === n);
  });

  const details = section('Details');
  field(details, 'Display name', 'display', 20, { id: 'display' });
  if (account.profile.usernameReset === true) {
    const urow = newRow(details, 'frow');
    ep.idx.username = ep.rows.length - 1;
    const uwrap = el('div', 'fwrap');
    uwrap.appendChild(el('label', 'flabel', 'New username (an admin reset yours, you can change it once)'));
    const uinput = el('input', 'finput');
    uinput.type = 'text';
    uinput.maxLength = 16;
    uinput.autocomplete = 'off';
    uinput.spellcheck = false;
    uinput.placeholder = 'choose a username';
    const unote = el('span', 'fnote dim');
    uinput.addEventListener('input', () => { ep.s.username = uinput.value; checkUsername(uinput.value, unote); });
    uwrap.append(uinput, unote);
    add(urow, uwrap, 'input', null, uinput);
  } else {
    const lock = el('div', 'frow locked');
    lock.appendChild(el('label', 'flabel', 'Username'));
    lock.appendChild(el('div', 'finput dis', '@' + account.username));
    lock.appendChild(el('span', 'fnote dim', 'usernames are not changeable. to change your username, email me! contacttempterm@gmail.com'));
    details.appendChild(lock);
  }
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

  const canRename = account.profile.usernameReset === true;
  const newName = (s.username || '').trim();
  if (canRename && newName) {
    if (!USERNAME_RE.test(newName)) { epMsg('username: 3-16 letters, numbers or _', 'err'); return epFocus(ep.idx.username, 0); }
    if (RESERVED_RE.test(newName)) { epMsg('that username is reserved.', 'err'); return epFocus(ep.idx.username, 0); }
  }

  ep.busy = true;
  epMsg('saving...', 'dim');
  if (canRename && newName && newName !== account.username) {
    const renamed = await fbChangeUsername(account.username, newName);
    if (renamed.error) {
      ep.busy = false;
      epMsg(renamed.error, 'err');
      return epFocus(ep.idx.username, 0);
    }
  }
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
      epFocus(ep.r, ep.c);
      epMsg((kind === 'pfp' ? 'picture' : 'banner') + ' ready. press Save to keep it.', 'ok');
    },
    () => { show('editprofile'); epFocus(ep.r, ep.c); epMsg('', 'dim'); });
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

// ---------- notices and live profile ----------
const noticeUi = { open: false, queue: [], cur: null, stopNotices: null, stopProfile: null };

function showNextNotice() {
  if (noticeUi.open || !noticeUi.queue.length) return;
  const n = noticeUi.queue.shift();
  noticeUi.cur = n;
  noticeUi.open = true;
  if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
  const box = $('notice-box');
  box.innerHTML = '';
  box.appendChild(el('p', 'ntext', n.text));
  box.appendChild(el('p', 'dim small', 'press Enter or click to continue'));
  frameEl(box, n.kind === 'thanks' ? 'thank you' : 'notice');
  $('notice').hidden = false;
}

function dismissNotice() {
  const n = noticeUi.cur;
  noticeUi.open = false;
  noticeUi.cur = null;
  $('notice').hidden = true;
  if (n) fbClearNotice(n.uid, n.key);
  if (current === 'chat' && !chatUi.pv && !chatUi.rp && !chatUi.who) $('msg').focus();
  showNextNotice();
}

$('notice').addEventListener('click', e => { e.stopPropagation(); dismissNotice(); });

function onNotice(uid, key, n) {
  noticeUi.queue.push({ uid, key, kind: n.kind, text: String(n.text || '') });
  if (n.kind === 'reset' && (current === 'editprofile' || current === 'crop')) show('profile');
  showNextNotice();
}

function onProfileLive(val) {
  if (!val || !account) return;
  const badges = account.profile.badges;
  account.profile = { ...val, badges };
  account.username = val.username;
  account.display = val.display;
  me.name = val.display;
  if (current === 'profile') renderProfile();
  else if (current === 'menu') render();
}

function startLive() {
  if (noticeUi.stopNotices) noticeUi.stopNotices();
  if (noticeUi.stopProfile) noticeUi.stopProfile();
  noticeUi.stopNotices = null;
  noticeUi.stopProfile = null;
  if (!me.uid) return;
  const uid = me.uid;
  noticeUi.stopNotices = fbWatchNotices(uid, (key, n) => onNotice(uid, key, n));
  if (account) noticeUi.stopProfile = fbWatchProfile(uid, onProfileLive);
}

// ---------- status banner ----------
const banner = { data: null, dismissed: '', seen: false };

function cmpVersion(a, b) {
  const pa = String(a).split('.').map(n => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}

function bannerKey() {
  return JSON.stringify(banner.data || null);
}

function renderBanner() {
  const box = $('statusbar');
  const d = banner.data || {};
  const msg = typeof d.message === 'string' ? d.message.trim() : '';
  const level = ['info', 'warning', 'offline'].includes(d.level) ? d.level : 'info';
  const upd = typeof d.latest === 'string' && cmpVersion(d.latest, APP_VERSION) > 0 ? d.latest : '';
  const hideable = level === 'info';
  const hidden = hideable && banner.dismissed === bannerKey();
  const visible = !!(msg || upd) && !hidden && current === 'menu' && !tut.active;
  box.hidden = !visible;
  if (!visible) return;
  box.className = 'statusbar lv-' + level;
  box.replaceChildren();
  if (msg) box.appendChild(el('span', 'sbmsg', msg));
  if (upd) box.appendChild(el('span', 'sbupd', (msg ? '   ·   ' : '') + 'update available: v' + upd + (d.link ? ' (' + d.link + ')' : '')));
  if (hideable) box.appendChild(el('span', 'dim small', '   press X to hide'));
}

function dismissBanner() {
  if (!banner.data) return;
  banner.dismissed = bannerKey();
  renderBanner();
}

function onStatus(data) {
  const prev = banner.data;
  banner.data = data;
  renderBanner();
  const msg = data && typeof data.message === 'string' ? data.message.trim() : '';
  const old = prev && typeof prev.message === 'string' ? prev.message.trim() : '';
  if (banner.seen && room && msg && msg !== old) addLocalLine('[system]: ' + msg);
  banner.seen = true;
}

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
    tour(7, 6, 'Quit: close TempTerm (why would you want to >:('),
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
  if (needsSetup) openFinishSetup(); else openSignup();
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
  $('splash-title').textContent = 'Welcome to TempTerm!';
  $('splash-ver').hidden = true;
}
fbWatchStatus(onStatus);
render();
boot();