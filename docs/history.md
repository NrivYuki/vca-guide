# 規格の版の履歴

VCA(OMA / DCS)の規格書の旧版をネットで集め、版ごとの違いを調べた結果です。

- 比べたのは、手に入った 3.02・3.07・3.09・3.10・3.13・3.14 の 6 版です。3.01 以前・3.03-3.06・3.08・3.11・3.12 は手に入らなかったため、これらの版の変更は、後の版の本文や附属書 D に書かれている範囲でしか分かりません
- 附属書 D(改訂履歴)は 3.11 で設けられ、3.11 から 3.14 までの変更が載っています。それより前の版の変更は、本文にところどころ書かれているだけです
- ラベルの追加と削除は、各版の附属書 A の表(表 A.1・A.1a・A.2 と工程管理レコードの表)に載っているラベルを機械的に突き合わせて出しました。附属書 D で 3.11-3.14 に追加されたとあるラベルは、どれもその範囲で初めて現れており、食い違いはありません
- 規格書そのものは著作権があるため、このリポジトリには入れていません。入手先は[最後の節](#入手先)にまとめています

## 目次

- [版の一覧](#版の一覧)
- [版ごとのラベルの追加](#版ごとのラベルの追加)
- [無くなったラベル](#無くなったラベル)
- [測定値の接頭辞付きラベルの扱い](#測定値の接頭辞付きラベルの扱い)
- [版によって記述が食い違う点](#版によって記述が食い違う点)
- [入手先](#入手先)

## 版の一覧

| 版 | 日付 | 主な変更 |
|---|---|---|
| 3.01 | - | ISO 16284 の元になった版(3.07 の前書きによる。3.09 以降の前書きでは 3.03 となっている) |
| 3.02 | 2001-06-29 | 現存する最も古い版。附属書 A のラベルは 184 個。限定文字列・文字列は二重引用符で囲む |
| 3.03 | - | 大幅な改訂。引用符が不要になった(古い相手のために付けてもよい)。`ERDRIN`・`ERDRUP`・`ERNRIN`・`ERNRUP`・`LTYPE` を追加 |
| 3.04 | - | TCP/IP での通信を規定。`DRILLE` を追加し `DRILL` を廃止扱いに。ダウンロードする装置でのプリセット初期化を非推奨に |
| 3.06 | - | 刻印・インクマークの絵柄を指定する `INKMASK`・`ENGMASK`・`ENGLOC` を追加 |
| 3.07 | 2008-06-01 | `ENGMARK` を追加し、3.06 の 3 つを廃止扱いに。ラベルは 315 個 |
| 3.08 | - | 未入手。2011 年 3 月の業界記事で現行版とされているため、それ以前に出ている |
| 3.09 | 2012-10-01 | 不等角度の玉型データを 2 種類に分け、角度が戻ってもよい「C」(creative)モードを追加。ラベルは 385 個 |
| 3.10 | 2014-10 | 左右の欄をさらに `\|` で区切って複数の値を持つレコード(公差など)を導入。公差レコードを表 A.1a に分けた。工程管理レコードの表の番号が A.23 から A.27 に変わった。ラベルは 412 個 |
| 3.11 | - | 未入手。附属書 D を新設。min\|max データ型、報告レコード(5.22 節)、`JOBRTE` などを追加。`SURFMT` に 10 番目の欄、状態コード 30・31 を追加 |
| 3.12 | - | 未入手。2019 年 11 月にウェイバックマシンに保存された公式サイトの最終版があるため、それ以前に出ている。単数・複数レコードを定義し、`PROCBLK` を追加 |
| 3.13 | 2022-04-05 | ラベルを 16 文字まで、値を 255 文字まで(従来は 80 文字)に。裏面刻印レンズの座標系を追加。ラベルは 451 個 |
| 3.14 | 2025-07-24 | 接頭辞付きの測定値レコードを表 A.1 の列で示す形に整理。処方値などのラベルを追加。ラベルは 496 個 |

- 日付は手に入った版の表紙によります。ただし 3.14 は表紙に日付が無いため、The Vision Council の公開発表の日です。手に入らなかった版は表紙が見られないため、日付を書いていません。3.13 の公開は 2022-06-03 です
- 3.03-3.06 の内容は、後の版の本文に「version 3.0x で導入」と書かれているものだけです
- ファイルでの受け渡し(`REQ=FIL`、3.14 の 7.5 節)は、3.02 には無く 3.07 にあります(6.5 節)。どの版で加わったかは分かりません
- ラベルの数は附属書 A の表に載っているもので、接頭辞付きのラベル([後述](#測定値の接頭辞付きラベルの扱い))は含めていません

## 版ごとのラベルの追加

### 3.02 から 3.07 まで(131 個)

この間の版は手に入っていないため、追加された版が分かるのは一部だけです。3.03・3.04 はプリセット表(表 A.5-A.23)のラベルに付いている下付きの版番号、3.06・3.07 は本文の記述によります。

- 3.03: `ERDRIN`・`ERDRUP`・`ERNRIN`・`ERNRUP`・`LTYPE`
- 3.04: `DRILLE`
- 3.06: `INKMASK`・`ENGMASK`・`ENGLOC`
- 3.07: `ENGMARK`
- 3.03-3.07 のどれか: `ABBE`・`ADJAX`・`ADJCYL`・`ADJPRVA`・`ADJPRVM`・`ADJSPH`・`AR`・`BCERIN`・`BCERUP`・`BEVH`・`BTILT`・`BVD`・`CANDO`・`CBUMP`・`CCFILMTYP`・`CCPOSDRP`・`CCPOSNRP`・`CCPOSPRP`・`CIRC3D`・`CKCOLR`・`CKCUT`・`CKHC`・`CKINK`・`CKPRSM`・`CKPWR`・`CKTHK`・`CLAGE`・`CLFRNT`・`CLHT`・`CLIENTF`・`CLINIT`・`CLLIFE`・`CLLNAM`・`CORRLEN`・`CRIBAX`・`CRIBFMT`・`CXFILMTYP`・`DOENG`・`DOFBLK`・`DOINK`・`DOPRINT`・`DOSDF`・`DRLFMT`・`DSDEV`・`DZX`・`DZXY`・`DZY`・`ERSGIN`・`ERSGUP`・`FED`・`FEDAX`・`FOD`・`FUPC`・`FWA`・`FWD`・`GRADIENT`・`HASINK`・`HEADK`・`HEADS`・`HICRV`・`INSTYPE`・`IP`・`LAB`・`LAPAX`・`LAPBIN`・`LDNAM`・`LDPATH`・`LHO`・`LIB`・`MAXBACK`・`MAXFRT`・`MINBACK`・`MINBLOCK`・`MINCTR`・`MINEDG`・`MINFRT`・`MINTHKCD`・`MPD`・`MVER`・`NOD`・`NWA`・`NWD`・`OCR`・`PANTO`・`PBOK`・`PHOTO`・`PINBS`・`POLAR`・`PORT`・`PROC`・`PTOK`・`PTPRVA`・`PTPRVM`・`RMT`・`RVD`・`SBLKCC`・`SBLKCX`・`SDFMODE`・`SMDMAX`・`SMOCIN`・`SMOCUP`・`STHKFMT`・`SURFMT`・`THNR`・`TILTBASE`・`TIME`・`TOKEN`・`TOLASPEC`・`TOLHC`・`TOLSET`・`TOLSHAPE`・`TOLSTD`・`TPERR`・`UNI`・`VIEWP`・`VMAP`・`WEIGHT`・`XMAX`・`XMIN`・`XSTATUS`・`ZZ`

### 3.07 から 3.09 まで(71 個)

3.08 は手に入っていないため、3.08 と 3.09 のどちらで追加されたかは分かりません。

`ACT`・`ADJADD`・`BLKM`・`BVAL`・`CAPE`・`CKPOLAR`・`CRIBELLOK`・`CRIBFLATOK`・`CRIBFMTOK`・`CRIBRNDOK`・`CTHKA`・`CTHKP`・`CTHNA`・`CTHNP`・`DRILLS`・`EDATA`・`ERCD`・`FBERIN`・`FBERUP`・`FBLKH`・`FBLKTYP`・`FBLKV`・`FCHT`・`FDSRC`・`HASENG`・`HMODEL`・`HNAME`・`HSN`・`HVEN`・`HVER`・`INSMOD`・`INSPATH`・`LDCRYPT`・`LDROT`・`LDTYPE`・`LDVEN`・`LDVER`・`LTYPEB`・`LTYPEF`・`MAC`・`MADD`・`MAXDRL`・`MINAVG`・`MINBCTHK`・`MINDIA`・`MINDRL`・`MIXBLKOK`・`NREF`・`OPTFRNT`・`PLRCRV`・`PLRLOC`・`PRI`・`PUBK`・`RCRIB`・`SA`・`SBCCIN`・`SBCCUP`・`SD`・`SEGDHT`・`SF`・`SHLFC`・`SHLFFMT`・`SHLFM`・`SHLFP`・`SW`・`TFADD`・`THKR`・`TXTENC`・`VTOLFCYL`・`VTOLFRNT`・`WDFPATH`

### 3.09 から 3.10 まで(27 個)

`BILLOK`・`BLKROT`・`CARDID`・`CARDTYP`・`CKPRHI`・`CKPRVI`・`CLDEYE`・`CLHLAT`・`CLICKS`・`CLZTILT`・`DDFPATH`・`DESTID`・`DOSDL`・`EDGED`・`ENVID`・`EROCIN`・`EROCUP`・`LBLTYP`・`LDENV`・`LENVID`・`MAXGPRVM`・`MAXKPRVM`・`NOTETYP`・`PRCPRMODE`・`SDLPATH`・`SMROT`・`TZ`

### 3.10 から 3.13 まで(39 個)

附属書 D で版が分かるものは分けています。

- 3.11: `JOBRTE`・`BLKGRP`・`BLKID`・`BLKMIN`・`BLKR`・`BLKSD`・`CCBLND`・`CCBOWL`・`CCCARR`・`CCCARX`・`CCCARY`・`CCFRM`・`DOCOAT`・`DOGEN`・`DOPRE`・`DOWASH`・`LVAL`・`PASSFMT`・`REP`・`SAFELENS`
- 3.12: `PROCBLK`
- 3.13: `ARCOAT`・`BACKR`・`BRERA`・`BRERIN`・`BRERUP`・`BLKOD`・`DODBLK`・`DOEDG`・`FRNTR`・`FSRC`・`MFH`
- 附属書 D に載っていないもの(3.11-3.13 のどれか): `CLNVB`・`CXBLND`・`CXBOWL`・`CXCARR`・`CXCARX`・`CXCARY`・`CXFRM`

### 3.13 から 3.14 まで(45 個)

附属書 D に載っている 39 個と、次の 6 個です。

- 附属書 D に載っているもの: `BEVANG`・`BINF`・`BINL`・`DATERCV`・`DATESB`・`DRAX`・`DRCYL`・`DRPRVA`・`DRPRVM`・`DRSPH`・`FCYLL`・`FGANG`・`FGHT`・`FRNTL`・`NPRISMDIFF`・`NRAX`・`NRCYL`・`NRPRVA`・`NRPRVM`・`NRSPH`・`PHORIA`・`PLRCRVR`・`POLARAX`・`PRAX`・`PRCYL`・`PRPRVA`・`PRPRVM`・`PRSPH`・`REFL`・`S1`・`S2`・`SGAX`・`SGCYL`・`SGSPH`・`SMDMAXR`・`SPU`・`TFADDL`・`XMIT`・`XMITB`
- 接頭辞を外した形で表 A.1 に載ったもの: `CTHK`・`FCYL`・`PRVH`・`PRVHI`・`PRVV`・`PRVVI`。それまでは `TOLCTHK`・`INSFCYL`・`TOLPRVHI` のように接頭辞付きでだけ載っていました。このうち `CTHK` は載ると同時に廃止扱い(後継は `CTHICK`)です

附属書 D で「Due to move as Measurable record」とされている `DRAX`・`NRSPH`・`PRCYL`・`SGSPH`・`REFL`・`XMIT` などは、3.13 までは `INSDRAX`・`LDNRSPH`・`TOLREFL` のように接頭辞付きでだけ載っていたものです。

## 無くなったラベル

附属書 A から消えたラベルはほとんどありません。廃止扱いになったラベルも、表には残り続けます。

| ラベル | 内容 |
|---|---|
| `HASINK` | 3.07 の表 A.1 にあり、3.09 では無くなっています。3.09 では `HASENG`(半可視マークがあるか)が加わっています |
| `INSSGIN`・`INSSGUP`・`TOLSGIN`・`TOLSGUP` | 3.07-3.13 にあった接頭辞付きのラベルです。3.14 では接頭辞の付く元が `SGOCIN`・`SGOCUP` となり、`INSSGOCIN`・`TOLSGOCUP` などの形になっています |

## 測定値の接頭辞付きラベルの扱い

検査値の `INS`、公差の `TOL`・`TOLV`、検査の指示の `CK`、設計値の `LD` の付いたラベルは、版によって載せ方が違います。

- 3.02 には接頭辞付きのラベルはありません
- 3.07 から 3.13 までは、`INSADD`・`TOLAX`・`LDSPH` のように接頭辞付きのラベルを 1 つずつ表に載せていました。3.07 の時点で 75 個あり、3.09 で `INSFCYL`・`INSFRNT`・`TOLFCYL`・`TOLFRNT`・`TOLPOLAR`・`TOLPRVH`・`TOLPRVV`、3.13 で `INSIPD`・`INSNPD` が加わっています
- 3.10 で公差レコードの表 A.1a ができ、`TOL` で始まるラベルはすべてそちらに移りました。公差の幅を表す `TOLV` の付いたラベル(`TOLVADD` など)が現れたのも 3.10 です。3.09 で加わった `VTOLFCYL`・`VTOLFRNT` は名前の形が違い、別のラベルとして 3.14 にも残っています
- 3.14 では接頭辞付きのラベルを 1 つずつ載せるのをやめ、表 A.1 の元のラベルに、どの接頭辞を付けてよいかの印を付ける形になりました([records.md](records.md#測定値の接頭辞))

## 版によって記述が食い違う点

規格書の前書きや本文が、版を上げたときに直されていない箇所があります。

- 3.07 の前書きは「Version 3.06 を作成した」と書き、続けて `OMAV=3.07` としています。3.10 の前書きも「Version 3.09」「`OMAV=3.09`」のままです(表紙は 3.10)
- ISO 16284 の元になった版は、3.07 の前書きでは 3.01、3.09 以降の前書きでは 3.03 となっています
- `DRILL` の導入時期は、5.5.1.1 節では 3.03、6.2.3 節では 3.02 となっています。3.02 の附属書 A に `DRILL` があり、プリセット表の下付きの版番号も 3.02 なので、3.02 が正しいと考えられます

## 入手先

The Vision Council のサイトで公開されていたファイルです。旧版は公式サイトから消えているため、ウェイバックマシン(Internet Archive)に保存されたものを使いました。

| 版 | 入手先 |
|---|---|
| 3.02 | https://nactkey.com/optekdocs/reference/VCA-DCS-302.pdf (第三者のサイト) |
| 3.07 | https://web.archive.org/web/20090806173817/http://www.thevisioncouncil.org:80/members/media/DCS%20V3%2007%20July%2008.pdf |
| 3.09 | https://web.archive.org/web/20140913170320/http://www.thevisioncouncil.org:80/sites/default/files/members/DCS%20v3%2009%2011062012%20Final.doc (Word 形式) |
| 3.10 | https://web.archive.org/web/20160305000045/http://www.thevisioncouncil.org/sites/default/files/DCS-v3-10-Final-2014.pdf |
| 3.12 | https://web.archive.org/web/20191120000310/https://www.thevisioncouncil.org/sites/default/files/DCS-v3_12_FINAL_v2.pdf (取得できなかったため、比較に使っていない) |
| 3.13 | https://web.archive.org/web/20220603184053/https://thevisioncouncil.org/sites/default/files/assets/media/DCS_v3.13_FINAL-2022.pdf |
| 3.14 | https://thevisioncouncil.org/sites/default/files/assets/media/DCS_v3.14_Final.pdf |
