import { auth, db } from './firebase.js';
import { signInWithEmailAndPassword, signOut } from 'https://www.gstatic.com/firebasejs/12.14.0/firebase-auth.js';
import { ref, get, set, push, update, remove, serverTimestamp } from 'https://www.gstatic.com/firebasejs/12.14.0/firebase-database.js';

const $ = id => document.getElementById(id);
const IMG = /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/;
const NAMES = { username: 'Username', display: 'Display name', pfp: 'Profile picture', banner: 'Banner', bio: 'Bio' };
const WHAT = { pfp: 'profile picture', banner: 'banner', bio: 'bio', display: 'display name', username: 'username', all: 'profile' };
const THANKS = 'action was taken on your report! thanks for keeping tempterm a safe place! :D';
const admin = { uid: null, name: 'an admin' };

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

function flash(text, kind) {
  const f = $('flash');
  f.textContent = text;
  f.className = kind || 'dim';
}

async function isAdmin(uid) {
  const snap = await get(ref(db, 'admins/' + uid));
  return snap.exists();
}

async function loadAdminName(uid) {
  admin.uid = uid;
  try {
    const snap = await get(ref(db, 'users/' + uid));
    if (snap.exists()) admin.name = snap.val().display || snap.val().username || 'an admin';
  } catch (e) { console.error(e); }
}

function showLogin() {
  $('panel').hidden = true;
  $('login').hidden = false;
}

async function showPanel() {
  $('login').hidden = true;
  $('panel').hidden = false;
  await loadAdminName(auth.currentUser.uid);
  await loadReports();
}

async function start() {
  await auth.authStateReady();
  const user = auth.currentUser;
  if (user && !user.isAnonymous) {
    const ok = await isAdmin(user.uid).catch(() => false);
    if (ok) return showPanel();
  }
  showLogin();
}

async function login() {
  $('lmsg').textContent = 'signing in...';
  try {
    const cred = await signInWithEmailAndPassword(auth, $('email').value.trim(), $('pass').value);
    if (!(await isAdmin(cred.user.uid))) {
      await signOut(auth);
      $('lmsg').textContent = 'this account is not an admin.';
      return;
    }
    $('lmsg').textContent = '';
    $('pass').value = '';
    showPanel();
  } catch (e) {
    console.error(e);
    $('lmsg').textContent = 'could not sign in. check the email and password.';
  }
}

$('go').addEventListener('click', login);
$('pass').addEventListener('keydown', e => { if (e.key === 'Enter') login(); });
$('refresh').addEventListener('click', () => loadReports());
$('out').addEventListener('click', async () => { await signOut(auth); showLogin(); });

function imgOrText(url, fallback) {
  const box = el('div', 'val');
  if (url && IMG.test(url)) {
    const img = el('img');
    img.src = url;
    img.alt = '';
    box.appendChild(img);
  } else box.textContent = fallback;
  return box;
}

function valueFor(key, p) {
  if (!p) return el('div', 'val dim', '(profile is gone)');
  if (key === 'username') return el('div', 'val', p.username || '(none)');
  if (key === 'display') return el('div', 'val', p.display || '(none)');
  if (key === 'bio') return el('div', 'val', p.bio || '(empty)');
  if (key === 'pfp') return p.pfpMode === 'image' ? imgOrText(p.pfpImg, '(image missing)') : el('div', 'val', 'letter: ' + (p.letter || '(default)'));
  return p.bannerMode === 'image' ? imgOrText(p.bannerImg, '(image missing)') : el('div', 'val', 'pattern: ' + (p.bannerMode || 'dither'));
}

function keyOf(key, p) {
  if (!p) return '';
  if (key === 'pfp') return [p.pfpMode || '', p.pfpImg || '', p.letter || ''].join('|');
  if (key === 'banner') return [p.bannerMode || '', p.bannerImg || ''].join('|');
  return p[key] || '';
}

async function reportCard(r) {
  const [liveSnap, repSnap] = await Promise.all([
    get(ref(db, 'users/' + r.target)),
    get(ref(db, 'users/' + r.reporter)),
  ]);
  const live = liveSnap.exists() ? liveSnap.val() : null;
  const reporter = repSnap.exists() ? '@' + repSnap.val().username : 'a guest';
  const snap = r.snap || {};
  const adm = r.admin || {};
  const done = adm.done;

  const card = el('div', 'card' + (done ? ' isdone' : ''));
  const head = el('div', 'head');
  head.append(
    el('span', '', 'Reported: @' + (snap.username || '?') + (live ? '' : '  (account deleted)')),
    el('span', 'dim', 'by ' + reporter + '  ·  ' + new Date(r.ts).toLocaleString())
  );
  card.appendChild(head);
  if (done) {
    card.appendChild(el('div', 'dim', 'marked done by ' + (done.byName || '?') + ' on ' + new Date(done.ts).toLocaleString() + (adm.acted ? '  ·  action was taken' : '  ·  no action taken')));
  }
  card.appendChild(el('div', 'msg', r.message));

  const keys = Object.keys(r.fields || {});
  keys.forEach(key => {
    const block = el('div', 'field');
    block.appendChild(el('div', 'ftitle', NAMES[key] || key));
    const two = el('div', 'two');
    const left = el('div');
    left.appendChild(el('div', 'lbl', 'what the reporter saw'));
    left.appendChild(valueFor(key, snap));
    const right = el('div');
    const changed = live && keyOf(key, snap) !== keyOf(key, live);
    right.appendChild(el('div', 'lbl', 'right now' + (changed ? '  (changed since)' : '')));
    right.appendChild(valueFor(key, live));
    two.append(left, right);
    block.appendChild(two);
    card.appendChild(block);
  });

  const actions = el('div', 'actions');
  const add = (label, cls, fn) => {
    const b = el('button', cls || '', label);
    b.addEventListener('click', () => fn(b));
    actions.appendChild(b);
  };
  if (done) {
    add('Reopen', '', () => reopen(r));
    add('Delete permanently', 'danger', () => del(r));
  } else {
    if (keys.includes('pfp')) add('Remove picture', 'danger', () => act(r, 'pfp', live));
    if (keys.includes('banner')) add('Remove banner', 'danger', () => act(r, 'banner', live));
    if (keys.includes('bio')) add('Remove bio', 'danger', () => act(r, 'bio', live));
    if (keys.includes('display')) add('Reset display name', 'danger', () => act(r, 'display', live));
    if (keys.includes('username')) add('Reset username', 'danger', () => act(r, 'username', live));
    add('Reset everything', 'danger', () => act(r, 'all', live));
    add('Mark done', 'primary', () => markDone(r));
  }
  card.appendChild(actions);
  return card;
}

