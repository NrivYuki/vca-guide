// 対応表(docs/conformance.md)・義務の一覧(docs/requirements.md)とテストを突き合わせ、
// どの行・義務をどのテストが確かめているかの一覧を作る
//   node tools/trace.js           docs/conformance-tests.md を作り直す(npm run trace)
//   node tools/trace.js --check   食い違いがあるか、一覧が古ければ終了コード 1(GitHub Actions で使う)
//
// テストには test(名前, { spec: [対応表の行], kind: [確かめ方], req: [番号] }, 本体) の形で、確かめる行を書く。
// 行は、対応表の「節」の欄(または「規格に書かれていない場面の扱い」の「番号」の欄)の文字列そのもの。
// 番号は義務の一覧の R(義務)・S(推奨)・O(ほかの言い方の義務)の番号。
// 確かめること:
//   義務の一覧で扱いが「テスト」の文には、テストが 1 件以上ある。テストに書いた番号は一覧の「テスト」の文にある。
//   「テスト」以外の文には理由が書いてある
//   すべてのテストに行と確かめ方が書かれ、行は対応表にある
//   対応表で ◎ の行には、正常系(正常・規格の例・Simulator)と異常系(異常・境界)のテストが 1 件以上ずつある。
//   U の行(規格に書かれていない場面の扱い)には、異常系(異常・境界)のテストが 1 件以上ある。
//   ただし「異常系を求めない行」の表に理由と一緒に書いた行は、異常系を求めない(異常系があれば、例外をやめるよう知らせる)
//   「-」(扱っていない)・「解説」の行を指すテストは無い
//   すべてのテストが通る
'use strict';
const fs = require('fs');
const path = require('path');
const repo = path.join(__dirname, '..');
const KINDS = ['正常', '異常', '境界', '規格の例', 'Simulator'];
const OUT = path.join(repo, 'docs/conformance-tests.md');

// 対応表の行を読む。| で区切る(\| は区切りではない)
function readRows() {
  const text = fs.readFileSync(path.join(repo, 'docs/conformance.md'), 'utf8').replace(/\r\n/g, '\n');
  const rows = [], exempt = new Map();
  let mode = null;   // 'spec'(節・内容・状態…)、'u'(番号・場面…)、'exempt'(行・理由)
  for (const line of text.split('\n')) {
    if (!line.startsWith('|')) { mode = line.trim() ? null : mode; continue; }
    const cells = line.split(/(?<!\\)\|/).slice(1, -1).map(c => c.trim());
    if (cells[0] === '節' && cells[2] === '状態') { mode = 'spec'; continue; }
    if (cells[0] === '番号' && cells[1] === '場面') { mode = 'u'; continue; }
    if (cells[0] === '行' && cells[1] === '理由') { mode = 'exempt'; continue; }
    if (!mode || /^-+$/.test(cells[0])) continue;
    if (mode === 'exempt') { exempt.set(cells[0], cells[1]); continue; }
    if (mode === 'spec') rows.push({ key: cells[0], title: cells[1], status: cells[2] });
    else rows.push({ key: cells[0], title: cells[1], status: 'U' });
  }
  rows.forEach(r => { r.exempt = exempt.get(r.key); });
  rows.exempt = exempt;
  return rows;
}
// 義務の一覧を読む(番号・節・種類・だれ・要点・扱い・確かめ方の表)
function readRequirements() {
  const text = fs.readFileSync(path.join(repo, 'docs/requirements.md'), 'utf8').replace(/\r\n/g, '\n');
  const reqs = [];
  for (const line of text.split('\n')) {
    const cells = line.split(/(?<!\\)\|/).slice(1, -1).map(c => c.trim());
    if (/^[RSO]\d{3}$/.test(cells[0] || '')) reqs.push({ id: cells[0], section: cells[1], summary: cells[4], handling: cells[5], why: cells[6] });
  }
  return reqs;
}
const POSITIVE = ['正常', '規格の例', 'Simulator'], NEGATIVE = ['異常', '境界'];
const has = (list, kinds) => list.some(t => t.kind.some(k => kinds.includes(k)));

