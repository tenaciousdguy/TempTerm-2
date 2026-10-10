import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.14.0/firebase-app.js';
import {
  getAuth, signInAnonymously, signInWithEmailAndPassword, signOut,
  EmailAuthProvider, linkWithCredential, sendPasswordResetEmail, sendEmailVerification, reload,
} from 'https://www.gstatic.com/firebasejs/12.14.0/firebase-auth.js';
import {
  getDatabase, ref, onValue, get, set, push, remove,
  onChildAdded, onDisconnect, serverTimestamp,
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

export async function fbLoadProfile(uid) {
  const snap = await get(ref(db, `users/${uid}`));
  return snap.exists() ? snap.val() : null;
}

export async function fbUsernameFree(name) {
  const snap = await get(ref(db, `usernames/${name.toLowerCase()}`));
  return !snap.exists();
}

export async function fbSignUp({ username, display, email, password }) {
  const user = auth.currentUser;
  const lower = username.toLowerCase();
  try {
    await set(ref(db, `usernames/${lower}`), user.uid);
  } catch {
    return { error: 'that username is taken or not allowed.' };
  }
  try {
    await linkWithCredential(user, EmailAuthProvider.credential(email, password));
  } catch (err) {
    await remove(ref(db, `usernames/${lower}`)).catch(() => {});
    return { error: authError(err) };
  }
  try {
    await set(ref(db, `users/${user.uid}`), { username, display, created: serverTimestamp() });
  } catch (err) {
    console.error(err);
    return { error: 'account created, but the profile could not be saved. try signing in.' };
  }
  sendEmailVerification(user).catch(() => {});
  return { uid: user.uid, profile: { username, display } };
}

export async function fbSignIn(email, password) {
  try {
    const cred = await signInWithEmailAndPassword(auth, email, password);
    const profile = await fbLoadProfile(cred.user.uid);
    return { uid: cred.user.uid, profile };
  } catch (err) {
    return { error: authError(err) };
  }
}

export async function fbSignOut() {
  await signOut(auth);
  await signInAnonymously(auth);
  return auth.currentUser.uid;
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

// ---------- rooms ----------
// Data layout:
//   rooms/CODE/meta            type, limit, host, lid
//   rooms/CODE/members/UID     who is in the room right now
//   rooms/CODE/messages/ID     the chat, including system lines (type: 'system')
//   lobby/LID                  what the Room Searcher lists (public entries include the code)
//   lobbyMembers/LID/UID       mirrors the member list, so the searcher can show counts
//   lobbyCodes/LID             the real room code; only readable once the room is empty (for cleanup)

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function makeCode() {
  let code = '';
  for (let i = 0; i < 6; i++) code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return code;
}

function pushSystem(code, name, text) {
  return push(ref(db, `rooms/${code}/messages`), {
    uid: auth.currentUser.uid, name, type: 'system', text, ts: serverTimestamp(),
  }).catch(err => console.error('system message failed:', err));
}

export async function fbCreateRoom({ type, limit, hostName }) {
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
    if (type === 'public') entry.code = code; // private codes are never shown
    await set(ref(db, `lobby/${lid}`), entry);
    await set(ref(db, `lobbyCodes/${lid}`), code);
    return code;
  }
  throw new Error('could not find a free room code');
}

// opts.fresh = true only for the person who just created the room
// opts.lid   = set when joining a private room from the list
export async function fbJoinRoom(code, name, opts = {}) {
  const uid = auth.currentUser.uid;
  const metaSnap = await get(ref(db, `rooms/${code}/meta`));
  if (!metaSnap.exists()) return { error: opts.lid ? 'wrong code.' : 'room not found.' };
  const meta = metaSnap.val();
  if (opts.lid && meta.lid !== opts.lid) return { error: 'wrong code.' };

  const memSnap = await get(ref(db, `rooms/${code}/members`));
  const members = memSnap.val() || {};
  const count = Object.keys(members).length;

  // An empty room that nobody just created is a closed room.
  if (count === 0 && !opts.fresh) {
    await fbCleanup(code).catch(() => {});
    return { error: 'room not found.' };
  }
  if (!members[uid] && count >= meta.limit) return { error: 'room is full.' };
  if (count === 0) await remove(ref(db, `rooms/${code}/messages`));

  await set(ref(db, `rooms/${code}/members/${uid}`), { name, joined: serverTimestamp() });
  if (meta.lid) await set(ref(db, `lobbyMembers/${meta.lid}/${uid}`), true);

  // If the app closes or the connection drops:
  // posts the "has left" line and removes us from the member lists.
  const leaveKey = push(ref(db, `rooms/${code}/messages`)).key;
  const updates = {
    [`rooms/${code}/members/${uid}`]: null,
    [`rooms/${code}/messages/${leaveKey}`]: {
      uid, name, type: 'system', text: `${name} has left the room.`, ts: serverTimestamp(),
    },
  };
  if (meta.lid) updates[`lobbyMembers/${meta.lid}/${uid}`] = null;
  await onDisconnect(ref(db)).update(updates);

  if (opts.fresh) pushSystem(code, name, `room created! code: ${code} [${meta.type}]`);
  pushSystem(code, name, `${name} has joined the room.`);
  return { meta };
}

// Deletes everything about a room, but only if nobody is in it (the rules enforce this too).
export async function fbCleanup(code) {
  const members = await get(ref(db, `rooms/${code}/members`));
  if (members.exists()) return;
  const metaSnap = await get(ref(db, `rooms/${code}/meta`));
  const meta = metaSnap.val();
  await remove(ref(db, `rooms/${code}/messages`));
  if (meta && meta.lid) {
    await remove(ref(db, `lobby/${meta.lid}`));
    await remove(ref(db, `lobbyCodes/${meta.lid}`));
  }
  await remove(ref(db, `rooms/${code}/meta`));
}

// Closes an empty room found in the lobby using the code that becomes readable once its empty
async function fbCloseLobby(lid) {
  const codeSnap = await get(ref(db, `lobbyCodes/${lid}`));
  if (codeSnap.exists()) return fbCleanup(codeSnap.val());
  await remove(ref(db, `lobby/${lid}`));
}

export async function fbLeaveRoom(code, name, lid) {
  const uid = auth.currentUser.uid;
  await onDisconnect(ref(db)).cancel();
  pushSystem(code, name, `${name} has left the room.`);
  await remove(ref(db, `rooms/${code}/members/${uid}`));
  if (lid) await remove(ref(db, `lobbyMembers/${lid}/${uid}`));
  await fbCleanup(code); // the last person out deletes everything
}

export function fbSendMessage(code, name, text) {
  return push(ref(db, `rooms/${code}/messages`), {
    uid: auth.currentUser.uid, name, text, ts: serverTimestamp(),
  });
}

// Live updates for one room. Returns a function that stops listening.
export function fbWatchRoom(code, handlers) {
  const stops = [
    onChildAdded(ref(db, `rooms/${code}/messages`), snap => handlers.onMessage(snap.key, snap.val())),
    onValue(ref(db, `rooms/${code}/members`), snap => handlers.onMembers(snap.val() || {})),
  ];
  return () => stops.forEach(stop => stop());
}

// Rooms with at least one person in them.
export async function fbListRooms() {
  const [lobbySnap, memSnap] = await Promise.all([get(ref(db, 'lobby')), get(ref(db, 'lobbyMembers'))]);
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