// vca-tcp.js のテスト(Node.js のみ)。自分のパソコンの中(127.0.0.1)で、実際の TCP・UDP でつなぐ
// 接続後の待ち時間(本来 3 秒)は、テストを速くするため 0.05 秒にしている
const VCA = require('../src/vca-parser.js');
const T = require('../src/vca-tcp.js');

module.exports = async function () {
  const results = [];
  const opts = { connectDelay: 0.05 };
  const trace = [['TRCFMT', '1', '4', 'E', 'R', 'F'], ['R', '2500', '2400', '2500', '2400']];
  const within = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('時間切れ')), ms))]);
  // test(名前, { spec: 確かめる対応表の行, kind: 確かめ方, req: 確かめる義務(docs/requirements.md の番号) }, 本体)。tools/trace.js が対応表・義務の一覧と突き合わせる
  async function test(name, meta, fn) {
    const info = { name, spec: meta.spec || [], kind: meta.kind || [], req: meta.req || [] };
    try { await within(fn(), 5000); results.push(Object.assign({ ok: true }, info)); }
    catch (e) { results.push(Object.assign({ ok: false, msg: e.message }, info)); }
  }

  await test('TCP リモート接続(7.8.2.7.3): デバイスがホストへつなぎ、玉型をアップロード', { spec: ['7.8.2'], kind: ['正常'], req: ['R195', 'R199', 'R203'] }, async () => {
    let got = null, hostRef = null;
    const server = await T.listenHost(0, { onData: (req, data) => { got = data; return { status: 0 }; } }, h => { hostRef = h; });
    try {
      const device = await T.connectDevice('127.0.0.1', server.address().port, opts);
      const r = await device.request('TRC', { job: '1234', data: trace });
      if (r.status !== 0 || JSON.stringify(got.traces[0].radii) !== '[2500,2400,2500,2400]') throw new Error('玉型が届かない');
      device.socket.destroy();
    } finally { if (hostRef) hostRef.socket.destroy(); server.close(); }
  });

  await test('TCP ローカル接続(7.8.2.7.2): ホストがデバイスへつなぎ、デバイスがダウンロード', { spec: ['7.8.2'], kind: ['正常'], req: ['R195', 'R202'] }, async () => {
    let device = null;
    const ready = new Promise(res => { device = res; });
    const server = await T.listenDevice(0, opts, d => device(d));
    try {
      const host = await T.connectHost('127.0.0.1', server.address().port,
        { onRequest: () => ({ records: [['DO', 'B'], ['HBOX', '52.00', '52.00']] }) });
      const d = await ready;
      const r = await d.request('EDG', { job: '9' });
      if (VCA.number(r.response, 'HBOX', 'L') !== 52) throw new Error('データが届かない');
      host.socket.destroy();
    } finally { server.close(); }
  });

  await test('オートコネクト(7.8.2.7.1): UDP の REQ=CON を受けたホストがデバイスへつなぐ', { spec: ['7.8.2'], kind: ['正常'] }, async () => {
    let device = null, con = null;
    const ready = new Promise(res => { device = res; });
    const server = await T.listenDevice(0, opts, d => device(d));
    const udp = await T.listenAutoconnect(0, { onRequest: () => ({ records: [['DO', 'R']] }) }, (h, c) => { con = c; });
    try {
      await T.announce({ ip: '127.0.0.1', port: server.address().port, dev: 'EDG', ven: 'GC', model: 'LE-3' },
        { address: '127.0.0.1', port: udp.address().port });
      const d = await ready;
      const r = await d.request('EDG', { job: '5' });
      if (VCA.value(r.response, 'DO') !== 'R' || VCA.value(con, 'MODEL') !== 'LE-3') throw new Error('つながらない');
      d.socket.destroy();
    } finally { udp.close(); server.close(); }
  });

  await test('TCP の接続のあと、デバイスは connectDelay 秒待ってから要求を送る(7.8.2.7.4)', { spec: ['7.8.2'], kind: ['境界'], req: ['R204'] }, async () => {
    let first = null, hostRef = null;
    const server = await T.listenHost(0, { onRequest: () => { first = first || Date.now(); return {}; } }, h => { hostRef = h; });
    try {
      const device = await T.connectDevice('127.0.0.1', server.address().port, { connectDelay: 0.3 });
      const t0 = Date.now();
      await device.request('EDG', { job: '1' });
      if (first - t0 < 280) throw new Error(`待たずに送った(${first - t0} ms)`);
      device.socket.destroy();
    } finally { if (hostRef) hostRef.socket.destroy(); server.close(); }
  });

  await test('オートコネクト: REQ=CON 以外の UDP パケットではつながない', { spec: ['7.8.2', 'U10'], kind: ['異常'] }, async () => {
    let connected = 0;
    const server = await T.listenDevice(0, opts, d => { connected++; d.socket.destroy(); });
    const udp = await T.listenAutoconnect(0, {}, () => {});
    try {
      const bad = VCA.buildPacket([['REQ', 'EDG'], ['IP', '127.0.0.1'], ['PORT', String(server.address().port)]]);
      await new Promise((res, rej) => {
        const s = require('dgram').createSocket('udp4');
        s.send(Buffer.from(bad, 'latin1'), udp.address().port, '127.0.0.1', e => { s.close(); if (e) rej(e); else res(); });
      });
      await new Promise(r => setTimeout(r, 300));
      if (connected !== 0) throw new Error('つないでしまった');
    } finally { udp.close(); server.close(); }
  });

  await test('オートコネクト: 形の正しくない IP・PORT、送り主と違う IP、allow で断った相手にはつながず、同じ相手には 1 本だけ', { spec: ['U10'], kind: ['異常'], req: ['R201'] }, async () => {
    let connected = 0;
    const server = await T.listenDevice(0, opts, d => { connected++; });
    const devicePort = server.address().port;
    const send = (udpPort, ip, port) => new Promise((res, rej) => {
      const pkt = VCA.buildPacket([['REQ', 'CON'], ['IP', ip], ['PORT', String(port)], ['DEV', 'EDG'], ['VEN', 'GC'], ['MODEL', 'X']]);
      const s = require('dgram').createSocket('udp4');
      s.send(Buffer.from(pkt, 'latin1'), udpPort, '127.0.0.1', e => { s.close(); if (e) rej(e); else res(); });
    });
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const reasons = [];
    const hosts = [];
    const udp = await T.listenAutoconnect(0, { onIgnore: r => reasons.push(r) }, h => hosts.push(h));
    const denied = await T.listenAutoconnect(0, { allow: () => false, onIgnore: r => reasons.push(r) }, h => hosts.push(h));
    try {
      const u = udp.address().port;
      await send(u, 'abc', devicePort);
      await send(u, '127.0.0.1', 0);
      await send(u, '127.0.0.1', 70000);
      await send(u, '10.255.255.1', devicePort);                  // 送り主(127.0.0.1)と違う
      await send(denied.address().port, '127.0.0.1', devicePort);  // allow で断る
      await wait(300);
      if (connected !== 0) throw new Error('つないでしまった');
      await send(u, '127.0.0.1', devicePort);
      await send(u, '127.0.0.1', devicePort);                     // 同じ知らせが 2 回
      await wait(300);
      if (connected !== 1) throw new Error(`接続が ${connected} 本`);
      const want = ['IP が IP アドレスの形ではありません', 'PORT が 1-65535 の整数ではありません', 'PORT が 1-65535 の整数ではありません',
        'IP が UDP の送り主のアドレスと違います', 'allow で断りました', 'すでにつないでいます'];
      if (JSON.stringify(reasons) !== JSON.stringify(want)) throw new Error('理由: ' + JSON.stringify(reasons));
    } finally { hosts.forEach(h => h.socket.destroy()); udp.close(); denied.close(); server.close(); }
  });

  await test('ポートを指定しなければ、デバイスは 50000 で待ち受け、ホストは 50000 へつなぐ(7.8.2.5.2・7.8.2.7.2)', { spec: ['7.8.2'], kind: ['正常'], req: ['R198', 'S060'] }, async () => {
    let device = null;
    const ready = new Promise(res => { device = res; });
    const server = await T.listenDevice(undefined, opts, d => device(d));
    try {
      if (server.address().port !== 50000) throw new Error('待ち受けのポート ' + server.address().port);
      const host = await T.connectHost('127.0.0.1', undefined, { onRequest: () => ({ records: [['DO', 'B']] }) });
      const d = await ready;
      const r = await d.request('EDG', { job: '1' });
      if (VCA.value(r.response, 'DO') !== 'B') throw new Error('つながらない');
      host.socket.destroy();
    } finally { server.close(); }
  });

  await test('標準のポート番号(7.8.2.5)。デバイスのポートの既定は 50000', { spec: ['7.8.2'], kind: ['正常'], req: ['R198', 'R199'] }, async () => {
    if (JSON.stringify(T.PORTS) !== JSON.stringify({ device: 50000, remote: 33512, rendezvous: 33511 })) throw new Error(JSON.stringify(T.PORTS));
  });

  return results;
};
