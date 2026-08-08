import { initializeApp, getApps } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js';
import { getDatabase, ref, set, get, update, onValue, onDisconnect, remove } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-database.js';
import { getAuth, signInAnonymously } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js';

const firebaseConfig = {
  apiKey: 'AIzaSyBG6oid29bMq8GVvBkNvPtSDZTRO5K09uk',
  authDomain: 'focus-game-1c7ee.firebaseapp.com',
  databaseURL: 'https://focus-game-1c7ee-default-rtdb.europe-west1.firebasedatabase.app',
  projectId: 'focus-game-1c7ee',
  storageBucket: 'focus-game-1c7ee.firebasestorage.app',
  messagingSenderId: '856695121197',
  appId: '1:856695121197:web:3e8adfb62230194b499fa4'
};

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
const db = getDatabase(app);
const auth = getAuth(app);

const PATH = 'catchmeRoomsV3';
const COLORS = ['#2f8fe0', '#ffcc33', '#22c55e', '#ef4444', '#a855f7', '#f97316'];
const TRACK = { 2: 32, 3: 40, 4: 48, 5: 56, 6: 64 };

function clean(o) {
  return JSON.parse(JSON.stringify(o, (k, v) => (v === undefined ? null : v)));
}

async function ensureAuth() {
  if (auth.currentUser) return auth.currentUser;
  const cred = await signInAnonymously(auth);
  return cred.user;
}

function code() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

function buildPlayers(list) {
  const n = list.length;
  const L = TRACK[n];
  const gap = Math.floor(L / n);
  return list.map((p, i) => ({
    id: p.uid,
    uid: p.uid,
    name: p.name,
    color: COLORS[i % COLORS.length],
    pos: i * gap,
    alive: true,
    ai: false
  }));
}

