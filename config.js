// --- DOM Elements ---
export const mainPlotDiv = document.getElementById('main-plot');
export const detailPlotDiv = document.getElementById('detail-plot');
export const tooltip = document.getElementById('tooltip');

// --- Constants ---
export const TELOMERE_DEBUG_X_POS = -1000;
export const TELOMERE_DEBUG_Y_POS = -1000;
export const GAP_DEBUG_X_POS = TELOMERE_DEBUG_X_POS - 500;
export const GAP_DEBUG_Y_POS = TELOMERE_DEBUG_Y_POS - 500;

// --- Application State ---
export let allData = null;
export let allContigInfo = null;
export let fullContigArray = null;
export let viewStack = [];
export let pathHistory = [];
export let yAxisReversed = false;
export let xAxisFlipOverride = false;
export let fastaFile = null;
export let faiMap = null;
export let hoveredSegment = null;
export let lastMousePosition = { x: 0, y: 0 };
export let allowRepeatSelection = false;

// --- State Modifiers ---
export function setAllData(data) { allData = data; }
export function setAllContigInfo(info) { allContigInfo = info; }
export function setFullContigArray(arr) { fullContigArray = arr; }
export function setYAxisReversed(value) { yAxisReversed = value; }
export function setXAxisFlipOverride(value) { xAxisFlipOverride = value; }
export function toggleXAxisFlipOverride() { xAxisFlipOverride = !xAxisFlipOverride; }
export function isXAxisReversed() { return !!(yAxisReversed ^ xAxisFlipOverride); }
export function pushToViewStack(item) { viewStack.push(item); }
export function popFromViewStack() { return viewStack.pop(); }
export function clearViewStack() { viewStack = ['global']; }
export function pushToPathHistory(path) { pathHistory.push(path); }
export function clearPathHistory() { pathHistory = []; }
export function removePathFromHistory(index) { pathHistory.splice(index, 1); }
export function setFastaFile(file) { fastaFile = file; }
export function setFaiMap(map) { faiMap = map; }
export function setHoveredSegment(segment) { hoveredSegment = segment; }
export function setMousePosition(x, y) { lastMousePosition = { x, y }; }
export function setAllowRepeatSelection(value) { allowRepeatSelection = value; }
