// curveOpsAndTracks.js
// Keeps curve selectors in sync across:
// - #curveSelector (main selector for editing)
// - 4 per-graph selectors created by initFourDepthTracks()
// When a derived curve NEW_<mnemonic> is created:
// - It appears in ALL selectors
// - Any track currently showing <mnemonic> is switched to NEW_<mnemonic> and re-rendered
//
// Assumes you already have:
// - initFourDepthTracks() from your multiTracks.js (returns { state, setTrack, resize, destroy, ...})
// - addDerivedCurve(), populateCurveSelector(), parseOperatorExpr() from curveOpsUI.js
//
// If you don't: copy the small helper functions used below.

import { addDerivedCurve, parseOperatorExpr, populateCurveSelector } from "./curveOpsUI.js";

/**
 * Wire up:
 * - a main curve selector (#curveSelector)
 * - an operator input (#curveOperator)
 * - the 4-track plotting controller returned by initFourDepthTracks()
 *
 * @param {object} las - parsed LAS object
 * @param {object} tracksCtrl - return value from initFourDepthTracks(las, ...)
 */
export function bindCurveOpsAndTracks(las, tracksCtrl, {
  mainSelectorId = "curveSelector",
  operatorId = "curveOperator",
} = {}) {
  const mainSel = document.getElementById(mainSelectorId);
  if (!mainSel) throw new Error(`Missing #${mainSelectorId}`);

  const opInput = document.getElementById(operatorId);
  if (!opInput) throw new Error(`Missing #${operatorId}`);

  // Ensure initial population everywhere
  refreshAllSelectors(las, tracksCtrl, mainSel);

  opInput.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;

    const srcMnemonic = mainSel.value;
    if (!srcMnemonic) return;

    const expr = opInput.value.trim();
    if (!expr) return;

    const parsed = parseOperatorExpr(expr);

    // Create/overwrite derived curve NEW_<src>
    addDerivedCurve(las, srcMnemonic, parsed);
    const newMnemonic = `NEW_${srcMnemonic}`;

    // 1) Update ALL selector UIs (main + per-track)
    refreshAllSelectors(las, tracksCtrl, mainSel);

    // 2) If any track was showing the edited curve, switch it to the new curve
    //    and re-render that plot.
    updateTracksShowingCurve(tracksCtrl, srcMnemonic, newMnemonic);

    // Optional: select new curve in main selector
    mainSel.value = newMnemonic;

    // Clear input
    opInput.value = "";
  });

  return {
    refresh: () => refreshAllSelectors(las, tracksCtrl, mainSel),
  };
}

/**
 * Rebuild options for:
 * - main selector
 * - each track's selector (tracksCtrl.state.tracks[].selectEl)
 */
function refreshAllSelectors(las, tracksCtrl, mainSel) {
  // Main selector
  populateCurveSelector(mainSel, las);

  // Track selectors
  const tracks = tracksCtrl?.state?.tracks || [];
  for (const t of tracks) {
    const prev = t.selectEl.value;
    populateCurveSelector(t.selectEl, las);

    // Keep prior selection if still exists
    if (prev && las.curves.some(c => c.mnemonic === prev)) {
      t.selectEl.value = prev;
    }
  }
}

/**
 * For every track currently displaying `oldMnemonic`, switch to `newMnemonic`.
 * If a track is already showing newMnemonic, leave it.
 */
function updateTracksShowingCurve(tracksCtrl, oldMnemonic, newMnemonic) {
  const tracks = tracksCtrl?.state?.tracks || [];
  for (let i = 0; i < tracks.length; i++) {
    const t = tracks[i];

    // Source of truth: track.selectedMnemonic if you kept it; else the select value.
    const current = (t.selectedMnemonic || t.selectEl.value || "").toUpperCase();
    if (current === oldMnemonic.toUpperCase()) {
      // Update the dropdown UI
      t.selectEl.value = newMnemonic;

      // Re-render plot
      tracksCtrl.setTrack(i, newMnemonic);

      // Keep internal state consistent if you use it
      t.selectedMnemonic = newMnemonic;
    }
  }
}
