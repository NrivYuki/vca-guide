// DCS Host Simulator(The Vision Council)と照合する: vca-session.js の createDevice で Simulator につなぎ、
// いくつかの場面を試して、結果を表示する。
//
// 使い方:
//   1. DCS Host Simulator を TCP で待ち受けさせる(DCS.INI の [Settings] に Mode=IP、RemotePort=33512)
//   2. node tools/sim-check.js [やり取りの記録を書くファイル]
//
// Simulator は The Vision Council から各自で入手する(配布はできない)。やり取りの記録には Simulator の試験用の
// ジョブのデータが入るので、リポジトリに入れないこと。結果の要約は docs/conformance.md にある。
// Simulator はホスト役だけなので、確かめられるのはデバイス側(createDevice)とパーサー。
'use strict';
const net = require('net');
const fs = require('fs');
const VCA = require('../src/vca-parser.js');
const { createDevice } = require('../src/vca-session.js');

const PORT = 33512;
const out = [];
const show = s => s.replace(/[\x00-\x1f]/g, c => ({ '\x1c': '<FS>', '\x1d': '<GS>', '\x1e': '<RS>', '\x06': '<ACK>',
  '\x15': '<NAK>', '\r': '<CR>', '\n': '<LF>\n' }[c] || `<${c.charCodeAt(0).toString(16)}>`));

// 自分の TCP の部品は使わず、送受信を記録できるようにつなぐ。接続のあと 3 秒待つ(7.8.2.7.4)
function connect(opts) {
  return new Promise((resolve, reject) => {
    const log = [];
    const socket = net.connect(PORT, '127.0.0.1', () => {
      const device = createDevice(Object.assign({}, opts, {
        send: s => { log.push(['D', s]); socket.write(Buffer.from(s, 'latin1')); },
      }));
      socket.on('data', b => { const s = b.toString('latin1'); log.push(['H', s]); device.receive(s); });
      socket.on('close', () => device.close());
      device.connected(3);
      resolve({ device, socket, log });
    });
    socket.once('error', reject);
  });
}

async function scenario(name, opts, fn) {
  const c = await connect(opts);
  const rec = { name, ok: true };
  try { rec.result = await fn(c.device); } catch (e) { rec.ok = false; rec.error = `${e.code || ''} ${e.message}`; }
  rec.linkWarnings = c.device.link.warnings.slice();
  rec.traffic = c.log.map(([w, s]) => w + ': ' + show(s));
  c.socket.destroy();
  out.push(rec);
  const r = rec.result || {}, resp = (r.download && r.download.response) || r.response || {};
  console.log(`${rec.ok ? '○' : '×'} ${name}${rec.ok ? '' : ' -- ' + rec.error}`);
  if (rec.ok) {
    const st = r.status !== undefined ? r.status : (r.download || {}).status;
    console.log(`   STATUS ${st}${r.jobMissing ? '(JOB なし)' : ''}  玉型 ${JSON.stringify((resp.traces || []).map(t => `${t.eye}:${t.got}/${t.n}点 形式${t.fmt}`))}`);
    if ((resp.warnings || []).length) console.log(`   警告 ${resp.warnings.join(' / ')}`);
    if ((resp.unknown || []).length) console.log(`   知らないラベル ${resp.unknown.join(' ')}`);
    if ((resp.sizing || []).length) console.log(`   寸法 ${resp.sizing.join(' / ')}`);
  }
  if (rec.linkWarnings.length) console.log(`   通信 ${rec.linkWarnings.join(' / ')}`);
  await new Promise(res => setTimeout(res, 500));
}

const summary = d => d && ({
  first: d.records[0] && d.records[0].label + '=' + d.records[0].fields.join(';'),
  status: d.rec.STATUS, warnings: d.warnings, unknown: d.unknown,
  traces: d.traces.map(t => ({ eye: t.eye, fmt: t.fmt, n: t.n, got: (t.radii || []).length, mode: t.mode })),
  sizing: VCA.checkSizing(d).warnings,
});
const INFO = [['DEV', 'EDG'], ['VEN', 'TST'], ['MODEL', 'T1']];
const init = async (dev, extra, def) => {
  const r = await dev.initialize(INFO.concat(extra || []), def);
  return { status: r.status, hostStatus: r.hostStatus, requestId: r.requestId, trace: r.trace, host: summary(r.host) };
};
const dl = async (dev, type, job, records) => {
  const r = await dev.request(type, { job, records });
  return { status: r.status, statusText: r.statusText, jobMissing: r.jobMissing, response: summary(r.response) };
};

(async () => {
  for (const crc of [true, false]) {
    await scenario(`初期化(自動フォーマット、CRC ${crc ? 'あり' : 'なし'})`, { crc },
      d => init(d, [['TRCFMT', '1', '400', 'E', 'R', 'F']], { tag: 'T', labels: ['HBOX', 'VBOX', 'CIRC', 'DBL', 'IPD', 'FCRV', 'ETYP'] }));
  }
  await scenario('初期化(プリセット、DEF なし)', { crc: true }, d => init(d, [['TRCFMT', '1', '400', 'E', 'R', 'F']]));
  await scenario('初期化 → 要求 ID でダウンロード(形式 1)', { crc: true }, async d => {
    const i = await init(d, [['TRCFMT', '1', '400', 'E', 'R', 'F']], { tag: 'T', labels: ['HBOX', 'VBOX', 'DBL'] });
    return { init: i, download: i.requestId ? await dl(d, i.requestId, '9001') : null };
  });
  for (let k = 1; k <= 5; k++) {
    // Simulator は行末・空白・REM をランダムに変えて送るので、何回か繰り返す
    await scenario(`EDG ダウンロード ${k} 回目(初期化なし、ジョブ 9001)`, { crc: true }, d => dl(d, 'EDG', '9001'));
  }
  await scenario('EDG ダウンロード(要求に TRCFMT=4)', { crc: true }, d => dl(d, 'EDG', '9001', [['TRCFMT', '4', '400', 'E', 'R', 'F']]));
  await scenario('ないジョブ(9999)', { crc: true }, d => dl(d, 'EDG', '9999'));
  await scenario('TIM', { crc: true }, d => dl(d, 'TIM'));
  await scenario('TRC アップロード', { crc: true }, async d => {
    const recs = VCA.datasetRecords({ fmt: 1, values: Array(360).fill(2500), eye: 'R' });
    const r = await d.request('TRC', { job: '7001', data: recs.concat([['HBOX', '50.00'], ['VBOX', '50.00']]) });
    return { status: r.status, statusText: r.statusText, response: summary(r.response), final: summary(r.final) };
  });
  await scenario('INF(作業完了)', { crc: true }, d => d.request('INF', { job: '9001', records: [['STATUS', '0']] }));
  await scenario('知らない要求(XYZ)', { crc: true }, d => dl(d, 'XYZ', '9001'));
  await scenario('CMD', { crc: true }, d => dl(d, 'CMD', '9001'));
  if (process.argv[2]) { fs.writeFileSync(process.argv[2], JSON.stringify(out, null, 1)); console.log('記録:', process.argv[2]); }
  process.exitCode = out.every(r => r.ok) ? 0 : 1;
})().catch(e => { console.error(e.message); process.exitCode = 1; });
