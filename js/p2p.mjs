/* Two players with no server in the middle.
 *
 * GitHub Pages can serve files and nothing else - no Node, no WebSocket, no
 * room server. So on a static host the game keeps exactly the same shape and
 * moves the authority into a browser: whoever pressed CREATE ROOM runs the
 * simulation and streams snapshots straight to the other player over a WebRTC
 * data channel. The guest still only sends input and only ever draws what the
 * authority tells it, which is the same contract the Node server has.
 *
 * The one real difference: the host now has a home advantage of exactly the
 * round trip, because their own input never leaves the machine. In a game
 * about falling over, nobody has ever noticed.
 *
 * PeerJS's public broker is used purely for introductions - it hands the two
 * browsers each other's connection details and then plays no further part. It
 * carries no game traffic. If it is unreachable, or the two networks refuse to
 * connect directly, that is reported rather than hidden: there is no relay.
 */

const CODE_CHARS = 'ACDEFGHJKMNPQRTUVWXY3479'; // no 0/O, 1/I/L, 2/Z, 5/S, 8/B
const PREFIX = 'escapetogether-v1-';

export const newCode = () =>
  Array.from({ length: 5 }, () =>
    CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');

function requirePeer() {
  if (!window.Peer) {
    throw new Error('THE MATCHMAKING LIBRARY DID NOT LOAD');
  }
  return window.Peer;
}

const peerOptions = {
  // Google's public STUN, which is what lets two browsers behind ordinary
  // routers find each other. There is deliberately no TURN relay: it would
  // mean paying to carry other people's game traffic.
  config: {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:global.stun.twilio.com:3478' },
    ],
  },
};

/* ------------------------------------------------------------------ shared */

function wrap(peer, handlers) {
  const t = {
    peer,
    conn: null,
    host: false,
    slot: 0,
    code: null,
    ready: false,
    close() {
      try { t.conn && t.conn.close(); } catch {}
      try { peer.destroy(); } catch {}
    },
    send(obj) { if (t.conn && t.conn.open) t.conn.send(obj); },
  };

  // input travels as the same 10 bytes the WebSocket build sends
  const buf = new ArrayBuffer(10);
  const view = new DataView(buf);
  t.sendInput = (input) => {
    if (!t.conn || !t.conn.open) return;
    let bits = 0;
    if (input.jump) bits |= 1;
    if (input.grab) bits |= 2;
    if (input.brace) bits |= 4;
    if (input.limp) bits |= 8;
    view.setUint8(0, bits);
    view.setInt8(1, Math.max(-100, Math.min(100, Math.round(input.move * 100))));
    view.setFloat32(2, input.aim ? input.aim.x : 0, true);
    view.setFloat32(6, input.aim ? input.aim.y : 0, true);
    t.conn.send(buf.slice(0));
  };

  return t;
}

function attach(t, conn, handlers) {
  t.conn = conn;
  conn.on('open', () => {
    t.ready = true;
    handlers.peerOpen && handlers.peerOpen(t);
  });
  conn.on('data', (data) => {
    if (data instanceof ArrayBuffer) return handlers.binary(data, t);
    if (ArrayBuffer.isView(data)) {
      return handlers.binary(
        data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength), t);
    }
    handlers.message(data, t);
  });
  const gone = () => { t.ready = false; handlers.peerGone && handlers.peerGone(t); };
  conn.on('close', gone);
  conn.on('error', gone);
}

/* -------------------------------------------------------------- the host */

export function createRoom(handlers) {
  const Peer = requirePeer();
  let attempts = 0;

  const open = (code) => {
    const peer = new Peer(PREFIX + code, peerOptions);
    const t = wrap(peer, handlers);
    t.host = true;
    t.slot = 0;
    t.code = code;

    peer.on('open', () => handlers.open && handlers.open(t));
    peer.on('connection', (conn) => {
      // one guest only; a second knock is turned away rather than queued
      if (t.conn && t.conn.open) {
        conn.on('open', () => { conn.send({ t: 'err', why: 'THAT ROOM IS FULL' }); conn.close(); });
        return;
      }
      attach(t, conn, handlers);
    });
    peer.on('error', (e) => {
      // somebody else on the public broker already holds that id: pick again
      if (e.type === 'unavailable-id' && attempts++ < 5) {
        try { peer.destroy(); } catch {}
        return open(newCode());
      }
      handlers.fail && handlers.fail(errorText(e));
    });
    return t;
  };

  return open(newCode());
}

/* ------------------------------------------------------------- the guest */

export function joinRoom(code, handlers) {
  const Peer = requirePeer();
  const peer = new Peer(peerOptions);
  const t = wrap(peer, handlers);
  t.host = false;
  t.slot = 1;
  t.code = code;

  let settled = false;
  peer.on('open', () => {
    const conn = peer.connect(PREFIX + code, { reliable: false, serialization: 'binary' });
    attach(t, conn, handlers);
    conn.on('open', () => { settled = true; handlers.open && handlers.open(t); });
    // PeerJS never times out a connection to an id nobody is holding, so the
    // "wrong code" case has to be a clock rather than an error
    setTimeout(() => {
      if (!settled) handlers.fail && handlers.fail('NO SUCH ROOM');
    }, 9000);
  });
  peer.on('error', (e) => {
    if (settled) return;
    settled = true;
    handlers.fail && handlers.fail(errorText(e));
  });
  return t;
}

function errorText(e) {
  switch (e && e.type) {
    case 'peer-unavailable': return 'NO SUCH ROOM';
    case 'network': return 'CANNOT REACH MATCHMAKING';
    case 'browser-incompatible': return 'THIS BROWSER CANNOT DO PEER TO PEER';
    case 'unavailable-id': return 'THAT ROOM CODE IS TAKEN';
    default: return 'CONNECTION FAILED';
  }
}
