// vca-parser.js のテスト。ブラウザでは run-tests.html、Node.js では run-node.js から実行する
// samples({ ファイル名: 内容 })を渡すと samples/ のファイルのテストも行う(Node.js のみ。ブラウザはファイルを読めない)
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory;
  else root.runVcaTests = factory;
})(this, function (VCA, samples) {
  const results = [];
  // test(名前, { spec: 確かめる対応表の行, kind: 確かめ方, req: 確かめる義務(docs/requirements.md の番号) }, 本体)。tools/trace.js が対応表・義務の一覧と突き合わせる
  function test(name, meta, fn) {
    const info = { name, spec: meta.spec || [], kind: meta.kind || [], req: meta.req || [] };
    try { fn(); results.push(Object.assign({ ok: true }, info)); }
    catch (e) { results.push(Object.assign({ ok: false, msg: e.message }, info)); }
  }
  function eq(a, b, what) {
    const sa = JSON.stringify(a), sb = JSON.stringify(b);
    if (sa !== sb) throw new Error(`${what || '値'}: 期待 ${sb} / 実際 ${sa}`);
  }
  function ok(v, what) { if (!v) throw new Error(what || '条件が偽'); }
  const CRLF = '\r\n';
  
  // ---- CRC・パケット --------------------------------------------------------
  test('CRC-16: "Hello World!" は 0x0CD3', { spec: ['6.1.2', '附属書 C'], kind: ['規格の例'] }, () => eq(VCA.crc16('Hello World!'), 0x0cd3));
  
  test('パケットの組み立てと CRC 検証', { spec: ['6.1', '6.1.2'], kind: ['正常', '異常'], req: ['R148', 'S000'] }, () => {
    const pkt = VCA.buildPacket([['REQ', 'TRC'], ['JOB', '1001']], { crc: true });
    eq(VCA.buildPacket([['REQ', 'TRC'], ['SPH', '-1.00', '-2.00']]), '\x1cREQ=TRC\r\nSPH=-1.00;-2.00\r\n\x1e\x1d', '区切りの前後に空白を入れない(5 章)');
    ok(pkt.startsWith('\x1c') && pkt.endsWith('\x1d'), 'FS で始まり GS で終わる');
    const p = VCA.parsePacket(pkt);
    eq(p.crcOk, true, 'CRC');
    eq(p.records.map(r => r.label), ['REQ', 'JOB'], 'レコード順');
    const broken = pkt.replace('1001', '1002');
    eq(VCA.parsePacket(broken).crcOk, false, '改ざん時の CRC');
  });
  
  test('CRC レコードが無いパケットは crcOk = null', { spec: ['6.1.2'], kind: ['境界'], req: ['O037', 'R149'] }, () => {
    eq(VCA.parsePacket(VCA.buildPacket([['REQ', 'INI']])).crcOk, null);
  });
  
  test('CRC の値が数字でなければ crcOk = false(CRC なしと区別する)', { spec: ['6.1.2'], kind: ['異常'] }, () => {
    const pkt = VCA.buildPacket([['REQ', 'TRC']], { crc: true });
    eq(VCA.parsePacket(pkt.replace(/CRC=\d+/, 'CRC=abc')).crcOk, false, '文字');
    eq(VCA.parsePacket(pkt.replace(/CRC=\d+/, 'CRC=')).crcOk, false, '空');
    eq(VCA.parsePacket(pkt.replace(/CRC=(\d+)/, 'CRC=$1x')).crcOk, false, '数字の後に文字');
  });
  
  // ---- レコード --------------------------------------------------------------
  test('左右レコードの取り出し(片眼のみ・単一値・不明値)', { spec: ['5.1.4', '3.3'], kind: ['正常', '境界'] }, () => {
    const d = VCA.parse(['SPH=;-2.75', 'DBL=18.0', 'IPD=?;31.0', 'CYL=-0.50;-0.75'].join(CRLF));
    eq(VCA.sideNumber(d.rec.SPH, 'R'), undefined, 'SPH 右');
    eq(VCA.sideNumber(d.rec.SPH, 'L'), -2.75, 'SPH 左');
    eq(VCA.sideNumber(d.rec.DBL, 'L'), 18, 'DBL(単一値は両眼)');
    eq(VCA.sideNumber(d.rec.IPD, 'R'), undefined, 'IPD 右(?)');
    eq(VCA.sideNumber(d.rec.CYL, 'L'), -0.75, 'CYL 左');
  });
  
  test('数値の読み取りは厳密(後ろに文字が付いた値は数値として扱わない)', { spec: ['3.3'], kind: ['異常'] }, () => {
    eq(VCA.sideNumber(['12abc'], 'R'), undefined, '12abc');
    eq(VCA.sideNumber(['1.2.3'], 'R'), undefined, '1.2.3');
    eq(VCA.sideNumber(['+0.50'], 'R'), 0.5, '+0.50');
    eq(VCA.sideNumber(['.25'], 'R'), 0.25, '.25');
    eq(VCA.sideNumber(['-2.'], 'R'), -2, '-2.');
  });
  
  test('"_" で始まるラベル・引用符付きの値・未知のラベル', { spec: ['5.1.5', '5.1.6', '6.2'], kind: ['正常'], req: ['R006', 'S003', 'S036', 'S037'] }, () => {
    const d = VCA.parse(['_MYTEST=abc', 'JOB="A-123"', 'ZZTOP=1'].join(CRLF));
    eq(d.rec._MYTEST, ['abc']);
    eq(d.rec.JOB, ['A-123']);
    eq(d.rec.ZZTOP, ['1'], '未知のラベルも保持(利用側で無視)');
  });

  test('引用符の中の ";" は区切りではない(6.2.2)。引用符の数が合わなければ普通に区切る', { spec: ['6.2', '5.1.7', 'U5'], kind: ['正常', '異常', 'Simulator'] }, () => {
    const d = VCA.parse(['REM="STATUS=9;  REM LINES CAN APPEAR ANYWHERE"', 'LNAM="A;B";"C"', 'MNAME=5" lens;x'].join(CRLF));
    eq(d.rec.REM, ['STATUS=9;  REM LINES CAN APPEAR ANYWHERE']);
    eq(d.rec.LNAM, ['A;B', 'C'], '左右それぞれの引用符');
    eq(d.rec.MNAME, ['5" lens', 'x'], '引用符が 1 つだけ');
    eq(d.warnings.filter(w => w.includes('REM')), [], 'REM は値 1 つのまま');
    // 引用符の無い REM の ";" も分けない(処理に使わない備考なので、1 つの文として受け取る)
    eq(VCA.parse('REM=STATUS=0;   "NO ERROR"').rec.REM, ['STATUS=0;   "NO ERROR"']);
  });

  test('データセットの途中の REM は、データセットを閉じない(R・A・Z の間)', { spec: ['5.4.5-5.4.7', 'U4'], kind: ['Simulator'] }, () => {
    const d = VCA.parse(['TRCFMT=1;8;U;R;F', 'R=2500;2500;2500;2500', 'REM=a', 'R=2500;2500;2500;2500',
      'A=0;4500;9000;13500', 'REM=b', 'A=18000;22500;27000;31500', 'ZFMT=1;8;U;R;F', 'Z=1;1;1;1', 'REM=c',
      'Z=1;1;1;1', 'ZA=0;4500;9000;13500;18000;22500;27000;31500', 'DBL=18'].join(CRLF));
    const t = d.traces[0];
    eq([t.radii.length, t.angles.length, t.sag.values.length, t.sag.angles.length], [8, 8, 8, 8]);
    eq([d.all.REM.length, VCA.value(d, 'DBL'), d.warnings], [3, '18', []], 'REM も DBL も通常のレコード');
  });
  
  test('繰り返しレコード(DRILLE)はすべて all に残り、重複の警告は出ない', { spec: ['5.1.10', '5.5'], kind: ['正常'] }, () => {
    const d = VCA.parse(['REQ=FIL', 'JOB=1', 'DRILLE=B;C;-22.00;3.25;1.40', 'DRILLE=B;C;22.00;4.35;1.40'].join(CRLF));
    eq(d.all.DRILLE.length, 2, '件数');
    eq(VCA.occurrences(d, 'DRILLE')[1].x, '22.00', '2 件目の x');
    eq(d.rec.DRILLE[2], '22.00', 'rec は最後の値');
    ok(!d.warnings.some(w => w.includes('複数回')), '警告なし');
  });
  
  test('繰り返せないレコードの重複は警告', { spec: ['5.1.10'], kind: ['異常'] }, () => {
    const d = VCA.parse(['SPH=-1.00;-1.00', 'SPH=-2.00;-2.00'].join(CRLF));
    ok(d.warnings.some(w => w.includes('SPH') && w.includes('複数回')));
    eq(d.all.SPH.length, 2);
  });
  
  test('定義に従った値の取り出し(左右・単一・不明)', { spec: ['5.1.1-5.1.2', '5.1.4'], kind: ['正常'] }, () => {
    const d = VCA.parse(['SPH=-1.00;-2.50', 'DBL=18.0', 'IPD=?;31.0', 'JOB=?'].join(CRLF));
    eq(VCA.number(d, 'SPH', 'L'), -2.5);
    eq(VCA.number(d, 'sph'), -1, '眼の既定は右、ラベルは大文字小文字を区別しない');
    eq(VCA.number(d, 'DBL', 'L'), 18);
    eq(VCA.value(d, 'IPD', 'R'), undefined);
    eq(VCA.value(d, 'JOB'), undefined, '単一レコードの ?');
    eq(VCA.value(d, 'NOPE'), undefined, '無いラベル');
  });
  
  test('defineRecords で欄名を付けると名前で取り出せる', { spec: ['5.1.1-5.1.2'], kind: ['正常'] }, () => {
    VCA.defineRecords({ _TESTHOLE: { repeat: true, fields: ['eye', 'ref', 'x', 'y'] } });
    const d = VCA.parse(['_TESTHOLE=R;C;1.5;2.5', '_TESTHOLE=L;C;3;4'].join(CRLF));
    const o = VCA.occurrences(d, '_TESTHOLE');
    eq([o[0].x, o[1].eye], ['1.5', 'L']);
    ok(VCA.recordDef('_testhole').repeat, 'recordDef');
  });
  
  test('"|" で区切った複数の値と、16 文字を超えるラベルの警告', { spec: ['5.20', '5.1.7', '5.1.8'], kind: ['正常', '境界'], req: ['O003'] }, () => {
    eq(VCA.subValues('1.0|2.0|3'), ['1.0', '2.0', '3']);
    eq(VCA.subValues(undefined), []);
    const d = VCA.parse('ABCDEFGHIJKLMNOPQ=1');
    ok(d.warnings.some(w => w.includes('16 文字')));
    eq(VCA.parse('_X=1').records[0].vendor, true, '"_" ラベルは vendor');
  });
  
  test('レコード順序の確認(パケット・ファイル)', { spec: ['6.1.1', '7.5'], kind: ['正常', '異常'], req: ['R146', 'R147', 'R183', 'R228'] }, () => {
    eq(VCA.parsePacket(VCA.buildPacket([['REQ', 'TRC'], ['JOB', '1']])).warnings.filter(w => w.includes('最初') || w.includes('2 番目')), [], '正しい順序');
    ok(VCA.parsePacket(VCA.buildPacket([['JOB', '1'], ['REQ', 'TRC']])).warnings.some(w => w.includes('最初')), 'REQ が先頭でない');
    ok(VCA.parsePacket(VCA.buildPacket([['REQ', 'EDG'], ['DEV', 'EDG']])).warnings.some(w => w.includes('JOB')), 'JOB が 2 番目でない');
    eq(VCA.parsePacket(VCA.buildPacket([['REQ', 'INI'], ['DEV', 'TRC']])).warnings.filter(w => w.includes('JOB')), [], 'INI は JOB 不要');
    eq(VCA.checkOrder(VCA.parse(['REQ=FIL', 'JOB=1'].join(CRLF)), { file: true }), [], 'ファイル');
    ok(VCA.checkOrder(VCA.parse('JOB=1'), { file: true }).some(w => w.includes('REQ=FIL')), 'REQ=FIL が無い');
  });

  test('ファイルの決まり(7.5.5・7.5.6): REQ は FIL・FRM・SDF、CRC・STATUS なし、玉型は形式 1', { spec: ['7.5'], kind: ['正常', '異常'], req: ['R096', 'R182', 'R183'] }, () => {
    const file = lines => VCA.checkOrder(VCA.parse(lines.join(CRLF)), { file: true });
    eq(file(['REQ=SDF', 'JOB=1']), []);
    ok(file(['REQ=EDG', 'JOB=1']).some(w => w.includes('FIL・FRM・SDF')), 'REQ=EDG');
    eq(file(['REQ=FIL', 'JOB=1', 'STATUS=0', 'CRC=123']).length, 2, 'CRC と STATUS');
    const bin = VCA.datasetRecords({ fmt: 2, values: [2500, 2500, 2500, 2500], eye: 'R' })
      .map(r => r[0] + '=' + r.slice(1).join(';'));
    ok(file(['REQ=FIL', 'JOB=1'].concat(bin)).some(w => w.includes('形式 1')), '形式 2 の玉型');
  });
  
  test('JOB が 2 番目でなくてよいパケット(TIM・MNT・CON・ANS=ERR・LNF・CMD)', { spec: ['6.1.1', '7.1'], kind: ['正常'], req: ['R147'] }, () => {
    const w = recs => VCA.parsePacket(VCA.buildPacket(recs)).warnings.filter(m => m.includes('2 番目'));
    eq(w([['REQ', 'TIM']]), [], 'TIM');
    eq(w([['REQ', 'MNT'], ['STATUS', '0'], ['DEV', 'GEN']]), [], 'MNT');
    eq(w([['REQ', 'CON'], ['IP', '169.254.1.1'], ['PORT', '50000']]), [], 'CON');
    eq(w([['ANS', 'ERR'], ['STATUS', '18']]), [], 'ANS=ERR');
    eq(w([['REQ', 'LNF'], ['OPC', '12345', '']]), [], 'LNF は OPC');
    eq(w([['REQ', 'LNF'], ['JOB', '1']]).length, 1, 'LNF に OPC が無い');
    eq(w([['REQ', 'CMD'], ['LIB', 'framefile']]), [], 'CMD は LIB でもよい');
    eq(w([['REQ', '1643'], ['DEV', 'GEN']]).length, 1, '要求 ID の要求には JOB が必要');
    eq(VCA.checkOrder(VCA.parse(['REQ=FRM', 'JOB=1'].join(CRLF)), { file: true }), [], 'REQ=FRM のファイル');
  });
  
  // ---- トレース(形式 1) ------------------------------------------------------
  const radii8 = [2500, 2400, 2000, 2400, 2500, 2400, 2000, 2400];
  
  test('TRCFMT=0 はトレースなし', { spec: ['5.4.1-5.4.3'], kind: ['境界'] }, () => {
    const d = VCA.parse('TRCFMT=0');
    eq(d.traces.length, 0); ok(d.warnings.length === 1, '警告 1 件');
  });
  
  test('形式 1・等角度', { spec: ['5.4.1-5.4.3', '5.4.15'], kind: ['正常'], req: ['R024', 'R173'] }, () => {
    const d = VCA.parse(['TRCFMT=1;8;E;R;F', 'R=' + radii8.join(';')].join(CRLF));
    const t = d.traces[0];
    eq(t.radii, radii8); eq(t.equi, true); eq(t.kind, 'F');
    const p = VCA.tracePoints(t);
    eq(p[2].a, 90, '3 点目の角度'); eq(+p[2].y.toFixed(6), 20, '3 点目の y');
  });
  
  test('形式 1・不等角度(U)と A レコード', { spec: ['5.4.1-5.4.3', '5.4.5-5.4.7'], kind: ['正常'], req: ['R021', 'R026', 'R221'] }, () => {
    const ang = [0, 4000, 9000, 14000, 18000, 22000, 27000, 32000];
    const d = VCA.parse(['TRCFMT=1;8;U;L;P', 'R=' + radii8.join(';'), 'A=' + ang.join(';')].join(CRLF));
    const t = d.traces[0];
    eq(t.angles, ang); eq(t.eye, 'L'); eq(d.errors, []);
    eq(VCA.tracePoints(t)[1].a, 40);
  });
  
  test('角度モード C(角度が戻ってもよい)は順序を保つ', { spec: ['5.4.1-5.4.3'], kind: ['正常'] }, () => {
    const ang = [0, 9000, 8000, 18000, 27000, 26000, 30000, 35000];
    const d = VCA.parse(['TRCFMT=1;8;C;R;F', 'R=' + radii8.join(';'), 'A=' + ang.join(';')].join(CRLF));
    eq(d.traces[0].equi, false);
    eq(VCA.tracePoints(d.traces[0]).map(p => p.a), ang.map(a => a / 100));
  });
  
  test('ZFMT / Z / ZA は R に混ざらない', { spec: ['5.4.4', '5.4.14', '5.1.9'], kind: ['正常'], req: ['R000', 'R014', 'R025', 'R027'] }, () => {
    const d = VCA.parse(['TRCFMT=1;8;E;R;F', 'R=' + radii8.join(';'), 'ZFMT=1;8;E;R;F',
                         'Z=10;20;30;40;50;60;70;80'].join(CRLF));
    eq(d.traces[0].radii, radii8); eq(d.traces[0].sag.values.length, 8);
  });
  
  test('両眼データ(2 つの TRCFMT)', { spec: ['5.4.10-5.4.13'], kind: ['正常'], req: ['R038', 'R039'] }, () => {
    const d = VCA.parse(['TRCFMT=1;8;E;R;F', 'R=' + radii8.join(';'),
                         'TRCFMT=1;8;E;L;F', 'R=' + radii8.join(';')].join(CRLF));
    eq(d.traces.map(t => t.eye), ['R', 'L']);
  });
  
  test('左右反転: 右眼データの 0°(鼻側)は左眼の向きで 180°', { spec: ['5.4.10-5.4.13'], kind: ['正常'], req: ['R036', 'R039'] }, () => {
    const d = VCA.parse(['TRCFMT=1;8;E;R;F', 'R=' + radii8.join(';')].join(CRLF));
    const asL = VCA.tracePoints(d.traces[0], 'L');
    const p = asL.find(q => q.r === 25 && Math.abs(q.a - 180) < 1e-9);
    ok(p, '180° に半径 25 mm の点がある');
  });
  
  test('左右反転: 0°と180°が入れ替わり、90°・270°は変わらない。点は反時計回りに並ぶ', { spec: ['5.4.10-5.4.13'], kind: ['境界'], req: ['R036'] }, () => {
    const d = VCA.parse(['TRCFMT=1;4;E;R;F', 'R=2000;2100;2200;2300'].join(CRLF));
    const asL = VCA.tracePoints(d.traces[0], 'L');
    const at = a => asL.find(q => Math.abs(q.a - a) < 1e-9).r;
    eq([at(0), at(90), at(180), at(270)], [22, 21, 20, 23]);
    const steps = asL.map((q, i) => (asL[(i + 1) % asL.length].a - q.a + 360) % 360);
    ok(steps.every(s => s === 90), '隣の点との角度差がすべて +90°');
  });
  
  test('点数の不一致は警告', { spec: ['5.4.1-5.4.3'], kind: ['異常'] }, () => {
    const d = VCA.parse(['TRCFMT=1;10;E;R;F', 'R=' + radii8.join(';')].join(CRLF));
    ok(d.warnings.some(w => w.includes('一致しません')));
  });
  
  // ---- バイナリ形式 ----------------------------------------------------------
  test('予約文字は ESC と最上位ビットを立てた値に、普通の文字はそのまま。16 ビットの値は下位バイトが先(5.4.16)',
    { spec: ['5.4.16', '3.2'], kind: ['正常'], req: ['R008', 'R009', 'R010'] }, () => {
      eq(VCA.escapeBinary('\x0a'), '\x1b\x8a', 'LF');
      eq(VCA.escapeBinary('\x1c\x1d\x1e'), '\x1b\x9c\x1b\x9d\x1b\x9e', 'FS・GS・RS');
      eq(VCA.escapeBinary('A\x7f'), 'A\x7f', '予約文字でなければそのまま');
      eq(VCA.encodeBinary(2, [258]), '\x02\x01', '258 = 0x0102 は 02 01 の順');
    });

  test('エスケープ: 全 256 バイトで往復一致',{ spec: ['5.4.16', '3.2'], kind: ['境界'], req: ['R008', 'R011'] }, () => {
    let s = ''; for (let i = 0; i < 256; i++) s += String.fromCharCode(i);
    const e = VCA.escapeBinary(s);
    ok(!/[\x1c\x1d\x1e\x0d\x0a]/.test(e), '予約制御文字が残っていない');
    eq(VCA.unescapeBinary(e), s);
  });
  
  function binaryFile(fmt, radii, angles, mode) {
    let t = `TRCFMT=${fmt};${radii.length};${mode || 'E'};R;F` + CRLF +
            'R=' + VCA.escapeBinary(VCA.encodeBinary(fmt, radii)) + CRLF;
    if (angles) t += 'A=' + VCA.escapeBinary(VCA.encodeBinary(fmt, angles)) + CRLF;
    return t;
  }
  // 下位バイトが LF(0x0A)や FS(0x1C)になる値、大きな差分、減少を含む
  const tricky = [2570, 2572, 2600, 2300, 2810, 7180, 2588, 2475, 2475, 2602];
  
  test('形式 2(バイナリ絶対値)の往復', { spec: ['5.4.15'], kind: ['正常'], req: ['R045'] }, () => {
    eq(VCA.parse(binaryFile(2, tricky)).traces[0].radii, tricky);
  });
  
  test('形式 3(バイナリ差分)の往復', { spec: ['5.4.15'], kind: ['正常'], req: ['R043', 'R044'] }, () => {
    eq(VCA.parse(binaryFile(3, tricky)).traces[0].radii, tricky);
  });
  
  test('形式 2・不等角度: 35999 までの角度を扱える', { spec: ['5.4.15', '5.4.1-5.4.3'], kind: ['境界'], req: ['R022'] }, () => {
    const ang = [0, 3000, 9000, 15000, 20000, 25000, 30000, 33000, 35000, 35999];
    const t = VCA.parse(binaryFile(2, tricky, ang, 'U')).traces[0];
    eq(t.angles, ang);
  });
  
  function sagBlock(fmt, values, angles) {
    let t = `ZFMT=${fmt};${values.length};${angles ? 'U' : 'E'};R;F` + CRLF +
            'Z=' + VCA.escapeBinary(VCA.encodeBinary(fmt, values)) + CRLF;
    if (angles) t += 'ZA=' + VCA.escapeBinary(VCA.encodeBinary(fmt, angles)) + CRLF;
    return t;
  }
  const sagVals = [10, 266, 300, 28, 700, 1200, 13, 400, 410, 395];
  
  test('ZFMT 形式 2・3 のサグを復号する', { spec: ['5.4.14', '5.4.15'], kind: ['正常'] }, () => {
    for (const fmt of [2, 3]) {
      const d = VCA.parse(binaryFile(fmt, tricky) + sagBlock(fmt, sagVals));
      eq(d.traces[0].radii, tricky, `形式${fmt} の R`);
      eq(d.traces[0].sag.values, sagVals, `形式${fmt} の Z`);
      eq(d.errors, [], `形式${fmt} のエラー`);
    }
  });
  
  test('ZFMT 形式 2・不等角度の ZA を復号する', { spec: ['5.4.14'], kind: ['正常'], req: ['R026'] }, () => {
    const ang = [0, 3000, 9000, 15000, 20000, 25000, 30000, 33000, 35000, 35999];
    const s = VCA.parse(binaryFile(2, tricky) + sagBlock(2, sagVals, ang)).traces[0].sag;
    eq(s.angles, ang);
  });
  
  test('ZFMT の点数の不一致は警告、未対応の形式はエラー', { spec: ['5.4.14'], kind: ['異常'] }, () => {
    const d = VCA.parse(binaryFile(2, tricky) + sagBlock(2, sagVals).replace('ZFMT=2;10', 'ZFMT=2;12'));
    ok(d.warnings.some(w => w.includes('ZFMT') && w.includes('一致しません')), '点数の警告');
    const d5 = VCA.parse(binaryFile(2, tricky) + 'ZFMT=5;10;E;R;F' + CRLF + 'Z=\x01\x02' + CRLF);
    ok(d5.errors.some(e => e.includes('ZFMT 形式5')), '形式 5 のエラー');
  });
  
  test('形式 2 の奇数バイトはエラー(余りを黙って捨てない)', { spec: ['5.4.15'], kind: ['異常'] }, () => {
    let threw = false;
    try { VCA.decodeBinary(2, '\x01\x02\x03'); } catch (e) { threw = true; }
    ok(threw, 'decodeBinary が例外を投げる');
    const d = VCA.parse('TRCFMT=2;2;E;R;F' + CRLF + 'R=\x01\x02\x03' + CRLF);
    ok(d.errors.some(e => e.startsWith('R:')), 'parse のエラー');
    eq(d.traces[0].radii, [], '壊れた値は返さない');
  });
  
  test('形式 3 の途中切れはエラー(先頭 1 バイト、0x80 の後の絶対値が足りない)', { spec: ['5.4.15'], kind: ['異常'], req: ['R043'] }, () => {
    for (const s of ['\x01', '\xc4\x09\x01\x80\x10', '\xc4\x09\x80']) {
      let threw = false;
      try { VCA.decodeBinary(3, s); } catch (e) { threw = true; }
      ok(threw, JSON.stringify(s));
    }
    eq(VCA.decodeBinary(3, ''), [], '空なら空');
    const z = VCA.parse(binaryFile(3, tricky) + 'ZFMT=3;3;E;R;F' + CRLF + 'Z=\xc4\x09\x80' + CRLF);
    ok(z.errors.some(e => e.startsWith('Z:')), 'Z の途中切れも parse のエラー');
  });
  
  test('形式 5 以降は未対応としてエラー', { spec: ['5.4.15'], kind: ['異常'] }, () => {
    const d = VCA.parse(['TRCFMT=5;8;E;R;F', 'R=\x01\x02'].join(CRLF));
    ok(d.errors.some(e => e.includes('形式5')));
  });
  
  // ---- 形式 4(パックトバイナリ) ----------------------------------------------
  // 規格 5.4.15 の 40 点のサンプルと、5.4.15.4 の符号化例(エスケープ前・後)
  const spec40 = [2479, 2583, 2605, 2527, 2394, 2253, 2137, 2044, 1975, 1935, 1922, 1939, 1989, 2072, 2184, 2322,
    2471, 2599, 2645, 2579, 2517, 2450, 2379, 2318, 2247, 2168, 2086, 2014, 1958, 1923, 1909, 1914, 1941, 1983,
    2033, 2089, 2140, 2200, 2277, 2371];
  const hexOf = s => Array.from(s, c => c.charCodeAt(0).toString(16).padStart(2, '0')).join(' ');
  const fromHex = h => h.split(' ').map(x => String.fromCharCode(parseInt(x, 16))).join('');
  const spec4 = 'af 09 00 80 68 16 b2 81 5a 09 cd 08 00 80 8c a3 bb d8 f3 11 32 53 70 81 12 09 a7 09 27 0a 00 80 2e ' +
    'be 80 4b c8 c3 b9 b1 80 d8 b8 c8 dd f2 05 1b 2a 32 80 6b 83 c4 d5 e0';
  const spec4esc = 'af 09 00 80 68 16 b2 81 5a 09 cd 08 00 80 8c a3 bb d8 f3 1b 91 32 53 70 81 12 09 a7 09 27 1b 8a 00 80 ' +
    '2e be 80 4b c8 c3 b9 b1 80 d8 b8 c8 dd f2 05 1b 9b 2a 32 80 6b 83 c4 d5 e0';
  
  test('形式 4: 規格の符号化例とバイト単位で一致(エスケープ前・後)', { spec: ['5.4.15', '附属書 B'], kind: ['規格の例'] }, () => {
    const p = VCA.encodeBinary(4, spec40);
    eq(hexOf(p), spec4, 'エスケープ前');
    eq(hexOf(VCA.escapeBinary(p)), spec4esc, 'エスケープ後');
  });
  
  test('形式 4: 規格の例を復号すると元の 40 点になる', { spec: ['5.4.15', '附属書 B'], kind: ['規格の例'], req: ['R011'] }, () => {
    eq(VCA.decodeBinary(4, fromHex(spec4), 40), spec40);
    const d = VCA.parse('TRCFMT=4;40;E;R;F' + CRLF + 'R=' + fromHex(spec4esc) + CRLF);
    eq(d.traces[0].radii, spec40, 'parse 経由'); eq(d.errors, []);
  });
  
  test('形式 4: 大きな差・小さな差・減少が混ざった値と角度の往復', { spec: ['5.4.15'], kind: ['境界'], req: ['R044'] }, () => {
    const vals = [2540, 2562, 2597, 2720, 2800, 2830, 2835, 2840, 2843, 9000, 9001, 8990, 2000, 2003, 2010, 1990];
    eq(VCA.decodeBinary(4, VCA.encodeBinary(4, vals), vals.length), vals, '値');
    const ang = [0, 2250, 4500, 6750, 9000, 11250, 13500, 15750, 18000, 20250, 22500, 24750, 27000, 29250, 31500, 35999];
    const t = VCA.parse(VCA.datasetRecords({ fmt: 4, values: vals, angles: ang, eye: 'L' }).map(r => r[0] + '=' + r.slice(1).join(';')).join(CRLF)).traces[0];
    eq([t.radii, t.angles, t.eye, t.mode], [vals, ang, 'L', 'U'], 'datasetRecords 経由');
  });
  
  test('形式 4: 途中で切れたデータはエラー', { spec: ['5.4.15'], kind: ['異常'] }, () => {
    let threw = false;
    try { VCA.decodeBinary(4, fromHex(spec4).slice(0, 20), 40); } catch (e) { threw = true; }
    ok(threw);
  });
  
  // ---- ラベル定義表 ----------------------------------------------------------
  test('定義表: 附属書 A の全ラベル(表 A.1・A.1a・A.2・A.27)を持つ', { spec: ['表 A.1・A.1a・A.2・A.27', '5.1.1-5.1.2'], kind: ['正常'] }, () => {
    ok(VCA.version === '3.14', '版');
    ok(VCA.labels().length >= 490, 'ラベル数 ' + VCA.labels().length);
    ['DRILLE', 'DRILLS', 'ENGMARK', 'BEVP', 'HBOX', 'SDFMODE', 'SHLFFMT', 'TOLSHAPE', 'DOSDF', 'PMFMT', 'DD']
      .forEach(l => ok(VCA.recordDef(l), l));
  });
  
  test('定義表: 左右・単一・複数・廃止の区別', { spec: ['表 A.1・A.1a・A.2・A.27', '5.1.10'], kind: ['正常'] }, () => {
    eq(VCA.recordDef('SPH').k, 'c', 'SPH は左右');
    eq(VCA.recordDef('HBOX').k, 'o', 'HBOX は左右(単一値は両眼)');
    eq(VCA.recordDef('DBL').k, 's', 'DBL は単一');
    eq(VCA.recordDef('DRILLE').p, 1, 'DRILLE は複数可');
    eq(VCA.recordDef('DRILL').dep, 'DRILLE', 'DRILL は廃止(後継 DRILLE)');
    eq(VCA.recordDef('LTYP').dep, 'LTYPE', 'LTYP は廃止(後継 LTYPE)');
  });
  
  test('定義表: 測定値の接頭辞(INS・TOL・TOLV・CK・LD)', { spec: ['5.21', '表 A.1・A.1a・A.2・A.27'], kind: ['正常'] }, () => {
    const ins = VCA.recordDef('INSADD');
    eq([ins.derived, ins.base, ins.k], ['INS', 'ADD', 'c']);
    eq(VCA.recordDef('TOLVADD').t, 'min|max');
    eq(VCA.recordDef('CKADD').t, 'literal');
    eq(VCA.recordDef('INSDBL'), undefined, 'M 欄が空のラベルには付かない');
    const d = VCA.parse(['TOLVADD=-0.04|0.06;-0.04|0.06', 'INSADD=1.96;1.97'].join(CRLF));
    eq(VCA.subValues(VCA.value(d, 'TOLVADD', 'L')), ['-0.04', '0.06'], 'min|max');
    eq(VCA.number(d, 'INSADD', 'L'), 1.97);
    eq(d.unknown, [], '未知のラベルなし');
  });
  
  test('定義表: 単一値の左右レコード(BEVP=7)は両眼に適用、廃止ラベルは警告', { spec: ['5.1.1-5.1.2', '5.7'], kind: ['正常', '異常'] }, () => {
    const d = VCA.parse(['BEVP=7', 'DRILL=B;-22;3', 'ZZTOP=1', '_X=1'].join(CRLF));
    eq([VCA.number(d, 'BEVP', 'R'), VCA.number(d, 'BEVP', 'L')], [7, 7]);
    ok(d.warnings.some(w => w.includes('DRILL') && w.includes('DRILLE')), '廃止の警告');
    eq(d.unknown, ['ZZTOP'], '未知のラベル("_" は除く)');
  });
  
  test('値の個数の確認(単一レコードに複数、左右レコードに 3 つ以上)', { spec: ['5.1.1-5.1.2'], kind: ['異常'] }, () => {
    const d = VCA.parse(['DBL=18;19', 'SPH=-1;-2;-3', 'CYL=?'].join(CRLF));
    ok(d.warnings.some(w => w.startsWith('DBL')), 'DBL');
    ok(d.warnings.some(w => w.startsWith('SPH')), 'SPH');
    ok(!d.warnings.some(w => w.startsWith('CYL')), '"?" だけなら警告しない');
  });
  
  // ---- 穴あけ(DRILLE) -------------------------------------------------------
  test('DRILLE: 規格の最小例と全項目の例', { spec: ['5.5'], kind: ['規格の例'], req: ['R059', 'R071'] }, () => {
    const d = VCA.parse(['DRILLE=B;C;-17.0;10.32', 'DRILLE=B;C;-17.0;10.32;2.3;-15.0;10.32;1.5;1;A;-15.0;5.0'].join(CRLF));
    const r = VCA.drillFeatures(d);
    eq(r.status, 'present'); eq(r.errors, []);
    const [a, b] = r.features;
    eq([a.eye, a.origin, a.mount, a.x, a.y, a.shape, a.depth, a.featureType], ['B', 'C', 'F', -17, 10.32, 'hole', 0, 1]);
    eq([b.diameter, b.xEnd, b.shape, b.depth, b.angleMode, b.lateralAngle, b.verticalAngle], [2.3, -15, 'slot', 1.5, 'A', -15, 5]);
    eq(a.angleMode, 'A', '同じ側の穴は角度モードを共有する(5.5.2.10.8)');
  });
  
  test('DRILLE: 穴なし(0)・未対応(?)・片眼だけ穴なし・レコードなし', { spec: ['5.5'], kind: ['境界'], req: ['R072', 'R073'] }, () => {
    eq(VCA.drillFeatures(VCA.parse('DRILLE=0')).status, 'none');
    eq(VCA.drillFeatures(VCA.parse('DRILLE=?')).status, 'unknown');
    eq(VCA.drillFeatures(VCA.parse('DBL=18')).status, 'absent');
    const r = VCA.drillFeatures(VCA.parse(['DRILLE=L;0', 'DRILLE=R;C;20;5'].join(CRLF)));
    eq(r.features.map(f => f.eye), ['R']);
    eq(r.features[0].angleMode, 'F', '角度モードの指定がどこにも無ければ F(前面の法線)');
  });
  
  test('DRILLE: 縁基準(耳側・後面取付)、矩形、グループ、エラー', { spec: ['5.5'], kind: ['正常', '異常'], req: ['R052', 'R054', 'R056', 'R058', 'R062'] }, () => {
    const r = VCA.drillFeatures(VCA.parse([
      'DRILLE=R;ETR;2.0;3.0;1.4;4.0;1.0;;2', 'DRILLE=R;ETR;2.0;-3.0;1.4;;;;;;;;;;A1', 'DRILLE=R;ETR;0;0;;;;;;;;;;;A2;1'].join(CRLF)));
    const [a, b, c] = r.features;
    eq([a.origin, a.side, a.mount, a.shape], ['E', 'T', 'R', 'rectangle']);
    eq([b.group, c.group, c.resize], [{ id: 'A', seq: 1 }, { id: 'A', seq: 2 }, 1]);
    const bad = VCA.drillFeatures(VCA.parse(['DRILLE=X;Q;1;2', 'DRILLE=R;C;1;2;;;;;2', 'DRILLE=R;C;1;2;;;;;;A'].join(CRLF)));
    ok(bad.errors.some(e => e.includes('眼')), '眼の指定');
    ok(bad.errors.some(e => e.includes('基準')), '基準');
    ok(bad.errors.some(e => e.includes('終点')), '矩形の終点');
    ok(bad.errors.some(e => e.includes('角度モード A')), '角度');
  });
  
  test('DRILLE: 基準が混在するとエラー、両眼データを左眼用に反転', { spec: ['5.5'], kind: ['正常', '異常'], req: ['R050', 'R053'] }, () => {
    const r = VCA.drillFeatures(VCA.parse(['DRILLE=B;C;-17;10;;;;;;;5', 'DRILLE=B;ENF;2;10'].join(CRLF)));
    ok(r.errors.some(e => e.includes('同じ基準')));
    const l = VCA.mirrorFeature(r.features[0]);
    eq([l.eye, l.x, l.y, l.lateralAngle], ['L', 17, 10, -5]);
    eq(VCA.mirrorFeature(r.features[1]).x, 2, '縁基準は x をそのまま使う');
  });
  
  test('drillRecords: DRILLE レコードを組み立て、読み直すと同じ穴になる', { spec: ['5.5'], kind: ['正常'], req: ['R046'] }, () => {
    const text = ['DRILLE=B;C;-17.0;10.32', 'DRILLE=B;C;-17.0;10.32;2.3;-15.0;10.32;1.5;1;A;-15.0;5.0',
      'DRILLE=R;C;20;5;1.4;;;;;;;;;;A1;1'].join(CRLF);
    const before = VCA.drillFeatures(VCA.parse(text)).features;
    const recs = VCA.drillRecords(before);
    eq(recs[0], ['DRILLE', 'B', 'C', '-17.00', '10.32'], '空の末尾は書かない');
    eq(recs[1].slice(9, 11), ['', 'A'], '角度の付いた A は書く(featureType 1 は省く)');
    eq(recs[2].slice(-2), ['A1', '1'], 'グループとサイズ変更');
    const after = VCA.drillFeatures(VCA.parse(recs.map(r => r[0] + '=' + r.slice(1).join(';')).join(CRLF)));
    eq(after.errors, []); eq(after.features, before, '往復');
    const e = VCA.drillRecords([{ eye: 'R', origin: 'E', side: 'T', mount: 'R', x: 2, y: 3, diameter: 1.4, xEnd: 4, yEnd: 1, featureType: 2 }]);
    eq(e[0].slice(1, 3), ['R', 'ETR']);
  });
  
  test('drillRecords: 穴なしは DRILLE=0、基準の混在や不足はエラー', { spec: ['5.5'], kind: ['境界', '異常'], req: ['R050', 'R072'] }, () => {
    eq(VCA.drillRecords([]), [['DRILLE', '0']]);
    const throws = (fs, word) => { let m = ''; try { VCA.drillRecords(fs); } catch (err) { m = err.message; } ok(m.includes(word), word); };
    throws([{ eye: 'R', x: 1, y: 2 }, { eye: 'R', origin: 'E', side: 'N', x: 1, y: 2 }], '同じ基準');
    throws([{ eye: 'R', origin: 'E', x: 1, y: 2 }], '鼻側・耳側');
    throws([{ eye: 'X', x: 1, y: 2 }], '眼');
    throws([{ eye: 'R', x: 1, y: 2, featureType: 2 }], '終点');
  });
  
  test('廃止された DRILL も読める(DRILLE が無いとき)', { spec: ['6.2', '5.5'], kind: ['正常'] }, () => {
    const r = VCA.drillFeatures(VCA.parse('DRILL=R;-22.0;3.25;1.40'));
    eq([r.legacy, r.features[0].x, r.features[0].diameter, r.features[0].origin], [true, -22, 1.4, 'C']);
  });
  
  // ---- データセット ------------------------------------------------------------
  test('CRIBFMT の R は玉型に混ざらない', { spec: ['5.10'], kind: ['正常'] }, () => {
    const d = VCA.parse(['TRCFMT=1;4;E;R;F', 'R=2000;2100;2200;2300', 'CRIBFMT=1;4;E;R', 'R=3000;3000;3000;3000', 'DBL=18'].join(CRLF));
    eq(d.traces[0].radii, [2000, 2100, 2200, 2300], '玉型');
    const crib = d.datasets.find(x => x.type === 'CRIBFMT');
    eq(crib.series.R, [3000, 3000, 3000, 3000], '削り落とし形状'); eq(d.rec.DBL, ['18']);
    eq(VCA.tracePoints(crib)[0].r, 30, 'tracePoints にも渡せる');
  });
  
  test('削り落とし形状・面の厚み・棚の点数の不一致と、TRCFMT の無い ZFMT は警告', { spec: ['5.10', '5.11', '5.8', '5.4.4'], kind: ['異常'], req: ['R027'] }, () => {
    const w = lines => VCA.parse(lines.join(CRLF)).warnings;
    ok(w(['CRIBFMT=1;4;E;R', 'R=3000;3000;3000']).some(x => x.includes('点数')), 'CRIBFMT の点数');
    ok(w(['STHKFMT=1;4;U;R', 'R=1;1;1;1', 'A=0;9000;18000;27000', 'T=1;1;1']).some(x => x.includes('T の個数')), 'STHKFMT の T');
    ok(w(['SHLFFMT=1;4;E;R;B', 'S=1;1;1']).some(x => x.includes('点数')), 'SHLFFMT の点数');
    ok(w(['ZFMT=1;4;E;R;F', 'Z=1;1;1;1']).some(x => x.includes('ZFMT の前に TRCFMT')), 'TRCFMT の無い ZFMT');
  });

  test('STHKFMT(厚み T)と SHLFFMT(棚 S・SA・SD)',{ spec: ['5.11', '5.8'], kind: ['正常'], req: ['R084', 'R087'] }, () => {
    const d = VCA.parse(['STHKFMT=1;4;E;R', 'R=2000;2000;2000;2000', 'T=150;160;170;180',
      'SHLFFMT=1;3;U;R;R;F', 'S=2400;2450;2500', 'SA=0;1000;2000', 'SD=50;50;50'].join(CRLF));
    const th = d.datasets.find(x => x.type === 'STHKFMT'), sh = d.datasets.find(x => x.type === 'SHLFFMT');
    eq(th.series.T, [150, 160, 170, 180]);
    eq([sh.series.S, sh.series.SA, sh.series.SD, sh.info.reference, sh.info.removeFrom], [[2400, 2450, 2500], [0, 1000, 2000], [50, 50, 50], 'R', 'F']);
    eq(d.errors, []);
  });
  
  test('棚が 2 つなら、棚ごとに SHLFFMT と S が続く(5.8.1)', { spec: ['5.8'], kind: ['正常'], req: ['R082'] }, () => {
    const d = VCA.parse(['SHLFFMT=1;3;E;R;R;F', 'S=2400;2450;2500', 'SHLFFMT=1;2;E;R;R;B', 'S=2300;2350'].join(CRLF));
    const sh = d.datasets.filter(x => x.type === 'SHLFFMT');
    eq([sh.length, sh[0].series.S, sh[1].series.S, sh[1].info.removeFrom], [2, [2400, 2450, 2500], [2300, 2350], 'B']);
    eq(d.errors, []);
  });

  test('SURFMT(ZZ の表と傾き)・DDFMT(DD)・行数の確認', { spec: ['5.9.1-5.9.6', '5.14', '5.13'], kind: ['正常', '異常'], req: ['R111', 'R133', 'R136'] }, () => {
    const d = VCA.parse(['SURFMT=1;R;B;3;3;10.0;10.0;1', 'ZZ=?;1.5;?', 'ZZ=1.0;0;1.0', 'ZZ=?;1.5;?',
      'DZY=0.1;0.1;0.1;0.2;0.2;0.2', 'DZX=0.1;0.1;0.1;0.2;0.2;0.2', 'DZXY=1;2;3;4',
      'DDFMT=1;R;2', 'DD=0;T;Distance;1;0.03;0.12', 'DD=1;T;Near;1;0.05;0.12', 'WMFMT=1;R;0;2;3;5;5', 'WW=1;1', 'WW=0;1'].join(CRLF));
    const s = d.datasets.find(x => x.type === 'SURFMT');
    eq([s.rows.length, s.rows[0], s.extra.DZXY, s.info.surface], [3, [undefined, 1.5, undefined], [1, 2, 3, 4], 'B']);
    eq(d.datasets.find(x => x.type === 'DDFMT').rows[1][2], 'Near');
    ok(d.warnings.some(w => w.includes('WMFMT') && w.includes('行数')), 'WMFMT の行数');
  });
  
  test('初期化パケットの TRCFMT・DRLFMT は対応形式の候補として扱う(5.5.3 の例)', { spec: ['5.4.17', '5.5'], kind: ['規格の例'], req: ['R047', 'R051'] }, () => {
    const pkt = VCA.buildPacket([['ANS', 'INI'], ['STATUS', '0'], ['DEV', 'EDG'], ['VEN', 'GC'], ['MODEL', 'LE-3'],
      ['TRCFMT', '4', '400', 'E', 'R'], ['TRCFMT', '4', '512', 'E', 'R'], ['TRCFMT', '1', '400', 'E', 'R'],
      ['DRLFMT', 'C'], ['DRLFMT', 'E'], ['DRLFMT', 'B']]);
    const d = VCA.parsePacket(pkt);
    eq(d.traces.length, 0, '玉型データではない');
    eq(d.proposals.map(p => p.fields.slice(0, 2).join(';')), ['4;400', '4;512', '1;400']);
    eq(d.all.DRLFMT.length, 3);
    eq(d.warnings, []);
  });
  
  test('見出しの無いデータレコードは警告', { spec: ['5.1.9', '5.4.5-5.4.7'], kind: ['異常'], req: ['R000', 'R014', 'R021', 'R024'] }, () => {
    ok(VCA.parse('R=2000;2000').warnings.some(w => w.includes('直後にありません')));
  });
  
  // ---- 装置ごとのレコード -------------------------------------------------------
  test('PROCBLK: ブロック番号付きのレコードをブロックごとに解析する(5.17.2 の例)', { spec: ['5.17'], kind: ['規格の例'] }, () => {
    const d = VCA.parse(['JOB=PROCBLKEXFSG', 'GAX=90.00;90.00', 'PROCBLK=1;FSG;SOM;HSC101;', '1!LMATID=70;70',
      '1!SCSBRD=2.50;2.50', '1!GAX=0;0', 'PROCBLK=2;FSG;LOH;VFT;', '2!RNGH=3.00;3.00', '2!CRIBFMT=1;4;E;L;F',
      '2!R=2988;2981;2997;3010'].join(CRLF));
    eq(d.rec.GAX, ['90.00', '90.00'], '本体の GAX はブロックの値で上書きされない');
    eq([d.blocks[1].decl.ven, d.blocks[1].rec.GAX, d.blocks[2].datasets[0].series.R.length], ['SOM', ['0', '0'], 4]);
    const recs = VCA.deviceRecords(d, { dev: 'FSG', ven: 'SOM', model: 'HSC101' });
    eq(recs.map(r => r.label), ['LMATID', 'SCSBRD', 'GAX']);
  });
  
  test('PROC: 装置を指定して取り出す(5.17.1 の例)', { spec: ['5.17'], kind: ['規格の例'] }, () => {
    const d = VCA.parse(['PROC=_P1PROC;POL;IGX;TURBO;010702250607000000;010702250607000000', 'PROC=LMATID;FSG;IGX;MARKX;62;62'].join(CRLF));
    eq(VCA.deviceRecords(d, { dev: 'FSG', ven: 'IGX', model: 'MARKX' }), [{ label: 'LMATID', fields: ['62', '62'], from: 'PROC' }]);
    eq(VCA.deviceRecords(d, { dev: 'POL', ven: 'IGX', model: 'TURBO' })[0].label, '_P1PROC');
  });
  
  test('自動フォーマット初期化の定義(DEF・D・ENDDEF)', { spec: ['7.2.4'], kind: ['正常'] }, () => {
    const d = VCA.parse(['REQ=INI', 'DEF=MYDEF', 'D=HBOX;VBOX;*CIRC', 'D=FCRV', 'ENDDEF=MYDEF', 'DEF=;1234'].join(CRLF));
    const defs = VCA.autoFormatDefinitions(d);
    eq(defs[0].labels.map(l => l.label + (l.mandatory ? '*' : '')), ['HBOX', 'VBOX', 'CIRC*', 'FCRV']);
    eq(defs[1].requestId, '1234');
  });
  
  // ---- プリセット・ステータス・書き出し -------------------------------------------
  test('プリセットパケット(表 A.7 エッジャー)と必須レコードの不足', { spec: ['表 A.5-A.23', '5.1.3'], kind: ['正常', '異常'] }, () => {
    const edg = VCA.presetRecords('EDG');
    ok(edg.some(r => r.label === 'DBL' && r.mandatory), 'DBL は必須');
    ok(edg.some(r => r.label === 'DRILLE' && r.since === '3.04'), 'DRILLE は 3.04 から');
    const miss = VCA.missingPresetRecords(VCA.parse(['DBL=18', 'CIRC=150;150'].join(CRLF)), 'EDG');
    ok(miss.indexOf('DBL') < 0 && miss.indexOf('IPD') >= 0, '不足の一覧');
  });
  
  test('ステータスコードと修飾ビット(表 A.24・A.25)', { spec: ['表 A.24-A.26'], kind: ['正常'] }, () => {
    const s = VCA.statusInfo(17 + 512);
    eq([s.code, s.modifiers], [17, [512]]);
    ok(VCA.STATUS[21] && VCA.XSTATUS_CODES[107] && VCA.DEVICE_TYPES.DRL && VCA.REQUEST_TYPES.DRL);
  });
  
  test('datasetRecords: 形式 1 は 1 行 80 文字以内', { spec: ['5.4.15'], kind: ['境界'], req: ['R042', 'R234'] }, () => {
    const recs = VCA.datasetRecords({ fmt: 1, values: spec40, eye: 'R', object: 'F' });
    eq(recs[0], ['TRCFMT', '1', '40', 'E', 'R', 'F']);
    ok(recs.slice(1).every(r => (r[0] + '=' + r.slice(1).join(';')).length <= 80), '80 文字以内');
    const d = VCA.parse(recs.map(r => r[0] + '=' + r.slice(1).join(';')).join(CRLF));
    eq(d.traces[0].radii, spec40);
  });

  // ---- 寸法・バイト列 ---------------------------------------------------------
  // 半径 r(mm)の円を n 点の等角度データにする
  const circle = (r, n) => VCA.parse([`TRCFMT=1;${n};E;R;F`].concat(
    Array.from({ length: n / 10 }, () => 'R=' + Array(10).fill(r * 100).join(';'))).join(CRLF)).traces[0];

  test('boxOf・circumference: 半径 25 mm の円は 50 × 50 mm、周長 2π × 25', { spec: ['5.4.9'], kind: ['正常'] }, () => {
    const pts = VCA.tracePoints(circle(25, 360));
    const b = VCA.boxOf(pts);
    ok(Math.abs(b.hbox - 50) < 1e-9 && Math.abs(b.vbox - 50) < 1e-9, '横幅・縦幅');
    ok(Math.abs(b.cx) < 1e-9 && Math.abs(b.cy) < 1e-9, '箱中心');
    ok(Math.abs(VCA.circumference(pts) - 2 * Math.PI * 25) < 0.01, '周長');
  });

  test('boxOf・circumference: 長方形の 4 点', { spec: ['5.4.9'], kind: ['正常'] }, () => {
    const pts = [{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 20 }, { x: 0, y: 20 }];
    eq(VCA.boxOf(pts), { hbox: 30, vbox: 20, cx: 15, cy: 10 });
    eq(VCA.circumference(pts), 100);
  });

  test('bytesToString: 1 バイト 1 文字、0x8000 バイトを超えても切れない', { spec: ['5.4.16'], kind: ['境界'] }, () => {
    eq(VCA.bytesToString(new Uint8Array([0x00, 0x1c, 0x41, 0x80, 0xff])), '\x00\x1cA\x80\xff');
    const big = new Uint8Array(70000).map((_, i) => i & 0xff);
    const s = VCA.bytesToString(big);
    eq([s.length, s.charCodeAt(0x8000), s.charCodeAt(69999)], [70000, 0x8000 & 0xff, 69999 & 0xff]);
  });

  // ---- 欄の名前 ---------------------------------------------------------------
  test('fieldsOf・occurrences: 規格の例(XSTATUS・REP・TOKEN、5.19.3・5.22)', { spec: ['5.19', '5.22', '5.18'], kind: ['規格の例'] }, () => {
    const d = VCA.parse(['REQ=INF', 'JOB=1234', 'TOKEN=UNIQUETOKENFORTHISORDERSUPPLIEDBYLDS', 'TIME=2013030301220000',
      'XSTATUS=B;100;Job completed.', 'REP=Spindle Temperature;153.1;2017-02-28T10:15:28.2Z;P15S;120.0|160.0;;degrees C'].join(CRLF));
    eq(d.warnings, []);
    eq(VCA.value(d, 'TOKEN'), 'UNIQUETOKENFORTHISORDERSUPPLIEDBYLDS');
    const x = VCA.fieldsOf(d, 'XSTATUS');
    eq([x.eye, x.code, x.text, x.severity], ['B', '100', 'Job completed.', 'W'], '4 番目の欄が無ければ W(附属書 A.5)');
    ok(/完了/.test(VCA.XSTATUS_CODES[100] || ''), 'XSTATUS 100 の説明');
    const rep = VCA.fieldsOf(d, 'REP');
    eq([rep.name, rep.value, rep.duration, VCA.subValues(rep.range), rep.eye, rep.unit],
      ['Spindle Temperature', '153.1', 'P15S', ['120.0', '160.0'], undefined, 'degrees C']);
  });

  test('fieldsOf: TIMEOUT・DRILLS・JOBRTE・ENGMARK の欄に名前が付く', { spec: ['5.6', '5.15', '6.1.3'], kind: ['正常'] }, () => {
    const d = VCA.parse(['TIMEOUT=5;30;5', 'DRILLS=R;1;90;2.5;;;1.0;3.0', 'JOBRTE=R;EDG;GC;LE-3;;;2024-01-01T10:00:00Z;0',
      'ENGMARK=MASK;LOGO;;R;F;;1.5;-2.0;;S'].join(CRLF));
    eq(VCA.fieldsOf(d, 'TIMEOUT'), { ack: '5', packet: '30', char: '5', _fields: ['5', '30', '5'] });
    const s = VCA.fieldsOf(d, 'DRILLS');
    eq([s.eye, s.featureType, s.startAngle, s.startDistance, s.endAngle, s.diameter, s.depth], ['R', '1', '90', '2.5', undefined, '1.0', '3.0']);
    const j = VCA.occurrences(d, 'JOBRTE')[0];
    eq([j.dev, j.ven, j.model, j.time, j.status], ['EDG', 'GC', 'LE-3', '2024-01-01T10:00:00Z', '0']);
    const e = VCA.occurrences(d, 'ENGMARK')[0];
    eq([e.kind, e.content, e.eye, e.surface, e.x, e.y, e.visibility], ['MASK', 'LOGO', 'R', 'F', '1.5', '-2.0', 'S']);
  });

  test('値の取り出し: ジェネレーター(5.3)・ヤゲン(5.7)・装置固有(5.16)のレコード', { spec: ['5.3', '5.7', '5.16', '5.9.1-5.9.6'], kind: ['正常'] }, () => {
    const d = VCA.parse(['GAX=90;180', 'GPRVM=1.5;?', 'BEVP=7', 'BEVM=40;50', 'BEVC=4.5', 'DSDEV=FSG;LOH;VFT;;SDF'].join(CRLF));
    eq([VCA.number(d, 'GAX', 'R'), VCA.number(d, 'GAX', 'L'), VCA.number(d, 'GPRVM', 'L')], [90, 180, undefined]);
    eq([VCA.number(d, 'BEVP', 'L'), VCA.number(d, 'BEVM', 'L'), VCA.number(d, 'BEVC', 'L')], [7, 50, 4.5], '単一値は両眼');
    const ds = VCA.fieldsOf(d, 'DSDEV');
    eq([ds.dev, ds.ven, ds.model, ds.sn], ['FSG', 'LOH', 'VFT', undefined]);
  });

  test('要求の種別・機器の種類の一覧は、表 A.3・A.4 と過不足なく一致する(表 A.3 に無いファイル用の FIL・FRM は 7.5.1)',
    { spec: ['表 A.3・A.4', '5.1.3', '7.5'], kind: ['正常', '境界'] }, () => {
      const a3 = ('INI TRC PTG EDG SBK FBK AGN BAS BRS CMD COA CON DNL DRL ENG ERR FSG FSP GEN INF INK INS LAP LDI LDS ' +
        'LMD LMI LMS LNF MNT POL SDF TIM UPL').split(' ');
      const a4 = 'TRC PTG EDG SBK FBK GEN AGN UPL DNL COA FSG LMD FIL INS LAP DRL FSP POL ENG INK'.split(' ');
      eq(Object.keys(VCA.REQUEST_TYPES).sort(), a3.concat(['FIL', 'FRM']).sort(), '表 A.3 と 7.5.1');
      eq(Object.keys(VCA.DEVICE_TYPES).sort(), a4.slice().sort(), '表 A.4');
    });

  // ---- データセット(5.9・5.12・5.13) ---------------------------------------------
  test('PMFMT(度数分布 PP)と WMFMT(重み WW)の表', { spec: ['5.12', '5.13'], kind: ['正常'] }, () => {
    const d = VCA.parse(['PMFMT=1;R;T;D;M;3;2;80.0;80.0;;;1', 'PP=?;2.12345;?', 'PP=2.1;2.2;2.3',
      'WMFMT=1;R;0;3;2;80.0;80.0', 'WW=0;0.5;1', 'WW=1;1;?'].join(CRLF));
    eq(d.warnings, []);
    const pm = d.datasets.find(x => x.type === 'PMFMT'), wm = d.datasets.find(x => x.type === 'WMFMT');
    eq([pm.info.powerType, pm.info.columns, pm.info.rows, pm.rows], ['T', '3', '2', [[undefined, 2.12345, undefined], [2.1, 2.2, 2.3]]]);
    eq([wm.info.index, wm.rows], ['0', [[0, 0.5, 1], [1, 1, undefined]]]);
  });

  test('PASSFMT(面形状の加工パス)の表', { spec: ['5.9.1-5.9.6'], kind: ['正常'] }, () => {
    const d = VCA.parse(['PASSFMT=1;R;B;3;2;10.0;10.0;1;;1', 'ZZ=1;2;3', 'ZZ=4;5;6'].join(CRLF));
    const p = d.datasets.find(x => x.type === 'PASSFMT');
    eq([p.eye, p.info.surface, p.info.columns, p.rows], ['R', 'B', '3', [[1, 2, 3], [4, 5, 6]]]);
  });

  // ---- データ型の要件(5.1.8) --------------------------------------------------
  test('データ型: limited は 12 文字まで、ASCII 以外の文字、255 文字を超える値', { spec: ['5.1.8', '3.3'], kind: ['境界', '異常'], req: ['O004', 'R007'] }, () => {
    ok(VCA.parse('JOB=123456789012').warnings.length === 0, '12 文字は可');
    ok(VCA.parse('JOB=1234567890123').warnings.some(w => w.includes('limited')), '13 文字は警告');
    ok(VCA.parse('REM=caf\xe9').warnings.some(w => w.includes('ASCII')), 'ASCII 以外');
    ok(VCA.parse('REM=a\x1bb').warnings.some(w => w.includes('ASCII')), '予約文字(ESC)は値に書けない(5.1.7.2)');
    eq(VCA.parse('REM=caf\xc3\xa9', { textEncoding: 'UTF-8' }).warnings, [], 'UTF-8 を取り決めたとき');
    eq(VCA.parse(['TXTENC=ASCII;UTF-8', 'REM=caf\xc3\xa9'].join(CRLF)).warnings, [], 'TXTENC に UTF-8');
    ok(VCA.parse('REM=' + 'x'.repeat(256)).warnings.some(w => w.includes('255')), '256 文字');
    // 左右レコードの limited は、右眼・左眼のそれぞれに 12 文字までを当てはめる(定義表には無いので定義を足して確かめる)
    VCA.defineRecords({ XLIM: { k: 'c', t: 'limited;' } });
    eq(VCA.parse('XLIM=123456789012;ABCDEFGHIJKL').warnings, [], '左右とも 12 文字');
    ok(VCA.parse('XLIM=1;ABCDEFGHIJKLM').warnings.some(w => w.includes('limited')), '左眼が 13 文字');
    eq(VCA.parse('REM=' + 'x'.repeat(255)).warnings, [], '255 文字は可');
  });

  // ---- 基準点(5.2) ---------------------------------------------------------------
  test('referencePoints: 基準点のずれのラベルを分ける(表 2・表 3)', { spec: ['5.2.1'], kind: ['正常', '異常'] }, () => {
    eq(VCA.referencePoints('FBFCIN'), { from: 'FB', to: 'FC', direction: 'IN',
      fromName: VCA.REFERENCE_POINTS.FB, toName: VCA.REFERENCE_POINTS.FC });
    eq(VCA.referencePoints('BRERA').direction, 'A');
    eq([VCA.referencePoints('SPH'), VCA.referencePoints('XXFCIN'), VCA.referencePoints('FBXXIN')], [null, null, null],
      '1 つ目・2 つ目のどちらかが表 2 に無い');
    const table3 = ['BCOCIN', 'BCOCUP', 'BCSGIN', 'BCSGUP', 'BRERA', 'BRERIN', 'BRERUP', 'FBFCIN', 'FBFCUP', 'FBOCIN',
      'FBOCUP', 'FBSGIN', 'FBSGUP', 'FCOCIN', 'FCOCUP', 'FCSGIN', 'FCSGUP', 'SBBCIN', 'SBBCUP', 'SBFCIN', 'SBFCUP',
      'SBOCIN', 'SBOCUP', 'SBSGIN', 'SBSGUP', 'SGOCIN', 'SGOCUP'];
    table3.forEach(l => ok(VCA.recordDef(l) && VCA.referencePoints(l), l));
  });

  // ---- 大きさ(5.4.9) -------------------------------------------------------------
  test('checkSizing: HBOX・VBOX・CIRC と玉型の食い違い、BSIZ と CSIZ の両方', { spec: ['5.4.9'], kind: ['正常', '異常'], req: ['R031', 'R032', 'S014'] }, () => {
    const t = ['TRCFMT=1;360;E;R;F'].concat(Array.from({ length: 36 }, () => 'R=' + Array(10).fill(2500).join(';')));
    const good = VCA.parse(['HBOX=50.00', 'VBOX=50.00', 'CIRC=157.08'].concat(t).join(CRLF));
    eq(VCA.checkSizing(good), { warnings: [], impliedCsiz: null });
    const bad = VCA.parse(['HBOX=52.00', 'VBOX=50.00', 'BSIZ=0.5', 'CSIZ=1.0'].concat(t).join(CRLF));
    const w = VCA.checkSizing(bad).warnings;
    ok(w.some(x => x.startsWith('HBOX 52')) && !w.some(x => x.startsWith('VBOX')), 'HBOX だけ違う');
    ok(w.some(x => x.includes('BSIZ と CSIZ')), 'BSIZ と CSIZ の両方');
    eq(VCA.checkSizing(bad, { tolerance: 3 }).warnings.filter(x => x.startsWith('HBOX')), [], '許容を広げる');
  });

  test('checkSizing: 玉型の箱の中心が原点からずれていれば警告、FBFCIN・FBFCUP があれば対象外(5.4.8)', { spec: ['5.4.8'], kind: ['正常', '異常'], req: ['R028', 'R029'] }, () => {
    // 0°方向だけ半径を 2 mm 伸ばした円(箱の中心が右へ 1 mm ずれる)
    const t = ['TRCFMT=1;360;E;R;F'].concat(Array.from({ length: 36 }, (_, i) =>
      'R=' + Array.from({ length: 10 }, (_, j) => (i === 0 && j === 0 ? 2700 : 2500)).join(';')));
    ok(VCA.checkSizing(VCA.parse(t.join(CRLF))).warnings.some(w => w.includes('中心')), 'ずれ');
    // 90°方向(上)だけ伸ばした円は、箱の中心が上へずれる
    const up = ['TRCFMT=1;360;E;R;F'].concat(Array.from({ length: 36 }, (_, i) =>
      'R=' + Array.from({ length: 10 }, (_, j) => (i === 9 && j === 0 ? 2700 : 2500)).join(';')));
    ok(VCA.checkSizing(VCA.parse(up.join(CRLF))).warnings.some(w => w.includes('中心')), '上下のずれ');
    eq(VCA.checkSizing(VCA.parse(['FBFCIN=1.0'].concat(t).join(CRLF))).warnings.filter(w => w.includes('中心')), [], 'FBFCIN あり');
  });

  test('checkSizing: 片眼の玉型で CIRC の左右が違えば、反対の眼の CSIZ を差とみなす(5.4.9.4)', { spec: ['5.4.9'], kind: ['正常', '境界'], req: ['R033'] }, () => {
    const t = ['TRCFMT=1;360;E;R;F'].concat(Array.from({ length: 36 }, () => 'R=' + Array(10).fill(2500).join(';')));
    eq(VCA.checkSizing(VCA.parse(['CIRC=157.08;158.08'].concat(t).join(CRLF))).impliedCsiz, { eye: 'L', csiz: 1, from: 'CIRC' });
    eq(VCA.checkSizing(VCA.parse(['CIRC=157.08;158.08', 'CSIZ=0'].concat(t).join(CRLF))).impliedCsiz, null, 'CSIZ があれば対象外');
    eq(VCA.checkSizing(VCA.parse(['CIRC=157.08;157.08'].concat(t).join(CRLF))).impliedCsiz, null, '左右が同じ');
  });

  // ---- 形式の取り決め(5.4.17・7.2.8・5.5.3・5.1.8.2) ------------------------------
  const iniPacket = VCA.parse(['ANS=INI', 'STATUS=0', 'DEV=EDG', 'VEN=GC', 'MODEL=LE-3', 'TRCFMT=4;400;E;R',
    'TRCFMT=4;512;E;R', 'TRCFMT=1;400;E;R', 'TRCFMT=1;512;E;R', 'DRLFMT=C', 'DRLFMT=E', 'DRLFMT=B'].join(CRLF));

  test('negotiate: デバイスの希望順で、ホストが使える最初の形式を選ぶ(5.5.3 の例)', { spec: ['5.4.17', '5.5'], kind: ['規格の例'], req: ['R047', 'R074', 'R169', 'R170', 'R171', 'R235'] }, () => {
    const r = VCA.negotiate(iniPacket, { trace: { formats: [1, 4], points: [512] }, drill: ['C'] });
    eq([r.status, r.records], [0, [['TRCFMT', '4', '512', 'E', 'R'], ['DRLFMT', 'C']]]);
    eq(VCA.negotiate(iniPacket, { trace: { formats: [1] } }).trace, ['1', '400', 'E', 'R'], '形式 1 だけ');
    eq(VCA.negotiate(iniPacket, {}).trace, ['4', '400', 'E', 'R'], '制限なしなら先頭');
  });

  test('negotiate: 使える形式が無いときは STATUS 17 と修飾ビット(7.2.8 の例 2)', { spec: ['5.4.17', '表 A.24-A.26'], kind: ['異常'] }, () => {
    const d = VCA.parse(['ANS=INI', 'DEV=TRC', 'VEN=GC', 'MODEL=FTX', 'TRCFMT=1;400;E;R'].join(CRLF));
    const r = VCA.negotiate(d, { trace: { formats: [1], points: [512] } });
    eq([r.status, r.trace, r.records], [17 + 512, null, []]);
    eq(VCA.statusInfo(r.status).modifiers, [512]);
    eq(VCA.negotiate(d, { trace: { formats: [4], modes: ['U'] } }).status, 17 + 256 + 1024);
  });

  test('negotiate: サグを扱えないホストは ZFMT=0、文字コードは最も複雑なもの', { spec: ['5.4.17', '5.1.8', '7.2.8'], kind: ['正常'], req: ['O005', 'R013', 'R172'] }, () => {
    const d = VCA.parse(['REQ=EDG', 'JOB=1', 'TRCFMT=1;400;E;R', 'ZFMT=1;400;E;R', 'TXTENC=ASCII;UTF-8'].join(CRLF));
    const r = VCA.negotiate(d, { encodings: ['ASCII', 'UTF-8'] });
    eq([r.sag, r.encoding], [null, 'UTF-8']);
    eq(r.records, [['TRCFMT', '1', '400', 'E', 'R'], ['ZFMT', '0'], ['TXTENC', 'UTF-8']]);
    eq(VCA.negotiate(d, { sag: {} }).records[1], ['ZFMT', '1', '400', 'E', 'R'], 'サグを扱える');
    eq(VCA.negotiate(d, {}).records.some(x => x[0] === 'TXTENC'), false, 'ASCII だけのホストは TXTENC を返さない');
  });

  test('形式 1 の 1 行が 80 文字を超えたら警告(5.4.15.1)', { spec: ['5.4.15'], kind: ['境界'], req: ['R042'] }, () => {
    const r = n => 'R=' + Array(n).fill(2500).join(';');
    eq(VCA.parse(['TRCFMT=1;15;E;R;F', r(15)].join(CRLF)).warnings, [], '76 文字');
    ok(VCA.parse(['TRCFMT=1;16;E;R;F', r(16)].join(CRLF)).warnings.some(w => w.includes('80 文字')), '81 文字');
  });

  // ---- 異常系・境界値(行ごと) ------------------------------------------------------
  test('知らないラベルは警告なしで 1 回だけ集め、"_" のラベルは集めない。16 文字ちょうどのラベルは警告しない',
    { spec: ['5.1.5', '5.1.6'], kind: ['異常', '境界'], req: ['R006'] }, () => {
      const d = VCA.parse(['_A=1', '_lower=2', 'ZZTOP=1', 'ZZTOP=2', 'ABCDEFGHIJKLMNOP=1'].join(CRLF));
      eq(d.unknown, ['ZZTOP', 'ABCDEFGHIJKLMNOP'], '"_" は集めず、同じラベルは 1 回');
      eq(d.warnings, [], '知らないラベルにも 16 文字ちょうどにも警告しない');
      eq([d.rec._A, d.rec._LOWER], [['1'], ['2']], '"_" のラベルも値は残す(ラベルは大文字にそろえる)');
    });

  test('DRILLS・ENGMARK の欄が足りなければ undefined、多ければ _fields に残す',
    { spec: ['5.6', '5.15'], kind: ['異常', '境界'] }, () => {
      const d = VCA.parse(['DRILLS=R;1', 'ENGMARK=MASK', 'ENGMARK=TXT;A;B;R;F;U;1;2;3;S;1;0;f;c;1;m;EXTRA'].join(CRLF));
      const s = VCA.fieldsOf(d, 'DRILLS');
      eq([s.eye, s.featureType, s.startAngle, s.depth], ['R', '1', undefined, undefined]);
      const e = VCA.occurrences(d, 'ENGMARK');
      eq([e[0].kind, e[0].content, e[1].method, e[1]._fields.length], ['MASK', undefined, 'm', 17]);
      eq(d.warnings.filter(w => w.includes('重複')), [], 'ENGMARK は複数あってよい');
      eq(d.warnings.filter(w => w.includes('DRILLS') || w.includes('ENGMARK')).length, 3, '足りない欄(開始角度・深さ・ENGMARK の中身)は警告');
    });

  test('PMFMT の行数が合わなければ警告', { spec: ['5.12'], kind: ['異常'], req: ['R131'] }, () => {
    ok(VCA.parse(['PMFMT=1;R;T;D;M;3;2;80.0;80.0', 'PP=1;2;3'].join(CRLF)).warnings.some(w => w.includes('PMFMT の行数')));
  });

  test('宣言の無い PROCBLK のブロックは警告、どの装置にも当てはまらない PROC は取り出さない',
    { spec: ['5.17'], kind: ['異常'] }, () => {
      ok(VCA.parse('2!SPH=1;1').warnings.some(w => w.includes('PROCBLK 宣言がありません')));
      const d = VCA.parse('PROC=SPH;GEN;ACME;X;1;1');
      eq(VCA.deviceRecords(d, { dev: 'EDG', ven: 'GC', model: 'Y' }), []);
    });

  test('TOKEN が空・不明なら undefined、REP の範囲が 1 つだけなら 1 つ、XSTATUS の 4 番目が空なら W(附属書 A.5)',
    { spec: ['5.18', '5.22', '5.19'], kind: ['異常', '境界'] }, () => {
      eq([VCA.value(VCA.parse('TOKEN='), 'TOKEN'), VCA.value(VCA.parse('TOKEN=?'), 'TOKEN')], [undefined, undefined]);
      eq(VCA.subValues(VCA.fieldsOf(VCA.parse('REP=t;1;;;5'), 'REP').range), ['5']);
      const x = VCA.occurrences(VCA.parse(['XSTATUS=L;0', 'XSTATUS=R;1001;Sphere out of range;E'].join(CRLF)), 'XSTATUS');
      eq(x.map(v => v.severity), ['W', 'E']);
    });

  test('接頭辞を付けられないラベルの組み合わせは定義が無く、知らないラベルになる', { spec: ['5.21', '表 A.1・A.1a・A.2・A.27'], kind: ['異常'] }, () => {
    eq([VCA.recordDef('INSDBL'), VCA.recordDef('TOLVDBL'), VCA.recordDef('NOSUCHLABEL')], [undefined, undefined, undefined]);
    ok(VCA.recordDef('TOLVADD'), 'TOLVADD は定義がある');
    eq(VCA.parse(['INSDBL=18', 'TOLVADD=-0.04|0.06;-0.04|0.06'].join(CRLF)).unknown, ['INSDBL']);
  });

  test('OPC の無い LNF の要求は、順序の警告', { spec: ['7.7', '6.1.1'], kind: ['異常'] }, () => {
    ok(VCA.checkOrder(VCA.parse(['REQ=LNF', 'JOB=1'].join(CRLF))).some(w => w.includes('OPC')));
  });

  test('データセットの先頭(見出しの直後)と最後の REM も、データセットを閉じない', { spec: ['U4', '5.4.5-5.4.7'], kind: ['境界'] }, () => {
    const d = VCA.parse(['TRCFMT=1;4;E;R;F', 'REM=a', 'R=1;1;1;1', 'REM=b', 'DBL=18'].join(CRLF));
    eq([d.traces[0].radii.length, d.all.REM.length, d.warnings], [4, 2, []]);
  });

  // ---- 規格の文ごとの確認(docs/requirements.md) ---------------------------------------------
  const ring = (head, n, extra) => [`${head}=1;${n};E;R;F`, 'R=' + Array(n).fill(2500).join(';')].concat(extra || []);

  test('LTYPE: レンズの種類はちょうど 1 つ、中間度数の 50 は書かない、特性は決まった順(表 A.1)', { spec: ['表 A.1・A.1a・A.2・A.27'], kind: ['正常', '異常'], req: ['O057', 'R210', 'R211', 'R212'] }, () => {
    const w = v => VCA.parse('LTYPE=' + v).warnings.filter(x => x.includes('書き方'));
    ['PR;PR', 'TR 60 EX FT AS LT', 'BI FT', 'SV AS', 'QD CT RD', 'DS FT', 'TR FT', 'PR AT FF SO OR', '?;PR']
      .forEach(v => eq(w(v), [], v));
    const bad = {
      'PR BI': 'ちょうど 1 つ', 'AS': 'ちょうど 1 つ', 'TR 50 FT': '知らない記号 50', 'TR 40 60 FT': '中間度数は 1 つまで',
      'SV 40': 'SV には', 'NV FT': 'NV には', 'BI': 'BI のセグメント', 'BI FT RD': 'BI のセグメント', 'TR FT EX': 'EX FT',
      'TR': 'EX FT', 'PR FT': 'PR には', 'QD': 'QD のセグメント', 'DS CT FT RD': 'DS のセグメント',
      'PR AS AT': 'AS と AT', 'SV LT AS': 'の順に書く', 'PR SO SO': 'の順に書く',
    };
    Object.keys(bad).forEach(v => ok(w(v).some(x => x.includes(bad[v])), v + ' → ' + JSON.stringify(w(v))));
    ok(w('PR;PR BI').some(x => x.includes('左眼の値')), '左眼だけ誤り');
    ok(VCA.parse('LTYPEF=PR BI;PR').warnings.some(x => x.startsWith('LTYPEF の') && x.includes('右眼の値')), 'LTYPEF も同じ書き方');
    ok(VCA.parse('LTYPEB=SV;SV 40').warnings.some(x => x.startsWith('LTYPEB の') && x.includes('左眼の値')), 'LTYPEB も同じ書き方');
    eq(VCA.parse('LTYPEF=PR FF;PR FF').warnings, [], '正しい LTYPEF');
  });

  test('PROCBLK: ブロックのレコードは宣言の直後に続けて置く(表 A.1・5.17.2.2 の例)', { spec: ['5.17'], kind: ['規格の例', '異常'], req: ['R217'] }, () => {
    const w = lines => VCA.parse(lines.join(CRLF)).warnings.filter(x => x.includes('ブロック'));
    eq(w(['DBL=10', 'PROCBLK=1;FSG;SOM;HSC101;', '1!LMATID=70;70', '1!GAX=0;0', 'PROCBLK=2;FSG;LOH;VFT;', '2!RNGH=3.00;3.00']), []);
    eq(w(['PROCBLK=1;FSG;;;', '1!LMATID=70;70', 'DBL=18', '1!GAX=0;0', '1!SPH=1;1']).length, 1, 'ブロックの外のレコードで閉じたあと(知らせは 1 回)');
    eq(w(['PROCBLK=1;FSG', 'PROCBLK=2;FSG', '1!GAX=0;0']).length, 1, '別のブロックの宣言のあと');
  });

  test('ENDDEF の値は DEF のタグと同じ(表 A.2)', { spec: ['7.2.4'], kind: ['正常', '異常'], req: ['R224'] }, () => {
    const w = lines => VCA.parse(lines.join(CRLF)).warnings.filter(x => x.includes('ENDDEF'));
    eq(w(['REQ=INI', 'DEF=MYREQ', 'D=HBOX;VBOX', 'ENDDEF=MYREQ', 'DEF=OTHER', 'D=DBL', 'ENDDEF=OTHER']), []);
    eq(w(['DEF=MYREQ;1000']), [], 'ホストの応答の DEF には ENDDEF が無い');
    ok(w(['DEF=MYREQ', 'D=HBOX', 'ENDDEF=OTHER']).some(x => x.includes('タグ MYREQ と違います')), '違うタグ');
    ok(w(['D=HBOX', 'ENDDEF=MYREQ']).some(x => x.includes('前に DEF がありません')), 'DEF が無い');
  });

  test('ENGMARK の DCS が指すラベルのレコードは同じパケットに入れる(5.15.1.3)', { spec: ['5.15'], kind: ['正常', '異常'], req: ['R137'] }, () => {
    const w = lines => VCA.parse(lines.join(CRLF)).warnings.filter(x => x.includes('ENGMARK'));
    eq(w(['JOB=1', 'ENGMARK=DCS;JOB;;B;F;F;0;0']), []);
    eq(w(['ENGMARK=TXT;HELLO;;B;F;F;0;0']), [], 'DCS 以外の種類');
    ok(w(['JOB=1', 'ENGMARK=DCS;SPH;;B;F;F;0;0']).some(x => x.includes('SPH')), 'SPH が無い');
  });

  test('DRILLS の眼の欄は R・L・B で、空にも省略にもしない(5.6.1.1)', { spec: ['5.6'], kind: ['正常', '異常'], req: ['O052', 'R076', 'R078'] }, () => {
    const w = line => VCA.parse(line).warnings.filter(x => x.includes('DRILLS'));
    ['DRILLS=R;1;10;1;10;1;1.4;2', 'DRILLS=b;1;10;1;10;1;1.4;2', 'DRILLS=0', 'DRILLS=?'].forEach(v => eq(w(v), [], v));
    ['DRILLS=X;1;10;1;10;1;1.4;2', 'DRILLS=;1;10;1;10;1;1.4;2', 'DRILLS=RL;1;10;1;10;1;1.4;2'].forEach(v => ok(w(v).length === 1, v));
  });

  test('XSTATUS: エラーなら STATUS=3、警告だけなら STATUS=0、コードは STATUS のコードか 100 以上(附属書 A.5)', { spec: ['表 A.24-A.26', '5.19'], kind: ['規格の例', '異常', '境界'], req: ['R238', 'R239', 'R240'] }, () => {
    const w = lines => VCA.parse(lines.join(CRLF)).warnings.filter(x => x.includes('XSTATUS'));
    eq(w(['ANS=LDS', 'JOB=1', 'STATUS=3', 'XSTATUS=R;1001;Sphere out of range for xxxxx design;E', 'XSTATUS=L;0']), [], 'A.5 の例 1');
    eq(w(['ANS=LDS', 'JOB=1', 'STATUS=3', 'XSTATUS=R;1001;Sphere;E', 'XSTATUS=L;1002;Cylinder;E']), [], 'A.5 の例 2');
    eq(w(['REQ=INF', 'JOB=1234', 'TOKEN=X', 'TIME=2013030301220000', 'XSTATUS=B;100;Job completed.']), [], '5.19.3 の例(通知は STATUS なしでよい)');
    eq(w(['ANS=LDS', 'JOB=1', 'STATUS=0', 'XSTATUS=B;1003;Thin edge']), [], '警告だけで STATUS=0');
    eq(w(['ANS=LDS', 'JOB=1', 'STATUS=8', 'XSTATUS=B;1003;Thin edge;W']), [], 'エラーは STATUS で伝え、XSTATUS は警告');
    ok(w(['ANS=LDS', 'JOB=1', 'STATUS=0', 'XSTATUS=R;1001;x;E']).some(x => x.includes('STATUS=3')), 'エラーなのに STATUS=0');
    ok(w(['ANS=LDS', 'JOB=1', 'XSTATUS=R;1001;x;E']).some(x => x.includes('STATUS=3')), 'エラーなのに STATUS なし');
    ok(w(['ANS=LDS', 'JOB=1', 'XSTATUS=B;1003;x']).some(x => x.includes('STATUS=0')), '警告だけなのに STATUS なし');
    const code = c => w(['XSTATUS=B;' + c + ';x']).filter(x => x.includes('コード')).length;
    eq([code(0), code(12), code(31), code(100), code(999), code(1000), code(1001)], [0, 0, 0, 0, 0, 0, 0]);
    eq([code(22), code(99), code(-1), code('1.5'), code('')], [1, 1, 1, 1, 1]);
  });

  test('DRILLE のグループは眼ごとに A から順、番号は 1 から順(5.5.2.10.6)', { spec: ['5.5'], kind: ['正常', '異常', '境界'], req: ['R066', 'R067'] }, () => {
    // 'R:A1' は右眼のグループ A の 1 番
    const line = g => { const [eye, group] = g.split(':'); return `DRILLE=${eye};C;1;2;1.4;;;;;;;;;;${group}`; };
    const e = groups => VCA.drillFeatures(VCA.parse(groups.map(line).join(CRLF))).errors.filter(x => x.includes('順'));
    eq(e(['R:A1', 'R:A2', 'R:B1', 'L:A1', 'L:A2', 'L:A3']), [], '眼ごとに A から');
    const ids = Array.from({ length: 27 }, (_, i) => i < 26 ? String.fromCharCode(65 + i) : 'AA');
    eq(e(ids.map(id => 'R:' + id + '1')), [], 'Z の次は AA');
    eq(e(['R:A1', 'R:C1']).length, 1, 'B を飛ばす');
    eq(e(['R:B1']).length, 1, 'A から始まらない');
    eq(e(['R:A1', 'R:AB1']).length, 1, 'AA を飛ばす');
    eq(e(['R:A2']).length, 1, '基準の穴が 1 でない');
    eq(e(['R:A1', 'R:A3']).length, 1, '番号を飛ばす');
    eq(e(['R:A1', 'R:A1']).length, 1, '1 が 2 つ');
  });

  test('左右のレコードは値を 2 つ書き、片眼が空でも ; は省かない(5.1・5.1.4・A.1.1.3)', { spec: ['5.1.1-5.1.2', '5.1.4'], kind: ['正常', '異常'], req: ['R003', 'R005', 'R206', 'S002', 'S064'] }, () => {
    const w = text => VCA.parse(text).warnings.filter(x => x.includes('左右のレコード'));
    ['SPH=-1.00;-2.00', 'SPH=-1.00;', 'SPH=;-2.00', 'SPH=?;?', 'SPH=?', 'DBL=18'].forEach(v => eq(w(v), [], v));
    eq(w('SPH=-1.00').length, 1, '値が 1 つ');
    eq(w(['IPD=31', 'OCHT=21', 'IPD=32'].join(CRLF)).length, 2, 'ラベルごとに 1 回');
    eq([VCA.number(VCA.parse('SPH=-1.00'), 'SPH', 'R'), VCA.number(VCA.parse('SPH=-1.00'), 'SPH', 'L')], [-1, -1], '読み取りは両眼に当てはめる(5.1)');
  });

  test('装置への応答の LDPATH には装置を選ぶ欄を入れない(5.9.3.2)', { spec: ['5.9.1-5.9.6'], kind: ['正常', '異常'], req: ['O023', 'R107'] }, () => {
    const w = lines => VCA.parse(lines.join(CRLF)).warnings.filter(x => x.includes('LDPATH'));
    eq(w(['ANS=EDG', 'JOB=1', 'LDPATH=job.sdf']), []);
    eq(w(['REQ=LMS', 'JOB=1', 'LDPATH=GEN;VEN;MOD;SN;SDF;job.sdf']), [], 'LMS のファイルでは使える');
    eq(w(['REQ=LMS', 'JOB=1', 'LDPATH=GEN;VEN;MOD;SN;;job.sdf']), [], 'Type が空なら SDF');
    eq(w(['REQ=LMS', 'JOB=1', 'LDPATH=GEN;VEN;MOD;SN;?;job.sdf']).length, 1, 'Type を不明にしない');
    eq(w(['ANS=EDG', 'JOB=1', 'LDPATH=GEN;VEN;MOD;SN;SDF;job.sdf']).length, 1);
  });

  test('面形状の表はすべて埋め、計算できない点は ? にする(5.9.4.5.2)', { spec: ['5.9.1-5.9.6'], kind: ['正常', '異常'], req: ['R118'] }, () => {
    const w = rows => VCA.parse(['SURFMT=1;R;B;3;3;10.0;10.0;1'].concat(rows).join(CRLF)).warnings.filter(x => x.includes('空欄'));
    eq(w(['ZZ=?;1;?', 'ZZ=1;0;1', 'ZZ=?;1;?']), []);
    eq(w(['ZZ=?;1;?', 'ZZ=1;;1', 'ZZ=?;1;?']).length, 1, '空欄');
    eq(w(['ZZ=?;1;?', 'ZZ=1;0', 'ZZ=?;1;?']).length, 1, '列が足りない');
  });

  test('プリセット・ラベル一覧のレコードはすべて送る(附属書 A.3・7.2.5.2)', { spec: ['表 A.5-A.23', '7.2.4'], kind: ['正常', '異常'], req: ['R166', 'R236', 'S034', 'S094'] }, () => {
    const labels = VCA.presetRecords('DRL').map(r => r.label);
    const d = VCA.parse(labels.filter(l => l !== 'BSIZ').map(l => l + '=?').join(CRLF));
    eq(VCA.presetRecords('DRL').find(r => r.label === 'BSIZ').mandatory, false, 'BSIZ は必須の印が無い');
    eq(VCA.missingPresetRecords(d, 'DRL'), [], '必須の印のあるものだけなら足りている');
    eq(VCA.missingPresetRecords(d, 'DRL', { all: true }), ['BSIZ'], 'すべてなら BSIZ が足りない');
    const def = VCA.autoFormatDefinitions(VCA.parse(['DEF=T', 'D=HBOX;*CIRC;TRCFMT', 'ENDDEF=T'].join(CRLF)))[0];
    const got = VCA.parse(['HBOX=50;50', 'TRCFMT=1;4;E;R;F', 'R=2500;2500;2500;2500'].join(CRLF));
    eq(VCA.missingRecords(got, def.labels), ['CIRC'], 'ラベル一覧(データセットの見出しも数える)');
    eq(VCA.missingRecords(got, ['hbox', 'TRCFMT']), [], '小文字・文字列でもよい');
  });

  test('機器の状態の MNT・TIM の応答・ACT=NEW・JOB に要るもの(7.3.6・7.4.4・7.6.1.1・表 A.2)', { spec: ['7.3-7.4', '7.6', '表 A.1・A.1a・A.2・A.27'], kind: ['正常', '異常'], req: ['R179', 'R181', 'R186', 'R225'] }, () => {
    const w = (lines, word) => VCA.parse(lines.join(CRLF)).warnings.filter(x => x.includes(word));
    eq(w(['REQ=MNT', 'STATUS=30', 'DEV=EDG', 'VEN=GC', 'MODEL=X', 'SN=1', 'TIME=20260101000000'], 'MNT'), []);
    eq(w(['REQ=MNT', 'STATUS=0', 'DEV=EDG', 'VEN=GC', 'MODEL=X', 'MID=A1', 'TIME=20260101000000'], 'MNT'), [], 'SN の代わりに MID');
    eq(w(['REQ=MNT', 'DEV=EDG', 'REP=X;1'], 'MNT'), [], '状態を知らせない MNT(設定など)');
    ok(w(['REQ=MNT', 'STATUS=31', 'DEV=EDG', 'VEN=GC', 'MODEL=X'], 'MNT').some(x => x.includes('TIME') && x.includes('SN か MID')), 'TIME と SN が無い');
    eq(w(['ANS=TIM', 'TIME=20260101000000'], 'TIME'), []);
    eq(w(['ANS=TIM', 'STATUS=8'], 'TIME'), [], '断りの応答');
    eq(w(['ANS=TIM'], 'TIME').length, 1, 'TIME が無い');
    eq(w(['REQ=CMD', 'JOB=1', 'ACT=NEW', 'DO=B'], 'DO'), []);
    eq(w(['REQ=CMD', 'JOB=1', 'ACT=MERGE'], 'DO'), [], 'MERGE は DO が無くてよい');
    eq(w(['REQ=CMD', 'JOB=1', 'ACT=NEW'], 'DO').length, 1, 'NEW に DO が無い');
    eq(w(['REQ=TRC', 'JOB=?'], 'JOB'), []);
    eq(w(['REQ=TRC', 'JOB='], 'JOB').length, 1, 'JOB が空');
  });

  test('CIRC3D はサグか FCRV から計算した立体の周長と比べる(5.4.9.5)', { spec: ['5.4.9'], kind: ['正常', '異常', '境界'], req: ['R035'] }, () => {
    // 半径 10 mm の 4 点。高さが 0 と 10 mm を繰り返すので、1 辺は √(10² + 10² + 10²)
    const sq = extra => VCA.parse(['TRCFMT=1;4;E;R;F', 'R=1000;1000;1000;1000'].concat(extra).join(CRLF));
    const d = sq(['ZFMT=1;4;E;R;F', 'Z=100;1100;100;1100']);
    ok(Math.abs(VCA.circumference3D(d.traces[0], d) - 4 * Math.sqrt(300)) < 1e-9, 'サグから');
    const w = extra => VCA.checkSizing(sq(extra)).warnings.filter(x => x.includes('立体の周長'));
    eq(w(['ZFMT=1;4;E;R;F', 'Z=100;1100;100;1100', 'CIRC3D=69.28;']), [], '一致');
    eq(w(['ZFMT=1;4;E;R;F', 'Z=100;1100;100;1100', 'CIRC3D=69.70;']), [], '許容 0.5 mm の内');
    eq(w(['ZFMT=1;4;E;R;F', 'Z=100;1100;100;1100', 'CIRC3D=69.80;']).length, 1, '許容の外');
    // FCRV: 球の半径は (TIND - 1) × 1000 / FCRV mm、高さは箱の中心からの距離で決まる
    const dia = extra => VCA.parse(['TRCFMT=1;4;E;R;F', 'R=1000;2000;1000;2000'].concat(extra).join(CRLF));
    const expect = tind => {
      const rs = ((tind - 1) * 1000) / 4, z = r => rs - Math.sqrt(rs * rs - r * r);
      return 4 * Math.sqrt(10 * 10 + 20 * 20 + (z(20) - z(10)) ** 2);
    };
    const f1 = dia(['FCRV=4;4']), f2 = dia(['FCRV=4;4', 'TIND=1.6;1.6']);
    ok(Math.abs(VCA.circumference3D(f1.traces[0], f1) - expect(1.53)) < 1e-9, 'TIND が無ければ 1.53');
    ok(Math.abs(VCA.circumference3D(f2.traces[0], f2) - expect(1.6)) < 1e-9, 'TIND を使う');
    ok(VCA.circumference3D(f1.traces[0], f1) > 4 * Math.sqrt(500), '曲がっている分だけ長い');
    const f0 = dia(['FCRV=0;0']);
    ok(Math.abs(VCA.circumference3D(f0.traces[0], f0) - 4 * Math.sqrt(500)) < 1e-9, 'FCRV=0 は平面');
    eq(VCA.circumference3D(dia([]).traces[0], dia([])), undefined, 'サグも FCRV も無い');
    eq(VCA.checkSizing(dia(['FCRV=4;4', 'CIRC3D=' + expect(1.53).toFixed(2) + ';'])).warnings.filter(x => x.includes('立体の周長')), [], 'FCRV から計算した値と一致');
  });

  test('DRILLS の開始角度・深さ、ENGMARK の最初の 2 欄、PROCBLK の中の PROC(5.6.1・5.15.1.1・表 A.1)', { spec: ['5.6', '5.15', '5.17'], kind: ['正常', '異常'], req: ['O018', 'O019', 'O020', 'O029', 'O053', 'O054', 'O055', 'O056', 'O060'] }, () => {
    const w = (lines, word) => VCA.parse(lines.join(CRLF)).warnings.filter(x => x.includes(word));
    eq(w(['DRILLS=R;1;10;1;10;1;1.4;2'], 'DRILLS'), []);
    eq(w(['DRILLS=R;;10;;;;;2'], 'DRILLS'), [], '種類・開始距離・終了角度は省いてよい(穴)');
    ok(w(['DRILLS=R;1;?;1;10;1;1.4;2'], 'DRILLS').some(x => x.includes('開始角度')), '開始角度が不明');
    ok(w(['DRILLS=R;1;10;1;10;1;1.4'], 'DRILLS').some(x => x.includes('深さ')), '深さが無い');
    ok(w(['DRILLS=R;2;10;1;;1;1.4;2'], 'DRILLS').some(x => x.includes('終了角度')), '矩形なのに終了角度が無い');
    eq(w(['ENGMARK=TXT;HELLO'], 'ENGMARK'), []);
    eq(w(['ENGMARK=TXT;?'], 'ENGMARK').length, 1, '中身が不明');
    eq(w(['ENGMARK=;HELLO'], 'ENGMARK').length, 1, '種類が空');
    eq(w(['PROCBLK=1;FSG', '1!GAX=0;0'], 'の中に'), []);
    eq(w(['PROCBLK=1;FSG', '1!PROC=X;FSG;;;1', '1!PROCBLK=2;FSG'], 'の中に').length, 2, 'ブロックの中の PROC・PROCBLK');
  });

  test('DRILLE の始点・角度モード A の角度は空・不明にしない(5.5.2.3-5.5.2.4・5.5.2.10.2-5.5.2.10.3)', { spec: ['5.5'], kind: ['異常'], req: ['O011', 'O014', 'O016', 'O017'] }, () => {
    const e = line => VCA.drillFeatures(VCA.parse(line)).errors;
    ok(e('DRILLE=R;C;?;2').some(x => x.includes('座標')), 'x が不明');
    ok(e('DRILLE=R;C;1').some(x => x.includes('座標')), 'y が無い');
    ok(e('DRILLE=R;C;1;2;1.4;;;;;A;?;5').some(x => x.includes('角度モード A')), '横の角度が不明');
    ok(e('DRILLE=R;C;1;2;1.4;;;;;A;5').some(x => x.includes('角度モード A')), '縦の角度が無い');
    eq(e('DRILLE=R;C;1;2;1.4;;;;;A;5;5'), [], 'そろっている');
  });

  test('DRILLE の種類が省略・0 なら 1(穴・長穴)とみなす(5.5.2.9.1)', { spec: ['5.5'], kind: ['境界'], req: ['S017', 'S018'] }, () => {
    const types = ['DRILLE=R;C;1;2;1.4', 'DRILLE=R;C;1;2;1.4;;;;0', 'DRILLE=R;C;1;2;1.4;;;;1', 'DRILLE=R;C;1;2;1.4;3;4;;2']
      .map(l => VCA.drillFeatures(VCA.parse(l)).features[0]);
    eq(types.map(f => [f.featureType, f.shape]), [[1, 'hole'], [1, 'hole'], [1, 'hole'], [2, 'rectangle']]);
  });

  test('余分な区切りを許し、小数点の桁数によらず読む(5.1・A.1.1.5.1)', { spec: ['5.1.1-5.1.2', '3.3'], kind: ['正常', '境界'], req: ['S001', 'S062'] }, () => {
    const d = VCA.parse('SPH=-1.00;-2.00;');
    eq([d.warnings, VCA.number(d, 'SPH', 'R'), VCA.number(d, 'SPH', 'L')], [[], -1, -2], '末尾の余分な ; は許す');
    eq(['18', '18.', '18.0', '18.123456', '.5'].map(v => VCA.number(VCA.parse('DBL=' + v), 'DBL')), [18, 18, 18, 18.123456, 0.5], 'どの桁数でも読む');
  });

  test('resampleTrace: デバイスが求める点数と向きの等角度データにする(5.4.13)', { spec: ['5.4.10-5.4.13'], kind: ['正常', '境界', '異常'], req: ['R040'] }, () => {
    const t = VCA.parse(['TRCFMT=1;4;E;R;F', 'R=1000;2000;3000;4000'].join(CRLF)).traces[0];
    eq(VCA.resampleTrace(t, 8), [1000, 1500, 2000, 2500, 3000, 3500, 4000, 2500], '間の点は角度で直線補間(359° と 0° の間もつなぐ)');
    eq(VCA.resampleTrace(t, 4), [1000, 2000, 3000, 4000], '同じ点数なら変わらない');
    eq(VCA.resampleTrace(t, 4, 'L'), [3000, 2000, 1000, 4000], '左眼の向き: 0° と 180° が入れ替わり、90°・270° はそのまま');
    eq(VCA.resampleTrace(t, 4, 'R'), [1000, 2000, 3000, 4000], '同じ眼なら反転しない');
    const u = VCA.parse(['TRCFMT=1;3;U;R;F', 'R=1000;2000;3000', 'A=1000;9000;27000'].join(CRLF)).traces[0];
    eq(VCA.resampleTrace(u, 4), [1200, 2000, 2500, 3000], '不等角度から(0° は 270° と 10° の間)');
    const c = circle(25, 360);
    ok(VCA.resampleTrace(c, 100).every(r => r === 2500), '円は円のまま');
    const back = VCA.parse(VCA.datasetRecords({ fmt: 1, values: VCA.resampleTrace(c, 100), eye: 'R' }).map(r => r[0] + '=' + r.slice(1).join(';')).join(CRLF));
    eq(back.traces[0].radii.length, 100, 'datasetRecords でそのまま送れる');
    let m = ''; try { VCA.resampleTrace(t, 0); } catch (err) { m = err.message; }
    ok(m.includes('点数'), '0 点は誤り');
  });

  test('角度は 0-35999。範囲外は警告(5.4.3・5.8.3)', { spec: ['5.4.1-5.4.3', '5.8'], kind: ['境界', '異常'], req: ['R023', 'R083', 'R085'] }, () => {
    const w = a => VCA.parse(['TRCFMT=1;2;U;R;F', 'R=2500;2500', 'A=0;' + a].join(CRLF)).warnings.filter(x => x.includes('範囲外の角度'));
    eq([w(35999).length, w(36000).length, w(-1).length], [0, 1, 1]);
    ok(VCA.parse(['SHLFFMT=1;2;U;R;B', 'S=1;1', 'SA=0;36000'].join(CRLF)).warnings.some(x => x.includes('SA に 0-35999')), 'SA');
  });

  test('データパケットの TRCFMT・ZFMT に眼の B は使わない(5.4.12.3)', { spec: ['5.4.10-5.4.13'], kind: ['異常'], req: ['R037'] }, () => {
    ok(VCA.parse(['TRCFMT=1;4;E;B;F', 'R=2500;2500;2500;2500'].join(CRLF)).warnings.some(x => x.includes('眼が B')), 'データの B');
    eq(VCA.parse('TRCFMT=1;400;E;B;F').warnings, [], '候補(要求・初期化)の B はよい');
  });

  test('サグの最小値は正の値(5.4.14)', { spec: ['5.4.14'], kind: ['境界', '異常'], req: ['R041'] }, () => {
    const w = z => VCA.parse(ring('TRCFMT', 4, ['ZFMT=1;4;E;R;F', 'Z=' + z]).join(CRLF)).warnings.filter(x => x.includes('最小値'));
    eq([w('1;2;3;4').length, w('0;2;3;4').length, w('-1;2;3;4').length], [0, 1, 1]);
  });

  test('CIRC3D があるなら、サグか FCRV が要る(5.4.9.5)', { spec: ['5.4.9'], kind: ['異常'], req: ['R034'] }, () => {
    const w = extra => VCA.checkSizing(VCA.parse(ring('TRCFMT', 4, extra).join(CRLF))).warnings.filter(x => x.includes('サグ(ZFMT)も FCRV も'));
    eq([w(['CIRC3D=160;160']).length, w(['CIRC3D=160;160', 'FCRV=4;4']).length,
      w(['CIRC3D=160;160', 'ZFMT=1;4;E;R;F', 'Z=1;1;1;1']).length], [1, 0, 0]);
  });

  test('重みは 0-1、面形状の表の中心点は 0(5.13.3.1・5.9.4.3)', { spec: ['5.13', '5.9.1-5.9.6'], kind: ['境界', '異常'], req: ['R112', 'R134'] }, () => {
    const ww = v => VCA.parse(['WMFMT=1;R;0;2;1;5;5', 'WW=0;' + v].join(CRLF)).warnings.filter(x => x.includes('重み'));
    eq([ww(1).length, ww(1.01).length, ww(-0.1).length], [0, 1, 1]);
    const zz = c => VCA.parse(['SURFMT=1;R;B;3;3;10.0;10.0;1', 'ZZ=1;1;1', `ZZ=1;${c};1`, 'ZZ=1;1;1'].join(CRLF)).warnings.filter(x => x.includes('中心点'));
    eq([zz(0).length, zz('0.01').length], [0, 1]);
  });

  test('整数の欄に小数点は書かない(A.1.1.5.2)', { spec: ['5.1.8', '3.3'], kind: ['異常'], req: ['R207'] }, () => {
    eq(VCA.parse('ETYP=1').warnings, []);
    ok(VCA.parse('ETYP=1.0').warnings.some(x => x.includes('小数点')), 'ETYP=1.0');
    eq(VCA.parse('DBL=18.0').warnings, [], '数値の欄はよい');
  });

  test('DRILLE の R(基準穴からの位置)はグループの 2 番目以降だけ(5.5.2.2)', { spec: ['5.5'], kind: ['異常'], req: ['R057'] }, () => {
    const e = lines => VCA.drillFeatures(VCA.parse(lines.join(CRLF))).errors.filter(x => x.includes('基準 R'));
    eq(e(['DRILLE=B;C;-20;5;1.4;;;;;;;;;;A1', 'DRILLE=B;R;3;0;1.4;;;;;;;;;;A2']).length, 0, '従う側');
    eq(e(['DRILLE=B;R;3;0;1.4;;;;;;;;;;A1']).length, 1, '基準の穴');
    eq(e(['DRILLE=B;R;3;0;1.4']).length, 1, 'グループなし');
  });

  test('DRILLE の基準は不明(?)にしない、グループは英字と数字(5.5.2.2・5.5.2.10.6)', { spec: ['5.5'], kind: ['異常'], req: ['R055', 'R065'] }, () => {
    const e = line => VCA.drillFeatures(VCA.parse(line)).errors;
    ok(e('DRILLE=R;?;1;2').some(x => x.includes('基準が 不明')), '基準が ?');
    ok(e('DRILLE=R').some(x => x.includes('基準が ありません')), '基準の欄の省略');
    ok(e('DRILLE=R;C;1;2;;;;;;;;;;;1A').some(x => x.includes('グループ指定')), 'グループが数字から');
    eq(e('DRILLE=R;;1;2'), [], '空欄は箱中心(C)とみなしてよい');
  });

  test('CRC はエスケープした後のバイト列で計算し、CRC が無ければ RS は GS の直前(5.1.7.3・6.1.2.4)', { spec: ['6.1.2', '5.4.16'], kind: ['正常'], req: ['R012', 'R148', 'R150', 'R151'] }, () => {
    const recs = VCA.datasetRecords({ fmt: 2, values: [0x0a1c, 2500], eye: 'R' });   // 0x1c と 0x0a はエスケープされる
    const pkt = VCA.buildPacket([['REQ', 'TRC'], ['JOB', '1']].concat(recs), { crc: true });
    ok(pkt.includes('\x1b\x9c') && pkt.includes('\x1b\x8a'), 'エスケープされている');
    const body = pkt.slice(1, pkt.indexOf('\x1e') + 1);
    eq(VCA.parsePacket(pkt).crcOk, true);
    ok(pkt.includes('CRC=' + VCA.crc16(body) + '\r\n'), 'エスケープ後のバイト列の CRC');
    ok(/\x1eCRC=\d+\r\n\x1d$/.test(pkt), 'CRC は RS の直後で最後');
    ok(VCA.buildPacket([['REQ', 'TIM']]).endsWith('\x1e\x1d'), 'CRC が無ければ RS は GS の直前');
  });

  test('不等角度(U)なら角度のレコードが続き、棚の SA・SD・SW の数は S と同じ(5.4.3・5.8.6)', { spec: ['5.4.1-5.4.3', '5.8'], kind: ['異常'], req: ['O010', 'O022', 'R088', 'R089', 'R218', 'R219', 'R221', 'R229', 'R231', 'R233'] }, () => {
    ok(VCA.parse(['TRCFMT=1;2;U;R;F', 'R=2500;2500'].join(CRLF)).errors.some(x => x.includes('角度データ A')), 'U なのに A が無い');
    ok(VCA.parse(['SHLFFMT=1;2;U;R;B', 'S=1;1'].join(CRLF)).errors.some(x => x.includes('角度データ SA')), 'U なのに SA が無い');
    const w = VCA.parse(['SHLFFMT=1;3;E;R;B', 'S=1;1;1', 'SD=1;1', 'SW=1;1;1;1'].join(CRLF)).warnings;
    ok(w.some(x => x.includes('SD の個数')) && w.some(x => x.includes('SW の個数')), 'SD・SW の個数');
    const ok3 = VCA.parse(['SHLFFMT=1;3;E;R;B', 'S=1;1;1', 'SD=1;1;1', 'SW=1;1;1'].join(CRLF));
    eq([ok3.warnings, ok3.datasets[0].series.SW], [[], [1, 1, 1]], 'SW は SD の直後に続けてよい');
  });

  // ---- samples/ のファイル -------------------------------------------------------
  if (samples) {
    const load = name => VCA.parse(samples[name]);
    const radiusAt = (trace, deg) => VCA.tracePoints(trace).reduce((b, p) => (Math.abs(p.a - deg) < Math.abs(b.a - deg) ? p : b)).r;

    test('サンプル: どのファイルも警告なし(ファイルの決まり・中心・大きさも含む)', { spec: ['7.5', '5.4.8', '5.4.9'], kind: ['正常'] }, () => {
      Object.keys(samples).forEach(name => {
        const d = load(name);
        eq([d.errors, d.warnings, VCA.checkOrder(d, { file: true }), VCA.checkSizing(d).warnings], [[], [], [], []], name);
      });
    });

    test('サンプル: 鼻側と耳側の形が違い、左右の向きが見分けられる', { spec: ['5.4.10-5.4.13'], kind: ['正常'] }, () => {
      Object.keys(samples).forEach(name => {
        const r = load(name).traces.find(t => t.eye === 'R');
        // 右眼は 0° が鼻側。鼻側の半径が耳側より 1 mm 以上小さい
        ok(radiusAt(r, 180) - radiusAt(r, 0) > 1, name);
      });
    });

    test('サンプル: 左眼は右眼の左右反転、どのファイルも同じ形', { spec: ['5.4.10-5.4.13'], kind: ['正常'] }, () => {
      const base = load('_SAMPLE0001.vca').traces, R1440 = base[0].radii;
      eq(base[1].radii, R1440.map((_, i) => R1440[(720 - i + 1440) % 1440]), '_SAMPLE0001 の左眼');
      const both = load('frame-both.vca').traces;
      eq(both[0].radii, R1440.filter((_, i) => i % 4 === 0), 'frame-both の右眼は 1440 点の 4 点おき');
      eq(both[1].radii, both[0].radii.map((_, i) => both[0].radii[(180 - i + 360) % 360]), 'frame-both の左眼');
      eq(load('frame-right.vca').traces[0].radii, both[0].radii, 'frame-right');
      const u = load('frame-uneven.vca').traces[0];
      eq(u.radii, u.angles.map(a => R1440[a / 25]), 'frame-uneven は同じ形の 180 点');
    });
  }

  return results;
});
