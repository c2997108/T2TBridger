

/**
 * Parses a FASTA index (FAI) file.
 * @param {string} faiText - The content of the FAI file.
 * @returns {Map<string, object>} - A map from contig name to its index info.
 */
export function parseFai(faiText) {
    const faiMap = new Map();
    const lines = faiText.split('\n');
    for (const line of lines) {
        if (!line) continue;
        const [name, length, offset, lineBases, lineWidth] = line.split('\t');
        faiMap.set(name, {
            name,
            length: +length,
            offset: +offset,
            lineBases: +lineBases,
            lineWidth: +lineWidth,
            gaps: []
        });
    }
    return faiMap;
}

/**
 * Builds FAI-equivalent index information by scanning a FASTA file stream.
 * This avoids requiring a pre-generated .fai file.
 * @param {File} fastaFile - The FASTA file object.
 * @returns {Promise<Map<string, object>>} - A map from contig name to index info.
 */
export async function buildFaiFromFasta(fastaFile, options = {}) {
    const reader = fastaFile.stream().getReader();
    const decoder = new TextDecoder('utf-8');

    const now = () => (typeof performance !== 'undefined' && typeof performance.now === 'function')
        ? performance.now()
        : Date.now();
    const waitForNextFrame = () => new Promise(resolve => {
        if (typeof requestAnimationFrame === 'function') {
            requestAnimationFrame(() => resolve());
        } else {
            setTimeout(resolve, 16);
        }
    });
    let lastYieldTs = now();
    const maybeYieldToBrowser = async (force = false) => {
        if (!force) {
            const elapsed = now() - lastYieldTs;
            if (elapsed < 32) return;
        }
        await waitForNextFrame();
        lastYieldTs = now();
    };

    const telomereMotifRaw = (options.telomereMotif || 'TTAGGG').toUpperCase();
    const telomereMinLength = Math.max(1, options.telomereMinLength || 100);
    const telomereMotifLength = telomereMotifRaw.length;
    const telomereComplement = telomereMotifLength > 0 ? reverseComplement(telomereMotifRaw) : '';
    const telomereMotifs = [];
    if (telomereMotifLength > 0) {
        telomereMotifs.push({ strand: '+', motif: telomereMotifRaw });
        if (telomereComplement && telomereComplement !== telomereMotifRaw) {
            telomereMotifs.push({ strand: '-', motif: telomereComplement });
        }
    }

    const faiMap = new Map();
    let buffer = new Uint8Array(0);
    let fileOffset = 0; // Number of bytes already consumed from the file stream

    const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;
    const totalSize = typeof fastaFile.size === 'number' ? fastaFile.size : null;
    const reportProgress = () => {
        if (!onProgress) return;
        try {
            const processed = totalSize != null ? Math.min(fileOffset, totalSize) : fileOffset;
            onProgress(processed, totalSize);
        } catch (_) { /* ignore user progress errors */ }
    };
    reportProgress();

    let currentContig = null;

    const finalizeTelomereState = (state, endIndexExclusive, telomereArray) => {
        if (!state || state.runStart === null) {
            if (state) state.matchIndex = 0;
            return;
        }
        const length = endIndexExclusive - state.runStart;
        if (length >= telomereMinLength) {
            telomereArray.push({
                start: state.runStart,
                end: endIndexExclusive,
                strand: state.strand
            });
        }
        state.runStart = null;
        state.matchIndex = 0;
    };

    const advanceTelomereState = (state, baseUpper, globalIndex, telomereArray) => {
        if (!state || state.motifLength === 0) return;
        const expectedChar = state.motif[state.matchIndex];
        if (baseUpper === expectedChar) {
            if (state.runStart === null) {
                state.runStart = globalIndex;
            }
            state.matchIndex++;
            if (state.matchIndex === state.motifLength) {
                state.matchIndex = 0;
            }
        } else {
            finalizeTelomereState(state, globalIndex, telomereArray);
            if (baseUpper === state.motif[0]) {
                state.runStart = globalIndex;
                state.matchIndex = state.motifLength === 1 ? 0 : 1;
            } else {
                state.runStart = null;
                state.matchIndex = 0;
            }
        }
    };

    const finalizeContig = () => {
        if (!currentContig) return;
        if (currentContig.ongoingGapStart !== null) {
            currentContig.gaps.push({
                start: currentContig.ongoingGapStart,
                end: currentContig.length
            });
        }
        if (currentContig.telomereStates && currentContig.telomeres) {
            for (const state of currentContig.telomereStates) {
                finalizeTelomereState(state, currentContig.length, currentContig.telomeres);
            }
        }
        const {
            name,
            length,
            offset,
            lineBases,
            lineWidth,
            gaps,
            telomeres
        } = currentContig;
        if (!name) return;
        faiMap.set(name, {
            name,
            length,
            offset: offset ?? 0,
            lineBases: lineBases ?? length,
            lineWidth: lineWidth ?? (lineBases ?? length),
            gaps,
            telomeres: telomeres || []
        });
        currentContig = null;
    };

    const concatUint8 = (a, b) => {
        if (!a.length) return b;
        if (!b.length) return a;
        const merged = new Uint8Array(a.length + b.length);
        merged.set(a, 0);
        merged.set(b, a.length);
        return merged;
    };

    const processLine = (lineBytes, lineStartOffset, newlineLength) => {
        if (!lineBytes.length && currentContig === null) return;

        const lineText = decoder.decode(lineBytes);
        if (lineText.startsWith('>')) {
            finalizeContig();
            const rawName = lineText.slice(1).trim();
            const name = rawName.split(/\s+/)[0] || rawName;
            currentContig = {
                name,
                length: 0,
                offset: null,
                lineBases: null,
                lineWidth: null,
                gaps: [],
                ongoingGapStart: null,
                telomeres: [],
                telomereStates: telomereMotifs.map(m => ({
                    strand: m.strand,
                    motif: m.motif,
                    motifLength: m.motif.length,
                    matchIndex: 0,
                    runStart: null
                }))
            };
            return;
        }

        if (!currentContig) {
            // Skip unexpected sequence lines before any header
            return;
        }

        if (currentContig.offset === null) {
            currentContig.offset = lineStartOffset;
        }

        const basesInLine = lineText.length;
        if (basesInLine === 0) return;

        const lineUpper = lineText.toUpperCase();
        for (let i = 0; i < lineText.length; i++) {
            const base = lineText[i];
            const isGapBase = base === 'N' || base === 'n';
            const globalIndex = currentContig.length + i;
            const baseUpper = lineUpper[i];
            if (isGapBase) {
                if (currentContig.ongoingGapStart === null) {
                    currentContig.ongoingGapStart = globalIndex;
                }
            } else if (currentContig.ongoingGapStart !== null) {
                currentContig.gaps.push({
                    start: currentContig.ongoingGapStart,
                    end: globalIndex
                });
                currentContig.ongoingGapStart = null;
            }
            if (currentContig.telomereStates && currentContig.telomeres) {
                for (const state of currentContig.telomereStates) {
                    advanceTelomereState(state, baseUpper, globalIndex, currentContig.telomeres);
                }
            }
        }

        currentContig.length += basesInLine;

        if (currentContig.lineBases === null) {
            currentContig.lineBases = basesInLine;
            currentContig.lineWidth = basesInLine + newlineLength;
        }
    };

    const consumeBuffer = (isEOF = false) => {
        let start = 0;
        for (let i = 0; i < buffer.length; i++) {
            if (buffer[i] === 0x0A) { // Line Feed
                let lineBytes = buffer.subarray(start, i);
                let newlineLen = 1;
                if (lineBytes.length && lineBytes[lineBytes.length - 1] === 0x0D) {
                    lineBytes = lineBytes.subarray(0, lineBytes.length - 1);
                    newlineLen = 2;
                }
                const lineStartOffset = fileOffset + start;
                processLine(lineBytes, lineStartOffset, newlineLen);
                start = i + 1;
            }
        }

        if (start > 0) {
            fileOffset += start;
            buffer = buffer.subarray(start);
        }

        if (isEOF && buffer.length) {
            const lineStartOffset = fileOffset;
            processLine(buffer, lineStartOffset, 0);
            fileOffset += buffer.length;
            buffer = new Uint8Array(0);
        }
        reportProgress();
    };

    while (true) {
        const { value, done } = await reader.read();
        if (done) {
            consumeBuffer(true);
            reportProgress();
            await maybeYieldToBrowser(true);
            break;
        }
        if (value && value.length) {
            buffer = concatUint8(buffer, value);
            consumeBuffer(false);
            await maybeYieldToBrowser();
        }
    }

    finalizeContig();
    reportProgress();
    await maybeYieldToBrowser(true);
    return faiMap;
}

