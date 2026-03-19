const verovioContainer = document.getElementById("verovioContainer");
const overlayLayer = document.getElementById("overlayLayer");
const comparisonContainer = document.getElementById("comparisonContainer");
const detailMeta = document.getElementById("detailMeta");
const comparisonCaption = document.getElementById("comparisonCaption");
const comparisonHeaderText = document.getElementById("comparisonHeaderText");
const clearSelectionBtn = document.getElementById("clearSelection");
const toggleMainCaptureBtn = document.getElementById("toggleMainCapture");
const toggleComparisonCaptureBtn = document.getElementById("toggleComparisonCapture");
const statusText = document.getElementById("statusText");
const debugSummary = document.getElementById("debugSummary");
const debugLog = document.getElementById("debugLog");

let activeOverlay = null;
let mainBars = [];
let mainCaptureMode = false;
let comparisonCaptureMode = false;
let mainCapturePoints = [];
let comparisonCapturePoints = [];
let currentComparisonLink = null;

function setDebug(summary, details = "") {
  if (debugSummary) debugSummary.innerHTML = summary;
  if (debugLog) debugLog.textContent = details;
}

function sanitiseMei(text) {
  return text.replace(/^\uFEFF/, "").replace(/<\?xml-model[\s\S]*?\?>\s*/g, "").trim();
}

async function fetchTextFile(path) {
  const response = await fetch(path);
  const rawText = await response.text();

  if (!response.ok) {
    throw new Error(`Could not load ${path} (${response.status} ${response.statusText})`);
  }

  return rawText;
}

function createToolkit(options = {}) {
  const toolkit = new verovio.toolkit();
  toolkit.setOptions({
    pageWidth: 9000,
    pageHeight: 1400,
    scale: 38,
    adjustPageHeight: true,
    breaks: "none",
    header: "none",
    footer: "none",
    mnumInterval: 1,
    ...options
  });
  return toolkit;
}

function parseBarsFromMei(meiText) {
  const parser = new DOMParser();
  const xml = parser.parseFromString(meiText, "application/xml");
  const bars = [...xml.getElementsByTagNameNS("*", "measure")];

  return bars
    .map((bar, index) => ({
      order: index + 1,
      n: Number(bar.getAttribute("n")),
      xmlId: bar.getAttribute("xml:id")
    }))
    .filter(bar => Number.isFinite(bar.n) && bar.xmlId);
}