export async function createOnlineController(cb = {}) {
  let uid = null;
  let roomCode = null;
  let stopWatch = null;

  async function watch() {
    if (stopWatch) stopWatch();
    stopWatch = onValue(ref(db, `${PATH}/${roomCode}`), (snap) => {
      if (!snap.exists()) {
        cb.onClosed?.('Le salon a été fermé.');
        return;
      }
      const r = snap.val();
      const players = Object.values(r.players || {}).sort((a, b) => (a.joinedAt || 0) - (b.joinedAt || 0));
      if (r.phase === 'lobby') {
        cb.onLobby?.({
          code: roomCode,
          players,
          maxPlayers: r.maxPlayers,
          hostId: r.hostId,
          amHost: r.hostId === uid
        });
      } else if (r.phase === 'playing' && r.game) {
        cb.onGame?.(r.game);
      }
    }, (err) => {
      cb.onClosed?.('Connexion perdue : ' + err.message);
    });
  }

  async function createRoom(name, maxPlayers) {
    const user = await ensureAuth();
    uid = user.uid;
    roomCode = code();
    const me = { uid, name, color: COLORS[0], joinedAt: Date.now(), connected: true };
    await set(ref(db, `${PATH}/${roomCode}`), clean({
      hostId: uid,
      maxPlayers,
      phase: 'lobby',
      createdAt: Date.now(),
      players: { [uid]: me }
    }));
    onDisconnect(ref(db, `${PATH}/${roomCode}/players/${uid}/connected`)).set(false);
    await watch();
    return roomCode;
  }

  async function joinRoom(name, c) {
    const user = await ensureAuth();
    uid = user.uid;
    roomCode = c.toUpperCase();
    const snap = await get(ref(db, `${PATH}/${roomCode}`));
    if (!snap.exists()) throw new Error('Salon introuvable.');
    const r = snap.val();
    if (r.phase !== 'lobby') throw new Error('La course a déjà commencé.');
    const ps = Object.values(r.players || {});
    if (ps.length >= r.maxPlayers && !r.players?.[uid]) throw new Error('Le salon est complet.');
    const me = { uid, name, color: COLORS[ps.length % COLORS.length], joinedAt: Date.now(), connected: true };
    await set(ref(db, `${PATH}/${roomCode}/players/${uid}`), clean(me));
    onDisconnect(ref(db, `${PATH}/${roomCode}/players/${uid}/connected`)).set(false);
    await watch();
  }

  async function startGame() {
    const snap = await get(ref(db, `${PATH}/${roomCode}`));
    if (!snap.exists()) throw new Error('Salon introuvable.');
    const r = snap.val();
    if (r.hostId !== uid) throw new Error("Seul l'hôte peut lancer la course.");
    const ps = Object.values(r.players || {})
      .filter((p) => p.connected !== false)
      .sort((a, b) => (a.joinedAt || 0) - (b.joinedAt || 0));
    if (ps.length < 2) throw new Error('Il faut au moins 2 coureurs.');
    const players = buildPlayers(ps);
    const game = {
      players,
      turn: 0,
      track: TRACK[ps.length],
      initial: ps.length,
      status: 'playing',
      mode: 'online',
      moveNo: 0,
      lastRoll: null,
      hostId: r.hostId
    };
    await update(ref(db, `${PATH}/${roomCode}`), clean({ phase: 'playing', game }));
  }

  function isMyTurn(g) {
    return !!g?.players?.[g.turn] && g.players[g.turn].uid === uid;
  }

  async function pushGame(g) {
    const snap = await get(ref(db, `${PATH}/${roomCode}`));
    if (!snap.exists()) throw new Error('Salon introuvable.');
    const remote = snap.val().game;
    if (remote && Number(remote.moveNo || 0) >= Number(g.moveNo || 0)) return;
    await set(ref(db, `${PATH}/${roomCode}/game`), clean(g));
  }

  async function eliminateSelfInGame(r) {
    const g = r.game;
    const idx = g.players.findIndex((p) => p.uid === uid);
    if (idx < 0 || !g.players[idx].alive) return g;
    g.players[idx].alive = false;
    const alive = g.players.map((p, i) => (p.alive ? i : -1)).filter((i) => i >= 0);
    if (alive.length === 1) {
      g.status = 'finished';
      g.turn = alive[0];
    } else if (alive.length > 1) {
      const oldN = g.track;
      const newN = TRACK[alive.length];
      g.players.forEach((p) => {
        if (p.alive) p.pos = Math.floor((((p.pos % oldN) + oldN) % oldN) / oldN * newN) % newN;
      });
      g.track = newN;
      if (!g.players[g.turn]?.alive) {
        let j = g.turn;
        do {
          j = (j + 1) % g.players.length;
        } while (!g.players[j].alive);
        g.turn = j;
      }
    }
    g.moveNo = (g.moveNo || 0) + 1;
    return g;
  }

  async function leave(eliminate) {
    if (!roomCode || !uid) return;
    try {
      const roomRef = ref(db, `${PATH}/${roomCode}`);
      const snap = await get(roomRef);
      if (snap.exists()) {
        const r = snap.val();
        if (eliminate && r.phase === 'playing' && r.game) {
          const g = await eliminateSelfInGame(r);
          await set(ref(db, `${PATH}/${roomCode}/game`), clean(g));
        }
        await remove(ref(db, `${PATH}/${roomCode}/players/${uid}`));
        if (r.hostId === uid && r.phase === 'lobby') {
          const left = Object.values(r.players || {}).filter((p) => p.uid !== uid);
          if (left.length) {
            await update(roomRef, { hostId: left.sort((a, b) => a.joinedAt - b.joinedAt)[0].uid });
          } else {
            await remove(roomRef);
          }
        }
      }
    } catch (e) {
      console.warn('leave() error', e);
    }
    if (stopWatch) {
      stopWatch();
      stopWatch = null;
    }
    roomCode = null;
  }

  async function restart() {
    const snap = await get(ref(db, `${PATH}/${roomCode}`));
    if (!snap.exists()) throw new Error('Salon introuvable.');
    const r = snap.val();
    if (r.hostId !== uid) throw new Error("Seul l'hôte peut relancer la course.");
    const ps = Object.values(r.players || {})
      .filter((p) => p.connected !== false)
      .sort((a, b) => a.joinedAt - b.joinedAt);
    if (ps.length < 2) throw new Error('Il faut au moins 2 coureurs encore connectés.');
    const players = buildPlayers(ps);
    await set(ref(db, `${PATH}/${roomCode}/game`), clean({
      players,
      turn: 0,
      track: TRACK[ps.length],
      initial: ps.length,
      status: 'playing',
      mode: 'online',
      moveNo: 0,
      lastRoll: null,
      hostId: r.hostId
    }));
  }

  function shareData() {
    const url = `${location.origin}${location.pathname}?room=${roomCode}`;
    return {
      title: 'Attrape-moi si tu peux !',
      text: `Rejoins ma course olympique. Code : ${roomCode}`,
      url
    };
  }

  return {
    createRoom,
    joinRoom,
    startGame,
    isMyTurn,
    pushGame,
    leave,
    restart,
    shareData,
    get roomCode() {
      return roomCode;
    },
    get uid() {
      return uid;
    }
  };
}