/**
 * Fetches a DNA sequence from a FASTA file using an FAI index.
 * @param {File} fastaFile - The FASTA file object.
 * @param {Map<string, object>} faiMap - The parsed FAI index.
 * @param {string} contigName - The name of the contig to fetch from.
 * @param {number} start - The 1-based start coordinate.
 * @param {number} end - The 1-based end coordinate.
 * @returns {Promise<string>} - The requested sequence.
 */
export async function fetchSequence(fastaFile, faiMap, contigName, start, end) {
    const entry = faiMap.get(contigName);
    if (!entry) {
        throw new Error(`Contig \"${contigName}\" not found in FAI index.`);
    }

    const { offset, lineBases, lineWidth } = entry;
    
    // Ensure start and end are within bounds
    const realStart = Math.max(1, start);
    const realEnd = Math.min(entry.length, end);
    const length = realEnd - realStart + 1;

    if (length <= 0) return "";

    // Calculate byte offsets for the start and end of the sequence data
    const startOffset = offset + Math.floor((realStart - 1) / lineBases) * lineWidth + ((realStart - 1) % lineBases);
    const endOffset = offset + Math.floor((realEnd - 1) / lineBases) * lineWidth + ((realEnd - 1) % lineBases);
    
    const blob = fastaFile.slice(startOffset, endOffset + 1); // +1 because slice end is exclusive
    const text = await blob.text();
    
    // Remove any newlines from the fetched text
    return text.replace(/\r?\n|\r/g, '');
}

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
                const parts = line.trim().split('\t');
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
 * Returns the reverse complement of a DNA sequence.
 * @param {string} seq - The DNA sequence.
 * @returns {string} - The reverse complemented sequence.
 */
export function reverseComplement(seq) {
    const complement = {
        'A': 'T', 'T': 'A', 'C': 'G', 'G': 'C',
        'a': 't', 't': 'a', 'c': 'g', 'g': 'c',
        'N': 'N', 'n': 'n'
    };
    let complementedSeq = '';
    for (let i = 0; i < seq.length; i++) {
        const base = seq[i];
        complementedSeq += complement[base] || base;
    }
    return complementedSeq.split('').reverse().join('');
}
