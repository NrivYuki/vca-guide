#!/usr/bin/env python3
"""
build-records.py — 規格書 PDF から src/vca-records.js(ラベル定義表)を生成する

使い方:
    python3 tools/build-records.py DCS_v3.14_Final.pdf > src/vca-records.js

必要なもの: pdftotext(poppler-utils)、pdfplumber(pip install pdfplumber)

規格書(The Vision Council, Data Communication Standard v3.14)は各自で入手してください。
生成されるのは、ラベル・データ型の記法・左右の別・単数/複数・測定値接頭辞の可否・
廃止と後継・プリセットパケットの構成といった「事実」だけです。規格の説明文は含めません。
"""
import json
import re
import statistics
import subprocess
import sys

import pdfplumber

VERSION = '3.14'

# 説明文の中でだけ廃止とされているラベルと、その後継
DEPRECATED_IN_TEXT = {'CTHK': 'CTHICK', 'CKPRHI': 'CKPRVHI', 'CKPRVI': 'CKPRVVI', 'CKTHK': 'CKCTHICK'}

HEADER = '''/*
 * vca-records.js — DCS v3.14 附属書 A のラベル定義表(自動生成。手で編集しないこと)
 * 生成: python3 tools/build-records.py <規格書 PDF> > src/vca-records.js
 *
 * 各ラベルの値:
 *   k  値の並び  s=単一 c=左右 o=左右(省略可。単一値は両眼) l=可変長 m=決まった複数の欄 ?=表に記載なし
 *   t  データ型の記法(表のまま)   tb 掲載表(A.1 / A.1a / A.2 / A.27)
 *   p  1 なら複数回出現してよい(表の上付き P)
 *   m  Y=測定値接頭辞(INS/TOL/TOLV/CK/LD)付きのレコードもある / O=接頭辞付きでのみ使う
 *   v  1 なら TOLV レコードもある(表 A.1a)
 *   dep 廃止。値は後継ラベル     note 補足(typo:HBO = 表の誤植 HBO を HBOX として収録)
 * presets: 要求種別ごとのプリセットパケット [ラベル, 必須(1/0), 追加された版]
 * 規格の説明文は含めていません。意味は規格書の附属書 A を参照してください。
 */
(function (root, data) {
  if (typeof module === 'object' && module.exports) module.exports = data;
  else root.VCA_RECORDS = data;
})(typeof self !== 'undefined' ? self : this, '''


def layout_text(pdf_path):
    # xpdf の pdftotext は桁のそろえ方が poppler と違い、表を正しく読めない
    ver = subprocess.run(['pdftotext', '-v'], capture_output=True, encoding='utf-8')
    if 'xpdf' in (ver.stdout + ver.stderr).lower():
        sys.exit('pdftotext が xpdf 版です。poppler-utils の pdftotext を使ってください')
    return subprocess.run(['pdftotext', '-layout', '-enc', 'UTF-8', pdf_path, '-'], check=True,
                          capture_output=True, encoding='utf-8').stdout.split('\n')


def superscript_plural(pdf_path):
    """表 A.1・A.2 の上付き文字 "P"(複数レコードの印)が付いたラベルを集める"""
    out = set()
    pdf = pdfplumber.open(pdf_path)
    for page in pdf.pages:
        t = page.extract_text() or ''
        if not ('Device Records' in t or 'Interface Records' in t or 'Tolerance Records' in t):
            continue
        for c in page.chars:
            if c['text'] == 'P' and c['size'] < 8 and c['x0'] < 200:
                row = [d for d in page.chars if abs(d['top'] - c['top']) < 6 and d['x0'] < c['x0']
                       and d['size'] >= 8 and c['x0'] - d['x0'] < 120]
                row.sort(key=lambda d: d['x0'])
                out.add(''.join(d['text'] for d in row).strip())
    return out


def chunks(line):
    return [(m.start(), m.group()) for m in re.finditer(r'\S+(?: \S+)*', line)]


