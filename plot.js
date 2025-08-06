import * as config from './config.js';
import { findContigByLocalPos, distToSegmentSquared } from './utils.js';

// This variable will be set by main.js to avoid circular dependencies.
let renderViewCallback;
export function setRenderViewCallback(callback) {
    renderViewCallback = callback;
}

// --- Plotting Utilities ---

function prepareLineTraces(data, isDetail = false) {
    const traces = { fwd: {x:[],y:[], customdata:[]}, rev: {x:[],y:[], customdata:[]} };
    for (const d of data) {
        const t = d.direction === 'forward' ? traces.fwd : traces.rev;
        t.x.push(+d.x_start, +d.x_end, null);
        t.y.push(+d.y_start, +d.y_end, null);
        t.customdata.push(d, d, null);
    }

    const markerStyle = isDetail
        ? { size: 6, opacity: 1 } // Visible and larger markers for detail plot
        : { size: 8, opacity: 0 }; // Invisible markers for global plot hover

    return [
        { ...traces.fwd, mode: 'lines+markers', type: 'scattergl', name: 'Forward', line: { color: 'blue', width: 1.5 }, marker: markerStyle },
        { ...traces.rev, mode: 'lines+markers', type: 'scattergl', name: 'Reverse', line: { color: 'red', width: 1.5 }, marker: markerStyle }
    ].map(t => ({...t, hoverinfo: 'none'}));
}

function createTelomereDebugTracesForY(yContigsInView) {
    const plusTraceData = { x: [], y: [] }, minusTraceData = { x: [], y: [] };
    for (const contig of yContigsInView) {
        if (!contig.telomeres) continue;
        for (const telomere of contig.telomeres) {
            const y_start = telomere.start + contig.newOffset;
            const y_end = telomere.end + contig.newOffset;
            const targetTrace = telomere.strand === '+' ? plusTraceData : minusTraceData;
            targetTrace.x.push(config.TELOMERE_DEBUG_X_POS, config.TELOMERE_DEBUG_X_POS, null);
            targetTrace.y.push(y_start, y_end, null);
        }
    }
    return [
        { x: plusTraceData.x, y: plusTraceData.y, mode: 'lines+markers', type: 'scattergl', name: 'Telomere Y (+)', line: { color: 'green', width: 5 }, marker: { color: 'green', size: 8 }, hoverinfo: 'none' },
        { x: minusTraceData.x, y: minusTraceData.y, mode: 'lines+markers', type: 'scattergl', name: 'Telomere Y (-)', line: { color: 'yellow', width: 5 }, marker: { color: 'yellow', size: 8 }, hoverinfo: 'none' }
    ];
}

function createTelomereDebugTracesForX(xContigsInView) {
    const plusTraceData = { x: [], y: [] }, minusTraceData = { x: [], y: [] };
    for (const contig of xContigsInView) {
        if (!contig.telomeres) continue;
        const effectiveDirectionReversed = contig.isReversed ^ config.yAxisReversed;
        for (const telomere of contig.telomeres) {
            let x_start_local = telomere.start;
            let x_end_local = telomere.end;
            if (effectiveDirectionReversed) {
                x_start_local = contig.length - telomere.end;
                x_end_local = contig.length - telomere.start;
            }
            const x_start = x_start_local + contig.newOffset;
            const x_end = x_end_local + contig.newOffset;
            const targetTrace = telomere.strand === '+' ? plusTraceData : minusTraceData;
            targetTrace.x.push(x_start, x_end, null);
            targetTrace.y.push(config.TELOMERE_DEBUG_Y_POS, config.TELOMERE_DEBUG_Y_POS, null);
        }
    }
    return [
        { x: plusTraceData.x, y: plusTraceData.y, mode: 'lines+markers', type: 'scattergl', name: 'Telomere X (+)', line: { color: 'purple', width: 5 }, marker: { color: 'purple', size: 8 }, hoverinfo: 'none' },
        { x: minusTraceData.x, y: minusTraceData.y, mode: 'lines+markers', type: 'scattergl', name: 'Telomere X (-)', line: { color: 'orange', width: 5 }, marker: { color: 'orange', size: 8 }, hoverinfo: 'none' }
    ];
}

