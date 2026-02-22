// multiTracks.js
// Creates 4 "tracks" (dropdown + uPlot) inside:
//   #graph1div, #graph2div, #graph3div, #graph4div
//
// Shared y-axis (depth) is drawn ONCE in #yAxisDiv.
// Per-track plots do NOT draw a y-axis.
//
// Assumes:
// - uPlot is loaded globally as `uPlot`
// - `las` is from lasio.js and has `las.curves[]` with `.mnemonic`, `.unit`, `.data[]`
// - Depth curve exists ("DEPT" or "DEPTH") and is numeric with nulls for gaps
// - This module is called only after LAS + TOPS are uploaded, so yMin/yMax are known.

export function initFourDepthTracks(las, {
  containerIds = ["graph1div", "graph2div", "graph3div", "graph4div","graph5div","graph6div","graph7div","graph8div"],
  yAxisDivId = "yAxisDiv",

  depthMnemonicCandidates = ["DEPT", "DEPTH"],
  initialCurves = [
    las.curves[1]?.mnemonic ?? "", 
    las.curves[2]?.mnemonic ?? "",
    las.curves[3]?.mnemonic ?? "",
    las.curves[4]?.mnemonic ?? "",
    las.curves[5]?.mnemonic ?? "",
    las.curves[6]?.mnemonic ?? "",
    las.curves[7]?.mnemonic ?? "",
    las.curves[8]?.mnemonic ?? ""
],

  
  

  // If null, uses container clientWidth
  width = null,

  // Height of each track plot (and shared y-axis plot)
  

  // Shared y-axis width (px)
  yAxisWidth = 70,

  dropdownHeightPx = 34,
  height = graph1div.offsetHeight-10-dropdownHeightPx,
  

  // REQUIRED for tops-driven depth range:
  // yMin = highestTop - 10, yMax = lowestTop + 10
  yMin = window.topsData.yMin,
  yMax = window.topsData.yMax,
} = {}) {
  const depthCurve = findCurve(las, depthMnemonicCandidates);
  if (!depthCurve) throw new Error(`Depth curve not found (tried: ${depthMnemonicCandidates.join(", ")})`);

  if (!Number.isFinite(yMin) || !Number.isFinite(yMax))
    throw new Error("initFourDepthTracks requires numeric yMin/yMax (from tops: highestTop-10, lowestTop+10).");


  const curveChoices = las.curves
    .filter(c => c && c.data && c.data.length)
    .map(c => ({
      mnemonic: c.mnemonic,
      unit: c.unit || "",
      label: `${c.mnemonic}${c.unit ? ` (${c.unit})` : ""}`,
    }));

  const state = {
    las,
    depthCurve,
    curveChoices,
    yMin,
    yMax,
    tracks: [],       // { id, root, selectEl, plotEl, uplot, selectedMnemonic }
    yAxis: {          // shared y-axis plot
      divId: yAxisDivId,
      root: null,
      uplot: null,
      width: yAxisWidth,
    },
  };

  // Create shared y-axis plot ONCE
  initSharedYAxis(state, height, dropdownHeightPx);

  // Create tracks
  for (let i = 0; i < containerIds.length; i++) {
    const id = containerIds[i];
    const root = document.getElementById(id);
    if (!root) throw new Error(`Missing container div: #${id}`);

    // Layout
    root.style.display = "flex";
    root.style.flexDirection = "column";

    // Dropdown
    const selectEl = document.createElement("select");
    selectEl.style.height = `${dropdownHeightPx}px`;
    selectEl.style.width = "100%";

    // Options
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Select curve…";
    selectEl.appendChild(placeholder);

    for (const ch of curveChoices) {
      const opt = document.createElement("option");
      opt.value = ch.mnemonic;
      opt.textContent = ch.label;
      selectEl.appendChild(opt);
    }

    // Plot container
    const plotEl = document.createElement("div");
    plotEl.style.width = "100%";
    plotEl.style.flex = "1 1 auto";
    plotEl.style.minHeight = `${height}px`;
    plotEl.style.height = `${height}px`;

    // Clear and append
    root.innerHTML = "";
    root.appendChild(selectEl);
    root.appendChild(plotEl);

    const track = {
      id,
      root,
      selectEl,
      plotEl,
      uplot: null,
      selectedMnemonic: "",
    };
    state.tracks.push(track);

    // Hook change
    selectEl.addEventListener("change", () => {
      const mn = selectEl.value || "";
      setTrackCurve(state, i, mn, { width, height });
    });

    // Initial selection
    const init = initialCurves?.[i];
    if (init) {
      selectEl.value = init;
      setTrackCurve(state, i, init, { width, height });
    }
  }

  // Resize handling (keeps shared y-axis synced)
  const onResize = () => resizeAll(state, { width, height });
  window.addEventListener("resize", onResize);

  return {
    state,
    setTrack: (trackIndex, mnemonic) => {
      const t = state.tracks[trackIndex];
      if (!t) throw new Error("Invalid track index");
      t.selectEl.value = mnemonic ?? "";
      setTrackCurve(state, trackIndex, mnemonic ?? "", { width, height });
    },
    setDepthRange: (newYMin, newYMax) => {
      if (!Number.isFinite(newYMin) || !Number.isFinite(newYMax)) return;
      state.yMin = newYMin;
      state.yMax = newYMax;
      // Apply to shared y-axis
      if (state.yAxis.uplot) state.yAxis.uplot.setScale("y", { min: state.yMin, max: state.yMax });
      // Apply to all track plots
      for (const t of state.tracks) {
        if (t.uplot) t.uplot.setScale("y", { min: state.yMin, max: state.yMax });
      }
    },
    resize: () => resizeAll(state, { width, height }),
    destroy: () => {
      window.removeEventListener("resize", onResize);
      for (const t of state.tracks) {
        if (t.uplot) t.uplot.destroy();
        t.uplot = null;
      }
      if (state.yAxis.uplot) state.yAxis.uplot.destroy();
      state.yAxis.uplot = null;
    },
  };
}


