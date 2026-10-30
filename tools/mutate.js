// ミューテーションテスト: 実装の一部をわざと壊し、テストが失敗するかを確かめる(npm run mutate)
//
// テストが「確かめているはずの処理」を本当に確かめているかを調べる。壊してもテストが通るもの(生き残り)は、
// その処理を通る場面をテストが作っていない。生き残りがあれば終了コード 1 で終わる。
//   node tools/mutate.js            すべて試す(数分かかる)
//   node tools/mutate.js 重複        名前に「重複」を含むものだけ試す
// 壊したファイルは各回のあとに元に戻す(途中で Ctrl+C で止めても戻す)。
// 一覧に無い壊し方まで検出できることの保証ではない。処理を足したら、ここにも壊し方を足すこと。
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const repo = path.join(__dirname, '..');
const P = 'src/vca-parser.js', S = 'src/vca-session.js', T = 'src/vca-tcp.js';

// [名前, ファイル, 元の文字列, 壊した文字列, TCP のテストも要るか]
// 元の文字列はファイルの中にちょうど 1 か所あること(改行は LF で書く。CRLF のファイルでも動く)
const M = [
  // ---- パーサー ----
  ['CRC の初期値', P, '    let crc = 0;', '    let crc = 1;'],
  ['エスケープしない', P, "out += ESCAPED.has(c) ? CH.ESC + String.fromCharCode(c | 0x80) : s[i];", 'out += s[i];'],
  ['エスケープの最上位ビットを戻さない', P, 'String.fromCharCode(s.charCodeAt(++i) & 0x7f)', 'String.fromCharCode(s.charCodeAt(++i))'],
  ['ESCAPED から LF を外す', P, '0x1a, 0x0d, 0x0a]);', '0x1a, 0x0d]);'],
  ['ラベルの上限 16 → 17', P, 'const MAX_LABEL = 16;', 'const MAX_LABEL = 17;'],
  ['引用符の中の ; で区切る', P, "if (c === ';' && !quoted) {", "if (c === ';') {"],
  ['引用符の数が合わなくても引用符で区切る', P, "if ((value.match(/\"/g) || []).length % 2 === 0 && value.includes('\"')) {", "if (value.includes('\"')) {"],
  ['データセットの途中の REM で閉じる', P, "if (ds && label !== 'REM') closeDataset();", 'if (ds) closeDataset();'],
  ['XSTATUS の既定の W を使わない', P, "    XSTATUS: { severity: 'W' },", ''],
  ['プリセット初期化の DEF を受け入れる', S, 'if (st === 14 && def) {', 'if (false) {'],
  ['要求 ID を 1 から振る', S, 'Math.floor((Date.now() - Date.UTC(2020, 0, 1)) / 1000)) - 1;', '1) - 1;'],
  ['D を ENDDEF の後に置く', S, "          labelLists(definition.labels).forEach(d => data.push(d));\n          data.push(['ENDDEF', definition.tag]);", "          data.push(['ENDDEF', definition.tag]);\n          labelLists(definition.labels).forEach(d => data.push(d));"],
  ['テキストの ESC を認める', P, "if (!utf8 && /[^\\x20-\\x7f]/.test(v))", "if (!utf8 && /[^\\x00-\\x7f]/.test(v))"],
  ['REM の ; で分ける', P, "const fields = label === 'REM' ? [raw.trim().replace(/^\"([\\s\\S]*)\"$/, '$1')] : splitFields(raw);", 'const fields = splitFields(raw);'],
  ['引用符を外さない', P, ".replace(/^\"([\\s\\S]*)\"$/, '$1'));", ');'],
  ['limited の上限 12 → 13', P, 'const MAX_LIMITED = 12, MAX_VALUE = 255;', 'const MAX_LIMITED = 13, MAX_VALUE = 255;'],
  ['値の上限 255 → 256', P, 'const MAX_LIMITED = 12, MAX_VALUE = 255;', 'const MAX_LIMITED = 12, MAX_VALUE = 256;'],
  ['ASCII の確かめをしない', P, "if (!utf8 && /[^\\x20-\\x7f]/.test(v))", 'if (false)'],
  ['左右レコードで limited を見ない', P, "(chiral ? types[0] : types[i]) === 'limited'", "types[i] === 'limited'"],
  ['80 文字の警告 → 81 文字', P, "(label + '=' + raw.replace(/\\s+$/, '')).length > 80) {", "(label + '=' + raw.replace(/\\s+$/, '')).length > 81) {"],
  ['単一レコードの値の個数を見ない', P, "if (def.k === 's' && fields.length > 1)", 'if (false)'],
  ['重複の警告を出さない', P, 'if (def && !def.p) warnings.push', 'if (false) warnings.push'],
  ['廃止の警告を出さない', P, 'if (def && def.dep !== undefined && def.dep !== null) {', 'if (false) {'],
  ['知らないラベルを集めない', P, 'if (unknown.indexOf(label) < 0) unknown.push(label);', ''],
  ['整数の欄の小数点を見ない', P, "=== 'integer' && /^[+-]?\\d*\\.\\d*$/.test(v)", "=== 'integer' && false"],
  ['角度の上限 35999 → 36000', P, 'v < 0 || v > 35999)) warnings', 'v < 0 || v > 36000)) warnings'],
  ['負の角度を見ない', P, 'v < 0 || v > 35999)) warnings', 'v > 35999)) warnings'],
  ['データの眼の B を見ない', P, "(head === 'TRCFMT' || head === 'ZFMT') && d.eye === 'B'", 'false'],
  ['サグの最小値 0 を認める', P, 'Math.min(...main) <= 0) warnings', 'Math.min(...main) < 0) warnings'],
  ['重みの上限を見ない', P, '(v < 0 || v > 1)))) {', '(v < 0)))) {'],
  ['面形状の中心点を見ない', P, 'if (c !== undefined && c !== 0) warnings', 'if (false) warnings'],
  ['DRILLE の基準の ? を認める', P, "(f[1] === undefined || String(f[1]).trim() === '?')", '(f[1] === undefined)'],
  ['DRILLE の基準の省略を認める', P, "(f[1] === undefined || String(f[1]).trim() === '?')", "(String(f[1]).trim() === '?')"],
  ['基準 R をグループの 1 番目にも認める', P, 'feat.group && feat.group.seq > 1', 'feat.group && feat.group.seq > 0'],
  ['CIRC3D のサグ・FCRV を見ない', P, 'if (hasCirc3d && !hasFcrv', 'if (false && !hasFcrv'],
  ['CIRC3D で FCRV を見ない', P, 'if (hasCirc3d && !hasFcrv', 'if (hasCirc3d'],
  ['LTYPE の種類の数を見ない', P, "if (type.length !== 1) out.push(", 'if (false) out.push('],
  ['LTYPE の知らない記号を認める', P, ".forEach(t => out.push(`知らない記号 ${t}`));", '.forEach(() => {});'],
  ['LTYPE の特性の順を見ない', P, 'if (idx.some((x, i) => i && x <= idx[i - 1]))', 'if (idx.some((x, i) => i && x < idx[i - 1]))'],
  ['LTYPE の AS と AT を認める', P, "if (sp.includes('AS') && sp.includes('AT'))", 'if (false)'],
  ['LTYPE の TR の EX FT を見ない', P, "(seg.length === 2 && seg.join(' ') !== 'EX FT')", 'false'],
  ['LTYPE の BI のセグメントを見ない', P, "if (t === 'BI' && seg.length !== 1)", 'if (false)'],
  ['LTYPE の SV に中間度数を認める', P, "(t === 'SV' || t === 'NV') && (power.length || seg.length)", "(t === 'SV' || t === 'NV') && seg.length"],
  ['ENDDEF のタグを見ない', P, 'else if (r.fields[0] !== def) warnings.push', 'else if (false) warnings.push'],
  ['ENGMARK の DCS のラベルを見ない', P, "=== 'DCS' && !all[label]) warnings.push", "=== 'DCS' && false) warnings.push"],
  ['DRILLS の眼を見ない', P, "if (!/^[RLB]$/i.test(String(f[0] || '').trim())) warnings.push", 'if (false) warnings.push'],
  ['XSTATUS のコードの範囲を見ない', P, '(+c < 100 && !STATUS[+c])', 'false'],
  ['XSTATUS のエラーで STATUS=3 を見ない', P, "if (error && st !== '3') warnings.push", 'if (false) warnings.push'],
  ['XSTATUS の警告で STATUS を見ない', P, 'if (!error && st === undefined) warnings.push', 'if (false) warnings.push'],
  ['XSTATUS の INF も STATUS を求める', P, "String(head.fields[0] || '').toUpperCase() !== 'INF'", 'true'],
  ['PROCBLK の連続を見ない', P, 'if (block !== openBlock && !brokenBlocks.has(block)) {', 'if (false) {'],
  ['PROCBLK のブロックを閉じない', P, "openBlock = label === 'PROCBLK' ? String(splitFields(raw)[0] || '').trim() : null;", "if (label === 'PROCBLK') openBlock = String(splitFields(raw)[0] || '').trim();"],
  ['グループの英字の順を見ない', P, 'if (ids.some((id, i) => letters(id) !== i + 1)) errors.push', 'if (false) errors.push'],
  ['グループの番号の順を見ない', P, 'if (seqs.some((s, i) => s !== i + 1)) errors.push', 'if (false) errors.push'],
  ['グループを眼ごとに分けない', P, 'const g = (groups[f.eye] = groups[f.eye] || {});', "const g = (groups.X = groups.X || {});"],
  ['補間で 0° をまたがない', P, 'const pa = k === 0 ? p.a - 360 : p.a,', 'const pa = p.a,'],
  ['補間で眼の向きを使わない', P, 'const pts = tracePoints(trace, asEye).map(p => ({ a: p.a, v: p.r * 100 }));', 'const pts = tracePoints(trace).map(p => ({ a: p.a, v: p.r * 100 }));'],
  ['補間しない', P, 'return qa === pa ? p.v : p.v + ((q.v - p.v) * (a - pa)) / (qa - pa);', 'return p.v;'],
  ['左右のレコードの値の数を見ない', P, "if (d && d.k === 'c' && r.fields.length === 1 && String(r.fields[0]).trim() !== '?') single.add(r.label);", ''],
  ['LABEL=? も値の数で警告する', P, "r.fields.length === 1 && String(r.fields[0]).trim() !== '?') single.add", 'r.fields.length === 1) single.add'],
  ['応答の LDPATH の欄を見ない', P, "(all.LDPATH || []).forEach(f => { if (f.length > 1) warnings.push('装置への応答", "(all.LDPATH || []).forEach(f => { if (false) warnings.push('装置への応答"],
  ['MNT の SN・MID を見ない', P, "if (!all.SN && !all.MID) need.push('SN か MID');", ''],
  ['TIM の応答の TIME を見ない', P, "type === 'TIM' && !all.TIME && ", "type === 'TIM' && false && "],
  ['TIM の断りにも TIME を求める', P, " && !(all.STATUS && all.STATUS[0][0] !== '0')) {", ') {'],
  ['ACT=NEW の DO を見ない', P, "=== 'NEW') && !all.DO) warnings.push", "=== 'NEW') && false) warnings.push"],
  ['空の JOB を認める', P, "if ((all.JOB || []).some(f => !f.length || String(f[0]).trim() === '')) warnings.push", 'if (false) warnings.push'],
  ['面形状の表の空欄を見ない', P, "if (cells.some(c => c.trim() === '')) ds.emptyCells = true;", ''],
  ['面形状の表の列の数を見ない', P, '(d.emptyCells || d.rows.some(r => r.length !== +d.info.columns))) {', '(d.emptyCells)) {'],
  ['プリセットの all を見ない', P, 'r.mandatory || (opts && opts.all)', 'r.mandatory'],
  ['ラベル一覧でデータセットを数えない', P, 'const has = l => data.all[l] || (data.datasets || []).some(d => d.type === l);', 'const has = l => data.all[l];'],
  ['CIRC3D を比べない', P, 'if (v3 !== undefined && Math.abs(c3 - v3) > tol3) {', 'if (false) {'],
  ['立体の周長で高さを使わない', P, '(q.y - p.y) ** 2 + (z[j] - z[i]) ** 2);', '(q.y - p.y) ** 2);'],
  ['FCRV の TIND を使わない', P, "const tind = (data && number(data, 'TIND', trace.eye)) || 1.53;", 'const tind = 1.53;'],
  ['LTYPEF・LTYPEB を見ない', P, "['LTYPE', 'LTYPEF', 'LTYPEB'].forEach(label =>", "['LTYPE'].forEach(label =>"],
  ['DRILLS の開始角度を見ない', P, 'if (blank(f[2])) warnings.push', 'if (false) warnings.push'],
  ['DRILLS の深さを見ない', P, 'if (blank(f[7])) warnings.push', 'if (false) warnings.push'],
  ['DRILLS の矩形の終了角度を見ない', P, "=== '2' && blank(f[4])) warnings.push", "=== '2' && false) warnings.push"],
  ['ENGMARK の最初の 2 欄を見ない', P, 'if (blank(f[0]) || blank(f[1])) warnings.push', 'if (false) warnings.push'],
  ['LDPATH の Type の ? を認める', P, "if (f.length > 1 && String(f[4] || '').trim() === '?') warnings.push", 'if (false) warnings.push'],
  ['ブロックの中の PROC を認める', P, "if (label === 'PROC' || label === 'PROCBLK') warnings.push", 'if (false) warnings.push'],
  ['初期化の ACT に返さない', S, "if (data.all.ACT && opts.actions) reply.push(['ACT'].concat(opts.actions));", ''],
  ['ACT が返らなくても知らせない', S, "if (sentAct && !host.all.ACT && status(host) === 0) warnings.push(", 'if (false) warnings.push('],
  ['DRLFMT を取り決めても DRILL を送る', S, 'const records = numeric && requestIds[type].drill && res.records ?', 'const records = false ?'],
  ['CRC 付きのパケットに CRC なしで応答する', S, '{ crc: !!opts.crc || peerCrc }', '{ crc: !!opts.crc }'],
  ['初期化の DEV・VEN・MODEL を見ない', S, 'if (lack.length) w.push(', 'if (false) w.push('],
  ['ラベル一覧の R・A・Z・ZA を見ない', S, 'if (data.length) w.push(', 'if (false) w.push('],
  ['ラベル一覧のインターフェイスレコードを見ない', S, 'if (iface.length) w.push(', 'if (false) w.push('],
  ['候補を集めない', P, 'proposals.push({ label: ds.type, fields: ds.fields });', ''],
  ['数値を緩く読む', P, 'const NUMBER_RE = /^[+-]?(\\d+\\.?\\d*|\\.\\d+)$/;', 'const NUMBER_RE = /^[+-]?(\\d+\\.?\\d*|\\.\\d+)/;'],
  ['基準点の A を受け付けない', P, '(IN|UP|A)$/);', '(IN|UP)$/);'],
  ['基準点の 2 つ目を確かめない', P, '!REFERENCE_POINTS[m[1]] || !REFERENCE_POINTS[m[2]]', '!REFERENCE_POINTS[m[1]]'],
  ['ファイルの REQ を確かめない', P, "else if (['FIL', 'FRM', 'SDF'].indexOf(type) < 0)", 'else if (false)'],
  ['ファイルの CRC・STATUS を確かめない', P, "['CRC', 'STATUS'].forEach(l =>", "[].forEach(l =>"],
  ['ファイルの形式 1 を確かめない', P, '(data.traces || []).some(t => t.fmt !== 1)', 'false'],
  ['LNF の OPC を確かめない', P, "if (type === 'LNF') { if (second !== 'OPC')", "if (type === 'LNF') { if (false)"],
  ['CMD の LIB・RMT を認めない', P, "type === 'CMD' ? ['JOB', 'LIB', 'RMT'] : ['JOB']", "['JOB']"],
  ['左右反転しない', P, 'if (mirror) a = (540 - a) % 360;', ''],
  ['反転後に並べ直さない', P, 'return mirror ? pts.reverse() : pts;', 'return pts;'],
  ['周長を閉じない', P, 'const q = points[(i + 1) % points.length];', 'const q = points[Math.min(i + 1, points.length - 1)];'],
  ['BSIZ と CSIZ の両方を見ない', P, "if (number(data, 'BSIZ', eye) && number(data, 'CSIZ', eye))", 'if (false)'],
  ['中心のずれを見ない', P, '(Math.abs(box.cx) > tol || Math.abs(box.cy) > tol)', 'false'],
  ['中心のずれで y を見ない', P, '(Math.abs(box.cx) > tol || Math.abs(box.cy) > tol)', '(Math.abs(box.cx) > tol)'],
  ['寸法の食い違いを見ない', P, 'if (given !== undefined && Math.abs(given - v) > tol) {', 'if (false) {'],
  ['暗黙の CSIZ の符号を逆に', P, 'csiz: Math.round((b - a) * 1e6) / 1e6', 'csiz: Math.round((a - b) * 1e6) / 1e6'],
  ['STATUS 17 の 256 を足さない', P, 'traceProps.some(f => fits(f, { formats: t.formats }))) status += 256;', 'traceProps.some(f => fits(f, { formats: t.formats }))) status += 0;'],
  ['STATUS 17 の 1024 を足さない', P, 'traceProps.some(f => fits(f, { modes: t.modes }))) status += 1024;', 'traceProps.some(f => fits(f, { modes: t.modes }))) status += 0;'],
  ['サグ非対応でも ZFMT=0 を返さない', P, "records.push(sag ? ['ZFMT'].concat(sag) : ['ZFMT', '0']);", "if (sag) records.push(['ZFMT'].concat(sag));"],
  ['文字コードを最も単純なものにする', P, "TEXT_ENCODINGS.forEach(e => { if (encProps.indexOf(e) >= 0 && hostEnc.indexOf(e) >= 0) encoding = e; });", ''],
  ['点数を見ないで形式を選ぶ', P, "(!spec.points || spec.points.map(Number).indexOf(+f[1]) >= 0) &&", ''],
  ['形式 1 を 80 文字で分けない', P, "if ((label + '=' + cur.concat([s]).join(';')).length > 80)", 'if (false)'],
  ['CRC を確かめない', P, 'crcOk = /^\\d+$/.test(v) && crc16(inner.slice(0, r + 1)) === +v;', 'crcOk = true;'],
  ['パケットの順序を確かめない', P, 'checkOrder(data).forEach(msg => data.warnings.push(msg));', ''],
  ['修飾ビットを分けない', P, '[256, 512, 1024].forEach(b => { if (c & b) mods.push(b); });', ''],
  ['| で分けない', P, "String(v).split('|'); }", '[String(v)]; }'],
  ['穴の基準の混在を見ない', P, "if (refs.size > 1) errors.push('1 つのパケットの DRILLE", "if (false) errors.push('1 つのパケットの DRILLE"],
  ['穴の角度モードの既定を F にしない', P, "if (!f.angleMode) f.angleMode = groupMode[keyOf(f)] || 'F';", "if (!f.angleMode) f.angleMode = groupMode[keyOf(f)];"],
  ['DRILLE=? を unknown にしない', P, "return { status: src[0][0] === '0' ? 'none' : 'unknown', features: [] };", "return { status: 'none', features: [] };"],
  ['自動フォーマットの * を外さない', P, "label: l.replace(/^\\*/, '').toUpperCase()", 'label: l.toUpperCase()'],
  // ---- 通信の制御 ----
  ['CRC が誤っても ACK', S, "if (!data || data.crcOk === false || !data.records.length) { opts.send(NAK); return; }", 'if (!data) { opts.send(NAK); return; }'],
  ['送り直しを 2 回までに', S, 'const MAX_SENDS = 4;', 'const MAX_SENDS = 3;'],
  ['重複を捨てない', S, 'if (raw === lastAccepted) {', 'if (false) {'],
  ['ACK・NAK で重複の記憶を消さない', S, '          lastAccepted = null;   // 相手は先へ進んだ', '          // 相手は先へ進んだ'],
  ['取り置きを渡さない', S, 'packets.unshift(overlap);', 'return ng(outOfSync(overlap));'],
  ['NAK のとき取り置きでも同期ずれにしない', S, 'if (c === NAK) return ng(outOfSync(overlap));', ''],
  ['ACK・NAK 以外の文字を無視', S, 'if (confirmWaiter) confirmWaiter.onBadChar(c);', ''],
  ['quiet を無視', S, "const quiet = !!(sendOpts && sendOpts.quiet);", 'const quiet = false;'],
  ['文字間タイムアウトを止める', S, 'else charTimer = clock.setTimeout(charTimeout, timeouts.char * 1000);', 'else charTimer = null;'],
  ['パケットのタイムアウトを止める', S, "const recv = () => link.receivePacket(link.timeouts.packet);\n    // 応答の種類", "const recv = () => link.receivePacket(null);\n    // 応答の種類"],
  ['TIMEOUT を受け入れない', S, 'if (Number.isInteger(v) && v >= 2 && v <= 255) link.timeouts[k] = v;', ''],
  ['TIMEOUT の範囲を見ない', S, 'if (Number.isInteger(v) && v >= 2 && v <= 255) link.timeouts[k] = v;', 'if (Number.isInteger(v)) link.timeouts[k] = v;'],
  ['JOB の無い断りの応答を失敗にする', S, 'if (jobOf(d) === undefined && status(d) !== 0) return true;', ''],
  ['JOB の無い成功の応答も受け取る', S, 'if (jobOf(d) === undefined && status(d) !== 0) return true;', 'if (jobOf(d) === undefined) return true;'],
  ['JOB を確かめない', S, '      if (jobOf(d) !== String(job)) {', '      if (false) {'],
  ['セッションの重なりを許す', S, "if (busy) throw new SessionError('busy'", "if (false) throw new SessionError('busy'"],
  ['接続後に待たない', S, 'const d = delay === undefined ? CONNECT_DELAY : delay;', 'const d = 0;'],
  ['応答の種類を確かめない', S, 'if (answerType(d) !== type) throw syncError(`${type} の応答を', 'if (false) throw syncError(`${type} の応答を'],
  ['同期ずれで STATUS=12 を送らない', S, "if (e.code === 'out-of-sync') return abortOutOfSync(link, type, job, e);", ''],
  ['D レコードを 80 文字で分けない', S, "if (cur.length && (cur.concat(l).join(';')).length > 80)", 'if (false)'],
  ['プリセットで DEF を送る', S, "if (definition && st === 0) {\n          data.push(['DEF', definition.tag]);", "if (definition) {\n          data.push(['DEF', definition.tag]);"],
  ['初期化に非対応でも続ける', S, "if (st !== 0 && st !== 14) return { status: st, statusText: statusText(response), response };", ''],
  ['REQ なしに 18 を返さない', S, 'noRequest: 18,', 'noRequest: 0,'],
  ['知らない要求種別を通す', S, "if (!numeric && !VCA.REQUEST_TYPES[type]) {", 'if (false) {'],
  ['対応しない種別を通す', S, "} else if ((supported && supported.indexOf(type) < 0) || (type === 'CMD' && !opts.onData)) {", '} else if (false) {'],
  ['知らない要求 ID を通す', S, "if (!requestIds[type]) { await link.sendPacket(answer(type, job, codes.unknownRequestId)); return; }", ''],
  ['例外を STATUS=8 にしない', S, "return { status: 'hostError', text: String(e && e.message || e) };", 'throw e;'],
  ['名前の状態コードを番号にしない', S, "const codeOf = st => (typeof st === 'string' && codes[st] !== undefined ? codes[st] : st);", 'const codeOf = st => st;'],
  ['上書きを無視', S, 'const codes = Object.assign({}, STATUS_CODES, opts.statusCodes);', 'const codes = Object.assign({}, STATUS_CODES);'],
  ['STATUS の説明文を返さない', S, "const statusText = d => { const f = d.rec.STATUS; return f && f[1] !== undefined && f[1] !== '' ? f[1] : undefined; };", 'const statusText = d => undefined;'],
  ['中止の知らせを無視しない', S, "if (first && first.label === 'ANS' && status(req) === OUT_OF_SYNC) return;", ''],
  ['データの種類を確かめない', S, "if (answerType(d) !== type) throw syncError(`${type} のデータを", "if (false) throw syncError(`${type} のデータを"],
  ['形式が合わなくても要求 ID を出す', S, 'if (neg.status === 0) {\n        id = nextId();', 'if (true) {\n        id = nextId();'],
  ['TIMEOUT をデバイスに送らない', S, "reply.push(['TIMEOUT', String(t.ack), String(t.packet), String(t.char)]);", ''],
  ['STATUS が 0 以外でもデータを送る', S, "if (kind === 'download' || status(response) !== 0) {", "if (kind === 'download') {"],
  ['切断で確認応答待ちを失敗させない', S, 'if (confirmWaiter) confirmWaiter.onClose(err);', ''],
  ['切断でタイマーを止めない', S, 'onClose: err => ng(err),', 'onClose: err => { confirmWaiter = null; reject(err); },'],
  ['長すぎるパケットを読み捨てない', S, 'else if (buf.length > maxPacket) {', 'else if (false) {'],
  ['読み捨ての途中のタイムアウトも知らせる', S, 'if (wasDiscarding) return;', ''],
  ['読み捨てたパケットに NAK を返さない', S, 'if (c === GS) { discarding = false; opts.send(NAK); continue; }', 'if (c === GS) { discarding = false; continue; }'],
  ['GS の無いまま次の FS が来ても読み直さない', S, 'if (buf !== null && c === FS) {', 'if (false) {'],
  // ---- TCP ----
  ['オートコネクトの IP の形を見ない', T, "if (!ip || !net.isIP(ip)) return ignore(", "if (false) return ignore(", true],
  ['オートコネクトの PORT の範囲を見ない', T, 'if (!(p >= 1 && p <= 65535)) return ignore(', 'if (false) return ignore(', true],
  ['オートコネクトの送り主を見ない', T, "if (o.allow ? !o.allow({ ip, port: p, from, con }) : ip !== from) {", "if (o.allow ? !o.allow({ ip, port: p, from, con }) : false) {", true],
  ['オートコネクトの allow を見ない', T, "if (o.allow ? !o.allow({ ip, port: p, from, con }) : ip !== from) {", 'if (ip !== from) {', true],
  ['オートコネクトで同じ相手に何本もつなぐ', T, "if (active.has(key)) return ignore(", "if (false) return ignore(", true],
  ['オートコネクトで CON 以外も受け付ける', T, "if (VCA.value(con, 'REQ') !== 'CON') return;", '', true],
  ['TCP で接続後に待たせない', T, 'device.connected(opts.connectDelay);', '', true],
  ['UDP の送り先ポートを間違える', T, "sock.send(msg, t.port || PORTS.rendezvous, address,", "sock.send(msg, (t.port || PORTS.rendezvous) + 1, address,", true],
];