// --- View Renderers ---

export async function renderGlobalPlot() {
    document.getElementById('detail-view-container').style.display = 'none';
    document.getElementById('main-view-container').style.display = 'block';
    document.getElementById('main-title').textContent = 'Telomere-Containing Contigs (Press "r" to reverse Y-axis)';

    const telomereContigsMap = new Map();
    let currentOffset = 0;
    for (const contig of config.fullContigArray) {
        if (contig.hasTelomere) {
            telomereContigsMap.set(contig.name, { ...contig, newOffset: currentOffset });
            currentOffset += contig.length;
        }
    }
    const initialPlotContigArray = Array.from(telomereContigsMap.values());

    const GLOBAL_PLOT_MIN_ALIGN_LENGTH = 100000;
    const filteredData = config.allData
        .filter(d => d.aln_len >= GLOBAL_PLOT_MIN_ALIGN_LENGTH)
        .map(d => {
            const qContigMapInfo = telomereContigsMap.get(d.q_name);
            const tContigMapInfo = telomereContigsMap.get(d.t_name);
            if (qContigMapInfo && tContigMapInfo) {
                return {
                    ...d,
                    x_start: qContigMapInfo.newOffset + d.x_start,
                    x_end: qContigMapInfo.newOffset + d.x_end,
                    y_start: tContigMapInfo.newOffset + d.y_start,
                    y_end: tContigMapInfo.newOffset + d.y_end,
                };
            }
            return null;
        }).filter(Boolean);

    const plotTraces = prepareLineTraces(filteredData);
    plotTraces.push(...createTelomereDebugTracesForY(initialPlotContigArray));
    plotTraces.push(...createTelomereDebugTracesForX(initialPlotContigArray));
    
    const totalLength = currentOffset;
    const allPreviouslyViewed = new Set(config.pathHistory.flatMap(p => p.slice(1).map(item => item.contigName)));
    
    let shapes = initialPlotContigArray.flatMap(c => c.newOffset > 0 ? [
        { type: 'line', x0: c.newOffset, x1: c.newOffset, y0: 0, y1: totalLength, line: { color: 'rgba(0,0,0,0.4)', width: 1, dash: 'dot' } },
        { type: 'line', x0: 0, x1: totalLength, y0: c.newOffset, y1: c.newOffset, line: { color: 'rgba(0,0,0,0.4)', width: 1, dash: 'dot' } }
    ] : []);
    
    for (const contig of initialPlotContigArray) {
        if (allPreviouslyViewed.has(contig.name)) {
            shapes.push({
                type: 'rect', xref: 'x', yref: 'paper',
                x0: contig.newOffset, x1: contig.newOffset + contig.length,
                y0: 0, y1: 1,
                fillcolor: 'grey', opacity: 0.2, layer: 'below', line: { width: 0 }
            });
            shapes.push({
                type: 'rect', xref: 'paper', yref: 'y',
                x0: 0, x1: 1,
                y0: contig.newOffset, y1: contig.newOffset + contig.length,
                fillcolor: 'grey', opacity: 0.2, layer: 'below', line: { width: 0 }
            });
        }
    }

    const annotations = [];
    for (const contig of initialPlotContigArray) {
        const midpoint = contig.newOffset + contig.length / 2;
        annotations.push({
            x: midpoint,
            y: 1,
            xref: 'x',
            yref: 'paper',
            yanchor: 'bottom',
            yshift: 5,
            text: contig.name,
            showarrow: false,
            font: { size: 9 },
            textangle: -45
        });
        annotations.push({
            x: 0,
            y: midpoint,
            xref: 'paper',
            yref: 'y',
            xanchor: 'right',
            xshift: -5,
            text: contig.name,
            showarrow: false,
            font: { size: 9 }
        });
    }

    const yRange = config.yAxisReversed ? [totalLength, -5000] : [-5000, totalLength];
    const layout = {
        xaxis: { title: 'Telomere-Containing Contigs', range: [-5000, totalLength], showticklabels: false },
        yaxis: { 
            title: { text: 'Telomere-Containing Contigs', font: { color: config.yAxisReversed ? 'red' : 'black' } },
            range: yRange, scaleanchor: "x", scaleratio: 1, showticklabels: false
        },
        shapes: shapes,
        annotations: annotations,
        showlegend: true, 
        dragmode: 'pan'
    };
    
    await Plotly.newPlot(config.mainPlotDiv, plotTraces, layout, { responsive: true, scrollZoom: true });
    
    // Replace all old listeners with simple standard JS listeners
    config.mainPlotDiv.onclick = (e) => {
        if (!config.mainPlotDiv._fullLayout) return;

        const yaxis = config.mainPlotDiv._fullLayout.yaxis;
        const plotRect = config.mainPlotDiv.querySelector('.nsewdrag').getBoundingClientRect();
        const mouseY = e.clientY - plotRect.top;

        if (mouseY < 0 || mouseY > plotRect.height) return;

        const yData = yaxis.p2l(mouseY);
        const clickedContig = findContigByLocalPos(yData, initialPlotContigArray);

        if (clickedContig) {
            const allVisitedInPaths = new Set(config.pathHistory.flatMap(p => p.slice(1).map(item => item.contigName)));
            if (allVisitedInPaths.has(clickedContig.name)) {
                alert(`Error: Contig ${clickedContig.name} has already been visited in a completed path.`);
                return;
            }

            let hasLowerTelomere = false;
            const lowerTelomereThreshold = clickedContig.length / 2;
            if (clickedContig.telomeres && clickedContig.telomeres.length > 0) {
                for (const telomere of clickedContig.telomeres) {
                    if (telomere.start < lowerTelomereThreshold) {
                        hasLowerTelomere = true;
                        break;
                    }
                }
            }
            config.setYAxisReversed(!hasLowerTelomere);

            const dummyAlignment = {
                source: { name: clickedContig.name, start: 0, end: 1, isReversed: false },
                target: { name: clickedContig.name, start: 0, end: 1, strand: '+' }
            };

            config.pushToViewStack({
                contigName: clickedContig.name,
                entryAlignment: dummyAlignment,
                isReversed: config.yAxisReversed
            });
            renderViewCallback();
        }
    };

    config.mainPlotDiv.onmousemove = (e) => {
        if (!config.mainPlotDiv._fullLayout) return;

        const xaxis = config.mainPlotDiv._fullLayout.xaxis;
        const yaxis = config.mainPlotDiv._fullLayout.yaxis;
        const plotRect = config.mainPlotDiv.querySelector('.nsewdrag').getBoundingClientRect();

        const mouseX = e.clientX - plotRect.left;
        const mouseY = e.clientY - plotRect.top;

        if (mouseX >= 0 && mouseX <= plotRect.width && mouseY >= 0 && mouseY <= plotRect.height) {
            const xData = xaxis.p2l(mouseX);
            const yData = yaxis.p2l(mouseY);

            const xContig = findContigByLocalPos(xData, initialPlotContigArray);
            const yContig = findContigByLocalPos(yData, initialPlotContigArray);

            if (xContig && yContig) {
                config.tooltip.innerHTML = `X: ${xContig.name}<br>Y: ${yContig.name}`;
                config.tooltip.style.left = `${e.clientX + 15}px`;
                config.tooltip.style.top = `${e.clientY + 15}px`;
                config.tooltip.style.display = 'block';
            } else {
                config.tooltip.style.display = 'none';
            }
        } else {
            config.tooltip.style.display = 'none';
        }
    };

    config.mainPlotDiv.onmouseleave = () => {
        config.tooltip.style.display = 'none';
    };
}

