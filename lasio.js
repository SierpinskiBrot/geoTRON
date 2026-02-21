// lasio.js
// Minimal LAS (Log ASCII Standard) reader/writer for JS.
//
// Features:
// - Parses LAS 2.0-style sectioned text (~V, ~W, ~C, ~P, ~O, ~A).
// - Stores curves as an array of curve objects with per-row data.
// - Exports back to a LAS string after edits.
// - Handles NULL value, delimiter (SPACE/TAB/COMMA), and ~A numeric tables.
//
// Notes:
// - This is not a full LAS spec implementation. It aims to be practical for most field LAS files.
// - For browser file import/export, see helper functions at bottom.
//
// Usage:
//   import { readLAS, writeLAS, applyCurveEdit, downloadTextFile } from "./lasio.js";
//
//   const las = await readLAS(fileText);
//   // Edit curve values
//   const gr = las.curves.find(c => c.mnemonic === "GR");
//   gr.data = gr.data.map(v => (Number.isFinite(v) ? v * 1.05 : v));
//   // Or use applyCurveEdit(las, "GR", (v, i, row) => v * 1.05);
//
//   const outText = writeLAS(las);
//   downloadTextFile(outText, "edited.las");

export function readLAS(text) {
  const normalized = normalizeNewlines(text);
  const rawLines = normalized.split("\n");

  // Remove UTF-8 BOM if present
  if (rawLines.length && rawLines[0].charCodeAt(0) === 0xfeff) rawLines[0] = rawLines[0].slice(1);

  const las = {
    version: "2.0",
    wrap: "NO",
    delimiter: null, // "SPACE" | "TAB" | "COMMA" | null
    nullValue: null, // number | null
    sections: new Map(), // sectionName -> { name, lines: original lines (kept), items: parsed key/value where applicable }
    well: new Map(),     // mnemonic -> item object
    params: new Map(),   // mnemonic -> item object
    other: [],           // lines from ~O or ~Other
    curves: [],          // [{ mnemonic, unit, api, description, rawLine, data: [] }]
    data: {
      rows: [],          // array of row arrays [v0, v1, ...]
    },
    meta: {
      originalText: text,
      lineEnding: detectLineEnding(text),
    },
  };

  // First pass: split into sections.
  const sections = [];
  let current = null;

  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i];

    const secMatch = line.match(/^\s*~\s*([A-Za-z0-9_]+)\b(.*)$/);
    if (secMatch) {
      const name = secMatch[1].toUpperCase();
      current = { name, headerLine: line, lines: [] };
      sections.push(current);
      continue;
    }

    if (!current) {
      // Pre-section header junk: keep in a synthetic section
      current = { name: "PRE", headerLine: "", lines: [] };
      sections.push(current);
    }
    current.lines.push(line);
  }

  // Store sections and parse key ones.
  for (const s of sections) {
    las.sections.set(s.name, { ...s, items: [] });
  }

  // Parse Version section to detect WRAP, VERS, DLM etc.
  parseKeyValueSection(las, "V", las.sections.get("V") || las.sections.get("VERSION"));
  parseKeyValueSection(las, "W", las.sections.get("W") || las.sections.get("WELL"));
  parseKeyValueSection(las, "P", las.sections.get("P") || las.sections.get("PARAMETER"));
  parseCurveInfoSection(las, las.sections.get("C") || las.sections.get("CURVE"));
  parseOtherSection(las, las.sections.get("O") || las.sections.get("OTHER"));

  // Resolve delimiter / null from parsed metadata.
  las.nullValue = getNullValue(las);
  las.delimiter = getDelimiter(las);

  // Parse data table (~A or ~ASCII or ~DATA)
  const aSec =
    las.sections.get("A") ||
    las.sections.get("ASCII") ||
    las.sections.get("DATA");
  if (aSec) parseAsciiData(las, aSec);

  convertNullSentinelToNull(las);

  // Distribute column data into curves
  distributeDataIntoCurves(las);

  return las;
}