function initSharedYAxis(state, height, dropdownHeightPx) {
  const yRoot = document.getElementById(state.yAxis.divId);
  if (!yRoot) throw new Error(`Missing shared y-axis div: #${state.yAxis.divId}`);

  state.yAxis.root = yRoot;

  // Ensure it sizes and doesn't add extra UI
  yRoot.innerHTML = "";
  yRoot.style.width = `${state.yAxis.width}px`;
  yRoot.style.minWidth = `${state.yAxis.width}px`;
  yRoot.style.height = `${height}px`;

  // Destroy if re-init
  if (state.yAxis.uplot) {
    state.yAxis.uplot.destroy();
    state.yAxis.uplot = null;
  }

  // Minimal data to let uPlot render an axis.
  // x is dummy; y spans the desired depth range.
  const data = [
    [0, 1],                 // x (dummy)
    [state.yMin, state.yMax]// y (depth)
  ];

  const opts = {
    width: state.yAxis.width,
    height,
    scales: {
      x: { time: false, auto: false, min: 0, max: 1 },
      y: { auto: false, dir: -1, min: state.yMin, max: state.yMax },
    },
    axes: [
      { show: true, scale: "x", size: 50 }, // hide x-axis
      {
        scale: "y",
        // label on the shared axis only
        label: `${state.depthCurve.mnemonic}${state.depthCurve.unit ? ` (${state.depthCurve.unit})` : ""}`,
        // if you want tighter left padding, adjust size/ticks here later
      },
    ],
    series: [
      {},
      {
        show: false,     // do not draw any line
        points: { show: false },
      }
    ],
    legend: { show: false },
    cursor: { show: false },
  };

  state.yAxis.uplot = new uPlot(opts, data, yRoot);
  const spacer = document.createElement("div")
  spacer.style.height = `${dropdownHeightPx}px`;
  spacer.style.minHeight = `${dropdownHeightPx}px`;
  yRoot.prepend(spacer)
  
}

function setTrackCurve(state, trackIndex, mnemonic, { width, height }) {
  const track = state.tracks[trackIndex];
  if (!track) return;

  if (track.uplot) {
    track.uplot.destroy();
    track.uplot = null;
  }

  track.plotEl.innerHTML = "";
  track.selectedMnemonic = mnemonic;

  if (!mnemonic) return;

  const xCurve = state.las.curves.find(c => c.mnemonic.toUpperCase() === mnemonic.toUpperCase());
  if (!xCurve) throw new Error(`Curve not found: ${mnemonic}`);

  const w = width ?? track.plotEl.clientWidth ?? 400;
  const h = height;

  const u = createDepthVsCurvePlot({
    target: track.plotEl,
    depthCurve: state.depthCurve,
    xCurve,
    width: w,
    height: h,
    yMin: state.yMin,
    yMax: state.yMax,
  });

  track.uplot = u;
}

