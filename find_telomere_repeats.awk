#!/usr/bin/awk -f
#
#  find_telomere_repeats.awk : TTAGGG/CCCTAA ≥3 連続を BED で出力
#
#  使い方:
#     awk -f find_telomere_repeats.awk input.fa > telomere.bed
#

BEGIN {
    RS = "\n";          # 1 行ずつ読む
    FS = "" ;           # 行を 1 文字ずつ扱う (ここでは使わない)
    regex = "(TTAGGG){3,}|(CCCTAA){3,}";
    seq  = "";
    chrom = "";
}

/^>/ {                  # ヘッダー行 (新しい配列の開始)
    if (length(seq) > 0)
        process_seq();  # 直前の配列を処理
    chrom = substr($0, 2);  # '>' を除いた ID が染色体名
    seq   = "";
    next;
}

{   # 配列行を連結
    gsub(/[ \t\r\n]/, "", $0);  # 念のため空白類を除去
    seq = seq $0;
}

END {
    if (length(seq) > 0)
        process_seq();  # 最後の配列を処理
}

# ---------- サブルーチン ----------
function process_seq(   s, offset, start, end, motif, strand) {
    s      = seq;       # 作業用コピー
    offset = 0;         # 0-based 位置オフセット

    while (match(s, regex)) {
        start = offset + RSTART - 1;   # AWK は 1-based
        end   = start + RLENGTH;       # BED は end exclusive
        motif = substr(s, RSTART, 6);  # 先頭 6 bp でモチーフ判定
        strand = (motif == "TTAGGG") ? "+" : "-";

        # BED3 + motif + score (.) + strand
        printf "%s\t%d\t%d\t%s\t.\t%s\n", chrom, start, end, motif, strand;

        # 次の探索位置へ―オーバーラップしないよう RLENGTH だけ飛ばす
        s      = substr(s, RSTART + RLENGTH);
        offset = offset + RSTART + RLENGTH - 1;
    }
}
