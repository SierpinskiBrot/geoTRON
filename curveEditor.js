// curveEditor.js
// Unified curve editor UI:
// - #curveSelector selects the source curve
// - #curveOperator and #newName are applied ONLY via #curveApplyEdits
//   Behavior:
//     * op empty, name non-empty   => rename selected curve to newName
//     * op non-empty, name non-empty => create new derived curve named newName
//     * op non-empty, name empty  => create new derived curve named NEW_<src>
//     * op empty, name empty      => no-op
// - #deleteCurveBtn opens a modal/popup grid to multi-select curves for deletion
//
// Also keeps ALL selectors in sync (main + per-track selectors from initFourDepthTracks)
// and updates tracks:
// - rename: tracks showing old mnemonic switch to new mnemonic
// - op/create: tracks showing src mnemonic switch to new derived mnemonic
// - delete: tracks showing deleted mnemonic are cleared
//
// Assumes tracksCtrl has:
// - tracksCtrl.state.tracks[] where each track has { selectEl, selectedMnemonic? }
// - tracksCtrl.setTrack(trackIndex, mnemonicOrEmpty)
//
// This mirrors the behavior in your previous modules :contentReference[oaicite:0]{index=0} :contentReference[oaicite:1]{index=1} :contentReference[oaicite:2]{index=2}