def device_and_interface_records(lines, plural):
    """表 A.1・A.1a・A.2 を列位置で読み取る"""
    start = next(i for i, l in enumerate(lines) if 'Table A.1 Device Records' in l)
    end = next(i for i, l in enumerate(lines) if 'Table A.3 – Request Types' in l)
    pages, cur_page = [], []
    for i in range(start, end):
        if lines[i].startswith('DATA COMMUNICATION STANDARD'):
            if cur_page:
                pages.append(cur_page)
            cur_page = []
        else:
            cur_page.append((i, lines[i]))
    pages.append(cur_page)

    entries, cur, table, last_label_line = [], None, 'A.1', -9
    for pg in pages:
        tcols, dcols = [], []
        for _, l in pg:
            c = chunks(l)
            if len(c) >= 3 and c[0][0] <= 14 and re.fullmatch(r'[A-Z_][A-Z0-9_]*', c[0][1]):
                tcols.append(c[1][0])
                dcols.append(c[2][0])
        if not tcols:
            continue
        tcol, dcol = statistics.median(tcols), statistics.median(dcols)
        for i, l in pg:
            if 'Table A.1a' in l:
                table = 'A.1a'
            if 'Table A.2' in l:
                table = 'A.2'
            s = l.strip()
            if not s or re.match(r'(Table A\.|TABLE A\.|Record Label|Record\s+Data type|Record$|label$|Record\s+label)', s):
                continue
            lab = typ = m = ''
            desc = []
            for pos, txt in chunks(l):
                if pos < tcol - 3:
                    lab = (lab + ' ' + txt).strip()
                elif pos < dcol - 3:
                    typ = (typ + ' ' + txt).strip()
                elif re.fullmatch(r'[YOx]', txt) and pos > dcol + 30:
                    m = txt
                else:
                    desc.append(txt)
            if lab.startswith('Deprecated'):
                cur['deprecated'] = True
                cur['_dep'] = True
                continue
            if cur is not None and cur.get('_dep') and lab:
                cur['replacedBy'] = re.sub(r'^See\s+', '', lab)
                cur.pop('_dep')
                if typ:
                    cur['type'] = (cur['type'] + ' ' + typ).strip()
                continue
            if lab.endswith('(cont.)'):
                lab = ''
            if lab and not re.fullmatch(r'[A-Z_][A-Z0-9_]*,?', lab):
                continue  # 表と表の間の本文
            if lab and not typ and cur is not None and len(lab) <= 2 and last_label_line == i - 1 and cur['type']:
                cur['label'] += lab  # 折り返したラベル(SDFMOD + E)
                continue
            if lab:
                if cur is not None:
                    cur.pop('_dep', None)
                lab = lab.rstrip(',')
                p = False
                if lab.endswith('P') and lab[:-1] in plural:
                    lab, p = lab[:-1], True
                cur = {'label': lab, 'type': typ, 'm': m, 'table': table, 'plural': p}
                entries.append(cur)
                last_label_line = i
            elif cur is not None:
                if typ:
                    cur['type'] = (cur['type'] + ' ' + typ).strip()
                if m and not cur['m']:
                    cur['m'] = m
    for e in entries:
        e.pop('_dep', None)
    return entries


def process_control_records(lines):
    """表 A.27(工程管理レコード)"""
    start = next(i for i, l in enumerate(lines) if 'Table A.27 – Process Control Records' in l)
    end = next(i for i, l in enumerate(lines) if i > start and 'ANNEX B' in l)
    out = []
    for l in lines[start:end]:
        c = chunks(l)
        if len(c) >= 3 and c[0][0] <= 14 and re.fullmatch(r'[A-Z][A-Z0-9_]*', c[0][1]):
            out.append({'label': c[0][1], 'type': c[1][1], 'm': '', 'table': 'A.27', 'plural': False})
    return out


