// テストを Node.js で実行する(node tests/run-node.js)
//   tests.js          パーサー(samples/ のファイルも読んでテストする)
//   session-tests.js  通信の制御(偽の時計と、メモリ上でつないだデバイスとホスト)
//   tcp-tests.js      TCP・UDP での接続(自分のパソコンの中でつなぐ)。環境変数 VCA_SKIP_TCP=1 で飛ばす
const fs = require('fs');
const path = require('path');
const VCA = require('../src/vca-parser.js');
const S = require('../src/vca-session.js');

(async () => {
  const dir = path.join(__dirname, '../samples');
  const samples = {};
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.vca'))) samples[f] = fs.readFileSync(path.join(dir, f), 'latin1');
  const results = require('./tests.js')(VCA, samples)
    .concat(await require('./session-tests.js')(VCA, S))
    .concat(process.env.VCA_SKIP_TCP ? [] : await require('./tcp-tests.js')());
  const ng = results.filter(r => !r.ok);
  for (const r of results) console.log(`${r.ok ? '✓' : '✗'} ${r.name}${r.ok ? '' : ` -- ${r.msg}`}`);
  console.log(`${results.length - ng.length} / ${results.length} 件成功`);
  process.exitCode = ng.length ? 1 : 0;
})();
