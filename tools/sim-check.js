// DCS Host Simulator(The Vision Council)と照合する: vca-session.js の createDevice で Simulator につなぎ、
// いくつかの場面を試して、規格から決めた期待値と照らし合わせる。
//
// 使い方:
//   1. DCS Host Simulator を TCP で待ち受けさせる(DCS.INI の [Settings] に Mode=IP、RemotePort=33512)
//   2. node tools/sim-check.js [やり取りの記録を書くファイル]
//
// 期待値は 2 種類ある。
//   このリポジトリ側: createDevice とパーサーが規格どおりに受け取れたか。外れたら × にし、終了コードを 1 にする
//   Simulator 側: Simulator が規格どおりに送ったか。外れたら △ にして表示する(docs/conformance.md に書いた不整合)
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

// fn は (device, check, received) を受け取る。check(このリポジトリ側か, 合っているか, 期待したこと)。
// received() は Simulator から受け取った文字列すべて
async function scenario(name, opts, fn) {
  const c = await connect(opts);
  const rec = { name, ok: true, checks: [] };
  const check = (guide, pass, text) => rec.checks.push({ side: guide ? 'guide' : 'sim', pass: !!pass, text });
  try { rec.result = await fn(c.device, check, () => c.log.filter(x => x[0] === 'H').map(x => x[1]).join('')); } catch (e) { rec.ok = false; rec.error = `${e.code || ''} ${e.message}`; }
  if (rec.checks.some(k => k.side === 'guide' && !k.pass)) rec.ok = false;
  rec.linkWarnings = c.device.link.warnings.slice();
  rec.traffic = c.log.map(([w, s]) => w + ': ' + show(s));
  c.socket.destroy();
  out.push(rec);
  const r = rec.result || {}, resp = (r.download && r.download.response) || r.response || {};
  const simNg = rec.checks.some(k => k.side === 'sim' && !k.pass);
  console.log(`${!rec.ok ? '×' : simNg ? '△' : '○'} ${name}${rec.error ? ' -- ' + rec.error : ''}`);
  for (const k of rec.checks) if (!k.pass) console.log(`   ${k.side === 'guide' ? '× このリポジトリ' : '△ Simulator'}: ${k.text}`);
  if (!rec.error) {
    const st = r.status !== undefined ? r.status : (r.download || {}).status;
    console.log(`   STATUS ${st}${r.jobMissing ? '(JOB なし)' : ''}  玉型 ${JSON.stringify((resp.traces || []).map(t => `${t.eye}:${t.got}/${t.n}点 形式${t.fmt}`))}`);
    if ((resp.warnings || []).length) console.log(`   警告 ${resp.warnings.join(' / ')}`);
    if ((resp.unknown || []).length) console.log(`   知らないラベル ${resp.unknown.join(' ')}`);
    if ((resp.sizing || []).length) console.log(`   寸法 ${resp.sizing.join(' / ')}`);
  }
  if (rec.linkWarnings.length) console.log(`   通信 ${rec.linkWarnings.join(' / ')}`);
  // Simulator は接続が閉じたあと、待ち受けを開き直すまでに 2 秒近くかかる。その間につなぐと、すぐ切られる
  await new Promise(res => setTimeout(res, 3000));
}

