import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.14.0/firebase-app.js';
import {
  getAuth, signInAnonymously, signInWithEmailAndPassword, signOut,
  EmailAuthProvider, linkWithCredential, sendPasswordResetEmail, sendEmailVerification, reload,
  deleteUser, reauthenticateWithCredential, updatePassword, verifyBeforeUpdateEmail,
} from 'https://www.gstatic.com/firebasejs/12.14.0/firebase-auth.js';
import {
  getDatabase, ref, onValue, get, set, push, remove, update,
  onChildAdded, onDisconnect, serverTimestamp, goOffline, goOnline,
} from 'https://www.gstatic.com/firebasejs/12.14.0/firebase-database.js';

const app = initializeApp({
  apiKey: 'AIzaSyDFrHkDZZBeBvx5QHXoIos2ZbD7UPyqnb4',
  authDomain: 'tempterm2.firebaseapp.com',
  databaseURL: 'https://tempterm2-default-rtdb.europe-west1.firebasedatabase.app',
  projectId: 'tempterm2',
  storageBucket: 'tempterm2.firebasestorage.app',
  messagingSenderId: '991765627055',
  appId: '1:991765627055:web:fdce90f17e14f1c299145a',
});

export const auth = getAuth(app);
export const db = getDatabase(app);

// ---------- connection + sign in ----------
export function watchConnection(callback) {
  onValue(
    ref(db, '.info/connected'),
    snap => {
      note('connected = ' + (snap.val() === true));
      callback(snap.val() === true);
    },
    err => console.error('connection error:', err)
  );
}

function authError(err) {
  console.error(err);
  const map = {
    'auth/email-already-in-use': 'that email already has an account. try signing in.',
    'auth/requires-recent-login': 'please sign in again, then try once more.',
    'auth/missing-password': 'enter your password.',
    'auth/credential-already-in-use': 'that email already has an account. try signing in.',
    'auth/invalid-email': 'that email address does not look right.',
    'auth/weak-password': 'password is too weak. use at least 8 characters.',
    'auth/invalid-credential': 'wrong email or password.',
    'auth/wrong-password': 'wrong email or password.',
    'auth/user-not-found': 'wrong email or password.',
    'auth/too-many-requests': 'too many tries. wait a few minutes and try again.',
    'auth/network-request-failed': 'could not reach the server. check your connection.',
    'auth/operation-not-allowed': 'email sign-in is not switched on in Firebase yet.',
  };
  return map[err.code] || 'something went wrong. (' + err.code + ')';
}

export async function fbInit() {
  await auth.authStateReady();
  if (!auth.currentUser) await signInAnonymously(auth);
  const user = auth.currentUser;
  return { uid: user.uid, anonymous: user.isAnonymous };
}

export async function fbGetUser(uid) {
  const snap = await get(ref(db, `users/${uid}`));
  if (!snap.exists()) return null;
  return snap.val();
}

export function fbWatchUser(uid, cb) {
  return onValue(
    ref(db, `users/${uid}`),
    snap => cb(snap.exists() ? snap.val() : null),
    () => cb(null)
  );
}

export function fbWatchStatus(cb) {
  return onValue(ref(db, 'status'), snap => cb(snap.exists() ? snap.val() : null), err => console.error('status watch:', err));
}

export async function fbLoadSettings(uid) {
  const snap = await get(ref(db, `users/${uid}/settings`));
  return snap.exists() ? snap.val() : null;
}

export async function fbSaveSettings(uid, data) {
  try {
    await retryOnce(() => set(ref(db, `users/${uid}/settings`), data), 9000, 'saveSettings');
    return {};
  } catch (err) {
    console.error('settings sync failed:', err);
    return { error: true };
  }
}

export function fbWatchNotices(uid, cb) {
  return onChildAdded(ref(db, `notices/${uid}`), snap => cb(snap.key, snap.val()), err => console.error('notices:', err));
}