def presets(lines):
    """附属書 A.3 のプリセットパケット(表 A.5-A.23)"""
    s = next(i for i, l in enumerate(lines) if re.match(r'\s*A\.3 PRESET PACKETS', l))
    e = next(i for i, l in enumerate(lines) if i > s and re.match(r'\s*A\.4\s+STATUS CODES', l))
    out, cur = {}, None
    head = re.compile(r'Table A\.(\d+)\s*[–-]\s*(.*?)\s*\(“(\w+)”\)')
    for l in lines[s:e]:
        m = head.search(l)
        if m:
            cur = out.setdefault(m.group(3), {'table': 'A.' + m.group(1), 'records': [], 'datasets': []})
            continue
        if cur is None or l.startswith('DATA COMMUNICATION') or re.search(r'TABLE A\.|Record label|See Table', l):
            continue
        st = l.strip()
        if not st:
            continue
        first = re.split(r'\s{2,}', st)[0]
        if re.fullmatch(r'\(.*\)', first):
            cur['datasets'].append(first.strip('()'))
            continue
        if len(l) - len(l.lstrip()) > 14 or st.startswith('other records'):
            continue
        for tok in first.split(','):
            m2 = re.fullmatch(r'(\*?)([A-Z_][A-Z0-9_]*?)(3\.\d\d)?', tok.strip())
            if not m2:
                continue
            rec = [m2.group(2), 1 if m2.group(1) else 0, m2.group(3) or '']
            if rec not in cur['records']:
                cur['records'].append(rec)
    return out


def kind_of(t):
    """データ型の記法から値の並びの種類を決める
    s 単一 / c 左右 / o 左右(省略可、単一値は両眼) / l 可変長の並び / m 決まった複数の欄 / ? 記載なし"""
    n = t.replace(' ', '')
    if not n:
        return '?'
    if '…' in n or '...' in n:
        return 'l'
    if ';' not in n:
        return 's'
    if n.endswith('[;]') and n.count(';') == 1:
        return 'o'
    if n.count(';') == 1 and n.endswith(';'):
        return 'c'
    return 'm'


def main(pdf_path):
    lines = layout_text(pdf_path)
    plural = superscript_plural(pdf_path)
    entries = device_and_interface_records(lines, plural) + process_control_records(lines)

    # 型欄が空の行を補う(規格書の表で型が省略されているもの)
    prev = None
    for e in entries:
        if prev is not None and re.match(r'.*UP$', e['label']) and prev['label'][:-2] == e['label'][:-2]:
            # ...IN / ...UP の組は表の 1 行にまとめてあり、型と M 欄は IN 側にだけ記載されていることがある
            if not e['type']:
                e['type'] = prev['type']
            if not e['m']:
                e['m'] = prev['m']
        prev = e
    by = {e['label']: e for e in entries}
    for lab in ('LTYPEB', 'LTYPEF'):
        if lab in by and not by[lab]['type']:
            by[lab]['type'] = by['LTYPE']['type']  # 「LTYPE と同じ構成」
    # 規格書の誤植: 表 A.1 では "HBO" だが、本文・プリセット表・例はすべて HBOX
    if 'HBO' in by and 'HBOX' not in by:
        by['HBO']['label'] = 'HBOX'
        by['HBO']['note'] = 'typo:HBO'
    # 表に Deprecated の行は無いが、説明文で廃止とされているもの
    text = '\n'.join(lines)
    for lab, new in DEPRECATED_IN_TEXT.items():
        if lab in by and re.search(r'Deprecated\s+in\s+favor\s+of\s+' + new + r'\b', text):
            by[lab]['deprecated'] = True
            by[lab]['replacedBy'] = new

    recs = {}
    for e in entries:
        k = kind_of(e['type'])
        r = {'k': k, 't': re.sub(r'\s+', ' ', e['type']).replace('te xt', 'text').replace('int eger', 'integer'),
             'tb': e['table']}
        if e['plural']:
            r['p'] = 1
        if e['m'] in ('Y', 'O'):
            r['m'] = e['m']
        if e['m'] == 'x':
            r['v'] = 1  # 表 A.1a: TOLV レコードあり
        if e.get('deprecated'):
            r['dep'] = e.get('replacedBy', '')
        if e.get('note'):
            r['note'] = e['note']
        recs[e['label']] = r

    pre = presets(lines)
    # 規格書の誤植: 表 A.16 の "INSSGUP" は、同じ表の TOLSGOCUP と対になる INSSGOCUP
    for p in pre.values():
        for rec in p['records']:
            if rec[0] == 'INSSGUP':
                rec[0] = 'INSSGOCUP'
    body = json.dumps({'version': VERSION, 'records': recs, 'presets': pre}, ensure_ascii=False,
                      separators=(',', ':'), sort_keys=True)
    body = body.replace('},"', '},\n"')  # 1 ラベル 1 行(差分を読みやすくする)
    sys.stdout.write(HEADER + body + ');\n')


if __name__ == '__main__':
    main(sys.argv[1])
