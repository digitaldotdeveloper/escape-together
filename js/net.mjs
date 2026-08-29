/* The wire.
 *
 * Input goes up as a 10-byte frame, state comes down as one flat array of
 * floats. There is no message protocol to speak of because there is nothing to
 * negotiate: both ends already agree on what the world contains, so all that
 * ever has to travel is where everything currently is.
 */

export function connect(handlers) {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(proto + '://' + location.host);
  ws.binaryType = 'arraybuffer';

  const net = {
    ws,
    slot: -1,
    code: null,
    room: null,
    ready: false,
    ping: 0,
    lastSnapAt: 0,
    send: (obj) => { if (ws.readyState === 1) ws.send(JSON.stringify(obj)); },
    close: () => ws.close(),
  };

  ws.onopen = () => { net.ready = true; handlers.open && handlers.open(net); };
  ws.onclose = () => { net.ready = false; handlers.close && handlers.close(); };
  ws.onerror = () => { handlers.close && handlers.close(); };

  ws.onmessage = (e) => {
    if (e.data instanceof ArrayBuffer) {
      const now = performance.now();
      net.snapGap = now - net.lastSnapAt;
      net.lastSnapAt = now;
      handlers.snapshot(new Float32Array(e.data));
      return;
    }
    let msg;
    try { msg = JSON.parse(e.data); } catch { return; }
    if (msg.t === 'joined') { net.slot = msg.slot; net.code = msg.code; }
    if (msg.t === 'room') net.room = msg;
    handlers.message(msg, net);
  };

  // 10 bytes: one flags byte, one signed move byte, two floats of aim
  const buf = new ArrayBuffer(10);
  const view = new DataView(buf);
  net.sendInput = (input) => {
    if (ws.readyState !== 1 || net.slot < 0) return;
    let bits = 0;
    if (input.jump) bits |= 1;
    if (input.grab) bits |= 2;
    if (input.brace) bits |= 4;
    if (input.limp) bits |= 8;
    view.setUint8(0, bits);
    view.setInt8(1, Math.max(-100, Math.min(100, Math.round(input.move * 100))));
    view.setFloat32(2, input.aim ? input.aim.x : 0, true);
    view.setFloat32(6, input.aim ? input.aim.y : 0, true);
    ws.send(buf);
  };

  return net;
}
