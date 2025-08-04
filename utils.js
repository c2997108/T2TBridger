/**
 * Parses a MAF stream from a File object.
 * @param {File} mafFile - The MAF file object.
 * @param {object} contigInfo - Object containing contig information.
 * @returns {Promise<Array>} - A promise that resolves to an array of alignment objects.
 */
export async function parseMafStream(mafFile, contigInfo) {
    const alignments = [];
    const reader = mafFile.stream().getReader();
    const decoder = new TextDecoder();
    let leftover = '';
    const min_align_len = 10000;

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        const lines = (leftover + chunk).split('\n');
        leftover = lines.pop();

        for (const line of lines) {
            try {
                const parts = line.trim().split(/\t/);
                if (parts.length < 11 || line.startsWith('#')) continue;

                const q_aln_len = parseInt(parts[3], 10);
                if (q_aln_len < min_align_len) continue;

                const q_name = parts[1];
                const q_start = parseInt(parts[2], 10);
                const t_name = parts[6];
                const t_start = parseInt(parts[7], 10);
                const t_aln_len = parseInt(parts[8], 10);
                const strand = parts[9];
                const t_src_size = parseInt(parts[10], 10);

                if (contigInfo[q_name] && contigInfo[t_name]) {
                    let y_start_local, y_end_local;
                    let direction = 'forward';

                    if (strand === '+') {
                        y_start_local = t_start;
                        y_end_local = t_start + q_aln_len;
                    } else {
                        direction = 'reverse';
                        y_start_local = t_src_size - t_start - t_aln_len;
                        y_end_local = t_src_size - t_start;
                    }

                    alignments.push({
                        q_name,
                        q_start_orig: q_start,
                        t_name,
                        t_start_orig: y_start_local,
                        aln_len: q_aln_len,
                        strand,
                        x_start: q_start,
                        x_end: q_start + q_aln_len,
                        y_start: y_start_local,
                        y_end: y_end_local,
                        direction
                    });
                }
            } catch (e) { /* Silently ignore malformed lines */ }
        }
    }
    return alignments;
}

/**
 * Finds a contig from an array based on a local position.
 * @param {number} pos - The local position.
 * @param {Array} contigs - The array of contig objects.
 * @returns {object|undefined} - The found contig or undefined.
 */
export const findContigByLocalPos = (pos, contigs) => contigs.find(c => pos >= c.newOffset && pos < c.newOffset + c.length);

/**
 * Calculates the squared distance from a point to a line segment.
 * @param {object} p - The point {x, y}.
 * @param {object} v - The start point of the segment {x, y}.
 * @param {object} w - The end point of the segment {x, y}.
 * @returns {number} - The squared distance.
 */
export function distToSegmentSquared(p, v, w) {
    const l2 = (v.x - w.x)**2 + (v.y - w.y)**2;
    if (l2 === 0) return (p.x - v.x)**2 + (p.y - v.y)**2;
    let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
    t = Math.max(0, Math.min(1, t));
    const proj = { x: v.x + t * (w.x - v.x), y: v.y + t * (w.y - v.y) };
    return (p.x - proj.x)**2 + (p.y - proj.y)**2;
}

/**
 * Parses a FASTA file stream to extract contig information.
 * @param {File} fastaFile - The FASTA file object.
 * @returns {Promise<object>} - A promise that resolves to an object containing contig info.
 */
export async function parseFastaForContigInfo(fastaFile) {
    const reader = fastaFile.stream().getReader();
    const decoder = new TextDecoder();
    
    let buffer = '';
    const contigs = {};
    let currentName = null;
    let currentLength = 0;
    let totalOffset = 0;

    const processLines = (lines) => {
        for (const line of lines) {
            if (line.startsWith('>')) {
                if (currentName) {
                    contigs[currentName] = {
                        length: currentLength,
                        offset: totalOffset
                    };
                    totalOffset += currentLength;
                }
                currentName = line.substring(1).split(/\s+/)[0];
                currentLength = 0;
            } else if (currentName) {
                currentLength += line.trim().length;
            }
        }
    };

    while (true) {
        const { done, value } = await reader.read();
        if (done) {
            buffer += decoder.decode(); // flush
            const lines = buffer.split('\n');
            processLines(lines);
            break;
        }
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop(); // keep partial line
        processLines(lines);
    }

    if (currentName) {
        contigs[currentName] = {
            length: currentLength,
            offset: totalOffset
        };
    }

    return { contigs };
}