const summary = d => d && ({
  first: d.records[0] && d.records[0].label + '=' + d.records[0].fields.join(';'),
  job: d.rec.JOB && d.rec.JOB[0], status: d.rec.STATUS, warnings: [...new Set(d.warnings)], unknown: d.unknown,
  traces: d.traces.map(t => ({ eye: t.eye, fmt: t.fmt, n: t.n, got: (t.radii || []).length, mode: t.mode })),
  sizing: VCA.checkSizing(d).warnings,
  // REM を除いたレコードの一覧(並びは問わない)。行末・空白・引用符・REM を変えて送られても同じになるはず。
  // STATUS の説明文は省いてよい欄なので(A.4)、番号だけ比べる
  content: d.records.filter(x => x.label !== 'REM')
    .map(x => x.label + '=' + (x.label === 'STATUS' ? x.fields.slice(0, 1) : x.fields).join(';')).sort().join('\n'),
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

// 受け取った文字列で、TRCFMT のあとに REM を除いて最初に来るレコードのラベル(5.4.5 では R)。
// パーサーは玉型の見出しをデータセットにまとめるので、並びは受け取った文字列から読む
function afterTrcfmt(text) {
  const labels = text.split(/[\r\n\x1c\x1d\x1e]+/).map(l => l.split('=')[0].trim().toUpperCase()).filter(Boolean);
  const i = labels.indexOf('TRCFMT');
  return i < 0 ? null : labels.slice(i + 1).find(l => l !== 'REM') || '';
}

// 求めた TRCFMT のとおりの玉型を、点をすべて読めたか(5.4.1・5.4.13)
function traceChecks(check, r, fmt, n) {
  const t = (r.response || {}).traces || [];
  check(false, t.length > 0, `要求した玉型を送る(5.4.1)`);
  for (const x of t) {
    check(false, x.fmt === fmt && x.n === n, `${x.eye} の玉型が形式 ${fmt}・${n} 点(5.4.13。実際は形式 ${x.fmt}・${x.n} 点)`);
    check(true, x.got === x.n, `${x.eye} の玉型の点をすべて読める(${x.got}/${x.n})`);
  }
}

(async () => {
  const TRC1 = ['TRCFMT', '1', '400', 'E', 'R', 'F'];
  for (const crc of [true, false]) {
    await scenario(`初期化(自動フォーマット、CRC ${crc ? 'あり' : 'なし'})`, { crc }, async (d, check) => {
      const r = await init(d, [TRC1], { tag: 'T', labels: ['HBOX', 'VBOX', 'CIRC', 'DBL', 'IPD', 'FCRV', 'ETYP'] });
      check(false, r.status === 0, `STATUS=0(表 A.24。実際は ${r.status})`);
      check(true, r.trace && r.trace[0] === '1' && r.trace[1] === '400', `デバイスが示した TRCFMT=1;400 に決まる(5.4.1)`);
      check(true, !!r.requestId, `DEF で求めた要求 ID を受け取る`);
      return r;
    });
  }
  await scenario('初期化(プリセット、DEF なし)', { crc: true }, async (d, check) => {
    const r = await init(d, [TRC1]);
    check(false, r.status === 0, `STATUS=0(表 A.24。実際は ${r.status})`);
    return r;
  });
  await scenario('初期化 → 要求 ID でダウンロード(形式 1)', { crc: true }, async (d, check) => {
    const i = await init(d, [TRC1], { tag: 'T', labels: ['HBOX', 'VBOX', 'DBL'] });
    check(true, !!i.requestId, `要求 ID を受け取る`);
    const r = i.requestId ? await dl(d, i.requestId, '9001') : null;
    if (r) {
      check(false, r.status === 0, `STATUS=0(実際は ${r.status})`);
      traceChecks(check, r, 1, 400);
    }
    return { init: i, download: r };
  });
  // Simulator は行末・空白・引用符・REM をランダムに変えて送るので、何回か繰り返し、どれも同じ中身に読めるか確かめる
  let first = null;
  for (let k = 1; k <= 5; k++) {
    await scenario(`EDG ダウンロード ${k} 回目(初期化なし、ジョブ 9001)`, { crc: true }, async (d, check) => {
      const r = await dl(d, 'EDG', '9001');
      const resp = r.response || {};
      check(false, r.status === 0, `STATUS=0(実際は ${r.status})`);
      check(true, resp.job === '9001', `JOB=9001 を読める(7.1.6)`);
      // TRCFMT を入れない要求は、玉型を求めない(5.4.1)
      check(false, (resp.traces || []).length === 0, `TRCFMT の無い要求には玉型を送らない(5.4.1)`);
      if (first === null) first = resp.content;
      else check(true, resp.content === first, `1 回目と同じ中身に読める(5.1・6.2.2・表 A.2 の REM)`);
      return r;
    });
  }
  await scenario('EDG ダウンロード(要求に TRCFMT=4)', { crc: true }, async (d, check) => {
    const r = await dl(d, 'EDG', '9001', [['TRCFMT', '4', '400', 'E', 'R', 'F']]);
    check(false, r.status === 0, `STATUS=0(実際は ${r.status})`);
    traceChecks(check, r, 4, 400);
    const sizing = (r.response || {}).sizing || [];
    check(false, !sizing.some(s => /^(HBOX|VBOX)/.test(s)), `HBOX・VBOX が玉型の外接の箱と合う(表 A.1)`);
    check(false, !sizing.some(s => /^CIRC/.test(s)), `CIRC が玉型の周長と合う(表 A.1)`);
    return r;
  });
  // 両眼で同じ玉型のジョブ。データの TRCFMT の眼は R か L にする(5.4.12.3)。R の行は TRCFMT の直後に置く(5.4.5)
  for (const eye of ['R', 'B']) {
    await scenario(`EDG ダウンロード(ジョブ 9101、要求の TRCFMT の眼 ${eye})`, { crc: true }, async (d, check, received) => {
      const r = await dl(d, 'EDG', '9101', [['TRCFMT', '1', '400', 'E', eye, 'F']]);
      const resp = r.response || {}, w = (resp.warnings || []).join('\n'), next = afterTrcfmt(received());
      check(false, r.status === 0, `STATUS=0(実際は ${r.status})`);
      check(false, next === 'R', `R の行を TRCFMT の直後に置く(5.4.5。実際は ${next || 'なし'})`);
      if (next === 'R') {
        traceChecks(check, r, 1, 400);
        const eyes = (resp.traces || []).map(t => t.eye);
        check(false, !eyes.includes('B'), `データの TRCFMT の眼は R・L に分ける(5.4.12.3)`);
        check(true, !eyes.includes('B') || /5\.4\.12\.3/.test(w), `眼 B のデータには警告を出す(5.4.12.3)`);
      } else {
        check(true, (resp.traces || []).length === 0, `見出しの直後に無い R の行は玉型として扱わない(5.4.5)`);
        check(true, /R が対応する見出し/.test(w), `見出しの直後に無い R の行には警告を出す(5.4.5)`);
        check(true, /TRCFMT=.*玉型のデータがありません/.test(w), `データの無い TRCFMT には警告を出す(5.4.1・5.4.5)`);
      }
      return r;
    });
  }
  await scenario('ないジョブ(9999)', { crc: true }, async (d, check) => {
    const r = await dl(d, 'EDG', '9999');
    check(false, r.status === 1, `STATUS=1(表 A.24 の Job not found。実際は ${r.status})`);
    return r;
  });
  await scenario('TIM', { crc: true }, async (d, check) => {
    const r = await dl(d, 'TIM');
    check(false, r.status === 0, `STATUS=0(実際は ${r.status})`);
    return r;
  });
  await scenario('TRC アップロード', { crc: true }, async (d, check) => {
    const recs = VCA.datasetRecords({ fmt: 1, values: Array(360).fill(2500), eye: 'R' });
    const r = await d.request('TRC', { job: '7001', data: recs.concat([['HBOX', '50.00'], ['VBOX', '50.00']]) });
    check(false, r.status === 0, `STATUS=0(実際は ${r.status})`);
    return { status: r.status, statusText: r.statusText, response: summary(r.response), final: summary(r.final) };
  });
  await scenario('INF(作業完了)', { crc: true }, async (d, check) => {
    const r = await d.request('INF', { job: '9001', records: [['STATUS', '0']] });
    check(true, r.status === 0, `知らせを送り終える(実際は ${r.status})`);
    return r;
  });
  await scenario('知らない要求(XYZ)', { crc: true }, async (d, check) => {
    const r = await dl(d, 'XYZ', '9001');
    check(true, r.status !== 0, `断りの応答を、STATUS の番号つきで受け取る`);
    check(false, r.status === 16, `STATUS=16(表 A.24 の Invalid request。実際は ${r.status})`);
    check(false, !r.jobMissing, `応答に JOB を入れる(7.1.6)`);
    return r;
  });
  await scenario('CMD', { crc: true }, async (d, check) => {
    const r = await dl(d, 'CMD', '9001');
    check(true, r.status !== 0, `断りの応答を、STATUS の番号つきで受け取る`);
    check(false, r.status === 8, `STATUS=8(7.6.2。実際は ${r.status})`);
    check(false, !r.jobMissing, `応答に JOB を入れる(7.1.6)`);
    return r;
  });
  if (process.argv[2]) { fs.writeFileSync(process.argv[2], JSON.stringify(out, null, 1)); console.log('記録:', process.argv[2]); }
  const n = k => out.filter(r => r.checks.some(c => c.side === k && !c.pass)).length;
  console.log(`\n${out.length} 場面: このリポジトリ側の外れ ${out.filter(r => !r.ok).length}、Simulator 側の不整合 ${n('sim')}`);
  process.exitCode = out.every(r => r.ok) ? 0 : 1;
})().catch(e => { console.error(e.message); process.exitCode = 1; });
