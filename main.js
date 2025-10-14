import * as config from './config.js';
import * as utils from './utils.js';
import { renderGlobalPlot, renderDetailPlot, setRenderViewCallback } from './plot.js';

let contigJumpInputElem = null;
let contigJumpButtonElem = null;
let contigJumpDatalistElem = null;
let isJapaneseLocale = false;
let loadingOverlayElem = null;
let loadingMessageElem = null;
let loadingProgressBarElem = null;
let loadingProgressTextElem = null;

// --- Main Application Logic ---

document.addEventListener('DOMContentLoaded', function() {
    // Set the callback in plot.js to avoid circular dependency
    setRenderViewCallback(renderView);

    const loadButton = document.getElementById('load-data-button');
    const mafFileInput = document.getElementById('maf-file');
    const fastaFileInput = document.getElementById('fasta-file');
    const telomereMotifInput = document.getElementById('telomere-motif');
    const telomereMinLengthInput = document.getElementById('telomere-min-length');
    const toggleRepeatButton = document.getElementById('toggle-repeat-button');
    const reversePathButton = document.getElementById('reverse-path-button');
    contigJumpInputElem = document.getElementById('contig-jump-input');
    contigJumpButtonElem = document.getElementById('contig-jump-button');
    contigJumpDatalistElem = document.getElementById('contig-jump-options');
    loadingOverlayElem = document.getElementById('loading-overlay');
    loadingMessageElem = document.getElementById('loading-message');
    loadingProgressBarElem = document.getElementById('loading-progress-bar');
    loadingProgressTextElem = document.getElementById('loading-progress-text');
    const closeSequenceViewerButton = document.getElementById('close-sequence-viewer');
    const toggleHelpButton = document.getElementById('toggle-help-button');
    const helpBox = document.getElementById('keyboard-help');

    // i18n: Decide language (Japanese if any locale starts with "ja")
    const isJa = (() => {
        const langs = navigator.languages || [navigator.language || ''];
        return langs.some(l => (l || '').toLowerCase().startsWith('ja'));
    })();
    isJapaneseLocale = isJa;

    // Build localized help content
    const helpTexts = isJa ? {
        helpLabel: 'ヘルプ',
        title: 'キーボード操作',
        note: '注: プロット領域をアクティブにした状態（クリック後）で有効です。',
        items: [
            ['r', 'X軸の向きを反転（現在のビューに適用）'],
            ['f', 'ホバー中のアラインメント区間の配列を表示（最大3,000bp、X軸とY軸）'],
            ['↑ / ↓', '表示を上下にパン（5%ずつ）'],
            ['← / →', '表示を左右にパン（5%ずつ）'],
            ['w', 'ズームイン'],
            ['s', 'ズームアウト']
        ]
    } : {
        helpLabel: 'Help',
        title: 'Keyboard Shortcuts',
        note: 'Note: Click the plot area to focus before using shortcuts.',
        items: [
            ['r', 'Reverse X-axis orientation (applies to current view)'],
            ['f', 'Show sequences for hovered alignment segment (up to 3,000 bp; X & Y)'],
            ['↑ / ↓', 'Pan vertically by 5%'],
            ['← / →', 'Pan horizontally by 5%'],
            ['w', 'Zoom in'],
            ['s', 'Zoom out']
        ]
    };

    const missingFilesMessage = isJa
        ? 'MAFファイルとFASTAファイルを選択してください。'
        : 'Please select both MAF and FASTA files.';
    const invalidMotifMessage = isJa
        ? 'テロメアモチーフにはA/C/G/T/Nのみを使用してください。'
        : 'Telomere motif must contain only A, C, G, T, or N.';
   const invalidLengthMessage = isJa
       ? 'テロメア最小長は1以上の整数を指定してください。'
       : 'Minimum telomere length must be a positive integer.';
   const jumpEmptyMessage = isJa
       ? '移動するコンティグ名を入力してください。'
       : 'Please enter a contig name to jump to.';
   const jumpNotFoundMessage = isJa
       ? '指定したコンティグは見つかりません。'
       : 'Specified contig was not found.';
    const reversePathNotAllowedMessage = isJa
        ? 'パスが存在する状態でのみ反転できます。'
        : 'You can only reverse when a path is active.';

   const updateRepeatButtonLabel = () => {
       if (!toggleRepeatButton) return;
       const isOn = config.allowRepeatSelection;
       if (isJa) {
           toggleRepeatButton.textContent = `同一コンティグ再選択を許可: ${isOn ? 'ON' : 'OFF'}`;
       } else {
           toggleRepeatButton.textContent = `Allow Repeat Selection: ${isOn ? 'ON' : 'OFF'}`;
       }
   };
    const updateReverseButtonLabel = () => {
        if (!reversePathButton) return;
        reversePathButton.textContent = isJa ? '現在のパスを反転' : 'Reverse Current Path';
    };

    if (toggleHelpButton && helpBox) {
        toggleHelpButton.textContent = helpTexts.helpLabel;
        const listItems = helpTexts.items
            .map(([k, v]) => `<li><code>${k}</code>: ${v}</li>`) 
            .join('');
        helpBox.innerHTML = `
            <strong>${helpTexts.title}:</strong>
            <ul style="margin: 8px 0 0 18px;">${listItems}</ul>
            <div style="color:#666; margin-top:6px;">${helpTexts.note}</div>
        `;

        toggleHelpButton.addEventListener('click', () => {
            const isHidden = helpBox.style.display === 'none' || helpBox.style.display === '';
            helpBox.style.display = isHidden ? 'block' : 'none';
        });
    }

   loadButton.addEventListener('click', () => {
        const mafFile = mafFileInput.files[0];
        const fastaFile = fastaFileInput.files[0];
        const motifRaw = (telomereMotifInput.value || 'TTAGGG').trim();
        const motif = motifRaw.toUpperCase();
        const minLengthInput = parseInt(telomereMinLengthInput.value, 10);
        const telomereMinLength = Number.isFinite(minLengthInput) ? minLengthInput : 100;

        if (!mafFile || !fastaFile) {
            alert(missingFilesMessage);
            return;
        }

        if (!motif || !/^[ACGTN]+$/i.test(motif)) {
            alert(invalidMotifMessage);
            return;
        }

        if (telomereMinLength <= 0) {
            alert(invalidLengthMessage);
            return;
        }

       config.setAllowRepeatSelection(false);
       updateRepeatButtonLabel();
        updateReverseButtonLabel();

        document.getElementById('file-selection-container').style.display = 'none';
        document.getElementById('main-content').style.display = 'block';

        initialize(mafFile, fastaFile, motif, telomereMinLength).catch(console.error);
    });

   if (toggleRepeatButton) {
       updateRepeatButtonLabel();
       toggleRepeatButton.addEventListener('click', () => {
           config.setAllowRepeatSelection(!config.allowRepeatSelection);
           updateRepeatButtonLabel();
       });
   }
    if (reversePathButton) {
        updateReverseButtonLabel();
        reversePathButton.addEventListener('click', () => {
            if (config.viewStack.length <= 1) {
                alert(reversePathNotAllowedMessage);
                return;
            }
            reverseCurrentPath();
        });
    }

    const handleContigJump = () => {
        if (!contigJumpInputElem) return;
        const targetName = (contigJumpInputElem.value || '').trim();
        if (!targetName) {
            alert(jumpEmptyMessage);
            return;
        }
        jumpToContigByName(targetName, { alertNotFoundMessage: jumpNotFoundMessage });
    };

    if (contigJumpButtonElem) {
        contigJumpButtonElem.addEventListener('click', handleContigJump);
    }
    if (contigJumpInputElem) {
        contigJumpInputElem.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                handleContigJump();
            }
        });
    }

    closeSequenceViewerButton.addEventListener('click', () => {
        document.getElementById('sequence-viewer').style.display = 'none';
    });
});