async function runTests() {
  const VCA = require('../src/vca-parser.js');
  const S = require('../src/vca-session.js');
  const dir = path.join(repo, 'samples'), samples = {};
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.vca'))) samples[f] = fs.readFileSync(path.join(dir, f), 'latin1');
  const tag = (list, file) => list.map(r => Object.assign({ file }, r));
  return tag(require('../tests/tests.js')(VCA, samples), 'tests.js')
    .concat(tag(await require('../tests/session-tests.js')(VCA, S), 'session-tests.js'))
    .concat(tag(await require('../tests/tcp-tests.js')(), 'tcp-tests.js'));
}

const esc = s => String(s).replace(/\|/g, '\\|');
const slug = h => h.toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, '').replace(/\s/g, '-');

function render(rows, tests, reqs) {
  const by = new Map(rows.map(r => [r.key, []]));
  tests.forEach(t => t.spec.forEach(k => { if (by.has(k)) by.get(k).push(t); }));
  const count = (list, k) => list.filter(t => t.kind.includes(k)).length;
  const L = [];
  L.push('# 対応表とテストの対応');
  L.push('');
  L.push('[conformance.md](conformance.md) の各行を、どのテストが確かめているかの一覧です。`tools/trace.js` がテストを実行して作るもので、手で直さないでください(`npm run trace` で作り直す)。GitHub Actions は、この一覧が古くないこと、◎ の行にテストがあること、テストがすべて通ることを確かめます。');
  L.push('');
  L.push('確かめ方の種類は次のとおりです。1 つのテストが複数の行・種類にまたがることがあります。');
  L.push('');
  L.push('| 種類 | 意味 |');
  L.push('|---|---|');
  L.push('| 正常 | 正しいデータ・手順で、期待どおりに動くこと |');
  L.push('| 異常 | 誤ったデータ・手順を、警告・エラー・中止で正しく扱うこと |');
  L.push('| 境界 | 上限・下限・ちょうどの値(80 文字、6 秒、送り直し 3 回など)での動き |');
  L.push('| 規格の例 | 規格書に載っている例(附属書 B・C、本文の例)と一致すること |');
  L.push('| Simulator | DCS Host Simulator との照合で見つかった場面 |');
  L.push('');
  L.push(`テストは全部で ${tests.length} 件です(正常 ${count(tests, '正常')}・異常 ${count(tests, '異常')}・境界 ${count(tests, '境界')}・規格の例 ${count(tests, '規格の例')}・Simulator ${count(tests, 'Simulator')})。`);
  L.push('');
  L.push('## 行ごとの件数');
  L.push('');
  L.push('| 行 | 内容 | 状態 | テスト | 正常 | 異常 | 境界 | 規格の例 | Simulator |');
  L.push('|---|---|---|---|---|---|---|---|---|');
  rows.forEach(r => {
    const list = by.get(r.key);
    const link = list.length ? `[${list.length}](#${slug(r.key)})` : '0';
    L.push(`| ${esc(r.key)} | ${r.title} | ${r.status}${r.exempt ? '(例外)' : ''} | ${link} | ${KINDS.map(k => count(list, k) || '').join(' | ')} |`);
  });
  L.push('');
  L.push('「状態」の U は、規格に書かれていない場面の扱い(conformance.md の U1-U11)です。「(例外)」は異常系を求めない行で、理由は次のとおりです([conformance.md](conformance.md#異常系を求めない行))。');
  L.push('');
  rows.filter(r => r.exempt).forEach(r => L.push(`- ${r.key}: ${r.exempt}`));
  L.push('');
  L.push('## 行ごとのテスト');
  rows.forEach(r => {
    const list = by.get(r.key);
    if (!list.length) return;
    L.push('');
    L.push(`### ${r.key}`);
    L.push('');
    L.push(`${r.title}`);
    L.push('');
    list.forEach(t => L.push(`- ${t.name}(${t.kind.join('・')}、tests/${t.file})`));
  });
  const tested = reqs.filter(q => q.handling === 'テスト');
  L.push('');
  L.push('## 義務ごとのテスト');
  L.push('');
  L.push(`[requirements.md](requirements.md) の文 ${reqs.length} 件(義務 R・推奨 S・ほかの言い方の義務 O)のうち、扱いが「テスト」の ${tested.length} 件を、どのテストが確かめているかです。`);
  tested.forEach(q => {
    L.push('');
    L.push(`### ${q.id}`);
    L.push('');
    L.push(`${q.section}: ${q.summary}`);
    L.push('');
    tests.filter(t => t.req.includes(q.id)).forEach(t => L.push(`- ${t.name}(${t.kind.join('・')}、tests/${t.file})`));
  });
  return L.join('\n') + '\n';
}

