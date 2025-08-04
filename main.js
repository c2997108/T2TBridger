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
    const bedFileInput = document.getElementById('bed-file');

    loadButton.addEventListener('click', () => {
        const mafFile = mafFileInput.files[0];
        const fastaFile = fastaFileInput.files[0];
        const bedFile = bedFileInput.files[0];

        if (!mafFile || !fastaFile || !bedFile) {
            alert('Please select all three input files.');
            return;
        }

        document.getElementById('file-selection-container').style.display = 'none';
        document.getElementById('main-content').style.display = 'block';

        initialize(mafFile, fastaFile, bedFile).catch(console.error);
    });
});

async function initialize(mafFile, fastaFile, bedFile) {
    const [contigData, telomereBedText] = await Promise.all([
        utils.parseFastaForContigInfo(fastaFile),
        bedFile.text()
    ]);
    
    config.setAllContigInfo(contigData);
    config.setAllData(await utils.parseMafStream(mafFile, config.allContigInfo.contigs));
    
    const tempContigs = Object.entries(config.allContigInfo.contigs).map(([name, info]) => ({ name, ...info, hasTelomere: false, telomeres: [] }));
    const contigMap = new Map(tempContigs.map(c => [c.name, c]));

    telomereBedText.split('\n').forEach(line => {
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
        config.pushToPathHistory([...config.viewStack]);
    }
    config.clearViewStack();
    renderView();
});

document.querySelectorAll('.export-paths-btn').forEach(button => {
    button.addEventListener('click', () => {
        const allPathsToExport = [...config.pathHistory];
        if (config.viewStack.length > 1) {
            allPathsToExport.push([...config.viewStack]);
        }

        if (allPathsToExport.length === 0) {
            alert("No paths to export.");
            return;
        }

        let outputText = "";
        allPathsToExport.forEach((path, index) => {
            outputText += `Path ${index + 1}:\n`;
            path.slice(1).forEach((step, stepIndex) => {
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

                    outputText += ` ( ${sourcePart}${target.name} [${target.start.toLocaleString()}-${target.end.toLocaleString()}] Contig:${outputContigDirection} Alignment:${target.strand})\n`;
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


document.addEventListener('keydown', (event) => {
    const activePlotDiv = (config.viewStack.length === 0 || config.viewStack[config.viewStack.length - 1] === 'global') ? config.mainPlotDiv : config.detailPlotDiv;
    if (!activePlotDiv.layout) return;

    const key = event.key.toLowerCase();

    if (key === 'r') {
        config.setYAxisReversed(!config.yAxisReversed);
        
        if (activePlotDiv === config.detailPlotDiv) {
            renderView(); 
        } else {
            const currentYRange = activePlotDiv.layout.yaxis.range;
            const newYRange = [currentYRange[1], currentYRange[0]];
            Plotly.relayout(activePlotDiv, { 'yaxis.range': newYRange });
        }
        
        updateSequenceDisplay();
        return;
    }

    const actions = ['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'w', 's'];
    if (actions.includes(key)) {
        event.preventDefault();
        config.tooltip.style.display = 'none';

        const currentXRange = activePlotDiv.layout.xaxis.range;
        const currentYRange = activePlotDiv.layout.yaxis.range;
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
