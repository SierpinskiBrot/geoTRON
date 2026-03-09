export function bindZonalStats({
  lasGetter = () => window.las,
  topsGetter = () => window.topsData,
  zonalButtonId = "zonalButton",
  cutoffInputId = "dphiCutoffInput",
  resistivitySelectorId = "resistivitySelector",
  modalId = "zonalStatsModal",
  closeBtnId = "zonalStatsClose",
  customTopAId = "zonalTopA",
  customTopBId = "zonalTopB",
  customRunBtnId = "zonalCustomRun",
  allZonesBodyId = "zonalAllZonesBody",
  customZoneBodyId = "zonalCustomZoneBody",
} = {}) {
  const zonalButton = mustEl(zonalButtonId);
  const modal = mustEl(modalId);
  const closeBtn = mustEl(closeBtnId);
  const customTopA = mustEl(customTopAId);
  const customTopB = mustEl(customTopBId);
  const customRunBtn = mustEl(customRunBtnId);
  const allZonesBody = mustEl(allZonesBodyId);
  const customZoneBody = mustEl(customZoneBodyId);

  function openModal() {
    const las = lasGetter();
    const topsData = topsGetter();

    if (!las) {
      alert("Load a LAS file first.");
      return;
    }
    if (!topsData?.tops?.length) {
      alert("Load a tops file first.");
      return;
    }

    populateTopSelectors(customTopA, customTopB, topsData.tops);
    renderAllZonesTable({ las, topsData, tbody: allZonesBody, cutoffInputId, resistivitySelectorId });
    renderCustomZone({ las, topsData, tbody: customZoneBody, topASelect: customTopA, topBSelect: customTopB, cutoffInputId, resistivitySelectorId });

    modal.classList.add("open");
    modal.setAttribute("aria-hidden", "false");
  }

  function closeModal() {
    modal.classList.remove("open");
    modal.setAttribute("aria-hidden", "true");
  }

  zonalButton.addEventListener("click", openModal);
  closeBtn.addEventListener("click", closeModal);
  customRunBtn.addEventListener("click", () => {
    const las = lasGetter();
    const topsData = topsGetter();
    if (!las || !topsData?.tops?.length) return;
    renderCustomZone({ las, topsData, tbody: customZoneBody, topASelect: customTopA, topBSelect: customTopB, cutoffInputId, resistivitySelectorId });
  });

  modal.addEventListener("mousedown", (e) => {
    if (e.target === modal) closeModal();
  });

  return {
    refresh() {
      if (!modal.classList.contains("open")) return;
      const las = lasGetter();
      const topsData = topsGetter();
      if (!las || !topsData?.tops?.length) return;
      populateTopSelectors(customTopA, customTopB, topsData.tops);
      renderAllZonesTable({ las, topsData, tbody: allZonesBody, cutoffInputId, resistivitySelectorId });
      renderCustomZone({ las, topsData, tbody: customZoneBody, topASelect: customTopA, topBSelect: customTopB, cutoffInputId, resistivitySelectorId });
    },
    destroy() {},
  };
}