export function writeLAS(las, opts = {}) {
  const lineEnding = opts.lineEnding || las?.meta?.lineEnding || "\n";

  // Build sections. Keep original sections where possible, but update ~C and ~A for sure.
  const out = [];

  // Helper to push with correct EOL
  const pushLine = (s) => out.push(s);

  // VERSION (~V)
  const vSec = las.sections.get("V") || las.sections.get("VERSION");
  if (vSec) {
    pushLine(vSec.headerLine || "~Version");
    const vLines = rebuildKeyValueLines(las, vSec, "V");
    for (const l of vLines) pushLine(l);
  } else {
    pushLine("~Version");
    pushLine(`VERS.  ${las.version ?? "2.0"} : LAS version`);
    pushLine(`WRAP.  ${las.wrap ?? "NO"} : One line per depth step`);
    if (las.delimiter) pushLine(`DLM .  ${las.delimiter} : Delimiter`);
  }

  // WELL (~W)
  const wSec = las.sections.get("W") || las.sections.get("WELL");
  if (wSec) {
    pushLine(wSec.headerLine || "~Well");
    const wLines = rebuildKeyValueLines(las, wSec, "W");
    for (const l of wLines) pushLine(l);
  } else {
    pushLine("~Well");
    if (las.nullValue != null) pushLine(`NULL.  ${las.nullValue} : Null value`);
  }

  // CURVE (~C) — rebuilt from las.curves
  pushLine("~Curve Information");
  pushLine("#MNEM.UNIT         API CODE           : CURVE DESCRIPTION");
  for (const c of las.curves) {
    pushLine(formatCurveLine(c));
  }

  // PARAMETER (~P)
  const pSec = las.sections.get("P") || las.sections.get("PARAMETER");
  if (pSec) {
    pushLine(pSec.headerLine || "~Parameter");
    const pLines = rebuildKeyValueLines(las, pSec, "P");
    for (const l of pLines) pushLine(l);
  }

  // OTHER (~O)
  const oSec = las.sections.get("O") || las.sections.get("OTHER");
  if (oSec || (las.other && las.other.length)) {
    pushLine("~Other");
    const lines = (las.other && las.other.length) ? las.other : (oSec?.lines || []);
    for (const l of lines) pushLine(l);
  }

  // ASCII (~A) — rebuilt from curve data
  pushLine("~ASCII");
  const dlm = opts.delimiter || las.delimiter || "SPACE";
  const delimChar = dlm === "COMMA" ? "," : (dlm === "TAB" ? "\t" : " ");

  const rows = rebuildRowsFromCurves(las);
  const precision = Number.isFinite(opts.precision) ? opts.precision : null;

  for (const row of rows) {
    pushLine(row.map(v => formatNumber(v, las.nullValue, precision)).join(delimChar).trimEnd());
  }

  return out.join(lineEnding) + lineEnding;
}

// --- Editing helpers ---

/**
 * Apply an in-place edit to a curve by mnemonic.
 * fn(value, index, rowArray) -> newValue
 */
export function applyCurveEdit(las, mnemonic, fn) {
  const idx = las.curves.findIndex(c => c.mnemonic.toUpperCase() === mnemonic.toUpperCase());
  if (idx === -1) throw new Error(`Curve not found: ${mnemonic}`);

  // Ensure data rows exist
  const rows = las.data?.rows || [];
  if (!rows.length) {
    // If curves have data arrays, edit those instead.
    const c = las.curves[idx];
    c.data = c.data.map((v, i) => fn(v, i, null));
    return;
  }

  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    row[idx] = fn(row[idx], r, row);
  }

  // Re-distribute back into curve arrays for convenience
  distributeDataIntoCurves(las);
}

// --- Browser import/export helpers ---

/**
 * Read a File object (from <input type="file">) into text.
 */
export function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onerror = () => reject(fr.error);
    fr.onload = () => resolve(String(fr.result ?? ""));
    fr.readAsText(file);
  });
}

/**
 * Trigger a download of a text file in the browser.
 */
