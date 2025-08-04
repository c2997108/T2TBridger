<img width="910" height="459" alt="image" src="https://github.com/user-attachments/assets/5c83085b-73e8-4cce-81ef-60b47f9ac3cf" />

# T2TBridger
T2TBridgerは、アセンブルしたコンティグの相同性部分を見つけてつなぎ合わせていくことでT2Tゲノムを作るのを視覚的にわかりやすく操作できるツールです。

# 準備
1. HiFiもしくはQ20ナノポアフローセルでシーケンスしたデータをhifiasmでアセンブル。
```
#以下はナノポアの例 HiFiなら--ontは不要
hifiasm --dual-scaf -o contigs -t 16 --ont fastq/*.fastq.gz
for i in `ls *ctg.gfa`; do awk '/^S/{print ">"$2;print $3}' $i > `basename $i .gfa`.fasta; done
#hap1とhap2のコンティグを同一ファイルにまとめる
cat contigs.bp.hap1.p_ctg.fasta contigs.bp.hap2.p_ctg.fasta > hap1-2.fasta
```

2. テロメアの座標を探索
```
#テロメアがTTAGGGの場合
git clone https://github.com/c2997108/T2TBridger.git
awk -f T2TBridger/find_telomere_repeats.awk hap1-2.fasta > hap1-2.telomere.bed
```

3. コンティグ間の相同性領域の探索
[Portable Pipeline](https://github.com/c2997108/OpenPortablePipeline)の`post-assemble~dotplot-by-last`にて、X, Yともにhap1-2.fastaを指定して実行し、hap1-2.fasta内のすべてのコンティグ間の相同性を検索し、下記のコマンドで出力を削っておく。
```
awk -F'\t' '$9>=10000' path-to-portable-pipeline-output/split_query/hap1-2.fa-temp-hap1-2.fa.maf.all.tsv|cut -f 1-11 > hap1-2.maf.tsv
```

4. https://c2997108.github.io/T2TBridger/
にアクセスして、`hap1-2.fasta`, `hap1-2.telomere.bed`, `hap1-2.maf.tsv`の3つを入力し、T2TBridgerを開始する。

# 使い方
1. データがロードされると、テロメア配列を持つコンティグが抽出され、それらの間の相同性を表示するドットプロットが描画される。このとき、テロメアからコンティグを伸ばしていきたいコンティグのドットプロットをクリックすると、次のその選択したコンティグと相同性のあるコンティグ（テロメアを持たないコンティグも含む）がX軸に描画される。このとき、Y軸は下側にテロメアが配置されるように描画されるため、Y軸の上方向にもっと伸ばすことができそうなX軸のコンティグを選んでクリックすると、そのコンティグが選択され、そのコンティグがY軸となる次のドットプロットが描画される。基本的にはY軸の上方向に伸ばしていけそうなコンティグをX軸から選んでいくのを繰り返し、Y軸の上側を伸ばすことができるX軸のコンティグの端にテロメアが出現したら、そのX軸のコンティグを選んで1つの染色体構築が終了。そうすると、「Back to Global」をクリックして全テロメアコンティグのドットプロットに戻ってから別のテロメア付きのコンティグを選んで染色体の作成を継続する。満足する染色体数を作り終えたら、「Export Paths」をクリックして、これまでに選択したコンティグの順番を出力する。

2. 下記のコマンドで伸長したFASTAファイルを作成する。samtools, seqkitのインストールが必要。
```
samtools faidx hap1-2.fa

cat exported_paths.txt|sed 's/,//g; s/ [[]/:/g; s/]//g'|awk '
 FILENAME==ARGV[1]{len[$1]=$2}
 FILENAME==ARGV[2]{
  if($0~"^Path "){sub(/:$/,"",$2); n=$2; m=0}
  else if($0~"^  ->"){
   m++;
   if(m>1){
    split($4,arr,":"); c=arr[1]; split(arr[2],pos,"-");
    if(c!=newc){echo "contig names are not same"; exit 1};
    if(newdir=="+"){
     print n"\t"m-1"\t"c"\t"newpos[2]+1"\t"pos[2]"\t"newdir"\t"len[c]
    }else{
     print n"\t"m-1"\t"c"\t"pos[1]+1"\t"newpos[1]"\t"newdir"\t"len[c]
    }
   };
   if(m==1){
    split($5,arr,":"); newc=arr[1]; split(arr[2],newpos,"-"); newdir=substr($6,8,1);
    if(newdir=="+"){newpos[1]=0; newpos[2]=0}else{newpos[1]=len[newc]; newpos[2]=len[newc]};
   }else{
    split($6,arr,":"); newc=arr[1]; split(arr[2],newpos,"-"); newdir=substr($7,8,1);
   }
  }
  else if($0~"^$"){
   if(newdir=="+"){
    print n"\t"m"\t"newc"\t"newpos[2]+1"\t"len[newc]"\t"newdir"\t"len[newc]
   }else{
    print n"\t"m"\t"newc"\t"1"\t"newpos[1]"\t"newdir"\t"len[newc]
   }
  }
 }' hap1-2.fa.fai /dev/stdin > hap1-2.path

awk -F'\t' '
 BEGIN {
  map["A"]="T"; map["C"]="G"; map["G"]="C"; map["T"]="A";
  map["B"]="V"; map["V"]="B"; map["D"]="H"; map["H"]="D";
  map["K"]="M"; map["M"]="K"; map["R"]="Y"; map["Y"]="R";
  map["S"]="W"; map["W"]="S";
 }
 function revcomp(x,   i, n, c) {
  n = length(x)
  for(i = n; i >= 1; i--) {
    c = substr(x, i, 1)
    # 1文字ずつその場で出力
    printf "%s", (c in map ? map[c] : "N")
  }
 }
 FILENAME==ARGV[1]{seq[$1]=$2}
 FILENAME==ARGV[2]{
  ORS="";
  if($1!=old){if(old!=""){print "\n"}; old=$1; print ">scaffold_"$1"\n"}
  path[$3]=1;
  if($6=="+"){
   print substr(seq[$3],$4,$5-$4+1)
  }else{
   revcomp(substr(seq[$3],$4,$5-$4+1))
  }
 }
 END{
  print "\n"
  ORS="\n";
  for(i in seq){
   if(!(i in path)){
    print ">"i"\n"seq[i]
   }
  }
 }
 ' <(cat hap1-2.fa|awk '$0~"^>"{print $1} $0!~"^>"{print $0}'| seqkit fx2tab) hap1-2.path > hap1-2.extended.fa
```