async function initialize(mafFile, fastaFile, telomereMotif, telomereMinLength) {
    config.setFastaFile(fastaFile);
    
    const loadingMessage = isJapaneseLocale ? 'FASTA解析中...' : 'Processing FASTA file...';
    showLoadingOverlay(loadingMessage);
    let faiMap;
    try {
        const totalBytes = typeof fastaFile.size === 'number' ? fastaFile.size : null;
        let lastPercent = -1;
        let lastUpdateTs = 0;
        const onProgress = (processedBytes, total) => {
            const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
            const totalForProgress = typeof total === 'number' && total > 0
                ? total
                : (typeof totalBytes === 'number' && totalBytes > 0 ? totalBytes : null);
            let fraction = null;
            let percent = null;
            if (totalForProgress) {
                fraction = Math.min(processedBytes / totalForProgress, 1);
                percent = Math.floor(fraction * 100);
            }
            const shouldUpdate = processedBytes === total || percent === 100 || percent !== lastPercent || (now - lastUpdateTs) > 200;
            if (!shouldUpdate) return;
            lastUpdateTs = now;
            if (percent !== null) {
                lastPercent = percent;
                const text = `${percent}% (${formatBytes(processedBytes)} / ${formatBytes(totalForProgress)})`;
                updateLoadingOverlayProgress(fraction, text);
            } else {
                const text = `${formatBytes(processedBytes)} processed`;
                updateLoadingOverlayProgress(null, text);
            }
        };

        faiMap = await utils.buildFaiFromFasta(fastaFile, {
            telomereMotif,
            telomereMinLength,
            onProgress
        });
        updateLoadingOverlayProgress(1, isJapaneseLocale ? '解析完了' : 'Completed');
    } finally {
        hideLoadingOverlay();
    }

    config.setFaiMap(faiMap);

    const contigs = {};
    for (const [name, info] of faiMap.entries()) {
        contigs[name] = {
            length: info.length,
            gaps: info.gaps ? info.gaps.slice() : [],
            telomeres: info.telomeres ? info.telomeres.slice() : []
        };
    }
    const contigData = { contigs };
    
    config.setAllContigInfo(contigData);
    config.setAllData(await utils.parseMafStream(mafFile, config.allContigInfo.contigs));
    
    const tempContigs = Object.entries(config.allContigInfo.contigs).map(([name, info]) => ({
        name,
        ...info,
        gaps: info.gaps ? info.gaps.slice() : [],
        telomeres: info.telomeres ? info.telomeres.map(t => ({ ...t })) : [],
        hasTelomere: info.telomeres && info.telomeres.length > 0
    }));
    const contigMap = new Map(tempContigs.map(c => [c.name, c]));
    config.setFullContigArray(Array.from(contigMap.values()));
    populateContigJumpOptions();
    
    config.clearViewStack();
    await renderView();
}