export function fbClearNotice(uid, key) {
  return remove(ref(db, `notices/${uid}/${key}`)).catch(err => console.error(err));
}

export function fbWatchProfile(uid, cb) {
  return onValue(ref(db, `users/${uid}`), snap => cb(snap.exists() ? snap.val() : null), err => console.error('profile watch:', err));
}

export async function fbChangeUsername(oldName, newName) {
  const uid = auth.currentUser.uid;
  const lower = newName.toLowerCase();
  try {
    const cur = await get(ref(db, `usernames/${lower}`));
    if (cur.exists() && cur.val() !== uid) return { error: 'that username is taken.' };
    if (!cur.exists()) await set(ref(db, `usernames/${lower}`), uid);
  } catch (err) {
    console.error(err);
    return { error: 'that username is taken or not allowed.' };
  }
  try {
    const old = await get(ref(db, `usernames/${oldName.toLowerCase()}`));
    if (old.exists() && old.val() === uid && oldName.toLowerCase() !== lower) {
      await remove(ref(db, `usernames/${oldName.toLowerCase()}`));
    }
    await update(ref(db, `users/${uid}`), { username: newName, usernameReset: null });
    return {};
  } catch (err) {
    console.error(err);
    return { error: 'could not change the username. try again.' };
  }
}

export async function fbSendReport({ target, fields, message, snap }) {
  try {
    const write = set(push(ref(db, 'reports')), {
      reporter: auth.currentUser.uid, target, fields, message, ts: serverTimestamp(), snap,
    });
    const timeout = new Promise((_, reject) => setTimeout(() => reject({ code: 'timeout' }), 15000));
    await Promise.race([write, timeout]);
    return {};
  } catch (err) {
    console.error('report failed:', err);
    if (err.code === 'timeout') return { error: 'the server did not answer. check your connection and try again.' };
    if (/permission/i.test(err.code || err.message || '')) return { error: 'the server refused the report (permission denied). are the new rules published?' };
    return { error: 'could not send the report: ' + (err.code || err.message) };
  }
}

export async function fbLoadProfile(uid) {
  const [user, badges] = await Promise.all([
    get(ref(db, `users/${uid}`)),
    get(ref(db, `badges/${uid}`)),
  ]);
  if (!user.exists()) return null;
  return { ...user.val(), badges: badges.exists() ? badges.val() : '' };
}

export async function fbSaveProfile(uid, fields) {
  try {
    await retryOnce(() => update(ref(db, `users/${uid}`), fields), 9000, 'saveProfile');
    return {};
  } catch (err) {
    console.error(err);
    return { error: err.code === 'timeout'
      ? 'the server did not answer. your change may still have gone through, so check your profile.'
      : 'could not save. check your connection.' };
  }
}

export async function fbUsernameFree(name) {
  const snap = await get(ref(db, `usernames/${name.toLowerCase()}`));
  return !snap.exists();
}

export async function fbSignUp({ username, display, email, password }) {
  const user = auth.currentUser;
  const lower = username.toLowerCase();
  try {
    await withTimeout(set(ref(db, `usernames/${lower}`), user.uid));
  } catch (err) {
    return { error: err.code === 'timeout' ? 'the server is not answering. try again.' : 'that username is taken or not allowed.' };
  }
  try {
    await linkWithCredential(user, EmailAuthProvider.credential(email, password));
  } catch (err) {
    await remove(ref(db, `usernames/${lower}`)).catch(() => {});
    return { error: authError(err) };
  }
  try {
  await withTimeout(set(ref(db, `users/${user.uid}`), { username, display, created: serverTimestamp() }));
  } catch (err) {
    console.error(err);
    return { error: 'account created, but the profile could not be saved. try signing in.' };
  }
  sendEmailVerification(user).catch(() => {});
  return { uid: user.uid, profile: { username, display } };
}