async function loadReports(msg) {
  flash('loading...');
  try {
    const snap = await get(ref(db, 'reports'));
    const open = [];
    const finished = [];
    snap.forEach(c => {
      const r = { id: c.key, ...c.val() };
      if (r.admin && r.admin.done) finished.push(r); else open.push(r);
    });
    open.sort((a, b) => b.ts - a.ts);
    finished.sort((a, b) => (b.admin.done.ts || 0) - (a.admin.done.ts || 0));
    $('count').textContent = '(' + open.length + ')';
    $('donesum').textContent = 'Done (' + finished.length + ')';

    const box = $('list');
    box.innerHTML = '';
    if (!open.length) box.appendChild(el('p', 'dim', 'no open reports. nice.'));
    for (const r of open) box.appendChild(await reportCard(r));

    const dbox = $('donelist');
    dbox.innerHTML = '';
    if (!finished.length) dbox.appendChild(el('p', 'dim', 'nothing here yet.'));
    for (const r of finished) dbox.appendChild(await reportCard(r));

    flash(msg || '', msg ? 'ok' : 'dim');
  } catch (e) {
    console.error(e);
    flash('could not load reports: ' + (e.code || e.message), 'fail');
  }
}

const NAME_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';

function randomName() {
  let s = '';
  for (let i = 0; i < 5; i++) s += NAME_CHARS[Math.floor(Math.random() * NAME_CHARS.length)];
  return 'temptermuser_' + s;
}

async function resetUsername(uid, oldName) {
  for (let i = 0; i < 6; i++) {
    const name = randomName();
    const taken = await get(ref(db, 'usernames/' + name));
    if (taken.exists()) continue;
    await set(ref(db, 'usernames/' + name), uid);
    await update(ref(db, 'users/' + uid), { username: name, usernameReset: true });
    await remove(ref(db, 'usernames/' + oldName.toLowerCase()));
    return name;
  }
  throw new Error('could not find a free name');
}

const REMOVE = {
  pfp: { pfpMode: null, pfpImg: null, letter: null },
  banner: { bannerMode: null, bannerImg: null },
  bio: { bio: null },
};

function notify(uid, kind, text) {
  return set(push(ref(db, 'notices/' + uid)), { kind, text, ts: serverTimestamp() });
}

async function act(r, kind, live) {
  if (!live) return flash('that account no longer exists.', 'fail');
  const label = kind === 'all' ? 'reset EVERYTHING on' : 'remove / reset ' + kind + ' for';
  if (!confirm('Really ' + label + ' @' + live.username + '?')) return;
  const uid = r.target;
  let newName = null;
  try {
    if (REMOVE[kind]) await update(ref(db, 'users/' + uid), REMOVE[kind]);
    else if (kind === 'display') await update(ref(db, 'users/' + uid), { display: live.username });
    else if (kind === 'username') newName = await resetUsername(uid, live.username);
    else if (kind === 'all') {
      newName = await resetUsername(uid, live.username);
      await update(ref(db, 'users/' + uid), {
        display: newName, bio: null, layout: null, accent: null,
        ...REMOVE.pfp, ...REMOVE.banner,
      });
    }

    let text = 'Your ' + WHAT[kind] + ' was reported and reset by ' + admin.name + '.';
    if (newName) text += ' You can choose a new username in Edit Profile.';
    await notify(uid, 'reset', text);

    const patch = { acted: true };
    if (!(r.admin && r.admin.thanked)) {
      await notify(r.reporter, 'thanks', THANKS);
      patch.thanked = true;
    }
    await update(ref(db, 'reports/' + r.id + '/admin'), patch);
    await loadReports('done. the user was notified' + (newName ? ' (new username: ' + newName + ')' : '') + '.');
  } catch (e) {
    console.error(e);
    flash('failed: ' + (e.code || e.message), 'fail');
  }
}

async function markDone(r) {
  try {
    await update(ref(db, 'reports/' + r.id + '/admin'), {
      done: { by: admin.uid, byName: admin.name, ts: serverTimestamp() },
    });
    await loadReports('moved to Done.');
  } catch (e) {
    console.error(e);
    flash('could not mark done: ' + (e.code || e.message), 'fail');
  }
}

async function reopen(r) {
  try {
    await remove(ref(db, 'reports/' + r.id + '/admin/done'));
    await loadReports('reopened.');
  } catch (e) {
    console.error(e);
    flash('could not reopen: ' + (e.code || e.message), 'fail');
  }
}

async function del(r) {
  if (!confirm('Delete this report permanently?')) return;
  try {
    await remove(ref(db, 'reports/' + r.id));
    await loadReports('deleted.');
  } catch (e) {
    console.error(e);
    flash('could not delete: ' + (e.code || e.message), 'fail');
  }
}

start();