(async () => {
  const check = process.argv.includes('--check');
  const rows = readRows(), keys = new Set(rows.map(r => r.key));
  const tests = await runTests();
  const problems = [];
  const dup = rows.map(r => r.key).filter((k, i, a) => a.indexOf(k) !== i);
  if (dup.length) problems.push(`対応表の行の名前が重なっています: ${dup.join(' / ')}`);
  tests.forEach(t => {
    if (!t.ok) problems.push(`テストが失敗しています: ${t.name}(${t.msg})`);
    if (!t.spec.length) problems.push(`行が書かれていないテスト: ${t.name}`);
    if (!t.kind.length) problems.push(`確かめ方が書かれていないテスト: ${t.name}`);
    t.kind.filter(k => !KINDS.includes(k)).forEach(k => problems.push(`知らない確かめ方「${k}」: ${t.name}`));
    t.spec.filter(k => !keys.has(k)).forEach(k => problems.push(`対応表に無い行「${k}」: ${t.name}`));
  });
  rows.exempt.forEach((why, k) => {
    if (!rows.some(r => r.key === k && r.status === '◎')) problems.push(`「異常系を求めない行」の ${k} が、対応表の ◎ の行にありません`);
  });
  rows.forEach(r => {
    const list = tests.filter(t => t.spec.includes(r.key)), n = list.length;
    if ((r.status === '◎' || r.status === 'U') && !n) problems.push(`◎ なのにテストが無い行: ${r.key}(${r.title})`);
    if ((r.status === '-' || r.status === '解説') && n) problems.push(`「${r.status}」なのにテストがある行: ${r.key}`);
    if (!n) return;
    if (r.status === '◎' && !has(list, POSITIVE)) problems.push(`正常系のテストが無い行: ${r.key}(${r.title})`);
    if ((r.status === '◎' || r.status === 'U') && !r.exempt && !has(list, NEGATIVE)) {
      problems.push(`異常系・境界値のテストが無い行: ${r.key}(${r.title})。足すか、「異常系を求めない行」に理由を書く`);
    }
    if (r.exempt && has(list, NEGATIVE)) problems.push(`「異常系を求めない行」の ${r.key} に異常系のテストがあるので、例外から外す`);
  });
  const reqs = readRequirements(), reqIds = new Map(reqs.map(q => [q.id, q]));
  if (!reqs.length) problems.push('docs/requirements.md に義務がありません');
  tests.forEach(t => t.req.forEach(id => {
    const q = reqIds.get(id);
    if (!q) problems.push(`義務の一覧に無い番号「${id}」: ${t.name}`);
    else if (q.handling !== 'テスト') problems.push(`扱いが「${q.handling}」の文 ${id} を指すテスト: ${t.name}`);
  }));
  reqs.forEach(q => {
    if (q.handling === 'テスト' && !tests.some(t => t.req.includes(q.id))) problems.push(`テストの無い文: ${q.id}(${q.section} ${q.summary})`);
    if (q.handling !== 'テスト' && !q.why) problems.push(`理由の無い文: ${q.id}`);
  });
  const doc = render(rows, tests, reqs);
  if (check) {
    const cur = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8').replace(/\r\n/g, '\n') : '';
    if (cur !== doc) problems.push('docs/conformance-tests.md が古くなっています。npm run trace で作り直してください');
  } else fs.writeFileSync(OUT, doc);
  problems.forEach(p => console.log('✗ ' + p));
  console.log(`対応表の行 ${rows.length}・テスト ${tests.length} 件・問題 ${problems.length} 件`);
  process.exitCode = problems.length ? 1 : 0;
})().catch(e => { console.error(e); process.exitCode = 1; });
