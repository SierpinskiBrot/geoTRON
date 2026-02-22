import { readLAS, writeLAS, readFileAsText, downloadTextFile } from "./lasio.js";
import { initFourDepthTracks } from "./multiTracks.js";
import { bindCurveEditor } from "./curveEditor.js";

let lasLoaded = false;
let topsLoaded = false;
window.las = null
let tracksCtrl;
let curveEditorCtrl;


window.addEventListener("drop", (e) => {
  if ([...e.dataTransfer.items].some((item) => item.kind === "file")) {
    e.preventDefault();
  }
});
window.addEventListener("dragover", (e) => {
  const fileItems = [...e.dataTransfer.items].filter(
    (item) => item.kind === "file",
  );
  if (fileItems.length > 0) {
    e.preventDefault();
    if (!topsFileDropZone.contains(e.target) && !lasFileDropZone.contains(e.target)) {
      e.dataTransfer.dropEffect = "none";
    }
  }
});

document.getElementById("lasFileInput").addEventListener("change", (e) => handleLasInput(e.target.files?.[0]));
document.getElementById("lasFileDropZone").addEventListener("drop", (e) => {
  e.preventDefault()
  const file = e.dataTransfer?.files?.[0]
  handleLasInput(file)})

document.getElementById("topsFileInput").addEventListener("change", (e) => handleTopsInput(e.target.files?.[0]));
document.getElementById("topsFileDropZone").addEventListener("drop", (e) => {
  e.preventDefault()
  const file = e.dataTransfer?.files?.[0]
  handleTopsInput(file)})
  
async function handleLasInput(file) {
    lasFileDropZone.innerText = shortenFileName(file.name)

    const text = await readFileAsText(file);
    window.las = readLAS(text);
    console.log(window.las)

    // Example edit: clamp GR to [0, 200]
    //const gr = las.curves.find(c => c.mnemonic.toUpperCase() === "GR");
    //if (gr) gr.data = gr.data.map(v => (Number.isFinite(v) ? Math.max(0, Math.min(200, v)) : v));

    //const out = writeLAS(las, { delimiter: "SPACE", precision: 4 });
    //downloadTextFile(out, "edited.las");


    lasLoaded = true;
    if(topsLoaded) startGraph();
}

async function handleTopsInput(file) {
  try {
    await loadTopsCsvFile(file);
    //applyDepthRangeToAllGraphs();   // next section
  } catch (err) {
    console.error(err);
    alert(String(err?.message ?? err));
  }

  topsFileDropZone.innerText = shortenFileName(file.name)

  for(let top of window.topsData.tops) {
    let row = document.createElement("tr")
    let lbl = document.createElement("td")
    let tvd = document.createElement("td")
    lbl.innerText = top.label
    tvd.innerText = top.topD
    row.appendChild(lbl)
    row.appendChild(tvd)
    document.getElementById("topsTable").appendChild(row)

  }

  topsLoaded = true
  if(lasLoaded) startGraph();
}

function startGraph() {
    tracksCtrl?.destroy?.();
    tracksCtrl = initFourDepthTracks(window.las);

    curveEditorCtrl?.destroy?.();
    curveEditorCtrl = bindCurveEditor(window.las, tracksCtrl)
}

document.getElementById("exportButton").addEventListener("click", () => {
  const out = writeLAS(window.las);
  downloadTextFile(out, "edited.las");
  // your download/export handler here
});



function parseCsvLine(line) {
  // minimal CSV parser that handles quotes
  const out = [];
  let cur = "", inQ = false;

  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (c === ',' && !inQ) {
      out.push(cur);
      cur = "";
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out;
}

async function loadTopsCsvFile(file) {
  const text = await file.text();
  const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length < 2) throw new Error("Tops CSV must have a header row and at least one data row.");

  const header = parseCsvLine(lines[0]).map(s => s.trim());
  const row    = parseCsvLine(lines[1]).map(s => s.trim());

  // column 0 expected to be Well ID
  const wellId = row[0] || null;

  const tops = [];
  for (let i = 1; i < header.length; i++) {
    const label = header[i];
    const raw = row[i] ?? "";
    const topD = raw === "" ? null : Number(raw);

    if (label && Number.isFinite(topD)) {
      tops.push({ label, topD });
    } else if (label) {
      // keep label even if missing value, if you want:
      // tops.push({ label, top: null });
    }
  }

  // compute requested y-range using only numeric tops
  const vals = tops.map(t => t.topD).filter(Number.isFinite);
  if (vals.length === 0) {
    window.topsData = { wellId, tops, yMin: null, yMax: null };
    return window.topsData;
  }

  const highestTop = Math.min(...vals); // shallowest (smallest TVD)
  const lowestTop  = Math.max(...vals); // deepest (largest TVD)

  const yMin = highestTop - 10;
  const yMax = lowestTop + 10;

  window.topsData = { wellId, tops, yMin, yMax };
  return window.topsData;
}

function shortenFileName(name) {
  if (name.length <= 20) return name;

  return (
    name.slice(0, 12) +
    "..." +
    name.slice(-5)
  );
}