export async function fbSignIn(email, password) {
  const guest = auth.currentUser && auth.currentUser.isAnonymous ? auth.currentUser : null;
  let removed = false;
  if (guest) {
    try { await deleteUser(guest); removed = true; }
    catch (err) { console.warn('could not remove guest account:', err.code); }
  }
  try {
    const cred = await signInWithEmailAndPassword(auth, email, password);
    const profile = await fbLoadProfile(cred.user.uid);
    return { uid: cred.user.uid, profile };
  } catch (err) {
    let uid = null;
    if (removed) {
      try { uid = (await signInAnonymously(auth)).user.uid; } catch (e) { console.error(e); }
    }
    return { error: authError(err), uid };
  }
}

export async function fbSignOut() {
  await signOut(auth);
  await signInAnonymously(auth);
  return auth.currentUser.uid;
}

export async function fbFinishProfile({ username, display }) {
  const uid = auth.currentUser.uid;
  const lower = username.toLowerCase();
  try {
    const claim = await withTimeout(get(ref(db, `usernames/${lower}`)));
    if (!claim.exists()) await withTimeout(set(ref(db, `usernames/${lower}`), uid));
    else if (claim.val() !== uid) return { error: 'that username is taken.' };
  } catch (err) {
    return { error: err.code === 'timeout' ? 'the server is not answering. try again.' : 'that username is taken or not allowed.' };
  }
  try {
    await withTimeout(set(ref(db, `users/${uid}`), { username, display, created: serverTimestamp() }));
  } catch (err) {
    console.error(err);
    return { error: 'could not save the profile. try again.' };
  }
  return { uid, profile: { username, display } };
}

export async function fbSendReset(email) {
  try {
    await sendPasswordResetEmail(auth, email);
    return {};
  } catch (err) {
    return { error: authError(err) };
  }
}

export async function fbEmailVerified() {
  const user = auth.currentUser;
  if (!user || user.isAnonymous) return true;
  try { await reload(user); } catch (err) { console.error(err); }
  return user.emailVerified;
}

export async function fbResendVerification() {
  try {
    await sendEmailVerification(auth.currentUser);
    return {};
  } catch (err) {
    return { error: authError(err) };
  }
}

async function reauth(password) {
  const user = auth.currentUser;
  try {
    await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, password));
    return {};
  } catch (err) {
    console.error(err);
    if (/invalid-credential|wrong-password/.test(err.code || '')) return { error: 'that is not your current password.' };
    return { error: authError(err) };
  }
}

export async function fbChangePassword(current, next) {
  const r = await reauth(current);
  if (r.error) return r;
  try {
    await updatePassword(auth.currentUser, next);
    return {};
  } catch (err) {
    return { error: authError(err) };
  }
}

export async function fbChangeEmail(current, newEmail) {
  const r = await reauth(current);
  if (r.error) return r;
  try {
    await verifyBeforeUpdateEmail(auth.currentUser, newEmail);
    return {};
  } catch (err) {
    return { error: authError(err) };
  }
}

export async function fbDeleteAccount(password, username) {
  const r = await reauth(password);
  if (r.error) return r;
  const user = auth.currentUser;
  const uid = user.uid;
  const lower = username.toLowerCase();
  try {
    await withTimeout(remove(ref(db, `users/${uid}`)));
    const claim = await withTimeout(get(ref(db, `usernames/${lower}`)));
    if (claim.exists() && claim.val() === uid) await withTimeout(remove(ref(db, `usernames/${lower}`)));
  } catch (err) {
    console.error(err);
    return { error: 'could not remove your data. try again.' };
  }
  try {
    await deleteUser(user);
  } catch (err) {
    console.error(err);
    return { error: 'your profile was removed, but the login could not be deleted. sign in again to finish, or email contacttempterm@gmail.com.' };
  }
  try {
    const cred = await signInAnonymously(auth);
    return { uid: cred.user.uid };
  } catch {
    return { uid: null };
  }
}

// ---------- rooms ----------
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function makeCode() {
  let code = '';
  for (let i = 0; i < 6; i++) code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return code;
}

function pad(n) {
  return n < 10 ? '0' + n : String(n);
}

