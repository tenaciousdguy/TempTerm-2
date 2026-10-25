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
    snap => callback(snap.val() === true),
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

export function fbWatchStatus(cb) {
  return onValue(ref(db, 'status'), snap => cb(snap.exists() ? snap.val() : null), err => console.error('status watch:', err));
}

export async function fbLoadSettings(uid) {
  const snap = await get(ref(db, `users/${uid}/settings`));
  return snap.exists() ? snap.val() : null;
}

export async function fbSaveSettings(uid, data) {
  try {
    await set(ref(db, `users/${uid}/settings`), data);
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
  await withTimeout(update(ref(db, `users/${uid}`), fields));
    return {};
  } catch (err) {
    console.error(err);
    return { error: 'could not save. check your connection.' };
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

export function withTimeout(promise, ms = 12000) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error('timeout'), { code: 'timeout' })), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function pushSystem(code, name, text) {
  return withTimeout(push(ref(db, `rooms/${code}/messages`), {
    uid: auth.currentUser.uid, name, type: 'system', text, ts: serverTimestamp(),
  }), 8000).catch(err => console.error('system message failed:', err));
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
  return withTimeout(createInner(opts), 15000);
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

// opts.fresh: you just created the room. opts.lid: joining a private room from the list.
// opts.rejoin: coming back after a dropped connection.
export function fbJoinRoom(code, name, opts = {}) {
  return withTimeout(joinInner(code, name, opts), 15000);
}

export async function fbCleanup(code) {
  const members = await get(ref(db, `rooms/${code}/members`));
  if (members.exists()) return;
  const metaSnap = await get(ref(db, `rooms/${code}/meta`));
  const meta = metaSnap.val();
  await remove(ref(db, `rooms/${code}/messages`));
  await remove(ref(db, `rooms/${code}/slots`)).catch(() => {});
  if (meta && meta.lid) {
    await remove(ref(db, `lobby/${meta.lid}`));
    await remove(ref(db, `lobbyCodes/${meta.lid}`));
  }
  await remove(ref(db, `rooms/${code}/meta`));
}

async function fbCloseLobby(lid) {
  const codeSnap = await get(ref(db, `lobbyCodes/${lid}`));
  if (codeSnap.exists()) return fbCleanup(codeSnap.val());
  await remove(ref(db, `lobby/${lid}`));
}

export async function fbLeaveRoom(code, name, lid) {
  const uid = auth.currentUser.uid;
  await onDisconnect(ref(db)).cancel();
  const mine = await withTimeout(get(ref(db, `rooms/${code}/members/${uid}`)), 6000).catch(() => null);
  const slot = mine && mine.exists() ? mine.val().slot : null;
  pushSystem(code, name, `${name} has left the room.`);
  await remove(ref(db, `rooms/${code}/members/${uid}`));
  if (slot) await remove(ref(db, `rooms/${code}/slots/${slot}`)).catch(() => {});
  if (lid) await remove(ref(db, `lobbyMembers/${lid}/${uid}`));
  await fbCleanup(code);
}

export function fbSendMessage(code, name, text, extra = {}) {
  const msg = { uid: auth.currentUser.uid, name, ts: serverTimestamp() };
  if (text || !extra.img) msg.text = text;
  if (extra.img) msg.img = extra.img;
  return withTimeout(push(ref(db, `rooms/${code}/messages`), msg), extra.img ? 20000 : 10000);
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
  const [lobbySnap, memSnap] = await withTimeout(Promise.all([get(ref(db, 'lobby')), get(ref(db, 'lobbyMembers'))]));
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

// Test helper: run __tt.offline() and __tt.online() in the dev console to simulate a dropped connection.
window.__tt = { offline: () => goOffline(db), online: () => goOnline(db) };