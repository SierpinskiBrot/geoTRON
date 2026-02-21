// curveOpsUI.js
// Populates #curveSelector after LAS load, applies an operator expression from
// #curveOperator to the selected curve when Enter is pressed, and appends a new
// curve named NEW_<oldName> to las.curves (and las.data.rows) so it exports.
//
// Assumptions:
// - You have a parsed `las` object from lasio.js (curves[].data uses numbers or null)
// - Depth curve is present and should not be operated on unless selected
// - curveSelector is a <select id="curveSelector"> element
// - curveOperator is an <input id="curveOperator" type="text"> element
//
// Use:
//   import { bindCurveOpsUI } from "./curveOpsUI.js";
//   const ui = bindCurveOpsUI(las);
//   // later after loading another LAS, call ui.setLas(newLas)

export function bindCurveOpsUI(las, {
  selectorId = "curveSelector",
  operatorId = "curveOperator",
} = {}) {
  const selector = document.getElementById(selectorId);
  if (!selector) throw new Error(`Missing #${selectorId}`);

  const opInput = document.getElementById(operatorId);
  if (!opInput) throw new Error(`Missing #${operatorId}`);

  let _las = las;

  function populate() {
    populateCurveSelector(selector, _las);
  }

  function setLas(newLas) {
    _las = newLas;
    populate();
  }

  populate();

  opInput.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;

    const mnemonic = selector.value;
    if (!mnemonic) return;

    const expr = opInput.value.trim();
    if (!expr) return;

    const parsed = parseOperatorExpr(expr); // throws on invalid
    addDerivedCurve(_las, mnemonic, parsed);

    // refresh dropdown (includes new curve)
    populate();

    // optional: auto-select the new curve
    selector.value = `NEW_${mnemonic}`;

    // clear input
    opInput.value = "";
  });

  return { populate, setLas };
}

export function populateCurveSelector(selectEl, las) {
  // Keep current selection if possible
  const prev = selectEl.value;

  // Clear
  while (selectEl.firstChild) selectEl.removeChild(selectEl.firstChild);

  // Options: show "MNEM (UNIT)" but value is MNEM
  for (const c of las.curves) {
    const mn = c.mnemonic;
    const label = c.unit ? `${mn} (${c.unit})` : mn;

    const opt = document.createElement("option");
    opt.value = mn;
    opt.textContent = label;
    selectEl.appendChild(opt);
  }

  // Restore selection if still exists
  if (prev && las.curves.some(c => c.mnemonic === prev)) {
    selectEl.value = prev;
  }
}

/**
 * Parses strings like:
 *   "+5", "- 2.5", "*10", "/2", "x3", "×3"
 * Returns { op: "+| -| *| /", k: number }
 */
export function parseOperatorExpr(s) {
  const t = s
    .replace(/\s+/g, "")
    .replace(/^x/i, "*")
    .replace("×", "*")
    .replace("÷", "/");

  const m = t.match(/^([+\-*/])([0-9]*\.?[0-9]+(?:e[+\-]?[0-9]+)?)$/i);
  if (!m) throw new Error(`Invalid operator. Use like +5, *10, /2, -3`);

  const op = m[1];
  const k = Number(m[2]);
  if (!Number.isFinite(k)) throw new Error("Invalid number in operator");
  if (op === "/" && k === 0) throw new Error("Division by zero");
  return { op, k };
}

/**
 * Adds NEW_<mnemonic> curve to las.curves and ensures it exports:
 * - Appends to las.curves with copied unit/description
 * - Appends a new column to each row in las.data.rows (creating rows if missing)
 * - Stores nulls where source is null
 */
export function addDerivedCurve(las, sourceMnemonic, { op, k }) {
  const srcIdx = las.curves.findIndex(c => c.mnemonic.toUpperCase() === sourceMnemonic.toUpperCase());
  if (srcIdx === -1) throw new Error(`Curve not found: ${sourceMnemonic}`);

  const src = las.curves[srcIdx];
  const newMnemonic = `NEW_${src.mnemonic}`;

  // If already exists, overwrite in-place (safer UX than duplicating)
  let dstIdx = las.curves.findIndex(c => c.mnemonic.toUpperCase() === newMnemonic.toUpperCase());

  // Compute derived data
  const srcData = src.data || [];
  const dstData = new Array(srcData.length);

  for (let i = 0; i < srcData.length; i++) {
    const v = srcData[i];
    if (v == null || !Number.isFinite(v)) {
      dstData[i] = null;
      continue;
    }
    dstData[i] = applyOp(v, op, k);
  }

  if (dstIdx === -1) {
    // Add curve metadata
    las.curves.push({
      mnemonic: newMnemonic,
      unit: src.unit || "",
      api: src.api || "",
      code: src.coce || "",
      description: src.description || "",
      rawLine: "",
      data: dstData,
    });
    dstIdx = las.curves.length - 1;
  } else {
    // Overwrite existing derived curve
    las.curves[dstIdx].data = dstData;
    las.curves[dstIdx].unit = las.curves[dstIdx].unit || (src.unit || "");
    las.curves[dstIdx].description = `Derived from ${src.mnemonic} by ${op}${k}`;
  }

  // Ensure las.data.rows has the new column so writeLAS(rebuildRowsFromCurves) exports consistently
  ensureRowsFromCurves(las);

  // Put derived column into rows at dstIdx
  const rows = las.data.rows;
  for (let r = 0; r < rows.length; r++) {
    // rows are aligned by index across curves
    rows[r][dstIdx] = (r < dstData.length ? dstData[r] : null);
  }
}

function applyOp(v, op, k) {
  switch (op) {
    case "+": return v + k;
    case "-": return v - k;
    case "*": return v * k;
    case "/": return v / k;
    default: throw new Error(`Unsupported op: ${op}`);
  }
}

/**
 * Ensures las.data.rows exists and matches curve count.
 * Uses curve data arrays as source of truth (keeps nulls).
 */
function ensureRowsFromCurves(las) {
  const curves = las.curves || [];
  const nCurves = curves.length;
  const rowCount = maxLen(curves.map(c => (c.data ? c.data.length : 0)));

  if (!las.data) las.data = { rows: [] };
  const rows = las.data.rows;

  // Resize rows array
  rows.length = rowCount;

  for (let r = 0; r < rowCount; r++) {
    if (!Array.isArray(rows[r])) rows[r] = new Array(nCurves);
    const row = rows[r];

    // Resize row to curve count
    if (row.length !== nCurves) row.length = nCurves;

    // Fill any undefined entries from curves (do not clobber existing non-undefined)
    for (let c = 0; c < nCurves; c++) {
      if (row[c] === undefined) {
        row[c] = curves[c].data?.[r] ?? null;
      }
    }
  }
}

function maxLen(arr) {
  let m = 0;
  for (const x of arr) if (x > m) m = x;
  return m;
}