// ---------- connection health ----------
const events = [];

function note(msg) {
  events.push(new Date().toTimeString().slice(0, 8) + '  ' + msg);
  if (events.length > 80) events.shift();
}

let lastKick = 0;

// Resets a stalled connection. Safe to call often: it only acts once every 15 seconds.
export function fbKick() {
  const now = Date.now();
  if (now - lastKick < 15000) return false;
  lastKick = now;
  note('connection looks stalled, resetting it');
  try { goOffline(db); } catch (e) { console.error(e); }
  setTimeout(() => { try { goOnline(db); } catch (e) { console.error(e); } }, 500 * (globalThis.__ttTimeScale || 1));
  return true;
}

export function withTimeout(promise, ms = 12000, label = '') {
  const scale = globalThis.__ttTimeScale || 1;
  const t0 = Date.now();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      if (label) note('TIMEOUT ' + label + ' after ' + (Date.now() - t0) + 'ms');
      fbKick();
      reject(Object.assign(new Error('timeout'), { code: 'timeout' }));
    }, ms * scale);
  });
  return Promise.race([promise, timeout])
    .then(v => {
      const took = Date.now() - t0;
      if (label && took > 3000) note('slow ' + label + ' ' + took + 'ms');
      return v;
    })
    .finally(() => clearTimeout(timer));
}

// For safe-to-repeat writes: if the first try stalls, the connection is reset and it tries once more
async function retryOnce(make, ms, label) {
  try {
    return await withTimeout(make(), ms, label);
  } catch (err) {
    if (err.code !== 'timeout') throw err;
    await new Promise(r => setTimeout(r, 1500 * (globalThis.__ttTimeScale || 1)));
    return withTimeout(make(), ms, label + ' (retry)');
  }
}

function pushSystem(code, name, text) {
  return withTimeout(push(ref(db, `rooms/${code}/messages`), {
    uid: auth.currentUser.uid, name, type: 'system', text, ts: serverTimestamp(),
  }), 8000, 'systemMessage').catch(err => console.error('system message failed:', err));
}

async function createInner({ type, limit, hostName }) {
  const uid = auth.currentUser.uid;
  for (let i = 0; i < 5; i++) {
    const code = makeCode();
    const taken = await get(ref(db, `rooms/${code}/meta`));
    if (taken.exists()) continue;

    const lid = push(ref(db, 'lobby')).key;
    await set(ref(db, `rooms/${code}/meta`), {
      type, limit, host: uid, hostName, created: serverTimestamp(), lid,
    });
    const entry = { type, host: uid, hostName, limit, created: serverTimestamp() };
    if (type === 'public') entry.code = code;
    await set(ref(db, `lobby/${lid}`), entry);
    await set(ref(db, `lobbyCodes/${lid}`), code);
    return code;
  }
  throw new Error('could not find a free room code');
}

export function fbCreateRoom(opts) {
  return withTimeout(createInner(opts), 15000, 'createRoom');
}

