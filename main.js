import * as config from './config.js';
import * as utils from './utils.js';
import { renderGlobalPlot, renderDetailPlot, setRenderViewCallback } from './plot.js';

// --- Main Application Logic ---

document.addEventListener('DOMContentLoaded', function() {
    // Set the callback in plot.js to avoid circular dependency
    setRenderViewCallback(renderView);

    const loadButton = document.getElementById('load-data-button');
    const mafFileInput = document.getElementById('maf-file');
    const fastaFileInput = document.getElementById('fasta-file');
    const faiFileInput = document.getElementById('fai-file');
    const bedFileInput = document.getElementById('bed-file');
    const closeSequenceViewerButton = document.getElementById('close-sequence-viewer');
    const toggleHelpButton = document.getElementById('toggle-help-button');
    const helpBox = document.getElementById('keyboard-help');

    // i18n: Decide language (Japanese if any locale starts with "ja")
    const isJa = (() => {
        const langs = navigator.languages || [navigator.language || ''];
        return langs.some(l => (l || '').toLowerCase().startsWith('ja'));
    })();

    // Build localized help content
    const helpTexts = isJa ? {
        helpLabel: 'ヘルプ',
        title: 'キーボード操作',
        note: '注: プロット領域をアクティブにした状態（クリック後）で有効です。',
        items: [
            ['r', 'Y軸の向きを反転（現在のビューに適用）'],
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
            ['r', 'Reverse Y-axis orientation (applies to current view)'],
            ['f', 'Show sequences for hovered alignment segment (up to 3,000 bp; X & Y)'],
            ['↑ / ↓', 'Pan vertically by 5%'],
            ['← / →', 'Pan horizontally by 5%'],
            ['w', 'Zoom in'],
            ['s', 'Zoom out']
        ]
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
        const faiFile = faiFileInput.files[0];
        const bedFile = bedFileInput.files[0];

        if (!mafFile || !fastaFile || !faiFile || !bedFile) {
            alert('Please select all four input files.');
            return;
        }

        document.getElementById('file-selection-container').style.display = 'none';
        document.getElementById('main-content').style.display = 'block';

        initialize(mafFile, fastaFile, faiFile, bedFile).catch(console.error);
    });

    closeSequenceViewerButton.addEventListener('click', () => {
        document.getElementById('sequence-viewer').style.display = 'none';
    });
});

async function initialize(mafFile, fastaFile, faiFile, bedFile) {
    config.setFastaFile(fastaFile);
    
    const [faiText, bedFileText] = await Promise.all([
        faiFile.text(),
        bedFile.text()
    ]);

    const faiMap = utils.parseFai(faiText);
    config.setFaiMap(faiMap);

    const contigs = {};
    for (const [name, info] of faiMap.entries()) {
        contigs[name] = { length: info.length };
    }
    const contigData = { contigs };
    
    config.setAllContigInfo(contigData);
    config.setAllData(await utils.parseMafStream(mafFile, config.allContigInfo.contigs));
    
    const tempContigs = Object.entries(config.allContigInfo.contigs).map(([name, info]) => ({ name, ...info, hasTelomere: false, telomeres: [] }));
    const contigMap = new Map(tempContigs.map(c => [c.name, c]));

    bedFileText.split('\n').forEach(line => {
        const parts = line.split('\t');
        if (parts.length >= 6 && (+parts[2] - +parts[1]) >= 100) {
            const contig = contigMap.get(parts[0]);
            if (contig) {
                contig.hasTelomere = true;
                contig.telomeres.push({ start: +parts[1], end: +parts[2], strand: parts[5] });
            }
        }
    });
    config.setFullContigArray(Array.from(contigMap.values()));
    
    config.clearViewStack();
    await renderView();
}

export async function renderView() {
    const currentView = config.viewStack[config.viewStack.length - 1];
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
    document.getElementById('path-controls').style.display = hasHistory ? 'block' : 'none';
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


document.addEventListener('keydown', async (event) => {
    const activePlotDiv = (config.viewStack.length === 0 || config.viewStack[config.viewStack.length - 1] === 'global') ? config.mainPlotDiv : config.detailPlotDiv;
    const computedLayout = activePlotDiv?._fullLayout || activePlotDiv?.layout;
    if (!computedLayout) return;

    const key = event.key.toLowerCase();

    if (key === 'r') {
        config.setYAxisReversed(!config.yAxisReversed);
        
        if (activePlotDiv === config.detailPlotDiv) {
            renderView(); 
        } else {
            const currentYRange = computedLayout.yaxis.range;
            const newYRange = [currentYRange[1], currentYRange[0]];
            Plotly.relayout(activePlotDiv, { 'yaxis.range': newYRange });
        }
        
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