export async function renderView() {
    const currentView = config.viewStack[config.viewStack.length - 1];
    const reversePathButton = document.getElementById('reverse-path-button');
    if (reversePathButton) {
        reversePathButton.style.display = config.viewStack.length > 1 ? 'inline-block' : 'none';
    }
    if (currentView === 'global') {
        await renderGlobalPlot();
    } else {
        await renderDetailPlot(currentView.contigName);
    }
    updateSequenceDisplay();
    updatePathHistoryDropdown();
}

export function updateSequenceDisplay() {
    const pathNumSpan = document.getElementById('path-number');
    const display = document.getElementById('sequence-display');
    pathNumSpan.textContent = `Path (${config.pathHistory.length + 1})`;
    
    if (config.viewStack.length <= 1) {
        display.innerHTML = 'Global';
        return;
    }
    const path = config.viewStack.slice(1).map((item, index) => {
        if (index === config.viewStack.length - 2) { // This is the current Y-axis contig
            const contigName = item.contigName;
            if (config.yAxisReversed) {
                return `<strong><span style="color:red;">${contigName}(-)</span></strong>`;
            }
 else {
                return `<strong>${contigName}</strong>`;
            }
        }
        return item.contigName;
    }).join(' &rarr; ');
    display.innerHTML = path;
}