function resizeAll(state, { width, height }) {
  // resize shared y-axis
  if (state.yAxis.uplot) {
    state.yAxis.root.style.height = `${height}px`;
    state.yAxis.uplot.setSize({ width: state.yAxis.width, height });
  }

  // resize tracks
  for (const t of state.tracks) {
    if (!t.uplot) continue;
    const w = width ?? t.plotEl.clientWidth ?? t.uplot.width;
    t.uplot.setSize({ width: w, height });
  }
}

function findCurve(las, mnemonicCandidates) {
  const set = new Set(mnemonicCandidates.map(s => s.toUpperCase()));
  return las.curves.find(c => set.has(c.mnemonic.toUpperCase()));
}

// Line plots (depth on y, curve on x), depth-sorted, null gaps break the line.
function createDepthVsCurvePlot({ target, depthCurve, xCurve, width, height, yMin, yMax }) {
  const depth = depthCurve.data;
  const x = xCurve.data;

  const triples = [];
  const n = Math.min(depth.length, x.length);

  for (let i = 0; i < n; i++) {
    const d = depth[i];
    const xv = x[i];

    const dOk = (d != null && Number.isFinite(d));
    const xOk = (xv != null && Number.isFinite(xv));

    if (dOk) triples.push([d, xOk ? xv : null]);
  }

  triples.sort((a, b) => a[0] - b[0]);

  const ys = new Array(triples.length);
  const xs = new Array(triples.length);

  for (let i = 0; i < triples.length; i++) {
    ys[i] = triples[i][0]; // depth (y)
    xs[i] = triples[i][1]; // curve (x) or null
  }

  const data = [ys, xs];

  let tops = []
  for(let top of window.topsData.tops) tops.push(top.topD)

  const opts = {
    width,
    height,
    scales: {
      x: {
        time: false, 
        dir: -1, ori: 1, 
        min: yMin, max: yMax, 
        range: (self, newMin, newMax) => {
            return [yMin, yMax]
        }  },
      // fixed shared depth range (tops-driven)
      y: {dir: 1, ori: 0, },
    },
    axes: [
        {
            scale: "x",
            side:3,
            grid: {show: true} ,
            values: () => [],
            size: 0
        }, {
            scale: "y",
            side:2, 
            size: 50,
            splits: (u, i, min, max) => [min, max]
        }
      // x-axis only; y-axis is shared in #yAxisDiv
      //{ scale: "x", label: `${xCurve.mnemonic}${xCurve.unit ? ` (${xCurve.unit})` : ""}` },

    ],
    series: [
      {},
      {
        label: xCurve.mnemonic,
        points: { show: false },
        spanGaps: false,
        stroke: "#D4A373",
        width: 3,
      },
    ],
    hooks: {
        draw: [
            makeHorizLinesDraw(tops), // draws your horizontal tops
        ],
    },
    legend: { show: false },
    cursor: { x: true, y: true, drag: {x: false, y: true} },
  };
 
  return new uPlot(opts, data, target);
}

function makeHorizLinesDraw(depthVals, style = {}) {
  const { stroke = "#000", width = 2, dash = null } = style;

  return (u) => {
    const { ctx, bbox } = u;
    const depthScaleKey = "x"; // depth is on x-scale in your setup

    ctx.save();
    ctx.strokeStyle = stroke;
    ctx.lineWidth = width;
    if (dash) ctx.setLineDash(dash);

    for (const d of depthVals) {
      const v = +d;
      if (!Number.isFinite(v)) continue;

      // For vertical scales, valToPos is plot-relative (0..bbox.height) in most builds
      const py = bbox.top + u.valToPos(v, depthScaleKey, true);

      if (py < bbox.top || py > bbox.top + bbox.height) continue;

      ctx.beginPath();
      ctx.moveTo(bbox.left, py);
      ctx.lineTo(bbox.left + bbox.width, py);
      ctx.stroke();
    }

    ctx.restore();
  };
}