const filter = process.argv[2];
let restore = null;   // 壊している最中のファイルを戻す関数
const onSignal = () => { if (restore) restore(); process.exit(130); };
process.on('SIGINT', onSignal);
process.on('SIGTERM', onSignal);

// テストを実行し、失敗した件数を返す(TCP のテストは要るときだけ。VCA_SKIP_TCP で飛ばす)
function runTests(tcp) {
  const out = spawnSync(process.execPath, [path.join(repo, 'tests/run-node.js')], {
    cwd: repo, timeout: 120000, encoding: 'utf8',
    env: Object.assign({}, process.env, { VCA_SKIP_TCP: tcp ? '' : '1' }),
  });
  const m = /(\d+) \/ (\d+) 件成功/.exec(out.stdout || '');
  if (!m) return { crash: ((out.stderr || '') + (out.error ? out.error.message : '')).split('\n')[0] || '結果が読めません' };
  return { failed: +m[2] - +m[1] };
}

const survivors = [], skipped = [];
for (const [name, file, from, to, tcp] of M) {
  if (filter && !name.includes(filter)) continue;
  const f = path.join(repo, file), orig = fs.readFileSync(f, 'utf8');
  const crlf = orig.includes('\r\n'), eol = s => (crlf ? s.replace(/\n/g, '\r\n') : s);
  const count = orig.split(eol(from)).length - 1;
  if (count !== 1) { console.log(`?  ${name}: 元の文字列が ${count} か所あるので試せません`); skipped.push(name); continue; }
  restore = () => fs.writeFileSync(f, orig);
  fs.writeFileSync(f, orig.replace(eol(from), eol(to)));
  let res;
  try { res = runTests(tcp); } finally { restore(); restore = null; }
  // テストが走らなかったものは、壊し方の誤り(構文を壊したなど)かもしれないので、検出には数えない
  if (res.crash) { console.log(`?  ${name}: テストが走らなかった(${res.crash.slice(0, 60)})`); skipped.push(name); }
  else if (res.failed) console.log(`✓ ${name}: ${res.failed} 件失敗`);
  else { console.log(`✗ ${name}: 壊してもテストが通った`); survivors.push(name); }
}
console.log(`\n生き残り ${survivors.length} 件${survivors.length ? ': ' + survivors.join(' / ') : ''}`);
if (skipped.length) console.log(`試せなかったもの ${skipped.length} 件: ${skipped.join(' / ')}`);
process.exitCode = survivors.length || skipped.length ? 1 : 0;