function updatePathHistoryDropdown() {
    const dropdown = document.getElementById('path-history-dropdown');
    dropdown.innerHTML = '<option value="">Select a path to resume</option>'; // Clear existing options and add a placeholder

    config.pathHistory.forEach((path, index) => {
        const option = document.createElement('option');
        option.value = index;
        const pathString = path.map(p => p.contigName).join(' -> ');
        option.textContent = `Path ${index + 1}: ${pathString}`;
        dropdown.appendChild(option);
    });

    const hasHistory = config.pathHistory.length > 0;
    const pathControls = document.getElementById('path-controls');
    if (pathControls) {
        pathControls.style.display = 'block';
    }
    const resumeButton = document.getElementById('resume-path-button');
    if (resumeButton) {
        resumeButton.disabled = !hasHistory;
    }
}

function populateContigJumpOptions() {
    if (!contigJumpDatalistElem) return;
    contigJumpDatalistElem.innerHTML = '';
    if (!config.fullContigArray) return;
    const seen = new Set();
    for (const contig of config.fullContigArray) {
        if (seen.has(contig.name)) continue;
        seen.add(contig.name);
        const option = document.createElement('option');
        option.value = contig.name;
        contigJumpDatalistElem.appendChild(option);
    }
}

function jumpToContigByName(contigName, { alertNotFoundMessage } = {}) {
    if (!contigName) return;
    const contig = config.fullContigArray?.find(c => c.name === contigName);
    if (!contig) {
        if (alertNotFoundMessage) alert(alertNotFoundMessage);
        return;
    }

    const visitedInPaths = new Set(config.pathHistory.flatMap(p => p.map(item => item.contigName)));
    const currentlyVisited = new Set(config.viewStack.slice(1).map(item => item.contigName));
    if (!config.allowRepeatSelection && (visitedInPaths.has(contig.name) || currentlyVisited.has(contig.name))) {
        alert(`Error: Contig ${contig.name} has already been visited.`);
        return;
    }

    let hasLowerTelomere = false;
    const lowerTelomereThreshold = contig.length / 2;
    if (contig.telomeres && contig.telomeres.length > 0) {
        for (const telomere of contig.telomeres) {
            if (telomere.start < lowerTelomereThreshold) {
                hasLowerTelomere = true;
                break;
            }
        }
    }
    config.setYAxisReversed(!hasLowerTelomere);

    const dummyAlignment = {
        source: { name: contig.name, start: 0, end: 1, isReversed: false },
        target: { name: contig.name, start: 0, end: 1, strand: '+' }
    };

    config.clearViewStack();
    config.pushToViewStack({
        contigName: contig.name,
        entryAlignment: dummyAlignment,
        isReversed: config.yAxisReversed
    });
    renderView();
}

function invertEntryAlignment(alignment) {
    if (!alignment) return null;
    const newSourceIsReversed = alignment.target?.strand === '-' ? true : false;
    const newTargetStrand = alignment.source?.isReversed ? '-' : '+';
    return {
        source: {
            name: alignment.target?.name ?? '',
            start: alignment.target?.start ?? 0,
            end: alignment.target?.end ?? 0,
            isReversed: newSourceIsReversed
        },
        target: {
            name: alignment.source?.name ?? '',
            start: alignment.source?.start ?? 0,
            end: alignment.source?.end ?? 0,
            strand: newTargetStrand
        }
    };
}

