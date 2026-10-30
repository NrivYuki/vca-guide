// vca-session.js のテスト。偽の時計と、メモリ上でつないだデバイスとホストで確かめる
// ブラウザでは run-tests.html、Node.js では run-node.js から実行する(どちらも Promise で結果を返す)
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory;
  else root.runSessionTests = factory;
})(this, function (VCA, S) {
  const results = [];
  const queue = [];
  // test(名前, { spec: 確かめる対応表の行, kind: 確かめ方, req: 確かめる義務(docs/requirements.md の番号) }, 本体)。tools/trace.js が対応表・義務の一覧と突き合わせる
  function test(name, meta, fn) { queue.push({ name, fn, spec: meta.spec || [], kind: meta.kind || [], req: meta.req || [] }); }
  function eq(a, b, what) {
    const sa = JSON.stringify(a), sb = JSON.stringify(b);
    if (sa !== sb) throw new Error(`${what || '値'}: 期待 ${sb} / 実際 ${sa}`);
  }
  function ok(v, what) { if (!v) throw new Error(what || '条件が偽'); }
  const { FS, GS, ACK, NAK } = VCA.CH;

  // 偽の時計。advance(秒) で時間を進め、その間に期限の来たタイマーを順に動かす
  const flush = async () => { for (let i = 0; i < 50; i++) await Promise.resolve(); };
  function fakeClock() {
    let now = 0, seq = 0;
    const timers = new Map();
    return {
      now: () => now / 1000,
      setTimeout(f, ms) { const id = ++seq; timers.set(id, { t: now + ms, f }); return id; },
      clearTimeout(id) { timers.delete(id); },
      pending: () => timers.size,   // まだ動いていないタイマーの数
      async advance(sec) {
        const end = now + sec * 1000;
        for (;;) {
          await flush();
          let next = null;
          for (const [id, x] of timers) if (x.t <= end && (!next || x.t < next[1].t)) next = [id, x];
          if (!next) break;
          timers.delete(next[0]);
          now = next[1].t;
          next[1].f();
        }
        now = end;
        await flush();
      },
    };
  }

  // デバイスとホストをメモリ上でつなぐ。wire.toHost / wire.toDevice で送られた文字を書き換えたり捨てたりできる
  function pair(deviceOpts, hostOpts) {
    const clock = fakeClock();
    const log = [];        // [向き, 文字列]
    const wire = { toHost: s => s, toDevice: s => s };
    const errors = [];
    let device, host;
    device = S.createDevice(Object.assign({ clock, send: s => {
      log.push(['D', s]);
      const x = wire.toHost(s);
      if (x) Promise.resolve().then(() => host.receive(x));
    } }, deviceOpts));
    host = S.createHost(Object.assign({ clock, firstRequestId: 1000, onError: e => errors.push(e), send: s => {
      log.push(['H', s]);
      const x = wire.toDevice(s);
      if (x) Promise.resolve().then(() => device.receive(x));
    } }, hostOpts));
    // 送られたパケットの最初のレコード(ACK・NAK は文字で)
    const flow = () => log.map(([who, s]) => who + ':' + (s === ACK ? 'ACK' : s === NAK ? 'NAK'
      : VCA.parsePacket(s).records.slice(0, 1).map(r => r.label + '=' + r.fields.join(';')).join('')));
    return { clock, device, host, log, wire, errors, flow };
  }
  // Promise の結果を、時計を進めながら待つ
  async function settle(p, clock, sec) {
    let out;
    p.then(v => { out = { v }; }, e => { out = { e }; });
    await clock.advance(sec === undefined ? 1 : sec);
    if (!out) throw new Error('終わっていません');
    if (out.e) throw out.e;
    return out.v;
  }
  async function rejects(p, clock, sec) {
    let out;
    p.then(v => { out = { v }; }, e => { out = { e }; });
    await clock.advance(sec);
    if (!out) return 'pending';
    if (!out.e) throw new Error('成功してしまいました');
    return out.e.code;
  }
  const trace = ['TRCFMT=1;4;E;R;F', 'R=2500;2400;2500;2400'].map(l => [l.split('=')[0]].concat(l.split('=')[1].split(';')));

  // ---- セッションの手順(7 章) ------------------------------------------------------
  test('アップロード(7.3): 要求 → 応答 → データ → 応答、CRC 付き', { spec: ['7.3-7.4', '6.1.2', '3.4-3.7', '4'], kind: ['正常'], req: ['R152'] }, async () => {
    let got = null;
    const p = pair({ crc: true }, { crc: true, onData: (req, data) => { got = data; return { status: 0 }; } });
    const r = await settle(p.device.request('TRC', { job: '1234', data: trace }), p.clock);
    eq([r.kind, r.status], ['upload', 0]);
    eq(p.flow(), ['D:REQ=TRC', 'H:ACK', 'H:ANS=TRC', 'D:ACK', 'D:ANS=TRC', 'H:ACK', 'H:ANS=TRC', 'D:ACK']);
    eq(got.traces[0].radii, [2500, 2400, 2500, 2400], 'ホストが受け取った玉型');
    ok(p.log.filter(([, s]) => s.length > 1).every(([, s]) => VCA.parsePacket(s).crcOk === true), 'どのパケットにも正しい CRC');
  });

  test('ダウンロード(7.4): 要求 → データ、JOB を確かめる', { spec: ['7.3-7.4', '7.1', '3.4-3.7', '4'], kind: ['正常'], req: ['R161', 'S087'] }, async () => {
    const p = pair({}, { onRequest: () => ({ records: [['DO', 'B'], ['HBOX', '50.00', '50.00']] }) });
    const r = await settle(p.device.request('EDG', { job: '42' }), p.clock);
    eq([r.kind, r.status, VCA.value(r.response, 'JOB'), VCA.number(r.response, 'HBOX', 'L')], ['download', 0, '42', 50]);
    eq(p.flow(), ['D:REQ=EDG', 'H:ACK', 'H:ANS=EDG', 'D:ACK']);
  });

  test('時刻合わせ(TIM、7.4.4)は JOB なし', { spec: ['7.3-7.4'], kind: ['正常'] }, async () => {
    const p = pair({}, { onRequest: () => ({ records: [['TIME', '20070501163330']] }) });
    const r = await settle(p.device.request('TIM'), p.clock);
    eq([VCA.value(r.response, 'TIME'), r.response.rec.JOB], ['20070501163330', undefined]);
  });

  test('レンズ情報の要求(LNF、7.7)は JOB の代わりに OPC が 2 番目', { spec: ['7.7'], kind: ['正常'] }, async () => {
    let req = null;
    const p = pair({}, { onRequest: r => { req = r; return { records: [['LNAM', 'X', 'X']] }; } });
    const r = await settle(p.device.request('LNF', { records: [['OPC', '12345678', '']] }), p.clock);
    eq([req.records.map(x => x.label), req.warnings, VCA.value(r.response, 'LNAM', 'L')], [['REQ', 'OPC'], [], 'X']);
  });

  test('1 つのホストが、初期化・いろいろな要求の種別を続けて受け付ける(8.2)', { spec: ['8.2'], kind: ['正常'], req: ['R205'] }, async () => {
    const p = pair({}, {});
    await settle(p.device.initialize([['DEV', 'EDG'], ['VEN', 'GC'], ['MODEL', 'X']], { tag: 'A', labels: ['HBOX'] }), p.clock);
    for (const t of ['1000', 'EDG', 'TIM', 'INF', 'TRC']) {
      const r = await settle(p.device.request(t, { job: '1', data: trace }), p.clock);
      eq(r.status, 0, t);
    }
    eq(p.errors, []);
  });

  test('作業完了の通知(INF、7.3.5)はホストの確認応答だけ', { spec: ['7.3-7.4'], kind: ['正常'], req: ['R177'] }, async () => {
    let note = null;
    const p = pair({}, { onNotify: req => { note = VCA.value(req, 'JOB'); } });
    const r = await settle(p.device.request('INF', { job: '1234', records: [['STATUS', '0']] }), p.clock);
    eq([r.kind, note, p.flow()], ['notify', '1234', ['D:REQ=INF', 'H:ACK']]);
  });

  test('自動フォーマット初期化(7.2.4 の例 5)と形式の取り決め', { spec: ['7.2.4', '7.2.8', '6.1.3'], kind: ['規格の例'], req: ['R157', 'R165', 'R169', 'R222', 'S039', 'S042', 'S049', 'S093'] }, async () => {
    const p = pair({}, { supports: { trace: { formats: [1, 4] } }, timeoutsForDevice: { ack: 10, packet: 20, char: 8 } });
    const records = [['DEV', 'EDG'], ['VEN', 'GC'], ['MODEL', 'ELITE'], ['TRCFMT', '4', '400', 'E', 'R'], ['TRCFMT', '1', '400', 'E', 'R']];
    const r = await settle(p.device.initialize(records, { tag: 'FIRSTREQ', labels: ['HBOX', 'VBOX', '*CIRC', 'FCRV'] }), p.clock);
    eq([r.status, r.hostStatus, r.requestId], [0, 0, '1000']);
    eq(r.trace, ['4', '400', 'E', 'R'], 'ホストが選んだ形式');
    eq(VCA.autoFormatDefinitions(VCA.parse(p.log[4][1].slice(1, -1))).map(d => d.tag), ['FIRSTREQ'], 'DEF・D・ENDDEF');
    eq(p.device.link.timeouts, { ack: 10, packet: 20, char: 8 }, 'TIMEOUT レコードを受け入れる');
    eq(p.host.requestIds['1000'].kind, 'download');
    // 決まった要求 ID で要求する
    const d = await settle(p.device.request('1000', { job: '7' }), p.clock);
    eq([d.kind, d.status], ['download', 0]);
  });

  test('プリセット初期化だけを受け付けるホストに DEF を送ると、STATUS=13(初期化パケットが不正、7.2.5.3)', { spec: ['7.2.5', '表 A.24-A.26'], kind: ['異常'], req: ['R167'] }, async () => {
    const p = pair({}, { initStatus: 14 });
    const go = (async () => {
      await p.device.link.sendPacket([['REQ', 'INI']]);
      await p.device.link.receivePacket(12);                                      // STATUS=14
      await p.device.link.sendPacket([['ANS', 'INI'], ['DEV', 'EDG'], ['DEF', 'T'], ['D', 'HBOX'], ['ENDDEF', 'T']]);
      return p.device.link.receivePacket(12);
    })();
    const reply = await settle(go, p.clock);
    eq([VCA.number(reply, 'STATUS'), reply.rec.DEF, Object.keys(p.host.requestIds)], [13, undefined, []], '要求 ID は出さない');
  });

  test('プリセット初期化(STATUS=14)では DEF を送らず、DEF=;ID を受け取る(7.2.5)',{ spec: ['7.2.5'], kind: ['正常'], req: ['O042', 'R167'] }, async () => {
    const p = pair({ kind: 'upload' }, { initStatus: 14 });
    const r = await settle(p.device.initialize([['DEV', 'TRC'], ['VEN', 'GC'], ['MODEL', 'FTX'], ['TRCFMT', '1', '400', 'E', 'R']],
      { tag: 'X', labels: ['HBOX'] }), p.clock);
    eq([r.status, r.requestId], [14, '1000']);
    ok(!/DEF=/.test(p.log[4][1]), 'デバイスのデータに DEF が無い');
    ok(/DEF=;1000/.test(p.log[6][1]), 'ホストのデータに DEF=;1000');
    eq(p.host.requestIds['1000'].kind, 'upload', 'トレーサーの要求 ID はアップロード');
    const u = await settle(p.device.request('1000', { job: '1', data: trace }), p.clock);
    eq([u.kind, u.status], ['upload', 0]);
  });

  test('初期化に非対応のホスト(STATUS=15)は最初の応答で終わる(7.2.7)', { spec: ['7.2.1-7.2.3・7.2.6-7.2.7'], kind: ['正常'], req: ['R168'] }, async () => {
    const p = pair({}, { initStatus: 15 });
    const r = await settle(p.device.initialize([['DEV', 'EDG']]), p.clock);
    eq([r.status, p.flow()], [15, ['D:REQ=INI', 'H:ACK', 'H:ANS=INI', 'D:ACK']]);
  });

  test('使える玉型の形式が無ければ STATUS=17 と修飾ビット、要求 ID なし(7.2.8 の例 2)', { spec: ['7.2.8'], kind: ['規格の例', '異常'], req: ['R171'] }, async () => {
    const p = pair({}, { supports: { trace: { formats: [1], points: [512] } } });
    const r = await settle(p.device.initialize([['DEV', 'TRC'], ['TRCFMT', '1', '400', 'E', 'R']]), p.clock);
    eq([r.hostStatus, r.requestId], [529, undefined]);
  });

  test('既定の要求 ID は作った時刻から始まり、再起動しても前の番号に戻らない(7.2.3.3)', { spec: ['7.2.1-7.2.3・7.2.6-7.2.7'], kind: ['正常', '境界'], req: ['R163'] }, async () => {
    const now = Date.now;
    const first = at => {
      Date.now = () => at;
      const clock = fakeClock();
      let host, device;
      device = S.createDevice({ clock, send: s => Promise.resolve().then(() => host.receive(s)) });
      host = S.createHost({ clock, send: s => Promise.resolve().then(() => device.receive(s)) });
      Date.now = now;
      return settle(device.initialize([['DEV', 'EDG']], { tag: 'T', labels: ['HBOX'] }), clock).then(r => +r.requestId);
    };
    try {
      const a = await first(Date.UTC(2026, 0, 1)), b = await first(Date.UTC(2026, 0, 1) + 60000);   // 1 分後に再起動
      ok(a > 1000 && b > a, `${a} → ${b}`);
      eq(b - a, 60, '1 秒に 1 つずつ進む');
    } finally { Date.now = now; }
  });

  test('保守情報(MNT、7.3.6)にもホストは確認応答だけを返す', { spec: ['7.3-7.4'], kind: ['正常'], req: ['R178'] }, async () => {
    let got = null;
    const p = pair({}, { onNotify: req => { got = VCA.value(req, 'REQ'); } });
    const r = await settle(p.device.request('MNT', { records: [['STATUS', '0'], ['DEV', 'GEN'], ['VEN', 'GC'], ['MODEL', 'X'], ['SN', '1'], ['TIME', '20260101000000']] }), p.clock);
    eq([r.kind, got, p.flow()], ['notify', 'MNT', ['D:REQ=MNT', 'H:ACK']]);
  });

  test('知らない要求 ID には STATUS=5、REQ の無いパケットには ANS=ERR と STATUS=18', { spec: ['7.2.1-7.2.3・7.2.6-7.2.7', '7.1'], kind: ['異常'], req: ['R159', 'S043'] }, async () => {
    const p = pair({}, {});
    const r = await settle(p.device.request('5555', { job: '1' }), p.clock);
    eq(r.status, 5);
    p.host.receive(VCA.buildPacket([['JOB', '1']]));
    await p.clock.advance(1);
    const last = p.log.filter(([w]) => w === 'H').pop()[1];
    eq([VCA.value(VCA.parsePacket(last), 'ANS'), VCA.number(VCA.parsePacket(last), 'STATUS')], ['ERR', 18]);
  });

  test('コマンドに対応しないホストは STATUS=16 で、そこで終わる(表 A.24。本文 7.6.2 は 8)', { spec: ['7.6', '表 A.24-A.26'], kind: ['異常'], req: ['R190'] }, async () => {
    const p = pair({}, {});
    const r = await settle(p.device.request('CMD', { job: '1', data: [['ACT', 'NEW']] }), p.clock);
    eq([r.status, r.final], [16, undefined]);
    eq(p.flow(), ['D:REQ=CMD', 'H:ACK', 'H:ANS=CMD', 'D:ACK'], 'データは送らない');
  });

  test('statusCodes で本文どおりの 8 に差し替えられる', { spec: ['7.6'], kind: ['正常'] }, async () => {
    const p = pair({}, { statusCodes: { unsupportedRequest: 8 } });
    eq((await settle(p.device.request('CMD', { job: '1' }), p.clock)).status, 8);
  });

  test('知らない要求種別には STATUS=16、Simulator に合わせるなら 18 に差し替えられる', { spec: ['7.1', '表 A.24-A.26'], kind: ['異常'] }, async () => {
    const a = pair({}, { onRequest: () => { throw new Error('呼ばれてはいけない'); } });
    eq((await settle(a.device.request('XYZ', { job: '9001' }), a.clock)).status, 16);
    eq(a.errors, [], 'onRequest は呼ばない');
    const b = pair({}, { statusCodes: { unknownRequest: 18 } });
    eq((await settle(b.device.request('XYZ', { job: '9001' }), b.clock)).status, 18);
  });

  test('requestTypes に無い要求種別は対応していないものとして STATUS=16', { spec: ['7.1'], kind: ['異常'] }, async () => {
    const p = pair({}, { requestTypes: ['EDG'] });
    eq((await settle(p.device.request('EDG', { job: '1' }), p.clock)).status, 0);
    eq((await settle(p.device.request('GEN', { job: '1' }), p.clock)).status, 16);
    eq((await settle(p.device.request('TRC', { job: '1', data: trace }), p.clock)).status, 16, 'アップロードも');
  });

  test('応答の関数が例外を投げたら STATUS=8(ホストの内部エラー)と説明文を返す', { spec: ['表 A.24-A.26'], kind: ['異常'] }, async () => {
    const p = pair({}, { onRequest: () => { throw new Error('DB に接続できません'); } });
    const r = await settle(p.device.request('EDG', { job: '1' }), p.clock);
    eq([r.status, r.statusText], [8, 'DB に接続できません']);
    eq(p.errors.map(e => e.message), ['DB に接続できません'], 'onError にも知らせる');
    const q = pair({}, { onData: () => { throw new Error('保存に失敗'); } });
    const u = await settle(q.device.request('TRC', { job: '1', data: trace }), q.clock);
    eq([u.status, u.statusText], [8, '保存に失敗'], 'アップロードの最後の応答');
  });

  test('onRequest は STATUS_CODES の名前と説明文で断れる', { spec: ['7.7', '表 A.24-A.26'], kind: ['正常'] }, async () => {
    const p = pair({}, { onRequest: () => ({ status: 'unsupportedRequest', text: 'not supported' }) });
    const r = await settle(p.device.request('LNF', { records: [['OPC', '1', '']] }), p.clock);
    eq([r.status, r.statusText], [16, 'not supported']);
  });

  test('アップロードで最初の応答の STATUS が 0 でなければデータを送らない(7.3.3)', { spec: ['7.3-7.4'], kind: ['異常'], req: ['R190'] }, async () => {
    const p = pair({}, { onRequest: () => ({ status: 1 }) });
    const r = await settle(p.device.request('TRC', { job: '1', data: trace }), p.clock);
    eq([r.status, p.flow()], [1, ['D:REQ=TRC', 'H:ACK', 'H:ANS=TRC', 'D:ACK']]);
  });

  test('応答の JOB が要求と違えば失敗(7.1.6)', { spec: ['7.1'], kind: ['異常'], req: ['R160', 'S086'] }, async () => {
    const p = pair({}, {});
    p.wire.toDevice = s => s.replace('JOB=1\r\n', 'JOB=2\r\n');
    eq(await rejects(p.device.request('EDG', { job: '1' }), p.clock, 1), 'job');
  });

  test('JOB の無い断りの応答は、STATUS を結果に入れて受け取る(JOB の無い成功の応答は失敗)', { spec: ['U6', '7.1'], kind: ['異常', 'Simulator'] }, async () => {
    const p = pair({}, {});
    p.wire.toDevice = s => s.replace('JOB=1\r\n', '');
    const r = await settle(p.device.request('XYZ', { job: '1' }), p.clock);
    eq([r.status, r.jobMissing], [16, true]);
    const q = pair({}, {});
    q.wire.toDevice = s => s.replace('JOB=1\r\n', '');
    eq(await rejects(q.device.request('EDG', { job: '1' }), q.clock, 1), 'job', 'STATUS=0 なのに JOB が無い');
  });

  test('セッションの途中で次の要求は始められない(7.1.3)', { spec: ['7.1'], kind: ['異常'], req: ['R158'] }, async () => {
    const p = pair({}, {});
    const a = p.device.request('EDG', { job: '1' });
    eq(await rejects(p.device.request('EDG', { job: '2' }), p.clock, 0), 'busy');
    await settle(a, p.clock);
  });

  // ---- 確認応答とタイムアウト(6.1.3) ----------------------------------------------------
  test('CRC の誤りには NAK、送り直しで成功する(6.1.3.1)', { spec: ['6.1.3'], kind: ['異常'], req: ['R152', 'R174', 'R180', 'S030'] }, async () => {
    const p = pair({ crc: true }, { crc: true });
    let broken = 2;
    p.wire.toHost = s => (s.length > 1 && broken-- > 0 ? s.replace('JOB=1', 'JOB=9') : s);
    const r = await settle(p.device.request('EDG', { job: '1' }), p.clock);
    eq(r.status, 0);
    eq(p.flow().slice(0, 6), ['D:REQ=EDG', 'H:NAK', 'D:REQ=EDG', 'H:NAK', 'D:REQ=EDG', 'H:ACK']);
  });

  test('NAK が 4 回続いたら中止(送り直しは 3 回まで)', { spec: ['6.1.3'], kind: ['境界'], req: ['R174', 'R180', 'S031'] }, async () => {
    const p = pair({ crc: true }, { crc: true });
    p.wire.toHost = s => (s.length > 1 ? s.replace('JOB=1', 'JOB=9') : s);
    eq(await rejects(p.device.request('EDG', { job: '1' }), p.clock, 1), 'nak');
    eq(p.flow().filter(x => x === 'D:REQ=EDG').length, 4);
  });

  test('確認応答が 6 秒来なければ中止し、送り直さない(6.1.3.2)', { spec: ['6.1.3', '3.4-3.7'], kind: ['境界'], req: ['R001', 'R153'] }, async () => {
    const p = pair({}, {});
    p.wire.toHost = () => null;
    const req = p.device.request('EDG', { job: '1' });
    eq(await rejects(req, p.clock, 5.9), 'pending', '5.9 秒ではまだ待つ');
    await p.clock.advance(0.2);
    eq(p.flow(), ['D:REQ=EDG'], '送り直さない');
    let code = null;
    await req.catch(e => { code = e.code; });
    eq(code, 'ack-timeout');
  });

  test('ACK のあと 12 秒パケットが来なければ中止(6.1.3.3)', { spec: ['6.1.3', '3.4-3.7'], kind: ['境界'], req: ['R001', 'R154', 'S032'] }, async () => {
    const p = pair({}, {});
    p.wire.toDevice = s => (s === ACK ? s : null);   // ホストの ACK だけ届く
    const req = p.device.request('EDG', { job: '1' });
    eq(await rejects(req, p.clock, 11.9), 'pending');
    let code = null;
    req.catch(e => { code = e.code; });
    await p.clock.advance(0.2);
    eq(code, 'packet-timeout');
  });

  test('パケットの途中で 5 秒止まれば中止(6.1.3.4)。そのあともホストは次の要求を受け付ける(8.2)', { spec: ['6.1.3', '3.4-3.7', '8.2'], kind: ['境界', '異常'], req: ['R001', 'R205'] }, async () => {
    const p = pair({}, {});
    p.host.receive(FS + 'REQ=EDG\r\n');
    await p.clock.advance(4.9);
    eq(p.errors.length, 0);
    await p.clock.advance(0.2);
    eq(p.errors.map(e => e.code), ['char-timeout']);
    // そのあとは次の要求を受け付ける
    const r = await settle(p.device.request('EDG', { job: '1' }), p.clock);
    eq(r.status, 0);
  });

  // ---- 規格に書かれていない場面: 送り直しの重複と、パケットの重なり ----------------------------
  // 1 文字目だけを書き換える(ACK・NAK のような 1 文字の送信)
  const changeFirst = (from, to) => { let done = false; return s => (!done && s === from ? (done = true, to) : s); };

  test('ACK が NAK に化けて相手が送り直しても、2 回は処理しない(ダウンロード)', { spec: ['U1'], kind: ['異常'] }, async () => {
    let calls = 0;
    const p = pair({}, { onRequest: () => { calls++; return { records: [['DO', 'B']] }; } });
    p.wire.toDevice = changeFirst(ACK, NAK);
    const r = await settle(p.device.request('EDG', { job: '1' }), p.clock);
    eq([r.status, VCA.value(r.response, 'DO'), calls], [0, 'B', 1]);
    ok(p.host.link.warnings.some(w => w.includes('同じパケット')), 'ホストは重複を捨てた');
    eq(p.flow().filter(x => x === 'D:REQ=EDG').length, 2, 'デバイスは 1 回送り直した');
  });

  test('ACK が NAK に化けても、アップロードのデータは 1 回だけ受け取る', { spec: ['U1'], kind: ['異常'] }, async () => {
    let got = 0;
    const p = pair({}, { onData: () => { got++; return {}; } });
    let n = 0;
    p.wire.toDevice = s => (s === ACK && ++n === 2 ? NAK : s);   // データパケットへの ACK を化けさせる
    const r = await settle(p.device.request('TRC', { job: '1', data: trace }), p.clock);
    eq([r.status, got], [0, 1]);
  });

  test('ACK が相手のパケットより遅れて届いても、取り置いたパケットを受け取れる', { spec: ['U2'], kind: ['異常'] }, async () => {
    const p = pair({}, { onRequest: () => ({ records: [['DO', 'R']] }) });
    let held = false, released = false;
    p.wire.toDevice = s => {
      if (s === ACK && !held) { held = true; return null; }            // 最初の ACK を止めておき
      if (held && !released && s.length > 1) {                          // 応答のパケットのあとに届ける
        released = true;
        Promise.resolve().then(() => Promise.resolve()).then(() => p.device.receive(ACK));
      }
      return s;
    };
    const r = await settle(p.device.request('EDG', { job: '1' }), p.clock);
    eq([r.status, VCA.value(r.response, 'DO')], [0, 'R']);
  });

  test('前のセッションと同じ要求を続けて送っても、重複とはみなさない', { spec: ['U1'], kind: ['境界'] }, async () => {
    let calls = 0;
    const p = pair({}, { onRequest: () => { calls++; return { records: [['TIME', '20260101000000']] }; } });
    await settle(p.device.request('TIM'), p.clock);
    await settle(p.device.request('TIM'), p.clock);
    eq(calls, 2);
  });

  test('確認応答が ACK でも NAK でもなければ、待たずに中止する(6.1.3.1 の注記)', { spec: ['U11', '6.1.3'], kind: ['異常'] }, async () => {
    const p = pair({}, {});
    p.wire.toDevice = changeFirst(ACK, 'X');
    eq(await rejects(p.device.request('EDG', { job: '1' }), p.clock, 0.1), 'bad-confirmation');
  });

  test('ACK の前に相手のパケットが届き、ACK が来ないままなら同期ずれ(STATUS=12)で中止', { spec: ['U2', 'U3'], kind: ['異常'] }, async () => {
    const p = pair({}, {});
    p.wire.toDevice = changeFirst(ACK, null);   // 要求への ACK だけが届かない
    const req = p.device.request('EDG', { job: '1' });
    let code = null;
    req.catch(e => { code = e.code; });
    await p.clock.advance(6.1);
    eq(code, 'out-of-sync');
    const last = p.log.filter(([w]) => w === 'D').pop()[1];
    eq(VCA.number(VCA.parsePacket(last), 'STATUS'), 12, 'デバイスは STATUS=12 を送った');
    eq(p.errors, [], 'ホストは中止の知らせを受け取るだけ');
  });

  test('応答の種類が要求と違えば同期ずれ(STATUS=12)で中止', { spec: ['U3'], kind: ['異常'], req: ['S102'] }, async () => {
    const p = pair({}, {});
    p.wire.toDevice = s => s.replace('ANS=EDG', 'ANS=GEN');
    eq(await rejects(p.device.request('EDG', { job: '1' }), p.clock, 1), 'out-of-sync');
    ok(p.log.some(([w, s]) => w === 'D' && /STATUS=12/.test(s)), 'STATUS=12 を送った');
  });

  test('アップロードのデータの代わりに別の要求が届いたら、ホストは STATUS=12 を返して中止', { spec: ['U3'], kind: ['異常'] }, async () => {
    const p = pair({}, {});
    const go = (async () => {
      await p.device.link.sendPacket([['REQ', 'TRC'], ['JOB', '1']]);
      await p.device.link.receivePacket(12);                          // 最初の応答
      await p.device.link.sendPacket([['REQ', 'EDG'], ['JOB', '2']]); // データではなく別の要求
      return p.device.link.receivePacket(12);
    })();
    const reply = await settle(go, p.clock);
    eq([VCA.value(reply, 'ANS'), VCA.number(reply, 'STATUS')], ['TRC', 12]);
    eq(p.errors.map(e => e.code), ['out-of-sync']);
  });

  // ---- 切断・長すぎるパケット・再同期 --------------------------------------------------
  // 送ったものを捨てる相手(確認応答を返さない)と、ひとりでつなぐ
  const lone = o => { const clock = fakeClock(), sent = []; return { clock, sent, link: S.createLink(Object.assign({ clock, send: s => sent.push(s) }, o)) }; };

  test('確認応答を待つ間に切断されたら、タイムアウトを待たずに closed で失敗し、タイマーも残らない', { spec: ['U7'], kind: ['異常'] }, async () => {
    const { clock, link } = lone();
    let code = null, count = 0;
    link.sendPacket([['REQ', 'EDG'], ['JOB', '1']]).catch(e => { code = e.code; count++; });
    await clock.advance(1);
    link.close();
    await clock.advance(0);
    eq([code, clock.pending()], ['closed', 0], '1 秒の時点ですぐ失敗');
    await clock.advance(10);
    eq(count, 1, 'タイムアウトで二度失敗しない');
    eq(await rejects(link.sendPacket([['REQ', 'EDG']]), clock, 0), 'closed', '閉じたあとの送信');
  });

  test('切断とタイムアウトが重なっても、失敗は 1 回だけ', { spec: ['U7'], kind: ['境界'] }, async () => {
    const { clock, link } = lone();
    const codes = [];
    link.sendPacket([['REQ', 'EDG']]).catch(e => codes.push(e.code));
    await clock.advance(6);       // ここでタイムアウト
    link.close();                 // そのあとに切断
    await clock.advance(1);
    eq(codes, ['ack-timeout']);
    const b = lone(), codes2 = [];
    b.link.receivePacket(12).catch(e => codes2.push(e.code));
    b.link.close();               // 先に切断
    await b.clock.advance(20);
    eq([codes2, b.clock.pending()], [['closed'], 0], '受信待ちも');
  });

  test('長すぎるパケットは読み捨てて too-large で知らせ、GS で NAK を返し、次のパケットは読める', { spec: ['U8'], kind: ['境界', '異常'] }, async () => {
    const { clock, link, sent } = lone({ maxPacket: 50 });
    let code = null;
    link.receivePacket(12).catch(e => { code = e.code; });
    link.receive(FS + 'REM=' + 'x'.repeat(100));
    await clock.advance(0);
    eq(code, 'too-large');
    link.receive('y'.repeat(100) + GS);
    eq(sent, [NAK], '終わりの GS で NAK');
    const next = link.receivePacket(12);
    link.receive(VCA.buildPacket([['REQ', 'TIM']]));
    eq(VCA.value(await settle(next, clock), 'REQ'), 'TIM', '再同期して次のパケットを読む');
    ok(link.warnings.some(w => w.includes('読み捨て')));
    // 読み捨ての途中で止まっても、文字間タイムアウトとして二度は知らせない
    const errors = [];
    const b = lone({ maxPacket: 50, onError: e => errors.push(e.code) });
    b.link.receive(FS + 'x'.repeat(100));
    await b.clock.advance(6);
    eq([errors, b.clock.pending()], [['too-large'], 0]);
  });

  test('GS で終わらないまま次の FS が来たら、前のパケットを捨てて読み直す(再同期)', { spec: ['U9'], kind: ['異常'] }, async () => {
    const { clock, link, sent } = lone();
    const p = link.receivePacket(12);
    link.receive(FS + 'REQ=EDG\r\nJOB=1\r\n');                        // GS が失われた
    link.receive(VCA.buildPacket([['REQ', 'TIM']]));
    eq(VCA.value(await settle(p, clock), 'REQ'), 'TIM');
    eq(sent, [ACK]);
    ok(link.warnings.some(w => w.includes('GS で終わらない')));
  });

  test('両側が同時に STATUS=12 を送っても、繰り返さずに終わる', { spec: ['U3'], kind: ['境界'] }, async () => {
    const clock = fakeClock();
    let a, b;
    const sent = [];
    a = S.createLink({ clock, send: s => { sent.push(s); Promise.resolve().then(() => b.receive(s)); } });
    b = S.createLink({ clock, send: s => { sent.push(s); Promise.resolve().then(() => a.receive(s)); } });
    const stop = [['ANS', 'EDG'], ['STATUS', '12']];
    const both = Promise.all([a.sendPacket(stop, { quiet: true }), b.sendPacket(stop, { quiet: true })]);
    eq(await settle(both, clock), [1, 1]);
    eq(sent.length, 4, '各自のパケットと ACK だけ');
    // 相手の STATUS=12 は捨てられ、次のパケットとして残っていない
    eq(await rejects(a.receivePacket(1), clock, 1.1), 'packet-timeout', '古いパケットが残っていない');
  });

  test('相手のパケットを取り置いたあとに NAK が来たら、送り直さず同期ずれで中止', { spec: ['U2', 'U3'], kind: ['異常'] }, async () => {
    const p = pair({}, {});
    // 要求への ACK を、応答のパケットのあとに NAK として届ける
    let held = false, released = false;
    p.wire.toDevice = s => {
      if (s === ACK && !held) { held = true; return null; }
      if (held && !released && s.length > 1) {
        released = true;
        Promise.resolve().then(() => Promise.resolve()).then(() => p.device.receive(NAK));
      }
      return s;
    };
    eq(await rejects(p.device.request('EDG', { job: '1' }), p.clock, 0.5), 'out-of-sync');
    eq(p.flow().filter(x => x === 'D:REQ=EDG').length, 1, '送り直していない');
  });

  test('CRC の付いたパケットへの応答には CRC を付ける(6.1.2.1)', { spec: ['6.1.2'], kind: ['正常', '境界'], req: ['S029'] }, async () => {
    const hostCrc = async deviceOpts => {
      const p = pair(deviceOpts, { onRequest: () => ({ records: [['HBOX', '50', '50']] }) });
      await settle(p.device.request('EDG', { job: '1' }), p.clock);
      return p.log.filter(([who, s]) => who === 'H' && s.length > 1).map(([, s]) => s.includes('CRC='));
    };
    eq(await hostCrc({ crc: true }), [true], 'デバイスが CRC を付ければ、ホストのデータパケットにも付く');
    eq(await hostCrc({}), [false], 'どちらも付けなければ付かない');
  });

  test('TIMEOUT の値が 2-255 秒の範囲外なら、その値は受け入れない(6.1.3.5)', { spec: ['6.1.3', '7.2.1-7.2.3・7.2.6-7.2.7'], kind: ['境界'], req: ['R155', 'R232'] }, async () => {
    const p = pair({}, { timeoutsForDevice: { ack: 1, packet: 256, char: 9 } });
    await settle(p.device.initialize([['DEV', 'EDG']], { tag: 'A', labels: ['HBOX'] }), p.clock);
    eq(p.device.link.timeouts, { ack: 6, packet: 12, char: 9 });
  });

  test('初期化のデータに DEV・VEN・MODEL を入れ、ラベル一覧に R・A・Z・ZA やインターフェイスレコードを入れない(7.2.4.2・7.2.4.5・7.2.5.2)', { spec: ['7.2.4', '7.2.5'], kind: ['正常', '異常'], req: ['S048', 'S050', 'S051'] }, async () => {
    const init = async (records, labels) => {
      const p = pair({}, {});
      return (await settle(p.device.initialize(records, { tag: 'T', labels }), p.clock)).warnings;
    };
    const dev = [['DEV', 'EDG'], ['VEN', 'GC'], ['MODEL', 'X']];
    eq(await init(dev, ['HBOX', '*CIRC']), []);
    eq(await init([['DEV', 'EDG']], ['HBOX']), ['初期化のデータに VEN・MODEL がありません(7.2.5.2)']);
    eq(await init(dev, ['HBOX', 'R', '*A', 'ZA']), ['ラベル一覧に R・A・ZA があります。玉型のレコードは TRCFMT・ZFMT で決まります(7.2.4.2)']);
    eq(await init(dev, ['HBOX', 'DO', 'TRCFMT']), ['ラベル一覧にインターフェイスレコード DO・TRCFMT があります(7.2.4.5)']);
  });

  test('初期化に ACT があれば、ホストはできる操作を ACT で返す(7.6.3)', { spec: ['7.6'], kind: ['正常', '異常'], req: ['R191', 'S055'] }, async () => {
    const records = [['DEV', 'EDG'], ['VEN', 'GC'], ['MODEL', 'X'], ['ACT', 'NEW', 'MERGE', 'DELETE']];
    const p = pair({}, { actions: ['NEW', 'MERGE'] });
    const r = await settle(p.device.initialize(records, { tag: 'T', labels: ['HBOX'] }), p.clock);
    eq([r.actions, r.warnings], [['NEW', 'MERGE'], []]);
    const q = pair({}, {});
    const s = await settle(q.device.initialize(records, { tag: 'T', labels: ['HBOX'] }), q.clock);
    eq([s.actions, s.warnings], [undefined, ['ホストが ACT を返しませんでした(7.6.3)']], 'actions の無いホスト');
    const u = pair({}, { actions: ['NEW'] });
    const v = await settle(u.device.initialize([['DEV', 'EDG'], ['VEN', 'GC'], ['MODEL', 'X']], { tag: 'T', labels: ['HBOX'] }), u.clock);
    eq([v.actions, v.warnings], [undefined, []], 'ACT を送らなければ返さない');
  });

  test('DRLFMT を取り決めた要求 ID には DRILL を送らない(5.5.1.5)', { spec: ['5.5'], kind: ['正常', '異常'], req: ['R048', 'R049'] }, async () => {
    const onRequest = () => ({ records: [['DRILL', 'B', '-17.0', '10.32', '2.3'], ['DRILLE', 'B', 'C', '-17.0', '10.32'], ['HBOX', '50', '50']] });
    const run = async (supports, records) => {
      const p = pair({}, { supports, onRequest });
      const r = await settle(p.device.initialize([['DEV', 'DRL']].concat(records), { tag: 'T', labels: ['DRILL', 'DRILLE', 'HBOX'] }), p.clock);
      const d = await settle(p.device.request(r.requestId, { job: '1' }), p.clock);
      return [r.drill, Object.keys(d.response.all).filter(l => /^DRILL/.test(l))];
    };
    eq(await run({ drill: ['C'] }, [['DRLFMT', 'C']]), ['C', ['DRILLE']], '取り決めたら DRILL を外す');
    eq(await run({}, [['DRLFMT', 'C']]), [undefined, ['DRILL', 'DRILLE']], '取り決めていなければそのまま');
  });

  test('自動フォーマット初期化の D レコードは 80 文字ごとに分ける(7.2.4.1)', { spec: ['7.2.4'], kind: ['境界'], req: ['R223'] }, async () => {
    const p = pair({}, {});
    const labels = ['FRNT', 'BACK', 'GBASE', 'GCROS', 'GAX', 'GBASEX', 'GCROSX', 'SAGRD', 'SAGBD', 'SAGCD', 'TIND', 'RNGH',
      'RNGD', 'GTHK', 'LMATID', 'LAPM', 'DIA', 'BCTHK', 'BETHK', 'CRIB', 'GPRVA', 'GPRVM', 'KPRVA', 'KPRVM', 'PIND'];
    await settle(p.device.initialize([['DEV', 'GEN']], { tag: 'MYREQUEST', labels }), p.clock);
    const d = VCA.parse(p.log[4][1].slice(1, -1)).all.D;
    ok(d.length >= 2, 'D が複数');
    ok(d.every(f => f.join(';').length <= 80), 'どれも 80 文字以内');
    eq(d.reduce((a, f) => a.concat(f), []), labels, 'ラベルの並びは変わらない');
    const lines = p.log[4][1].slice(1, -1).split(/\r?\n/).map(l => l.split('=')[0]);
    const at = lines.indexOf('DEF');
    eq(lines.slice(at, at + d.length + 2), ['DEF'].concat(d.map(() => 'D'), ['ENDDEF']), 'D は DEF の直後(表 A.2)');
  });

  test('タイムアウトを短くすると、その秒数で中止する(TIMEOUT、6.1.3.5)', { spec: ['6.1.3'], kind: ['正常'] }, async () => {
    const p = pair({ timeouts: { ack: 2 } }, {});
    p.wire.toHost = () => null;
    eq(await rejects(p.device.request('EDG', { job: '1' }), p.clock, 2.1), 'ack-timeout');
  });

  test('TCP の接続のあと、デバイスは 3 秒待ってから要求を送る(7.8.2.7.4)', { spec: ['7.8.2'], kind: ['境界'], req: ['R204'] }, async () => {
    const p = pair({}, {});
    p.device.connected();
    const req = p.device.request('EDG', { job: '1' });
    await p.clock.advance(2.9);
    eq(p.log.length, 0, '3 秒より前は何も送らない');
    await settle(req, p.clock, 0.2);
  });

  test('オートコネクトのパケット(7.8.2.7.1)', { spec: ['7.8.2'], kind: ['正常'], req: ['R201'] }, () => {
    const d = VCA.parsePacket(S.autoconnectPacket({ ip: '169.254.1.1', port: 50000, dev: 'GEN', ven: 'GC', model: 'FERRET', sn: '12345' }));
    eq(d.records.map(r => r.label), ['REQ', 'IP', 'PORT', 'DEV', 'VEN', 'MODEL', 'SN']);
    eq(d.warnings, []);
  });

  // ---- 実行 ---------------------------------------------------------------------
  return (async () => {
    for (const t of queue) {
      const info = { name: t.name, spec: t.spec, kind: t.kind, req: t.req };
      try { await t.fn(); results.push(Object.assign({ ok: true }, info)); }
      catch (e) { results.push(Object.assign({ ok: false, msg: e.message }, info)); }
    }
    return results;
  })();
});
