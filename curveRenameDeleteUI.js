// curveRenameDeleteUI.js
// Adds two behaviors:
// 1) #newName (text input): on Enter, renames the currently-selected curve mnemonic.
//    - Updates las.curves[].mnemonic
//    - Updates ALL selectors (main + per-graph)
//    - If a graph was showing the old mnemonic, it updates to the renamed mnemonic
// 2) #deleteCurveBtn (button): warns, then deletes the selected curve.
//    - Removes curve from las.curves
//    - Removes the corresponding column from las.data.rows
//    - Updates all selectors
//    - Any graph showing the deleted curve is cleared (or optionally set to another curve)
//
// Assumes:
// - main selector: <select id="curveSelector">
// - rename input:  <input  id="newName" type="text">
// - delete button: <button id="deleteCurveBtn">
//
// Requires you have initFourDepthTracks() controller instance (tracksCtrl)
// and populateCurveSelector() helper (from curveOpsUI.js).

import { populateCurveSelector } from "./curveOpsUI.js";

export function bindRenameDeleteUI(las, tracksCtrl, {
  mainSelectorId = "curveSelector",
  newNameId = "newName",
  deleteBtnId = "deleteCurveBtn",
  // Optional: prevent deleting depth curve(s)
  protectedMnemonics = ["DEPT", "DEPTH"],
  // If true, deleting a shown curve sets the track to first available curve; else clears it
  fallbackToFirstCurve = false,
} = {}) {
  const mainSel = document.getElementById(mainSelectorId);
  if (!mainSel) throw new Error(`Missing #${mainSelectorId}`);

  const newNameInput = document.getElementById(newNameId);
  if (!newNameInput) throw new Error(`Missing #${newNameId}`);

  const deleteBtn = document.getElementById(deleteBtnId);
  if (!deleteBtn) throw new Error(`Missing #${deleteBtnId}`);

  // Initial sync
  refreshAllSelectors(las, tracksCtrl, mainSel);

  // 1) Rename on Enter
  newNameInput.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;

    const oldMnemonic = mainSel.value;
    if (!oldMnemonic) return;

    const raw = newNameInput.value.trim();
    if (!raw) return;

    const newMnemonic = sanitizeMnemonic(raw);

    // No-op
    if (newMnemonic.toUpperCase() === oldMnemonic.toUpperCase()) {
      newNameInput.value = "";
      return;
    }

    // Prevent renaming protected curves
    if (isProtected(oldMnemonic, protectedMnemonics)) {
      alert(`Cannot rename protected curve: ${oldMnemonic}`);
      return;
    }

    // Prevent collisions
    if (las.curves.some(c => c.mnemonic.toUpperCase() === newMnemonic.toUpperCase())) {
      alert(`A curve named "${newMnemonic}" already exists.`);
      return;
    }

    renameCurve(las, oldMnemonic, newMnemonic);

    // Update UI selectors
    refreshAllSelectors(las, tracksCtrl, mainSel);

    // Update tracks showing old curve
    updateTracksMnemonic(tracksCtrl, oldMnemonic, newMnemonic);

    // Select renamed curve in main selector
    mainSel.value = newMnemonic;

    // Clear input
    newNameInput.value = "";
  });

  // 2) Delete with warning
  deleteBtn.addEventListener("click", () => {
    const mnemonic = mainSel.value;
    if (!mnemonic) return;

    if (isProtected(mnemonic, protectedMnemonics)) {
      alert(`Cannot delete protected curve: ${mnemonic}`);
      return;
    }

    const ok = confirm(`Delete curve "${mnemonic}"?\n\nThis will remove it from the LAS export.`);
    if (!ok) return;

    deleteCurve(las, mnemonic);

    // Update selectors
    refreshAllSelectors(las, tracksCtrl, mainSel);

    // Update tracks that were showing it
    clearOrFallbackTracks(tracksCtrl, mnemonic, las, { fallbackToFirstCurve });

    // Ensure main selector points to something valid
    if (las.curves.length) {
      mainSel.value = las.curves[0].mnemonic;
    }
  });

  return {
    refresh: () => refreshAllSelectors(las, tracksCtrl, mainSel),
  };
}

// --- Core operations ---

export function renameCurve(las, oldMnemonic, newMnemonic) {
  const idx = las.curves.findIndex(c => c.mnemonic.toUpperCase() === oldMnemonic.toUpperCase());
  if (idx === -1) throw new Error(`Curve not found: ${oldMnemonic}`);

  las.curves[idx].mnemonic = newMnemonic;

  // Nothing else required as long as data alignment is by index (rows column order stays same).
  // Curve info (~C) will export with new mnemonic automatically.
}

export function deleteCurve(las, mnemonic) {
  const idx = las.curves.findIndex(c => c.mnemonic.toUpperCase() === mnemonic.toUpperCase());
  if (idx === -1) return;

  // Remove curve
  las.curves.splice(idx, 1);

  // Remove column from rows (so ~A exports with correct column count)
  if (las.data?.rows?.length) {
    for (const row of las.data.rows) {
      if (Array.isArray(row) && row.length > idx) row.splice(idx, 1);
    }
  }

  // Also keep any per-curve data arrays consistent (not strictly necessary if exporter uses curves)
  // but do it anyway for safety:
  // (curves already removed, remaining curves keep their data arrays)
}

// --- UI sync helpers ---

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

function clearOrFallbackTracks(tracksCtrl, deletedMnemonic, las, { fallbackToFirstCurve }) {
  const tracks = tracksCtrl?.state?.tracks || [];
  const fallback = (fallbackToFirstCurve && las.curves.length) ? las.curves[0].mnemonic : "";

  for (let i = 0; i < tracks.length; i++) {
    const t = tracks[i];
    const cur = (t.selectedMnemonic || t.selectEl.value || "").toUpperCase();
    if (cur === deletedMnemonic.toUpperCase()) {
      t.selectEl.value = fallback;
      tracksCtrl.setTrack(i, fallback); // if fallback=="" this clears plot in your implementation
      t.selectedMnemonic = fallback;
    }
  }
}

// --- Misc ---

function isProtected(mnemonic, protectedMnemonics) {
  const m = mnemonic.toUpperCase();
  return protectedMnemonics.some(p => p.toUpperCase() === m);
}

function sanitizeMnemonic(s) {
  // LAS mnemonics are typically short and avoid spaces/special chars.
  // Keep it simple: uppercase, replace spaces with _, strip illegal chars.
  return s
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "_")
    .replace(/[^A-Z0-9_]/g, "");
}