function reverseCurrentPath() {
    if (config.viewStack.length <= 1) return;
    const currentPath = config.viewStack.slice(1);
    const reversedPath = [];
    for (let newIdx = 0; newIdx < currentPath.length; newIdx++) {
        const originalIdx = currentPath.length - 1 - newIdx;
        const originalStep = currentPath[originalIdx];
        const newIsReversed = !originalStep.isReversed;
        let newEntryAlignment = null;
        if (newIdx === 0) {
            const contigInfo = config.allContigInfo?.contigs?.[originalStep.contigName];
            const contigLength = contigInfo?.length ?? 0;
            newEntryAlignment = {
                source: {
                    name: originalStep.contigName,
                    start: 0,
                    end: contigLength,
                    isReversed: newIsReversed
                },
                target: {
                    name: originalStep.contigName,
                    start: 0,
                    end: contigLength,
                    strand: newIsReversed ? '-' : '+'
                }
            };
        } else {
            const nextOriginalIdx = originalIdx + 1;
            const alignmentToInvert = currentPath[nextOriginalIdx]?.entryAlignment;
            newEntryAlignment = invertEntryAlignment(alignmentToInvert);
        }
        reversedPath.push({
            contigName: originalStep.contigName,
            entryAlignment: newEntryAlignment,
            isReversed: newIsReversed
        });
    }

    config.clearViewStack();
    reversedPath.forEach(view => config.pushToViewStack(view));
    const lastView = reversedPath[reversedPath.length - 1];
    if (lastView) {
        config.setYAxisReversed(lastView.isReversed);
    }
    renderView();
}

function showLoadingOverlay(message) {
    if (!loadingOverlayElem) return;
    loadingOverlayElem.style.display = 'flex';
    if (loadingMessageElem) loadingMessageElem.textContent = message;
    if (loadingProgressBarElem) loadingProgressBarElem.style.width = '0%';
    if (loadingProgressTextElem) loadingProgressTextElem.textContent = '0%';
}

function updateLoadingOverlayProgress(fraction, label) {
    if (!loadingOverlayElem) return;
    if (typeof fraction === 'number' && isFinite(fraction)) {
        const percent = Math.min(100, Math.max(0, Math.round(fraction * 100)));
        if (loadingProgressBarElem) loadingProgressBarElem.style.width = `${percent}%`;
        if (loadingProgressTextElem) loadingProgressTextElem.textContent = label ?? `${percent}%`;
    } else {
        if (loadingProgressBarElem) loadingProgressBarElem.style.width = '100%';
        if (loadingProgressTextElem) loadingProgressTextElem.textContent = label ?? '';
    }
}

function hideLoadingOverlay() {
    if (!loadingOverlayElem) return;
    loadingOverlayElem.style.display = 'none';
}

function formatBytes(bytes) {
    if (typeof bytes !== 'number' || !isFinite(bytes) || bytes <= 0) return '—';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let value = bytes;
    let unitIndex = 0;
    while (value >= 1024 && unitIndex < units.length - 1) {
        value /= 1024;
        unitIndex++;
    }
    if (unitIndex === 0) return `${Math.round(value)} ${units[unitIndex]}`;
    return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[unitIndex]}`;
}


// --- Event Handlers ---

document.getElementById('back-button').addEventListener('click', () => {
    if (config.viewStack.length > 1) {
        config.popFromViewStack();
        const currentView = config.viewStack[config.viewStack.length - 1];

        // If the view we are returning to is a detail view, restore its saved Y-axis orientation.
        if (typeof currentView === 'object' && currentView.hasOwnProperty('isReversed')) {
            config.setYAxisReversed(currentView.isReversed);
        }
        // For the global view, we preserve the last used orientation.
        renderView();
    }
});

document.getElementById('back-to-global-button').addEventListener('click', () => {
    if (config.viewStack.length > 1) {
        // Exclude the 'global' view from the path history
        config.pushToPathHistory(config.viewStack.slice(1));
    }
    config.clearViewStack();
    renderView();
});

document.getElementById('resume-path-button').addEventListener('click', () => {
    const dropdown = document.getElementById('path-history-dropdown');
    const selectedIndex = dropdown.value;

    if (selectedIndex === "") {
        alert("Please select a path from the dropdown to resume.");
        return;
    }

    const pathIndex = parseInt(selectedIndex, 10);
    
    // 1. Get the path to resume from the current history
    const pathToResume = config.pathHistory[pathIndex];

    // 2. Save the current working path (if it exists)
    const currentPath = config.viewStack.length > 1 ? config.viewStack.slice(1) : null;

    // 3. Remove the selected path from history
    config.removePathFromHistory(pathIndex);

    // 4. Add the (previously) current path to history if it was valid
    if (currentPath) {
        config.pushToPathHistory(currentPath);
    }
    
    // 5. Set the new view stack from the resumed path
    config.clearViewStack();
    pathToResume.forEach(view => config.pushToViewStack(view));
    
    const lastView = pathToResume[pathToResume.length - 1];
    if (lastView && typeof lastView === 'object' && lastView.hasOwnProperty('isReversed')) {
        config.setYAxisReversed(lastView.isReversed);
    }

    // Render the resumed view
    renderView();
});

document.querySelectorAll('.export-paths-btn').forEach(button => {
    button.addEventListener('click', () => {
        const allPathsToExport = [...config.pathHistory];
        if (config.viewStack.length > 1) {
            allPathsToExport.push(config.viewStack.slice(1));
        }

        if (allPathsToExport.length === 0) {
            alert("No paths to export.");
            return;
        }

        let outputText = "";
        allPathsToExport.forEach((path, index) => {
            outputText += `Path ${index + 1}:
