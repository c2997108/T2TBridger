#!/usr/bin/env python3
"""step2/ragtag.patch.fasta から N を含む領域を BED 形式で抽出するスクリプト。

Usage:
    python find_n_regions.py [FASTA_PATH]

FASTA_PATH を省略した場合は step2/ragtag.patch.fasta を使用する。
"""

import sys
from pathlib import Path


def main(argv=None):
    if argv is None:
        argv = sys.argv[1:]

    if len(argv) > 1:
        print(f"Usage: {Path(sys.argv[0]).name} [FASTA_PATH]", file=sys.stderr)
        return 2

    if argv:
        fasta_path = Path(argv[0])
    else:
        fasta_path = Path("step2/ragtag.patch.fasta")

    if not fasta_path.exists():
        print(f"{fasta_path} が見つかりません", file=sys.stderr)
        return 1

    with fasta_path.open() as fh:
        out_fh = sys.stdout
        current_name = None
        current_pos = 0
        run_start = None

        for raw_line in fh:
            line = raw_line.strip()
            if not line:
                continue
            if line.startswith(">"):
                if current_name is not None and run_start is not None:
                    out_fh.write(f"{current_name}\t{run_start}\t{current_pos}\n")
                    run_start = None
                current_name = line[1:].split()[0]
                current_pos = 0
                continue

            if current_name is None:
                print("FASTA ファイルの形式が不正です", file=sys.stderr)
                return 1

            for base in line:
                if base in {"N", "n"}:
                    if run_start is None:
                        run_start = current_pos
                elif run_start is not None:
                    out_fh.write(f"{current_name}\t{run_start}\t{current_pos}\n")
                    run_start = None
                current_pos += 1

        if current_name is not None and run_start is not None:
            out_fh.write(f"{current_name}\t{run_start}\t{current_pos}\n")

    return 0


if __name__ == "__main__":
    sys.exit(main())