export function bindCurveEditor(las, tracksCtrl, {
  mainSelectorId = "curveSelector",
  densitySelectorId = "densitySelector",
  gammaSelectorId = "gammaSelector",
  resistivitySelectorId = "resistivitySelector",
  operatorId = "curveOperator",
  newNameId = "newName",
  applyBtnId = "curveApplyEdits",

  pmaInputId = "pmaInput",
  pfInputId = "pfInput",
  rwInputId = "rwInput",
  nInputId = "nInput",
  mInputId = "mInput",

  dphiCutoffInputId = "dphiCutoffInput",

  deleteBtnId = "deleteCurveBtn",

  // delete modal elements
  deleteModalId = "curveDeleteModal",
  deleteGridId = "curveDeleteGrid",
  deleteConfirmId = "curveDeleteConfirm",
  deleteCancelId = "curveDeleteCancel",


  protectedMnemonics = ["DEPT", "DEPTH", "DPHIX"],
} = {}) {
  let _las = las;

  // --- main UI elements
  const mainSel = mustEl(mainSelectorId);
  const opInput = mustEl(operatorId);
  const nameInput = mustEl(newNameId);
  const applyBtn = mustEl(applyBtnId);

  const densitySel = mustEl(densitySelectorId);
  const gammaSel = mustEl(gammaSelectorId)
  const resistivitySel = mustEl(resistivitySelectorId)
  const dphiCutoffInput = mustEl(dphiCutoffInputId);

  const pmaInput = mustEl(pmaInputId)
  const pfInput = mustEl(pfInputId)
  const rwInput = mustEl(rwInputId)
  const nInput = mustEl(nInputId)
  const mInput = mustEl(mInputId)

  const deleteBtn = mustEl(deleteBtnId);

  // --- delete modal UI elements
  const modal = mustEl(deleteModalId);
  const grid = mustEl(deleteGridId);
  const btnConfirm = mustEl(deleteConfirmId);
  const btnCancel = mustEl(deleteCancelId);

  // Initial populate everywhere
  populateParameterSelectors(_las, densitySel, gammaSel, resistivitySel);
  createPetroCurve(las)
  refreshAllSelectors(_las, tracksCtrl, mainSel);
  
  function refreshPetro() {
    createPetroCurve(las); 
    updateTracksMnemonic(tracksCtrl, "DPHIX", "DPHIX")
    updateTracksMnemonic(tracksCtrl, "SWARCH", "SWARCH")

  }
  densitySel.addEventListener("change", () => {refreshPetro()})
  gammaSel.addEventListener("change", () => {refreshPetro()})
  resistivitySel.addEventListener("change", () => {refreshPetro()})
  pmaInput.addEventListener("change", () => {refreshPetro()})
  pfInput.addEventListener("change", () => {refreshPetro()})
  rwInput.addEventListener("change", () => {refreshPetro()})
  nInput.addEventListener("change", () => {refreshPetro()})
  mInput.addEventListener("change", () => {refreshPetro()})
  dphiCutoffInput.addEventListener("change", () => {refreshPetro()})

  // Apply button logic (single source of truth)
  applyBtn.addEventListener("click", () => {
    const srcMnemonic = (mainSel.value || "").trim();
    if (!srcMnemonic) return;

    const expr = opInput.value.trim();
    const rawName = nameInput.value.trim();

    const hasOp = expr.length > 0;
    const hasName = rawName.length > 0;

    if (!hasOp && !hasName) return;

    // Rename-only
    if (!hasOp && hasName) {
      if (isProtected(srcMnemonic, protectedMnemonics)) {
        alert(`Cannot rename protected curve: ${srcMnemonic}`);
        return;
      }

      const newMnemonic = sanitizeMnemonic(rawName);
      if (!newMnemonic) {
        alert("Invalid newName");
        return;
      }

      if (newMnemonic.toUpperCase() === srcMnemonic.toUpperCase()) {
        nameInput.value = "";
        return;
      }

      if (_las.curves.some(c => c.mnemonic.toUpperCase() === newMnemonic.toUpperCase())) {
        alert(`A curve named "${newMnemonic}" already exists`);
        return;
      }

      renameCurve(_las, srcMnemonic, newMnemonic);

      refreshAllSelectors(_las, tracksCtrl, mainSel);
      updateTracksMnemonic(tracksCtrl, srcMnemonic, newMnemonic);

      mainSel.value = newMnemonic;
      nameInput.value = "";
      return;
    }

    // Op => create derived curve
    const parsed = parseOperatorExpr(expr);

    // Name: provided or default NEW_<src>
    const outMnemonic = hasName ? sanitizeMnemonic(rawName) : `NEW_${srcMnemonic}`;

    if (!outMnemonic) {
      alert("Invalid newName");
      return;
    }

    // Do not allow overwriting protected originals by naming collision
    // (Overwriting an existing derived curve is allowed if same mnemonic.)
    const existingIdx = findCurveIdx(_las, outMnemonic);
    const isExisting = existingIdx !== -1;

    if (!isExisting && _las.curves.some(c => c.mnemonic.toUpperCase() === outMnemonic.toUpperCase())) {
      // This can only happen via weird casing; keep consistent messaging:
      alert(`A curve named "${outMnemonic}" already exists`);
      return;
    }

    // If destination exists and is protected, block overwrite
    if (isExisting && isProtected(_las.curves[existingIdx].mnemonic, protectedMnemonics)) {
      alert(`Cannot overwrite protected curve: ${_las.curves[existingIdx].mnemonic}`);
      return;
    }

    addDerivedCurveNamed(_las, srcMnemonic, outMnemonic, parsed);

    refreshAllSelectors(_las, tracksCtrl, mainSel);

    // If any track was showing the source curve, switch to the derived curve
    updateTracksMnemonic(tracksCtrl, srcMnemonic, outMnemonic);

    // Select new curve in main selector
    mainSel.value = outMnemonic;

    // Clear inputs
    opInput.value = "";
    nameInput.value = "";
  });

  // Delete button opens modal
  deleteBtn.addEventListener("click", () => {
    rebuildDeleteGrid(_las, grid, protectedMnemonics);
    openModal(modal);
  });

  // Modal buttons
  btnCancel.addEventListener("click", () => closeModal(modal));

  // Click outside panel closes (optional UX)
  modal.addEventListener("mousedown", (e) => {
    if (e.target === modal) closeModal(modal);
  });

  btnConfirm.addEventListener("click", () => {
    const selected = getSelectedDeleteMnemonics(grid);

    if (selected.length === 0) {
      closeModal(modal);
      return;
    }

    // Filter protected (should not be selectable, but double safety)
    const deletable = selected.filter(m => !isProtected(m, protectedMnemonics));
    if (deletable.length === 0) {
      closeModal(modal);
      return;
    }

    const ok = confirm(
      `Delete ${deletable.length} curve(s)?\n\n` +
      deletable.slice(0, 12).join(", ") +
      (deletable.length > 12 ? `, ...` : "")
    );
    if (!ok) return;

    // Perform deletions
    for (const m of deletable) deleteCurve(_las, m);

    // Refresh selectors
    refreshAllSelectors(_las, tracksCtrl, mainSel);

    // Clear tracks showing deleted curves
    clearTracksForDeleted(tracksCtrl, deletable);

    // Ensure main selector is valid
    if (_las.curves.length) mainSel.value = _las.curves[0].mnemonic;

    closeModal(modal);
  });

  // API
  function setLas(newLas) {
    _las = newLas;
    refreshAllSelectors(_las, tracksCtrl, mainSel);
    rebuildDeleteGrid(_las, grid, protectedMnemonics);
  }

  function refresh() {
    refreshAllSelectors(_las, tracksCtrl, mainSel);
  }

  function destroy() {
    // No-op (you can add removeEventListener wiring if needed)
  }

  return { setLas, refresh, destroy };
}

