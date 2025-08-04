// --- DOM Elements ---
export const mainPlotDiv = document.getElementById('main-plot');
export const detailPlotDiv = document.getElementById('detail-plot');
export const tooltip = document.getElementById('tooltip');

// --- Constants ---
export const TELOMERE_DEBUG_X_POS = -1000;
export const TELOMERE_DEBUG_Y_POS = -1000;

// --- Application State ---
export let allData = null;
export let allContigInfo = null;
export let fullContigArray = null;
export let viewStack = [];
export let pathHistory = [];
export let yAxisReversed = false;

// --- State Modifiers ---
export function setAllData(data) { allData = data; }
export function setAllContigInfo(info) { allContigInfo = info; }
export function setFullContigArray(arr) { fullContigArray = arr; }
export function setYAxisReversed(value) { yAxisReversed = value; }
export function pushToViewStack(item) { viewStack.push(item); }
export function popFromViewStack() { return viewStack.pop(); }
export function clearViewStack() { viewStack = ['global']; }
export function pushToPathHistory(path) { pathHistory.push(path); }
export function clearPathHistory() { pathHistory = []; }
