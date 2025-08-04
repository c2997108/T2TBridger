[日本語版 (Japanese)](https://github.com/c2997108/T2TBridger/blob/main/README_jp.md)
<img width="910" height="459" alt="image" src="https://github.com/user-attachments/assets/5c83085b-73e8-4cce-81ef-60b47f9ac3cf" />

# T2TBridger
A tool for generating a telomere-to-telomere (T2T) genome by finding and joining homologous regions among assembled contigs.

# Preparation

1. Assemble the sequencing data (obtained with either HiFi or Q20 Nanopore flowcells) using hifiasm.

```
# Example for Nanopore data; omit --ont option for HiFi reads
hifiasm --dual-scaf -o contigs -t 16 --ont fastq/*.fastq.gz
for i in `ls *ctg.gfa`; do awk '/^S/{print ">"$2;print $3}' $i > `basename $i .gfa`.fasta; done
# Merge hap1 and hap2 contigs into a single file
cat contigs.bp.hap1.p_ctg.fasta contigs.bp.hap2.p_ctg.fasta > hap1-2.fasta
```

2. Identify telomere coordinates

```
# For telomeres with the repeat motif TTAGGG
git clone https://github.com/c2997108/T2TBridger.git
awk -f T2TBridger/find_telomere_repeats.awk hap1-2.fasta > hap1-2.telomere.bed
```

3. Detect homologous regions between contigs
   Using the `post-assemble~dotplot-by-last` pipeline of the [Portable Pipeline](https://github.com/c2997108/OpenPortablePipeline), specify `hap1-2.fasta` for both X and Y. This will search for homologies among all contig pairs within hap1-2.fasta. Use the following command to filter the output:

```
awk -F'\t' '$9>=10000' path-to-portable-pipeline-output/split_query/hap1-2.fa-temp-hap1-2.fa.maf.all.tsv|cut -f 1-11 > hap1-2.maf.tsv
```

4. Go to [https://c2997108.github.io/T2TBridger/](https://c2997108.github.io/T2TBridger/),
   upload `hap1-2.fasta`, `hap1-2.telomere.bed`, and `hap1-2.maf.tsv`, and start T2TBridger.

---

# How to Use

1. Once the data is loaded, contigs containing telomeric sequences are extracted and a dot plot showing the homologies between these contigs is displayed.
   Clicking on the dot plot of a contig you wish to extend from its telomere will display contigs (including non-telomeric contigs) homologous to the selected contig along the X-axis.
   The telomere will be positioned at the bottom of the Y-axis, so you can choose and click an X-axis contig that appears to extend the Y-axis upwards.
   This will select that contig as the new Y-axis and a new dot plot will be rendered.
   By repeatedly selecting X-axis contigs that appear to extend the Y-axis upwards, if a telomeric sequence appears at the end of an X-axis contig that can further extend the Y-axis, select that contig to complete the construction of one chromosome.
   Then, click "Back to Global" to return to the dot plot of all telomeric contigs, and select a different telomeric contig to continue constructing additional chromosomes.
   Once you have finished constructing as many chromosomes as desired, click "Export Paths" to output the order of the selected contigs.

2. Use the following commands to create an extended FASTA file.
   You will need to have samtools and seqkit installed.
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