async function joinInner(code, name, opts) {
  const uid = auth.currentUser.uid;
  const closed = opts.rejoin ? 'closed' : 'room not found.';

  const metaSnap = await get(ref(db, `rooms/${code}/meta`));
  if (!metaSnap.exists()) return { error: opts.lid ? 'wrong code.' : closed };
  const meta = metaSnap.val();
  if (opts.lid && meta.lid !== opts.lid) return { error: 'wrong code.' };

  const [memSnap, slotSnap] = await Promise.all([
    get(ref(db, `rooms/${code}/members`)),
    get(ref(db, `rooms/${code}/slots`)),
  ]);
  const members = memSnap.val() || {};
  const slots = slotSnap.val() || {};
  const count = Object.keys(members).length;

  if (count === 0 && !opts.fresh) {
    await fbCleanup(code).catch(() => {});
    return { error: closed };
  }
  if (!members[uid] && count >= meta.limit) return { error: 'room is full.' };
  if (count === 0) await remove(ref(db, `rooms/${code}/messages`));

  let slot = Object.keys(slots).find(k => slots[k] === uid);
  for (let i = 1; !slot && i <= meta.limit; i++) {
    const key = pad(i);
    if (slots[key]) continue;
    try {
      await set(ref(db, `rooms/${code}/slots/${key}`), uid);
      slot = key;
    } catch {
      // someone took that seat at the same moment, try the next one
    }
  }
  if (!slot) return { error: 'room is full.' };

  try {
    await set(ref(db, `rooms/${code}/members/${uid}`), { name, joined: serverTimestamp(), slot });
  } catch (err) {
    await remove(ref(db, `rooms/${code}/slots/${slot}`)).catch(() => {});
    throw err;
  }
  if (meta.lid) await set(ref(db, `lobbyMembers/${meta.lid}/${uid}`), true);

  const leaveKey = push(ref(db, `rooms/${code}/messages`)).key;
  const updates = {
    [`rooms/${code}/members/${uid}`]: null,
    [`rooms/${code}/slots/${slot}`]: null,
    [`rooms/${code}/messages/${leaveKey}`]: {
      uid, name, type: 'system', text: `${name} has left the room.`, ts: serverTimestamp(),
    },
  };
  if (meta.lid) updates[`lobbyMembers/${meta.lid}/${uid}`] = null;
  await onDisconnect(ref(db)).cancel();
  await onDisconnect(ref(db)).update(updates);

  if (opts.fresh) pushSystem(code, name, `room created! code: ${code} [${meta.type}]`);
  pushSystem(code, name, opts.rejoin ? `${name} has rejoined the room.` : `${name} has joined the room.`);
  return { meta, slot };
}

export function fbJoinRoom(code, name, opts = {}) {
  return withTimeout(joinInner(code, name, opts), 15000, 'joinRoom');
}

// Deletes everything about an empty room in ONE step, so a stall can't leave it half-deleted
export async function fbCleanup(code) {
  const members = await withTimeout(get(ref(db, `rooms/${code}/members`)), 8000, 'cleanup:members');
  if (members.exists()) return;
  const metaSnap = await withTimeout(get(ref(db, `rooms/${code}/meta`)), 8000, 'cleanup:meta');
  const meta = metaSnap.exists() ? metaSnap.val() : null;
  const lid = meta && meta.lid;

  let lobbySnap = null;
  let codeSnap = null;
  if (lid) {
    [lobbySnap, codeSnap] = await withTimeout(Promise.all([
      get(ref(db, `lobby/${lid}`)).catch(() => null),
      get(ref(db, `lobbyCodes/${lid}`)).catch(() => null),
    ]), 8000, 'cleanup:lobby');
  }

  // Only delete what exists: the rules refuse to delete something that isn't there
  const updates = {
    [`rooms/${code}/messages`]: null,
    [`rooms/${code}/slots`]: null,
  };
  if (meta) updates[`rooms/${code}/meta`] = null;
  if (lobbySnap && lobbySnap.exists()) updates[`lobby/${lid}`] = null;
  if (codeSnap && codeSnap.exists()) updates[`lobbyCodes/${lid}`] = null;

  try {
    await withTimeout(update(ref(db), updates), 10000, 'cleanup:delete');
  } catch (err) {
    if (err.code === 'timeout') throw err;
    console.warn('cleanup in one step failed, trying piece by piece:', err.code || err.message);
    for (const path of Object.keys(updates)) {
      try { await withTimeout(remove(ref(db, path)), 6000, 'cleanup:' + path); }
      catch (e) { console.warn('could not remove', path, e.code || e.message); }
    }
  }
}

async function fbCloseLobby(lid) {
  const codeSnap = await get(ref(db, `lobbyCodes/${lid}`)).catch(() => null);
  if (codeSnap && codeSnap.exists()) return fbCleanup(codeSnap.val());
  await remove(ref(db, `lobby/${lid}`));
}