function cssEscapeSafe(value) {
  if (window.CSS && typeof window.CSS.escape === "function") {
    return window.CSS.escape(value);
  }
  return String(value).replace(/([ #;?%&,.+*~':"!^$[\]()=>|/@])/g, "\\$1");
}

function clearSelection() {
  if (activeOverlay) activeOverlay.classList.remove("active");
  activeOverlay = null;
  currentComparisonLink = null;

  detailMeta.innerHTML = `
    <p><strong>Main work:</strong> Browne, Magnificat (E74)</p>
    <p><strong>Selected bar:</strong> None</p>
    <p><strong>Related work:</strong> None</p>
    <p><strong>Bars:</strong> —</p>
  `;

  comparisonHeaderText.textContent = "Select a highlighted bar.";
  comparisonContainer.className = "placeholder comparison-container";
  comparisonContainer.textContent = "Select a highlighted bar to load the related example.";
  comparisonCaption.textContent = "";
}

function getRenderedMainSvg() {
  return verovioContainer.querySelector("svg");
}

function getRenderedComparisonSvg() {
  return comparisonContainer.querySelector("svg");
}

function findBarGroupForXmlId(xmlId) {
  const svg = getRenderedMainSvg();
  if (!svg) return null;

  let node = null;

  try {
    node = svg.querySelector(`#${cssEscapeSafe(xmlId)}`);
  } catch {
    node = svg.querySelector(`[id="${xmlId}"]`);
  }

  if (!node) return null;
  return node.closest("g.measure") || (node.matches && node.matches("g.measure") ? node : null);
}

function getBarVerticalExtent(barNumber) {
  const bar = mainBars.find(item => item.n === barNumber);
  if (!bar) return null;

  const group = findBarGroupForXmlId(bar.xmlId);
  if (!group) return null;

  const staffGroups = [...group.children].filter(
    child => child.tagName && child.tagName.toLowerCase() === "g" && child.classList.contains("staff")
  );

  const rects = staffGroups
    .map(staff => {
      try {
        return staff.getBoundingClientRect();
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .filter(rect => rect.width > 0 && rect.height > 0);

  if (!rects.length) {
    const rect = group.getBoundingClientRect();
    return { top: rect.top, bottom: rect.bottom };
  }

  return {
    top: Math.min(...rects.map(rect => rect.top)),
    bottom: Math.max(...rects.map(rect => rect.bottom))
  };
}

function getCombinedVerticalExtent(startBar, endBar) {
  const extents = [];

  for (let n = startBar; n <= endBar; n++) {
    const extent = getBarVerticalExtent(n);
    if (extent) extents.push(extent);
  }

  if (!extents.length) return null;

  return {
    top: Math.min(...extents.map(extent => extent.top)),
    bottom: Math.max(...extents.map(extent => extent.bottom))
  };
}

function getSvgPointFromEvent(svg, event) {
  const pt = svg.createSVGPoint();
  pt.x = event.clientX;
  pt.y = event.clientY;
  return pt.matrixTransform(svg.getScreenCTM().inverse());
}

function setMainCaptureMode(on) {
  mainCaptureMode = on;
  mainCapturePoints = [];

  if (toggleMainCaptureBtn) {
    toggleMainCaptureBtn.textContent = `Capture main coords: ${on ? "on" : "off"}`;
  }

  if (on) {
    setDebug(
      "Main capture mode is on.",
      "Click the LEFT edge of a Browne hotspot, then click the RIGHT edge."
    );
  } else {
    setDebug("Main capture mode is off.", "Normal interaction restored.");
  }
}

function setComparisonCaptureMode(on) {
  comparisonCaptureMode = on;
  comparisonCapturePoints = [];

  if (toggleComparisonCaptureBtn) {
    toggleComparisonCaptureBtn.textContent = `Capture comparison box: ${on ? "on" : "off"}`;
  }

  if (on) {
    setDebug(
      "Comparison capture mode is on.",
      "Load a comparison example, then click TOP-LEFT and BOTTOM-RIGHT of the box you want."
    );
  } else {
    setDebug("Comparison capture mode is off.", "Normal interaction restored.");
  }
}

function attachMainCaptureHandler() {
  const svg = getRenderedMainSvg();
  if (!svg || svg.dataset.captureAttached === "true") return;

  svg.addEventListener(
    "click",
    event => {
      if (!mainCaptureMode) return;

      const p = getSvgPointFromEvent(svg, event);
      mainCapturePoints.push(Math.round(p.x));

      if (mainCapturePoints.length === 1) {
        setDebug(
          "Main capture: first point recorded.",
          `Left edge: ${mainCapturePoints[0]}\nNow click the right edge.`
        );
      } else if (mainCapturePoints.length === 2) {
        const left = Math.min(mainCapturePoints[0], mainCapturePoints[1]);
        const right = Math.max(mainCapturePoints[0], mainCapturePoints[1]);

        setDebug(
          "Main capture: span recorded.",
          `svgLeft: ${left}\nsvgRight: ${right}\n\nPaste into links.js like:\nsvgLeft: ${left},\nsvgRight: ${right}`
        );

        mainCapturePoints = [];
      }

      event.preventDefault();
      event.stopPropagation();
    },
    true
  );

  svg.dataset.captureAttached = "true";
}

function attachComparisonCaptureHandler() {
  const svg = getRenderedComparisonSvg();
  if (!svg || svg.dataset.captureAttached === "true") return;

  svg.addEventListener(
    "click",
    event => {
      if (!comparisonCaptureMode) return;

      const p = getSvgPointFromEvent(svg, event);
      comparisonCapturePoints.push({
        x: Math.round(p.x),
        y: Math.round(p.y)
      });

      if (comparisonCapturePoints.length === 1) {
        setDebug(
          "Comparison capture: first corner recorded.",
          `Top-left approx:\nx: ${comparisonCapturePoints[0].x}\ny: ${comparisonCapturePoints[0].y}\n\nNow click the bottom-right corner.`
        );
      } else if (comparisonCapturePoints.length === 2) {
        const p1 = comparisonCapturePoints[0];
        const p2 = comparisonCapturePoints[1];

        const x = Math.min(p1.x, p2.x);
        const y = Math.min(p1.y, p2.y);
        const width = Math.abs(p2.x - p1.x);
        const height = Math.abs(p2.y - p1.y);

        const exampleName = currentComparisonLink ? currentComparisonLink.mainBar : "current example";

        setDebug(
          "Comparison capture: box recorded.",
          `${exampleName}\n\nhighlightBoxes: [\n  { x: ${x}, y: ${y}, width: ${width}, height: ${height} }\n]`
        );

        comparisonCapturePoints = [];
      }

      event.preventDefault();
      event.stopPropagation();
    },
    true
  );

  svg.dataset.captureAttached = "true";
}

function drawComparisonHighlightBoxes(link) {
  const svg = getRenderedComparisonSvg();
  if (!svg || !Array.isArray(link.highlightBoxes) || !link.highlightBoxes.length) return;

  const svgNs = "http://www.w3.org/2000/svg";

  link.highlightBoxes.forEach(box => {
    const rect = document.createElementNS(svgNs, "rect");
    rect.setAttribute("x", box.x);
    rect.setAttribute("y", box.y);
    rect.setAttribute("width", box.width);
    rect.setAttribute("height", box.height);
    rect.setAttribute("rx", 8);
    rect.setAttribute("ry", 8);
    rect.setAttribute("fill", "rgba(255, 0, 0, 0.10)");
    rect.setAttribute("stroke", "rgba(200, 0, 0, 0.95)");
    rect.setAttribute("stroke-width", "4");
    rect.setAttribute("vector-effect", "non-scaling-stroke");
    rect.setAttribute("pointer-events", "none");
    svg.appendChild(rect);
  });
}

async function renderComparison(link) {
  comparisonContainer.className = "comparison-container comparison-panorama";
  comparisonContainer.innerHTML = `<div class="comparison-status">Loading comparison score…</div>`;

  const rawMei = await fetchTextFile(link.meiPath);
  const meiData = sanitiseMei(rawMei);

  const toolkit = createToolkit({
    pageWidth: 5000,
    pageHeight: 1100,
    scale: 40,
    breaks: "none"
  });

  const loaded = toolkit.loadData(meiData);
  const vrvLog = toolkit.getLog ? toolkit.getLog() : "(no log available)";

  if (!loaded) {
    throw new Error(`Verovio could not load comparison MEI.\n${vrvLog}`);
  }

  const pageCount = toolkit.getPageCount();
  let svgOutput = "";

  for (let i = 1; i <= pageCount; i++) {
    svgOutput += toolkit.renderToSVG(i, {});
  }

  comparisonContainer.innerHTML = `<div class="comparison-strip">${svgOutput}</div>`;
  comparisonContainer.scrollTop = 0;
  comparisonContainer.scrollLeft = 0;

  currentComparisonLink = link;
  drawComparisonHighlightBoxes(link);
  attachComparisonCaptureHandler();
}

function updateMetadata(link, overlay) {
  if (activeOverlay) activeOverlay.classList.remove("active");
  activeOverlay = overlay;
  activeOverlay.classList.add("active");

  detailMeta.innerHTML = `
    <p><strong>Main work:</strong> ${link.mainWork}</p>
    <p><strong>Selected bar:</strong> ${link.mainBar}</p>
    <p><strong>Related work:</strong> ${link.relatedWork}</p>
    <p><strong>Bars:</strong> ${link.relatedBars}</p>
  `;

  comparisonHeaderText.textContent = link.comparisonHeader || link.relatedWork;
  comparisonCaption.textContent = link.note || "";
}

function buildMainOverlays() {
  overlayLayer.innerHTML = "";

  const scoreShell = document.getElementById("scoreShell");
  const scoreShellRect = scoreShell.getBoundingClientRect();
  const svg = getRenderedMainSvg();
  if (!svg) return;

  const infoLines = [];

  window.measureLinks.forEach(link => {
    if (typeof link.svgLeft !== "number" || typeof link.svgRight !== "number") {
      infoLines.push(`${link.mainBar}: missing manual SVG coordinates`);
      return;
    }

    const extent = getCombinedVerticalExtent(link.startMeasure, link.endMeasure);
    if (!extent) {
      infoLines.push(`${link.mainBar}: vertical extent not found`);
      return;
    }

    const p1 = svg.createSVGPoint();
    p1.x = link.svgLeft;
    p1.y = 0;

    const p2 = svg.createSVGPoint();
    p2.x = link.svgRight;
    p2.y = 0;

    const s1 = p1.matrixTransform(svg.getScreenCTM());
    const s2 = p2.matrixTransform(svg.getScreenCTM());

    const left = Math.min(s1.x, s2.x) - scoreShellRect.left;
    const width = Math.abs(s2.x - s1.x);
    const top = extent.top - scoreShellRect.top;
    const height = extent.bottom - extent.top;

    const overlay = document.createElement("button");
    overlay.type = "button";
    overlay.className = "measure-overlay";
    overlay.setAttribute("aria-label", `${link.mainBar}: show comparison passage`);
    overlay.innerHTML = `<span class="measure-label">${link.label}</span>`;

    overlay.style.left = `${left}px`;
    overlay.style.top = `${top}px`;
    overlay.style.width = `${width}px`;
    overlay.style.height = `${height}px`;

    overlay.addEventListener("click", async () => {
      if (mainCaptureMode) return;

      try {
        await renderComparison(link);
        updateMetadata(link, overlay);
      } catch (error) {
        comparisonContainer.className = "comparison-container";
        comparisonContainer.innerHTML = `
          <div class="error-box">
            <strong>Comparison score could not be rendered.</strong><br><br>
            Check <code>${link.meiPath}</code>.
          </div>
        `;
        setDebug("<strong>Comparison render failed.</strong>", error.message || String(error));
      }
    });

    overlayLayer.appendChild(overlay);
    infoLines.push(`${link.mainBar}: using manual SVG coordinates ${link.svgLeft}–${link.svgRight}`);
  });

  setDebug(
    `Main score rendered. Parsed <strong>${mainBars.length}</strong> bars.`,
    infoLines.join("\n")
  );
}

async function renderMainScore() {
  if (!window.verovio || !window.verovio.toolkit) {
    throw new Error("Verovio is not available in the page.");
  }

  statusText.textContent = "Loading score…";

  const rawMei = await fetchTextFile(window.MAIN_MEI_PATH);
  const meiData = sanitiseMei(rawMei);
  mainBars = parseBarsFromMei(meiData);

  const toolkit = createToolkit();
  const loaded = toolkit.loadData(meiData);
  const vrvLog = toolkit.getLog ? toolkit.getLog() : "(no log available)";

  if (!loaded) {
    throw new Error(`Verovio could not load the main MEI.\n${vrvLog}`);
  }

  const pageCount = toolkit.getPageCount();
  let svgOutput = "";

  for (let i = 1; i <= pageCount; i++) {
    svgOutput += toolkit.renderToSVG(i, {});
  }

  verovioContainer.innerHTML = svgOutput;

  if (!getRenderedMainSvg()) {
    throw new Error("No SVG returned for main score.");
  }

  attachMainCaptureHandler();
  buildMainOverlays();
  statusText.textContent = "Ready. Scroll horizontally, hover over a highlighted bar, then click.";
}

async function initEdition() {
  clearSelection();

  try {
    await renderMainScore();
  } catch (error) {
    statusText.textContent = "Score failed to load.";
    verovioContainer.innerHTML = `
      <div class="error-box">
        <strong>The main score could not be rendered.</strong><br><br>
        Check the browser console.
      </div>
    `;
    overlayLayer.innerHTML = "";
    setDebug("<strong>Main render failed.</strong>", error.message || String(error));
  }
}

if (clearSelectionBtn) {
  clearSelectionBtn.addEventListener("click", clearSelection);
}

if (toggleMainCaptureBtn) {
  toggleMainCaptureBtn.addEventListener("click", () => setMainCaptureMode(!mainCaptureMode));
}

if (toggleComparisonCaptureBtn) {
  toggleComparisonCaptureBtn.addEventListener("click", () => setComparisonCaptureMode(!comparisonCaptureMode));
}

document.addEventListener("DOMContentLoaded", () => {
  if (!window.verovio || !window.verovio.module) {
    setDebug(
      "<strong>Verovio script did not load.</strong>",
      "Check the browser console and your network connection."
    );
    statusText.textContent = "Verovio failed to load.";
    return;
  }

  window.verovio.module.onRuntimeInitialized = () => {
    initEdition();
  };
});