export async function renderDetailPlot(yContigName) {
    document.getElementById('main-view-container').style.display = 'none';
    document.getElementById('detail-view-container').style.display = 'block';
    document.getElementById('detail-title').textContent = `Alignments to ${yContigName} (Press "r" to reverse Y-axis)`;

    const yContig = config.fullContigArray.find(c => c.name === yContigName);
    if (!yContig) { console.error("Contig not found:", yContigName); return; }

    const filteredData = config.allData.filter(d => d.t_name === yContigName);
    const xContigNames = [...new Set(filteredData.map(d => d.q_name))];

    const reversalDecisions = new Map();
    for (const name of xContigNames) {
        const alignmentsForContig = filteredData.filter(d => d.q_name === name);
        const fwd_len = alignmentsForContig.filter(d => d.direction === 'forward').reduce((sum, d) => sum + d.aln_len, 0);
        const rev_len = alignmentsForContig.filter(d => d.direction === 'reverse').reduce((sum, d) => sum + d.aln_len, 0);
        reversalDecisions.set(name, rev_len > fwd_len);
    }

    const detailXContigsMap = new Map();
    let currentXOffset = 0;
    for (const name of xContigNames) {
        const originalContig = config.fullContigArray.find(c => c.name === name);
        detailXContigsMap.set(name, { 
            ...originalContig, 
            newOffset: currentXOffset,
            isReversed: reversalDecisions.get(name) || false
        });
        currentXOffset += originalContig.length;
    }
    const detailXContigArray = Array.from(detailXContigsMap.values());
    const detailYContigArray = [{...yContig, newOffset: 0}];

    const transformedData = filteredData.map(d => {
        const xContigMapInfo = detailXContigsMap.get(d.q_name);
        if (!xContigMapInfo) return null;
        const effectiveDirectionReversed = xContigMapInfo.isReversed ^ config.yAxisReversed;
        let x_start_new, x_end_new;
        if (effectiveDirectionReversed) {
            if(d.direction === 'forward'){
                x_start_new = xContigMapInfo.newOffset + (xContigMapInfo.length - d.x_start);
                x_end_new = xContigMapInfo.newOffset + (xContigMapInfo.length - d.x_end);
            }else{
                x_start_new = xContigMapInfo.newOffset + (xContigMapInfo.length - d.x_end);
                x_end_new = xContigMapInfo.newOffset + (xContigMapInfo.length - d.x_start);
            }
        } else {
            if(d.direction === 'forward'){
                x_start_new = xContigMapInfo.newOffset + d.x_start;
                x_end_new = xContigMapInfo.newOffset + d.x_end;
            }else{
                x_start_new = xContigMapInfo.newOffset + d.x_end;
                x_end_new = xContigMapInfo.newOffset + d.x_start;
            }
        }
        return { ...d, x_start: x_start_new, x_end: x_end_new };
    }).filter(Boolean);

    const detailPlotTraces = prepareLineTraces(transformedData, true);
    detailPlotTraces.push(...createTelomereDebugTracesForY(detailYContigArray));
    detailPlotTraces.push(...createTelomereDebugTracesForX(detailXContigArray));
    
    detailPlotTraces.push({
        x: [], y: [], mode: 'lines', type: 'scattergl', name: 'Highlight',
        line: { color: 'gold', width: 5 },
        hoverinfo: 'none'
    });
    const highlightTraceIndex = detailPlotTraces.length - 1;

    let detailShapes = [];
    let detailAnnotations = []; 
    for (const contig of detailXContigArray) {
        if (contig.newOffset > 0) detailShapes.push({ type: 'line', x0: contig.newOffset, x1: contig.newOffset, y0: 0, y1: yContig.length, line: { color: 'rgba(0,0,0,0.4)', width: 1, dash: 'dot' } });
        const effectiveDirectionReversed = contig.isReversed ^ config.yAxisReversed;
        const color = effectiveDirectionReversed ? 'red' : 'black';
        const text = contig.name + (effectiveDirectionReversed ? '(-)' : '');
        detailAnnotations.push({
            x: contig.newOffset + contig.length / 2,
            y: 0, yref: 'paper', yanchor: 'top', yshift: -10,
            text: text, font: { color: color }, showarrow: false,
            xanchor: 'right', textangle: -90
        });
    }
    
    const allVisitedContigs = new Set(config.pathHistory.flatMap(p => p.slice(1).map(item => item.contigName)));
    config.viewStack.slice(1).forEach(item => allVisitedContigs.add(item.contigName));

    for (const contig of detailXContigArray) {
        if (allVisitedContigs.has(contig.name)) {
            detailShapes.push({
                type: 'rect', xref: 'x', yref: 'paper',
                x0: contig.newOffset, x1: contig.newOffset + contig.length,
                y0: 0, y1: 1, fillcolor: 'grey', opacity: 0.2,
                layer: 'below', line: { width: 0 }
            });
        }
    }

    detailAnnotations.push({
        x: currentXOffset / 2, y: 0.01, yref: 'paper',
        text: 'Homologous Contigs', showarrow: false,
        font: { size: 14, color: 'grey' },
        xanchor: 'center', yanchor: 'bottom'
    });

    const yRange = config.yAxisReversed ? [yContig.length, -5000] : [-5000, yContig.length];
    const detailLayout = {
        xaxis: { title: '', range: [-5000, currentXOffset], showticklabels: false },
        yaxis: { 
            title: { text: `Contig: ${yContigName}`, font: { color: config.yAxisReversed ? 'red' : 'black' } },
            range: yRange, scaleanchor: "x", scaleratio: 1 
        },
        shapes: detailShapes, annotations: detailAnnotations,
        showlegend: true, dragmode: 'pan'
    };

    await Plotly.newPlot(config.detailPlotDiv, detailPlotTraces, detailLayout, { responsive: true, scrollZoom: true });
    
    config.detailPlotDiv.on('plotly_click', (e) => {
        if (!e.points || e.points.length === 0) return;

        const clickedXContig = findContigByLocalPos(e.points[0].x, detailXContigArray);
        if (clickedXContig) {
            const allVisitedInHistory = new Set(config.pathHistory.flatMap(p => p.slice(1).map(item => item.contigName)));
            const allVisitedInCurrentPath = new Set(config.viewStack.slice(1).map(item => item.contigName));
            if (allVisitedInHistory.has(clickedXContig.name) || allVisitedInCurrentPath.has(clickedXContig.name)) {
                alert(`Error: Contig ${clickedXContig.name} has already been visited.`);
                return;
            }

            const cursorPoint = { x: e.points[0].x, y: e.points[0].y };
            let minDistSq = Infinity;
            let closestSegment = null;

            const candidateSegments = [...new Set(e.points.map(p => p.customdata))];
            for (const segment of candidateSegments) {
                if (!segment) continue;
                const p1 = { x: segment.x_start, y: segment.y_start };
                const p2 = { x: segment.x_end, y: segment.y_end };
                const dSq = distToSegmentSquared(cursorPoint, p1, p2);
                if (dSq < minDistSq) {
                    minDistSq = dSq;
                    closestSegment = segment;
                }
            }

            if (closestSegment) {
                if (config.viewStack.length > 1) {
                    const previousView = config.viewStack[config.viewStack.length - 2];
                    if (previousView !== 'global') {
                        const previousAlignmentOnCurrentY = config.viewStack[config.viewStack.length - 1].entryAlignment.target;
                        const newAlignmentStartOnY = closestSegment.t_start_orig;
                        const newAlignmentEndOnY = closestSegment.t_start_orig + closestSegment.aln_len;
                        const currentYIsReversed = config.yAxisReversed;

                        if (!currentYIsReversed) {
                            if (previousAlignmentOnCurrentY.end > newAlignmentEndOnY) {
                                alert("Error: Cannot move backwards along the contig.\nThe end of the previous alignment is further along than the end of the newly selected one.");
                                return;
                            }
                        } else {
                            if (previousAlignmentOnCurrentY.start < newAlignmentStartOnY) {
                                alert("Error: Cannot move backwards along the contig.\nThe start of the previous alignment is further along (in reverse) than the start of the newly selected one.");
                                return;
                            }
                        }
                    }
                }

                const alignmentIsForward = closestSegment.direction === 'forward';
                const nextPlotShouldBeForward = (config.yAxisReversed === !alignmentIsForward);
                config.setYAxisReversed(!nextPlotShouldBeForward);
            }

            config.pushToViewStack({
                contigName: clickedXContig.name,
                entryAlignment: closestSegment ? {
                    source: { name: closestSegment.t_name, start: closestSegment.t_start_orig, end: closestSegment.t_start_orig + closestSegment.aln_len, isReversed: closestSegment.isReversed },
                    target: { name: closestSegment.q_name, start: closestSegment.q_start_orig, end: closestSegment.q_start_orig + closestSegment.aln_len, strand: closestSegment.strand }
                } : null,
                isReversed: config.yAxisReversed
            });
            renderViewCallback();
        }
    });

    let currentlyHighlightedSegment = null;
    config.detailPlotDiv.on('plotly_hover', (e) => {
        if (e.points.length > 0) {
            const cursorPoint = { x: e.points[0].x, y: e.points[0].y };
            let minDistSq = Infinity;
            let closestSegment = null;
            for (const segment of transformedData) {
                const p1 = { x: segment.x_start, y: segment.y_start };
                const p2 = { x: segment.x_end, y: segment.y_end };
                const dSq = distToSegmentSquared(cursorPoint, p1, p2);
                if (dSq < minDistSq) {
                    minDistSq = dSq;
                    closestSegment = segment;
                }
            }

            if (closestSegment && closestSegment !== currentlyHighlightedSegment) {
                Plotly.restyle(config.detailPlotDiv, {
                    x: [[closestSegment.x_start, closestSegment.x_end]],
                    y: [[closestSegment.y_start, closestSegment.y_end]]
                }, [highlightTraceIndex]);
                currentlyHighlightedSegment = closestSegment;

                const xContigInfo = detailXContigsMap.get(closestSegment.q_name);
                const t_end_orig = closestSegment.t_start_orig + closestSegment.aln_len;
                let q_start_display = closestSegment.q_start_orig;
                let q_end_display = closestSegment.q_start_orig + closestSegment.aln_len;
                if (xContigInfo.isReversed) {
                    [q_start_display, q_end_display] = [q_end_display, q_start_display];
                }

                config.tooltip.innerHTML =
                    `<b>${closestSegment.q_name}</b> (${closestSegment.strand}): ${q_start_display.toLocaleString()} - ${q_end_display.toLocaleString()}<br>` +
                    `<b>${closestSegment.t_name}</b>: ${t_end_orig.toLocaleString()} - ${closestSegment.t_start_orig.toLocaleString()}`;
                
                config.tooltip.style.left = `${e.event.clientX + 15}px`;
                config.tooltip.style.top = `${e.event.clientY + 15}px`;
                config.tooltip.style.display = 'block';
            }
        }
    });

    config.detailPlotDiv.on('plotly_unhover', () => {
        Plotly.restyle(config.detailPlotDiv, { x: [[]], y: [[]] }, [highlightTraceIndex]);
        currentlyHighlightedSegment = null;
        config.tooltip.style.display = 'none';
    });
}