/* ------------------------- helpers ------------------------- */

function mustEl(id) {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id}`);
  return el;
}

function openModal(modal) {
  modal.classList.add("open");
  modal.setAttribute("aria-hidden", "false");
}

function closeModal(modal) {
  modal.classList.remove("open");
  modal.setAttribute("aria-hidden", "true");
}

function rebuildDeleteGrid(las, gridEl, protectedMnemonics) {
  gridEl.innerHTML = "";

  for (const c of las.curves) {
    const mn = c.mnemonic;

    const item = document.createElement("label");
    item.className = "curve-del-item";

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.value = mn;

    const span = document.createElement("span");
    span.textContent = mn;

    const prot = isProtected(mn, protectedMnemonics);
    if (prot) {
      cb.disabled = true;
      item.classList.add("is-protected");
      item.title = "Protected curve";
    }

    item.appendChild(cb);
    item.appendChild(span);
    gridEl.appendChild(item);
  }
}

function getSelectedDeleteMnemonics(gridEl) {
  const out = [];
  const boxes = gridEl.querySelectorAll('input[type="checkbox"]');
  boxes.forEach(cb => {
    if (cb.checked) out.push(cb.value);
  });
  return out;
}

function refreshAllSelectors(las, tracksCtrl, mainSel) {
  const prevMain = mainSel.value;
  populateCurveSelector(mainSel, las);
  if (prevMain && las.curves.some(c => c.mnemonic === prevMain)) mainSel.value = prevMain;

  const tracks = tracksCtrl?.state?.tracks || [];
  for (const t of tracks) {
    const prev = t.selectEl.value;
    populateCurveSelector(t.selectEl, las);
    if (prev && las.curves.some(c => c.mnemonic === prev)) t.selectEl.value = prev;
  }
}

function updateTracksMnemonic(tracksCtrl, oldMnemonic, newMnemonic) {
  const tracks = tracksCtrl?.state?.tracks || [];
  for (let i = 0; i < tracks.length; i++) {
    const t = tracks[i];
    const cur = (t.selectedMnemonic || t.selectEl.value || "").toUpperCase();
    if (cur === oldMnemonic.toUpperCase()) {
      t.selectEl.value = newMnemonic;
      tracksCtrl.setTrack(i, newMnemonic);
      t.selectedMnemonic = newMnemonic;
    }
  }
}

function clearTracksForDeleted(tracksCtrl, deletedList) {
  const delSet = new Set(deletedList.map(s => s.toUpperCase()));
  const tracks = tracksCtrl?.state?.tracks || [];
  for (let i = 0; i < tracks.length; i++) {
    const t = tracks[i];
    const cur = (t.selectedMnemonic || t.selectEl.value || "").toUpperCase();
    if (delSet.has(cur)) {
      t.selectEl.value = "";
      tracksCtrl.setTrack(i, "");
      t.selectedMnemonic = "";
    }
  }
}

/* ---------------- LAS curve ops ---------------- */

export function populateCurveSelector(selectEl, las) {
  const prev = selectEl.value;

  while (selectEl.firstChild) selectEl.removeChild(selectEl.firstChild);

  for (const c of las.curves) {
    const mn = c.mnemonic;
    const label = c.unit ? `${mn} (${c.unit})` : mn;

    const opt = document.createElement("option");
    opt.value = mn;
    opt.textContent = label;
    selectEl.appendChild(opt);
  }

  if (prev && las.curves.some(c => c.mnemonic === prev)) {
    selectEl.value = prev;
  }
}

export function populateParameterSelectors(las, densitySel, gammaSel, resistivitySel) {

    while (densitySel.firstChild) densitySel.removeChild(densitySel.firstChild);
    while (gammaSel.firstChild) gammaSel.removeChild(gammaSel.firstChild);
    while (resistivitySel.firstChild) resistivitySel.removeChild(resistivitySel.firstChild);

    for (const c of las.curves) {
        const unit = c.unit;
        const mn = c.mnemonic;
        const label = unit ? `${mn} (${unit})` : mn;
        const opt = document.createElement("option");
        opt.value = mn;
        opt.textContent = label;
        if(unit == "K/M3" || unit == "KG/M3") {
            densitySel.appendChild(opt);
        }
        if(unit == "GAPI") {
            gammaSel.appendChild(opt)
        }
        if(unit == "OHMM") {
            resistivitySel.appendChild(opt)
        }
        
    }

    
}

export function parseOperatorExpr(s) {
  const t = s
    .replace(/\s+/g, "")
    .replace(/^x/i, "*");

  const m = t.match(/^([+\-*/])([0-9]*\.?[0-9]+(?:e[+\-]?[0-9]+)?)$/i);
  if (!m) throw new Error(`Invalid operator. Use like +5, *10, /2, -3`);

  const op = m[1];
  const k = Number(m[2]);
  if (!Number.isFinite(k)) throw new Error("Invalid number in operator");
  if (op === "/" && k === 0) throw new Error("Division by zero");
  return { op, k };
}

export function renameCurve(las, oldMnemonic, newMnemonic) {
  const idx = findCurveIdx(las, oldMnemonic);
  if (idx === -1) throw new Error(`Curve not found: ${oldMnemonic}`);
  las.curves[idx].mnemonic = newMnemonic;
}

export function deleteCurve(las, mnemonic) {
  const idx = findCurveIdx(las, mnemonic);
  if (idx === -1) return;

  las.curves.splice(idx, 1);

  if (las.data?.rows?.length) {
    for (const row of las.data.rows) {
      if (Array.isArray(row) && row.length > idx) row.splice(idx, 1);
    }
  }
}

export function addDerivedCurveNamed(las, sourceMnemonic, outMnemonic, { op, k }) {
  const srcIdx = findCurveIdx(las, sourceMnemonic);
  if (srcIdx === -1) throw new Error(`Curve not found: ${sourceMnemonic}`);

  const src = las.curves[srcIdx];

  let dstIdx = findCurveIdx(las, outMnemonic);

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
    las.curves.push({
      mnemonic: outMnemonic,
      unit: src.unit || "",
      api: src.api || "",
      code: src.code || "",
      description: `Derived from ${src.mnemonic} by ${op}${k}`,
      rawLine: "",
      data: dstData,
    });
    dstIdx = las.curves.length - 1;
  } else {
    las.curves[dstIdx].data = dstData;
    las.curves[dstIdx].unit = las.curves[dstIdx].unit || (src.unit || "");
    las.curves[dstIdx].description = `Derived from ${src.mnemonic} by ${op}${k}`;
  }

  ensureRowsFromCurves(las);

  const rows = las.data.rows;
  for (let r = 0; r < rows.length; r++) {
    rows[r][dstIdx] = (r < dstData.length ? dstData[r] : null);
  }
}

export function createPetroCurve(las) {
    console.log("editing petro curve")
    const densityMnemonic = (document.getElementById("densitySelector").value || "").trim();
    const dIdx = findCurveIdx(las, densityMnemonic);
    if (dIdx === -1) throw new Error(`Curve not found: ${densityMnemonic}`);

    const resistivityMnemonic = (document.getElementById("resistivitySelector").value || "").trim();
    const rIdx = findCurveIdx(las, resistivityMnemonic)
    if(rIdx === -1) throw new Error(`Curve not found: ${resistivityMnemonic}`)

    const dSrc = las.curves[dIdx];
    const rSrc = las.curves[rIdx]

    let dphiIdx = findCurveIdx(las, "DPHIX");
    let swIdx = findCurveIdx(las, "SWARCH");

    const pma = parseFloat(document.getElementById("pmaInput").value)
    const pf = parseFloat(document.getElementById("pfInput").value)
    const n = parseFloat(document.getElementById("nInput").value)
    const m = parseFloat(document.getElementById("mInput").value)
    const rw = parseFloat(document.getElementById("rwInput").value)
    const cutoff = parseFloat(document.getElementById("dphiCutoffInput").value)


    const dData = dSrc.data || [];
    const rData = dSrc.data || [];
    const dphiData = new Array(dData.length);
    const swData = new Array(dData.length);

    for (let i = 0; i < dData.length; i++) {
        const v = dData[i];
        if (v == null || !Number.isFinite(v)) {
            dphiData[i] = null;
            continue;
        }
        //dstData[i] = Math.max(100*(pma-v)/(pma-pf),cutoff)
        dphiData[i] = 100*(pma-v)/(pma-pf)
        swData[i] = 100*(rw/(Math.max(dphiData[i]/100,cutoff/100)**m * rData[i])) ** (1/n)
    }

    if (dphiIdx === -1) {
        las.curves.push({
        mnemonic: "DPHIX",
        unit: "%",
        api: dSrc.api || "",
        code: dSrc.code || "",
        description: `Porosity from bulk density`,
        rawLine: "",
        data: dphiData,
        });
        dphiIdx = las.curves.length - 1;
    } else {
        las.curves[dphiIdx].data = dphiData;
    }

    ensureRowsFromCurves(las);

    const rows = las.data.rows;
    for (let r = 0; r < rows.length; r++) {
        rows[r][dphiIdx] = (r < dphiData.length ? dphiData[r] : null);
    }

    if (swIdx === -1) {
        las.curves.push({
        mnemonic: "SWARCH",
        unit: "%",
        api: dSrc.api || "",
        code: dSrc.code || "",
        description: `Porosity from bulk density`,
        rawLine: "",
        data: swData,
        });
        swIdx = las.curves.length - 1;
    } else {
        las.curves[swIdx].data = swData;
    }

    ensureRowsFromCurves(las);

    for (let r = 0; r < rows.length; r++) {
        rows[r][swIdx] = (r < swData.length ? swData[r] : null);
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

function ensureRowsFromCurves(las) {
  const curves = las.curves || [];
  const nCurves = curves.length;
  const rowCount = maxLen(curves.map(c => (c.data ? c.data.length : 0)));

  if (!las.data) las.data = { rows: [] };
  const rows = las.data.rows;

  rows.length = rowCount;

  for (let r = 0; r < rowCount; r++) {
    if (!Array.isArray(rows[r])) rows[r] = new Array(nCurves);
    const row = rows[r];

    if (row.length !== nCurves) row.length = nCurves;

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

function findCurveIdx(las, mnemonic) {
  const up = mnemonic.toUpperCase();
  return las.curves.findIndex(c => c.mnemonic.toUpperCase() === up);
}

function isProtected(mnemonic, protectedMnemonics) {
  const m = mnemonic.toUpperCase();
  return protectedMnemonics.some(p => p.toUpperCase() === m);
}

function sanitizeMnemonic(s) {
  return s
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "_")
    .replace(/[^A-Z0-9_]/g, "");
}