function mustEl(id) {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id}`);
  return el;
}

function populateTopSelectors(selA, selB, tops) {
  const prevA = selA.value;
  const prevB = selB.value;
  const sorted = getSortedNumericTops(tops);

  selA.innerHTML = "";
  selB.innerHTML = "";

  for (const top of sorted) {
    const optA = document.createElement("option");
    optA.value = top.label;
    optA.textContent = `${top.label} (${formatNumber(top.topD, 2)} m)`;
    selA.appendChild(optA);

    const optB = document.createElement("option");
    optB.value = top.label;
    optB.textContent = `${top.label} (${formatNumber(top.topD, 2)} m)`;
    selB.appendChild(optB);
  }

  if (sorted.length >= 2) {
    selA.value = sorted.some(t => t.label === prevA) ? prevA : sorted[0].label;
    selB.value = sorted.some(t => t.label === prevB) ? prevB : sorted[sorted.length - 1].label;
  }
}

function renderAllZonesTable({ las, topsData, tbody, cutoffInputId, resistivitySelectorId }) {
  tbody.innerHTML = "";
  const sorted = getSortedNumericTops(topsData.tops);

  if (sorted.length < 2) {
    tbody.appendChild(makeMessageRow("Need at least two numeric tops."));
    return;
  }

  for (let i = 0; i < sorted.length - 1; i++) {
    const topA = sorted[i];
    const topB = sorted[i + 1];
    const stats = computeZoneStats({
      las,
      topDepthA: topA.topD,
      topDepthB: topB.topD,
      cutoff: getNumericInputValue(cutoffInputId),
      resistivityMnemonic: (mustEl(resistivitySelectorId).value || "").trim(),
    });

    tbody.appendChild(makeStatsRow({
      zoneName: `${topA.label.slice(0,-8)} -> ${topB.label.slice(0,-8)}`,
      topA,
      topB,
      stats,
    }));
  }
}

function renderCustomZone({ las, topsData, tbody, topASelect, topBSelect, cutoffInputId, resistivitySelectorId }) {
  tbody.innerHTML = "";
  const sorted = getSortedNumericTops(topsData.tops);
  if (sorted.length < 2) {
    tbody.appendChild(makeMessageRow("Need at least two numeric tops."));
    return;
  }

  const topA = sorted.find(t => t.label === topASelect.value) ?? sorted[0];
  const topB = sorted.find(t => t.label === topBSelect.value) ?? sorted[sorted.length - 1];

  if (!topA || !topB || topA.label === topB.label) {
    tbody.appendChild(makeMessageRow("Select two different tops."));
    return;
  }

  const stats = computeZoneStats({
    las,
    topDepthA: topA.topD,
    topDepthB: topB.topD,
    cutoff: getNumericInputValue(cutoffInputId),
    resistivityMnemonic: (mustEl(resistivitySelectorId).value || "").trim(),
  });

  tbody.appendChild(makeStatsRow({
    zoneName: `${topA.label} → ${topB.label}`,
    topA,
    topB,
    stats,
  }));
}

function computeZoneStats({ las, topDepthA, topDepthB, cutoff, resistivityMnemonic }) {
  const depthCurve = findCurve(las, ["DEPT", "DEPTH"]);
  const dphiCurve = findCurve(las, ["DPHIX"]);
  const swCurve = findCurve(las, ["SWARCH"]);
  const resCurve = findCurve(las, [resistivityMnemonic]);

  if (!depthCurve || !dphiCurve) {
    return emptyStats();
  }

  const depth = depthCurve.data || [];
  const dphi = dphiCurve.data || [];
  const sw = swCurve?.data || [];
  const res = resCurve?.data || [];
  const n = Math.max(depth.length, dphi.length, sw.length, res.length);

  const zTop = Math.min(topDepthA, topDepthB);
  const zBase = Math.max(topDepthA, topDepthB);

  let netPorousInterval = 0;
  let porositySum = 0;
  let porosityCount = 0;
  let resistivitySum = 0;
  let resistivityCount = 0;
  let swWeightedNumerator = 0;
  let swWeightDenominator = 0;

  for (let i = 0; i < n; i++) {
    const d = depth[i];
    const phi = dphi[i];
    if (!Number.isFinite(d) || !Number.isFinite(phi)) continue;
    if (d < zTop || d >= zBase) continue;
    if (phi <= cutoff) continue;

    netPorousInterval += phi;
    porositySum += phi;
    porosityCount += 1;

    const r = res[i];
    if (Number.isFinite(r)) {
      resistivitySum += r;
      resistivityCount += 1;
    }

    const s = sw[i];
    if (Number.isFinite(s)) {
      swWeightedNumerator += phi * s;
      swWeightDenominator += phi;
    }
  }

  return {
    netPorousInterval,
    averagePorosity: porosityCount > 0 ? porositySum / porosityCount : null,
    averageResistivity: resistivityCount > 0 ? resistivitySum / resistivityCount : null,
    averageWaterSaturation: swWeightDenominator > 0 ? swWeightedNumerator / swWeightDenominator : null,
    count: porosityCount,
  };
}

function emptyStats() {
  return {
    netPorousInterval: null,
    averagePorosity: null,
    averageResistivity: null,
    averageWaterSaturation: null,
    count: 0,
  };
}

function makeStatsRow({ zoneName, topA, topB, stats }) {
  const tr = document.createElement("tr");
  const cells = [
    zoneName,
    `${formatNumber(topA.topD, 2)}`,
    `${formatNumber(topB.topD, 2)}`,
    formatNumber(stats.netPorousInterval, 2),
    formatNumber(stats.averagePorosity, 2),
    formatNumber(stats.averageResistivity, 2),
    formatNumber(stats.averageWaterSaturation, 2),
  ];

  for (const val of cells) {
    const td = document.createElement("td");
    td.textContent = val;
    tr.appendChild(td);
  }
  return tr;
}

function makeMessageRow(message) {
  const tr = document.createElement("tr");
  const td = document.createElement("td");
  td.colSpan = 7;
  td.textContent = message;
  tr.appendChild(td);
  return tr;
}

function getSortedNumericTops(tops) {
  return [...(tops || [])]
    .filter(t => Number.isFinite(t.topD) && t.label)
    .sort((a, b) => a.topD - b.topD);
}

function getNumericInputValue(id) {
  const v = parseFloat(mustEl(id).value);
  return Number.isFinite(v) ? v : 0;
}

function findCurve(las, mnemonicCandidates) {
  const normalized = mnemonicCandidates
    .filter(Boolean)
    .map(m => String(m).toUpperCase());
  return las.curves.find(c => normalized.includes(String(c.mnemonic || "").toUpperCase()));
}

function formatNumber(v, digits = 2) {
  return Number.isFinite(v) ? Number(v).toFixed(digits) : "—";
}