`;
            path.forEach((step, stepIndex) => {
                outputText += `  -> ${step.contigName}`;
                if (step.entryAlignment) {
                    const { source, target } = step.entryAlignment;
                    let outputContigDirection = '';
                    step.isReversed ? outputContigDirection = '-' : outputContigDirection = '+';
                    
                    let sourcePart = '';
                    if (stepIndex > 0) {
                        sourcePart = `${source.name} [${source.start.toLocaleString()}-${source.end.toLocaleString()}] => `;
                    } else {
                        sourcePart = `=> `;
                    }

                    outputText += ` ( ${sourcePart}${target.name} [${target.start.toLocaleString()}-${target.end.toLocaleString()}] Contig:${outputContigDirection} Alignment:${target.strand})
`;
                } else {
                    outputText += "\n";
                }
            });
            outputText += "\n";
        });

        const blob = new Blob([outputText], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'exported_paths.txt';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    });
});

// --- Import Paths (from exported text) ---
function parseNumber(numStr) {
    if (!numStr) return null;
    return parseInt(String(numStr).replace(/,/g, ''), 10);
}

function parseExportedPaths(text) {
    const lines = text.split(/\r?\n/);
    const paths = [];
    let current = null;

    for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) continue;

        const pathHeader = line.match(/^Path\s+\d+\s*:/i);
        if (pathHeader) {
            if (current && current.length) paths.push(current);
            current = [];
            continue;
        }

        if (line.startsWith('->') || line.startsWith('➡') || line.startsWith('⇒')) {
            // Normalize to `->` format just in case
            const afterArrow = line.replace(/^[-➡⇒>\s]+/, '');

            // Split off optional parentheses block
            const m = afterArrow.match(/^([^()]+?)(?:\s*\((.*)\))?$/);
            if (!m) continue;
            const contigName = m[1].trim();
            const meta = (m[2] || '').trim();

            let isReversed = false;
            let entryAlignment = null;

            if (meta) {
                // Extract Contig orientation and Alignment strand
                const dirMatch = meta.match(/Contig\s*:\s*([+-])/i);
                if (dirMatch) isReversed = dirMatch[1] === '-';

                const alnMatch = meta.match(/Alignment\s*:\s*([+-])/i);
                const alnStrand = alnMatch ? alnMatch[1] : '+';

                // Extract bracketed ranges (source then target)
                const rangeMatches = [...meta.matchAll(/\[\s*([0-9,]+)\s*-\s*([0-9,]+)\s*\]/g)];
                let source = null;
                let target = null;
                let srcName = null;
                let tgtName = null;

                if (rangeMatches.length >= 1) {
                    // Target = last pair, name = token before last pair
                    const last = rangeMatches[rangeMatches.length - 1];
                    target = { start: parseNumber(last[1]), end: parseNumber(last[2]), strand: alnStrand };
                    const beforeLast = meta.slice(0, last.index).trim();
                    // target name should be the last token there (excluding the arrow)
                    const tokens = beforeLast.split(/\s+/).filter(t => t !== '=>' && t !== '→' && t !== '⇒');
                    tgtName = tokens[tokens.length - 1] || contigName;
                }

                if (rangeMatches.length >= 2) {
                    const first = rangeMatches[0];
                    source = { start: parseNumber(first[1]), end: parseNumber(first[2]), isReversed: false };
                    const beforeFirst = meta.slice(0, first.index).trim();
                    const srcTokens = beforeFirst.split(/\s+/);
                    srcName = srcTokens[srcTokens.length - 1] || null;
                }

                // Fallbacks
                if (!tgtName) tgtName = contigName;
                if (!source) {
                    // Mirror dummy used from global: source equals target with tiny span
                    source = { name: tgtName, start: 0, end: 1, isReversed: false };
                } else {
                    source.name = srcName || tgtName;
                }
                if (!target) target = { name: tgtName, start: 0, end: 1, strand: '+' };
                else target.name = tgtName;

                entryAlignment = { source, target };
            }

            current?.push({ contigName, entryAlignment, isReversed });
        }
    }
    if (current && current.length) paths.push(current);
    return paths;
}

// Wire import buttons to hidden file input
document.querySelectorAll('.import-paths-btn').forEach(button => {
    button.addEventListener('click', () => {
        document.getElementById('import-paths-input').click();
    });
});

document.getElementById('import-paths-input').addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    try {
        const text = await file.text();
        const imported = parseExportedPaths(text);
        if (!imported.length) {
            alert('No paths found in the selected file.');
            e.target.value = '';
            return;
        }

        // Append imported paths to history
        for (const p of imported) config.pushToPathHistory(p);
        updatePathHistoryDropdown();

        // If exactly one path imported and we are at global, offer to resume now
        if (imported.length === 1 && config.viewStack.length <= 1) {
            const resume = confirm('1 path imported. Resume it now?');
            if (resume) {
                // Move imported path from history into current view stack
                const pathToResume = imported[0];
                // Remove the last added path from history
                config.removePathFromHistory(config.pathHistory.length - 1);
                config.clearViewStack();
                pathToResume.forEach(v => config.pushToViewStack(v));
                const lastView = pathToResume[pathToResume.length - 1];
                if (lastView && typeof lastView === 'object' && lastView.hasOwnProperty('isReversed')) {
                    config.setYAxisReversed(lastView.isReversed);
                }
                renderView();
            }
        } else {
            alert(`${imported.length} paths imported. Use the dropdown to resume.`);
        }
    } catch (err) {
        console.error('Failed to import paths:', err);
        alert(`Failed to import: ${err.message}`);
    } finally {
        // Reset input so the same file can be selected again if needed
        e.target.value = '';
    }
});


document.addEventListener('keydown', async (event) => {
    const activePlotDiv = (config.viewStack.length === 0 || config.viewStack[config.viewStack.length - 1] === 'global') ? config.mainPlotDiv : config.detailPlotDiv;
    const computedLayout = activePlotDiv?._fullLayout || activePlotDiv?.layout;
    if (!computedLayout) return;

    const key = event.key.toLowerCase();

    if (key === 'r') {
        config.toggleXAxisFlipOverride();
        await renderView();
        updateSequenceDisplay();
        return;
    }

    if (key === 'f') {
        const segment = config.hoveredSegment;
        if (!segment) {
            console.log("No alignment segment is currently hovered.");
            return;
        }

        const seqViewer = document.getElementById('sequence-viewer');
        const seqOutput = document.getElementById('sequence-output');
        seqOutput.textContent = 'Fetching sequences...';
        seqViewer.style.display = 'block';

        try {
            const MAX_LEN = 3000;
            const q_len = Math.min(segment.aln_len, MAX_LEN);
            const t_len = Math.min(segment.aln_len, MAX_LEN);

            const q_start = segment.q_start_orig;
            const q_end = segment.q_start_orig + q_len;
            
            const t_start = segment.t_start_orig;
            const t_end = segment.t_start_orig + t_len;

            let [q_seq, t_seq] = await Promise.all([
                utils.fetchSequence(config.fastaFile, config.faiMap, segment.q_name, q_start, q_end),
                utils.fetchSequence(config.fastaFile, config.faiMap, segment.t_name, t_start, t_end)
            ]);

            let q_header;
            if (segment.strand === '-') {
                q_seq = utils.reverseComplement(q_seq);
                q_header = `>X-axis: ${segment.q_name}:${q_start}-${q_end} (strand ${segment.strand}, reverse complemented)`;
            } else {
                q_header = `>X-axis: ${segment.q_name}:${q_start}-${q_end} (strand ${segment.strand})`;
            }
            
            const t_header = `>Y-axis: ${segment.t_name}:${t_start}-${t_end}`;
            
            seqOutput.textContent = `${q_header}\n${q_seq}\n\n${t_header}\n${t_seq}`;

        } catch (error) {
            console.error("Failed to fetch sequence:", error);
            seqOutput.textContent = `Error: ${error.message}`;
        }
        return;
    }

    const actions = ['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'w', 's'];
    if (actions.includes(key)) {
        event.preventDefault();
        config.tooltip.style.display = 'none';

        const currentXRange = computedLayout.xaxis.range;
        const currentYRange = computedLayout.yaxis.range;
        let newXRange = [...currentXRange];
        let newYRange = [...currentYRange];

        switch (key) {
            case 'arrowup': {
                const yStep = (currentYRange[1] - currentYRange[0]) * 0.05;
                newYRange = [currentYRange[0] + yStep, currentYRange[1] + yStep];
                break;
            }
            case 'arrowdown': {
                const yStep = (currentYRange[1] - currentYRange[0]) * 0.05;
                newYRange = [currentYRange[0] - yStep, currentYRange[1] - yStep];
                break;
            }
            case 'arrowleft': {
                const xStep = (currentXRange[1] - currentXRange[0]) * 0.05;
                newXRange = [currentXRange[0] - xStep, currentXRange[1] - xStep];
                break;
            }
            case 'arrowright': {
                const xStep = (currentXRange[1] - currentXRange[0]) * 0.05;
                newXRange = [currentXRange[0] + xStep, currentXRange[1] + xStep];
                break;
            }
            case 'w': { // Zoom in
                const zoomFactor = 0.9;
                const xCenter = (currentXRange[0] + currentXRange[1]) / 2;
                const yCenter = (currentYRange[0] + currentYRange[1]) / 2;
                const newXSpan = (currentXRange[1] - currentXRange[0]) * zoomFactor;
                const newYSpan = (currentYRange[1] - currentYRange[0]) * zoomFactor;
                newXRange = [xCenter - newXSpan / 2, xCenter + newXSpan / 2];
                newYRange = [yCenter - newYSpan / 2, yCenter + newYSpan / 2];
                break;
            }
            case 's': { // Zoom out
                const zoomFactor = 1.1;
                const xCenter = (currentXRange[0] + currentXRange[1]) / 2;
                const yCenter = (currentYRange[0] + currentYRange[1]) / 2;
                const newXSpan = (currentXRange[1] - currentXRange[0]) * zoomFactor;
                const newYSpan = (currentYRange[1] - currentYRange[0]) * zoomFactor;
                newXRange = [xCenter - newXSpan / 2, xCenter + newXSpan / 2];
                newYRange = [yCenter - newYSpan / 2, yCenter + newYSpan / 2];
                break;
            }
        }

        Plotly.relayout(activePlotDiv, {
            'xaxis.range': newXRange,
            'yaxis.range': newYRange
        });
    }
});