export function downloadTextFile(text, filename = "output.las") {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// --- Internal parsing/writing utilities ---

function normalizeNewlines(s) {
  return s.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function detectLineEnding(s) {
  const idx = s.indexOf("\r\n");
  if (idx !== -1) return "\r\n";
  if (s.indexOf("\r") !== -1) return "\r";
  return "\n";
}

function stripComment(line) {
  // LAS comments often start with #. Keep inline colon sections in place.
  const hash = line.indexOf("#");
  if (hash === -1) return line;
  // If line starts with # it's a pure comment.
  if (/^\s*#/.test(line)) return "";
  // Otherwise remove trailing comment.
  return line.slice(0, hash);
}

function parseKeyValueSection(las, shortName, sec) {
  if (!sec) return;

  const items = [];
  for (const raw of sec.lines) {
    const line = stripComment(raw).trimEnd();
    if (!line.trim()) continue;
    // Typical format: MNEM.UNIT  VALUE : DESCRIPTION
    // Example: NULL. -999.25 : Null value
    const m = line.match(/^\s*([^.\s]+)\s*\.\s*([^ \t]*)\s+([^:]*)?(?::\s*(.*))?$/);
    if (!m) continue;

    const mnemonic = m[1].trim();
    const unit = (m[2] ?? "").trim();
    const valueRaw = (m[3] ?? "").trim();
    const desc = (m[4] ?? "").trim();

    const item = { mnemonic, unit, valueRaw, desc, rawLine: raw };
    items.push(item);

    if (shortName === "W") las.well.set(mnemonic.toUpperCase(), item);
    if (shortName === "P") las.params.set(mnemonic.toUpperCase(), item);

    if (shortName === "V") {
      // common: VERS, WRAP, DLM
      const key = mnemonic.toUpperCase();
      if (key === "VERS") las.version = valueRaw || las.version;
      if (key === "WRAP") las.wrap = (valueRaw || las.wrap).toUpperCase();
      if (key === "DLM" || key === "DLM ") las.delimiter = (valueRaw || las.delimiter);
    }
  }
  sec.items = items;
}

function parseCurveInfoSection(las, sec) {
  if (!sec) return;

  const curves = [];
  for (const raw of sec.lines) {
    const line = stripComment(raw).trimEnd();
    if (!line.trim()) continue;

    // Format: MNEM.UNIT   API   : DESCRIPTION
    // API/code part may be blank; tolerate varied spacing.
    const m = line.match(/^\s*([^.\s]+)\s*\.\s*([^ \t]*)\s*(.*?)\s*(?::\s*(.*))?$/);
    if (!m) continue;

    const mnemonic = m[1].trim();
    const unit = (m[2] ?? "").trim();
    const middle = (m[3] ?? "").trim();
    const desc = (m[4] ?? "").trim();

    // Split middle into api & code heuristically (keep as one string if unclear).
    let api = "";
    let code = "";
    if (middle) {
      const parts = middle.split(/\s+/).filter(Boolean);
      if (parts.length === 1) {
        api = parts[0];
      } else if (parts.length >= 2) {
        api = parts[0];
        code = parts.slice(1).join(" ");
      }
    }

    curves.push({
      mnemonic,
      unit,
      api,
      code,
      description: desc,
      rawLine: raw,
      data: [],
    });
  }
  las.curves = curves;
}

function parseOtherSection(las, sec) {
  if (!sec) return;
  las.other = sec.lines.slice();
}

function getNullValue(las) {
  // Usually in ~W as NULL.
  const item = las.well.get("NULL") || las.well.get("NULL ");
  if (!item) return las.nullValue;

  const v = parseFloat(item.unit);
  return Number.isFinite(v) ? v : las.nullValue;
}

function getDelimiter(las) {
  // In ~V: DLM.
  let dlm = las.delimiter;
  if (typeof dlm === "string" && dlm.trim()) {
    dlm = dlm.trim().toUpperCase();
    if (dlm === "SPACE" || dlm === "TAB" || dlm === "COMMA") return dlm;
  }

  // Sometimes delimiter is indicated as DLM in WELL too (rare)
  const dlmItem = las.well.get("DLM");
  if (dlmItem && dlmItem.valueRaw) {
    const s = dlmItem.valueRaw.trim().toUpperCase();
    if (s === "SPACE" || s === "TAB" || s === "COMMA") return s;
  }

  // Fallback: guess from first data line
  const aSec = las.sections.get("A") || las.sections.get("ASCII") || las.sections.get("DATA");
  if (aSec) {
    const first = aSec.lines.find(l => stripComment(l).trim().length);
    if (first) {
      if (first.includes(",")) return "COMMA";
      if (/\t/.test(first)) return "TAB";
      return "SPACE";
    }
  }
  return "SPACE";
}

function parseAsciiData(las, sec) {
  const dlm = las.delimiter || "SPACE";
  const splitter =
    dlm === "COMMA" ? /,+/ :
    dlm === "TAB"   ? /\t+/ :
                      /\s+/;

  const rows = [];
  for (const raw of sec.lines) {
    const line = stripComment(raw).trim();
    if (!line) continue;

    const parts = line.split(splitter).filter(p => p.length);
    if (!parts.length) continue;

    const row = parts.map(p => {
      const v = parseFloat(p);
      return Number.isFinite(v) ? v : null;
    });
    rows.push(row);
  }

  las.data.rows = rows;
}

// NEW
function convertNullSentinelToNull(las) {
  const nv = las.nullValue;
  if (!Number.isFinite(nv)) return;

  const rows = las.data?.rows || [];
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    for (let c = 0; c < row.length; c++) {
      const v = row[c];
      if (v === null) continue;
      // strict equality is usually correct for LAS NULL (e.g., -999.25)
      if (v === nv) row[c] = null;
    }
  }
}

function distributeDataIntoCurves(las) {
  const rows = las.data?.rows || [];
  const nCurves = las.curves.length;

  // If no curve info section, infer from first row length.
  if (!nCurves && rows.length) {
    for (let i = 0; i < rows[0].length; i++) {
      las.curves.push({ mnemonic: `CURVE${i + 1}`, unit: "", api: "", code: "", description: "", rawLine: "", data: [] });
    }
  }

  // Reset
  for (const c of las.curves) c.data = [];

  if (!rows.length) return;

  // Normalize row length to curve count (pad/truncate)
  for (const row of rows) {
    if (row.length < las.curves.length) {
      while (row.length < las.curves.length) row.push(null);
    } else if (row.length > las.curves.length) {
      row.length = las.curves.length;
    }
  }

  // Fill
  for (let ci = 0; ci < las.curves.length; ci++) {
    const c = las.curves[ci];
    const arr = new Array(rows.length);
    for (let r = 0; r < rows.length; r++) arr[r] = rows[r][ci];
    c.data = arr;
  }
}

function rebuildRowsFromCurves(las) {
  // Prefer las.data.rows if present and consistent; otherwise rebuild from curve arrays.
  const curves = las.curves || [];
  const n = curves.length;
  if (!n) return [];

  const rowCount = maxLen(curves.map(c => (c.data ? c.data.length : 0)));
  const rows = new Array(rowCount);

  for (let r = 0; r < rowCount; r++) {
    const row = new Array(n);
    for (let ci = 0; ci < n; ci++) {
      const v = curves[ci].data?.[r];
      row[ci] = (v === undefined ? null : v);
    }
    rows[r] = row;
  }
  return rows;
}

function maxLen(arr) {
  let m = 0;
  for (const x of arr) if (x > m) m = x;
  return m;
}

function formatCurveLine(c) {
  // Keep a reasonably standard alignment (not strict spec formatting).
  const mn = (c.mnemonic ?? "").padEnd(8, " ");
  const un = (c.unit ?? "").padEnd(8, " ");
  const api = (c.api ?? "").padEnd(16, " ");
  const code = (c.code ?? "").padEnd(16, " ");
  const desc = c.description ?? "";
  return `${mn}.${un} ${api} ${code} : ${desc}`.replace(/\s+:/, " :");
}

function rebuildKeyValueLines(las, sec, shortName) {
  // Rebuild only known keys we might have changed (NULL, DLM, WRAP, VERS), else keep raw.
  // For simplicity, keep original lines unless we have matching parsed items to update.
  const lines = [];

  const original = sec.lines || [];
  if (!sec.items || !sec.items.length) return original.slice();

  const updates = new Map();

  if (shortName === "V") {
    if (las.version != null) updates.set("VERS", String(las.version));
    if (las.wrap != null) updates.set("WRAP", String(las.wrap));
    if (las.delimiter != null) updates.set("DLM", String(las.delimiter));
  }
  if (shortName === "W") {
    if (las.nullValue != null) updates.set("NULL", String(las.nullValue));
  }

  for (const raw of original) {
    const line = stripComment(raw).trimEnd();
    const m = line.match(/^\s*([^.\s]+)\s*\.\s*([^ \t]*)\s+([^:]*)?(?::\s*(.*))?$/);
    if (!m) {
      lines.push(raw);
      continue;
    }
    const mnemonic = m[1].trim().toUpperCase();
    if (!updates.has(mnemonic)) {
      lines.push(raw);
      continue;
    }
    const unit = (m[2] ?? "").trim();
    const desc = (m[4] ?? "").trim();
    const newValue = updates.get(mnemonic);

    // Preserve basic shape
    lines.push(`${mnemonic}.${unit}  ${newValue} : ${desc}`.trimEnd());
  }

  // Ensure updated keys exist if missing
  for (const [k, v] of updates.entries()) {
    const present = sec.items.some(it => it.mnemonic.toUpperCase() === k);
    if (!present) {
      const desc =
        (k === "NULL") ? "Null value" :
        (k === "DLM")  ? "Delimiter" :
        (k === "WRAP") ? "One line per depth step" :
        (k === "VERS") ? "LAS version" : "";
      lines.push(`${k}.  ${v} : ${desc}`.trimEnd());
    }
  }

  return lines;
}

function formatNumber(v, nullValue, precision) {
  // Export rules:
  // - null -> nullValue (if defined), else "NaN"
  // - NaN/undefined/non-finite -> nullValue (if defined), else "NaN"
  if (v === null || v === undefined || !Number.isFinite(v)) {
    if (nullValue != null) return String(nullValue);
    return "NaN";
  }
  if (precision == null) return String(v);
  const s = v.toFixed(precision);
  return (s === "-0.000" || s === "-0.00" || s === "-0.0") ? s.replace("-", "") : s;
}