export async function fbLeaveRoom(code, name, lid) {
  const uid = auth.currentUser.uid;
  const mine = await withTimeout(get(ref(db, `rooms/${code}/members/${uid}`)), 6000, 'leave:read').catch(() => null);
  const slot = mine && mine.exists() ? mine.val().slot : null;
  pushSystem(code, name, `${name} has left the room.`);

  const updates = { [`rooms/${code}/members/${uid}`]: null };
  if (slot) updates[`rooms/${code}/slots/${slot}`] = null;
  if (lid) updates[`lobbyMembers/${lid}/${uid}`] = null;

  try {
    await withTimeout(update(ref(db), updates), 8000, 'leave:remove');
  } catch (err) {
    if (err.code === 'timeout') {
      console.warn('leaving timed out. the server finishes it when the connection resets.');
      return;
    }
    console.warn('leave in one step failed, trying piece by piece:', err.code || err.message);
    for (const path of Object.keys(updates)) {
      try { await withTimeout(remove(ref(db, path)), 6000, 'leave:' + path); }
      catch (e) { console.warn('could not remove', path, e.code || e.message); }
    }
  }
  onDisconnect(ref(db)).cancel().catch(() => {});
  try { await fbCleanup(code); }
  catch (err) { console.warn('cleanup after leaving failed:', err.code || err.message); }
}

export function fbSendMessage(code, name, text, extra = {}) {
  const msg = { uid: auth.currentUser.uid, name, ts: serverTimestamp() };
  if (text || !extra.img) msg.text = text;
  if (extra.img) msg.img = extra.img;
  return withTimeout(push(ref(db, `rooms/${code}/messages`), msg), extra.img ? 20000 : 10000, 'sendMessage');
}

export function fbWatchRoom(code, handlers) {
  const fail = err => { if (handlers.onError) handlers.onError(err); };
  const stops = [
    onChildAdded(ref(db, `rooms/${code}/messages`), snap => handlers.onMessage(snap.key, snap.val()), fail),
    onValue(ref(db, `rooms/${code}/members`), snap => handlers.onMembers(snap.val() || {}), fail),
  ];
  return () => stops.forEach(stop => stop());
}

export async function fbListRooms() {
  const [lobbySnap, memSnap] = await withTimeout(Promise.all([get(ref(db, 'lobby')), get(ref(db, 'lobbyMembers'))]), 12000, 'listRooms');
  const mem = memSnap.val() || {};
  const rooms = [];
  lobbySnap.forEach(child => {
    const r = { lid: child.key, ...child.val() };
    r.count = mem[r.lid] ? Object.keys(mem[r.lid]).length : 0;
    rooms.push(r);
  });
  rooms
    .filter(r => r.count === 0 && Date.now() - r.created > 15000)
    .forEach(r => fbCloseLobby(r.lid).catch(() => {}));
  return rooms.filter(r => r.count > 0);
}

// Janitor: removes rooms that nobody is in. Returns how many it found.
export async function fbSweep() {
  const [lobbySnap, memSnap] = await withTimeout(Promise.all([get(ref(db, 'lobby')), get(ref(db, 'lobbyMembers'))]), 12000, 'sweep');
  const mem = memSnap.val() || {};
  const empty = [];
  lobbySnap.forEach(child => {
    const v = child.val() || {};
    const count = mem[child.key] ? Object.keys(mem[child.key]).length : 0;
    if (count === 0 && Date.now() - (v.created || 0) > 15000) empty.push(child.key);
  });
  for (const lid of empty.slice(0, 5)) await fbCloseLobby(lid).catch(() => {});
  if (empty.length) note('janitor cleared ' + Math.min(empty.length, 5) + ' empty room(s)');
  return empty.length;
}

// Console helpers. In the app, press Ctrl+Shift+I and type: copy(__tt.report())
window.__tt = {
  offline: () => goOffline(db),
  online: () => goOnline(db),
  kick: () => { lastKick = 0; return fbKick(); },
  report: () => events.join('\n'),
};