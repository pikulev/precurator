import type { AeolusReport } from "./report-data";

function escapeJsonForHtml(json: string): string {
  return json.replace(/<\/script/giu, "<\\/script");
}

export function renderAeolusDashboard(report: AeolusReport): string {
  const payload = escapeJsonForHtml(JSON.stringify(report));

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Aeolus Dashboard</title>
    <style>
      :root {
        color-scheme: dark;
        --bg: #0f172a;
        --panel: #111827;
        --panel-border: #334155;
        --text: #e5e7eb;
        --muted: #94a3b8;
        --accent: #38bdf8;
        --actual: #60a5fa;
        --ghost: rgba(203, 213, 225, 0.8);
        --preview: rgba(148, 163, 184, 0.75);
        --control: #22c55e;
        --noise: #ef4444;
        --alert: #fb923c;
        --target: #f87171;
        --target-zone-fill: rgba(248, 113, 113, 0.18);
        --target-zone-stroke: rgba(252, 165, 165, 0.9);
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: radial-gradient(circle at top, #1e293b, var(--bg) 55%);
        color: var(--text);
      }

      .page {
        display: grid;
        grid-template-columns: minmax(420px, 1.4fr) minmax(320px, 1fr);
        min-height: 100vh;
        gap: 16px;
        padding: 16px;
      }

      .panel {
        background: rgba(15, 23, 42, 0.88);
        border: 1px solid var(--panel-border);
        border-radius: 16px;
        padding: 16px;
        box-shadow: 0 20px 40px rgba(2, 6, 23, 0.25);
      }

      .stack {
        display: grid;
        gap: 16px;
      }

      h1, h2, h3, p {
        margin: 0;
      }

      .fieldPanel {
        display: grid;
        gap: 12px;
      }

      .toolbar {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        align-items: center;
        justify-content: space-between;
      }

      .toolbarGroup {
        display: flex;
        gap: 12px;
        align-items: center;
      }

      button, select, input[type="range"] {
        accent-color: var(--accent);
      }

      button {
        border: 1px solid var(--panel-border);
        background: #1e293b;
        color: var(--text);
        padding: 8px 12px;
        border-radius: 10px;
        cursor: pointer;
      }

      .fieldMeta {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        color: var(--muted);
        font-size: 14px;
      }

      .badge {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        border-radius: 999px;
        padding: 4px 10px;
        border: 1px solid var(--panel-border);
        background: rgba(30, 41, 59, 0.85);
      }

      .badge strong {
        color: var(--text);
      }

      .fieldSvg {
        width: 100%;
        max-width: 100%;
        background:
          linear-gradient(rgba(148, 163, 184, 0.12) 1px, transparent 1px),
          linear-gradient(90deg, rgba(148, 163, 184, 0.12) 1px, transparent 1px),
          linear-gradient(180deg, rgba(15, 23, 42, 0.7), rgba(15, 23, 42, 0.95));
        background-size: 42px 42px, 42px 42px, auto;
        border: 1px solid var(--panel-border);
        border-radius: 14px;
      }

      .charts {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 12px;
      }

      .chartCard {
        background: rgba(2, 6, 23, 0.35);
        border: 1px solid rgba(51, 65, 85, 0.8);
        border-radius: 12px;
        padding: 12px;
      }

      .chartTitle {
        margin-bottom: 8px;
        color: var(--muted);
        font-size: 13px;
      }

      .telemetryGrid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 12px;
      }

      .metricCard {
        background: rgba(2, 6, 23, 0.35);
        border: 1px solid rgba(51, 65, 85, 0.8);
        border-radius: 12px;
        padding: 12px;
      }

      .metricLabel {
        color: var(--muted);
        font-size: 13px;
        margin-bottom: 6px;
      }

      .metricValue {
        font-size: 22px;
        font-weight: 700;
      }

      .reasoning {
        display: grid;
        gap: 12px;
      }

      .reasoningTrace {
        min-height: 120px;
        border: 1px solid rgba(51, 65, 85, 0.8);
        background: rgba(2, 6, 23, 0.45);
        border-radius: 12px;
        padding: 12px;
        line-height: 1.5;
        color: #dbeafe;
        white-space: pre-wrap;
      }

      .auditTableWrap {
        max-height: 320px;
        overflow: auto;
        border: 1px solid rgba(51, 65, 85, 0.8);
        border-radius: 12px;
      }

      table {
        width: 100%;
        border-collapse: collapse;
        font-size: 13px;
      }

      th, td {
        text-align: left;
        padding: 10px 12px;
        border-bottom: 1px solid rgba(51, 65, 85, 0.6);
      }

      th {
        position: sticky;
        top: 0;
        background: #111827;
        color: var(--muted);
      }

      tr.activeRow {
        background: rgba(56, 189, 248, 0.08);
      }

      .toast {
        position: fixed;
        right: 20px;
        bottom: 20px;
        max-width: 320px;
        padding: 12px 14px;
        border-radius: 12px;
        border: 1px solid rgba(148, 163, 184, 0.35);
        background: rgba(15, 23, 42, 0.95);
        color: var(--text);
        box-shadow: 0 16px 32px rgba(2, 6, 23, 0.45);
        opacity: 0;
        transform: translateY(8px);
        transition: opacity 180ms ease, transform 180ms ease;
        pointer-events: none;
      }

      .toast.visible {
        opacity: 1;
        transform: translateY(0);
      }

      .alertBanner {
        display: none;
        border: 1px solid rgba(251, 146, 60, 0.5);
        background: rgba(124, 45, 18, 0.35);
        color: #fdba74;
        border-radius: 12px;
        padding: 12px;
      }

      .alertBanner.visible {
        display: block;
      }

      .notes {
        display: grid;
        gap: 8px;
        color: var(--muted);
        font-size: 14px;
      }

      .legend {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        color: var(--muted);
        font-size: 13px;
      }

      .legendItem {
        display: inline-flex;
        align-items: center;
        gap: 8px;
      }

      .legendSwatch {
        width: 12px;
        height: 12px;
        border-radius: 999px;
      }

      .legendSwatchZone {
        background: var(--target-zone-fill);
        border: 1px solid var(--target-zone-stroke);
      }

      @media (max-width: 1100px) {
        .page {
          grid-template-columns: 1fr;
        }

        .charts, .telemetryGrid {
          grid-template-columns: 1fr;
        }
      }
    </style>
  </head>
  <body>
    <div class="page">
      <section class="panel fieldPanel">
        <div class="toolbar">
          <div>
            <h1>Aeolus Dashboard</h1>
            <p style="margin-top: 6px; color: var(--muted);">Predictor vs Reality under turbulent disturbance.</p>
          </div>
          <div class="toolbarGroup">
            <label>
              <span style="display:block; font-size:12px; color: var(--muted); margin-bottom:4px;">Run</span>
              <select id="runSelect">
                <option value="reality">Reality</option>
                <option value="simulation">Simulation</option>
              </select>
            </label>
            <button id="playPauseButton" type="button">Pause</button>
          </div>
        </div>

        <div class="fieldMeta">
          <span class="badge"><strong id="statusValue">optimizing</strong></span>
          <span class="badge">Step <strong id="stepValue">0</strong></span>
          <span class="badge">Checkpoint <strong id="checkpointValue">n/a</strong></span>
          <span class="badge">Mode <strong id="modeValue">reality</strong></span>
          <span class="badge"><span id="goalZoneSummary">Goal zone radius 0.00u</span></span>
        </div>

        <input id="stepSlider" type="range" min="0" max="0" value="0" />

        <svg id="fieldSvg" class="fieldSvg" viewBox="0 0 420 420" aria-label="Aeolus field">
          <defs>
            <marker id="arrowControl" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
              <path d="M0,0 L0,6 L6,3 z" fill="var(--control)"></path>
            </marker>
            <marker id="arrowNoise" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
              <path d="M0,0 L0,6 L6,3 z" fill="var(--noise)"></path>
            </marker>
          </defs>
          <rect x="10" y="10" width="400" height="400" rx="12" ry="12" fill="transparent" stroke="rgba(148,163,184,0.4)"></rect>
          <circle id="goalZone" fill="var(--target-zone-fill)" stroke="var(--target-zone-stroke)" stroke-width="2" stroke-dasharray="8 6"></circle>
          <g id="previewPathLayer"></g>
          <g id="actualPathLayer"></g>
          <g id="ghostPathLayer"></g>
          <line id="alertLink" x1="0" y1="0" x2="0" y2="0" stroke="transparent" stroke-width="3" stroke-dasharray="7 5"></line>
          <circle id="targetCenter" r="5" fill="var(--target)" stroke="#fee2e2" stroke-width="2"></circle>
          <circle id="ghostBall" r="9" fill="var(--ghost)"></circle>
          <circle id="actualBall" r="10" fill="var(--actual)"></circle>
          <line id="controlVector" x1="0" y1="0" x2="0" y2="0" stroke="var(--control)" stroke-width="4" marker-end="url(#arrowControl)"></line>
          <line id="noiseVector" x1="0" y1="0" x2="0" y2="0" stroke="var(--noise)" stroke-width="4" stroke-dasharray="4 4" marker-end="url(#arrowNoise)"></line>
        </svg>

        <div class="legend">
          <span class="legendItem"><span class="legendSwatch legendSwatchZone"></span>Goal Zone</span>
          <span class="legendItem"><span class="legendSwatch" style="background: var(--target);"></span>Goal Center</span>
          <span class="legendItem"><span class="legendSwatch" style="background: var(--actual);"></span>Actual State</span>
          <span class="legendItem"><span class="legendSwatch" style="background: rgba(203, 213, 225, 0.8);"></span>Ghost Prediction</span>
          <span class="legendItem"><span class="legendSwatch" style="background: var(--control);"></span>Control Force</span>
          <span class="legendItem"><span class="legendSwatch" style="background: var(--noise);"></span>Chaos Force</span>
        </div>
      </section>

      <section class="stack">
        <section class="panel">
          <h2>Cybernetic Basis</h2>
          <div class="telemetryGrid" style="margin-top: 12px;">
            <div class="metricCard">
              <div class="metricLabel">Error Score</div>
              <div class="metricValue" id="errorScoreValue">0.000</div>
            </div>
            <div class="metricCard">
              <div class="metricLabel">Delta Error</div>
              <div class="metricValue" id="deltaErrorValue">0.000</div>
            </div>
            <div class="metricCard">
              <div class="metricLabel">Disturbance Delta</div>
              <div class="metricValue" id="disturbanceValue">+0.00, +0.00</div>
            </div>
            <div class="metricCard">
              <div class="metricLabel">Trend</div>
              <div class="metricValue" id="trendValue">flat</div>
            </div>
          </div>

          <div class="charts" style="margin-top: 12px;">
            <div class="chartCard">
              <div class="chartTitle">Error Score</div>
              <svg id="errorChart" viewBox="0 0 320 120"></svg>
            </div>
            <div class="chartCard">
              <div class="chartTitle">Delta Error</div>
              <svg id="deltaChart" viewBox="0 0 320 120"></svg>
            </div>
          </div>
        </section>

        <section class="panel reasoning">
          <div>
            <h2>Reasoning Trace</h2>
            <p style="margin-top: 6px; color: var(--muted);">The example stores predictor reasoning, verifier alerts and bounded-memory compaction hints outside prompt-facing state.</p>
          </div>
          <div id="alertBanner" class="alertBanner"></div>
          <div id="reasoningTrace" class="reasoningTrace"></div>
        </section>

        <section class="panel">
          <div style="display:flex; justify-content:space-between; align-items:center; gap:12px;">
            <div>
              <h2>Audit Log</h2>
              <p style="margin-top:6px; color: var(--muted);">Includes the requested Disturbance Delta column.</p>
            </div>
          </div>
          <div class="auditTableWrap" style="margin-top: 12px;">
            <table>
              <thead>
                <tr>
                  <th>Step</th>
                  <th>Disturbance Delta</th>
                  <th>Expected</th>
                  <th>Actual</th>
                  <th>Error</th>
                  <th>Delta</th>
                  <th>Trend</th>
                </tr>
              </thead>
              <tbody id="auditLogBody"></tbody>
            </table>
          </div>
        </section>

        <section class="panel">
          <h2>Notes</h2>
          <div id="notes" class="notes" style="margin-top: 12px;"></div>
        </section>
      </section>
    </div>

    <div id="toast" class="toast"></div>
    <script id="aeolus-report-data" type="application/json">${payload}</script>
    <script>
      const report = JSON.parse(document.getElementById("aeolus-report-data").textContent);
      const runSelect = document.getElementById("runSelect");
      const playPauseButton = document.getElementById("playPauseButton");
      const stepSlider = document.getElementById("stepSlider");
      const stepValue = document.getElementById("stepValue");
      const statusValue = document.getElementById("statusValue");
      const checkpointValue = document.getElementById("checkpointValue");
      const modeValue = document.getElementById("modeValue");
      const errorScoreValue = document.getElementById("errorScoreValue");
      const deltaErrorValue = document.getElementById("deltaErrorValue");
      const disturbanceValue = document.getElementById("disturbanceValue");
      const trendValue = document.getElementById("trendValue");
      const goalZoneSummary = document.getElementById("goalZoneSummary");
      const reasoningTrace = document.getElementById("reasoningTrace");
      const alertBanner = document.getElementById("alertBanner");
      const auditLogBody = document.getElementById("auditLogBody");
      const toast = document.getElementById("toast");
      const goalZone = document.getElementById("goalZone");
      const previewPathLayer = document.getElementById("previewPathLayer");
      const actualPathLayer = document.getElementById("actualPathLayer");
      const ghostPathLayer = document.getElementById("ghostPathLayer");
      const actualBall = document.getElementById("actualBall");
      const ghostBall = document.getElementById("ghostBall");
      const targetCenter = document.getElementById("targetCenter");
      const controlVector = document.getElementById("controlVector");
      const noiseVector = document.getElementById("noiseVector");
      const alertLink = document.getElementById("alertLink");
      const errorChart = document.getElementById("errorChart");
      const deltaChart = document.getElementById("deltaChart");
      const notesRoot = document.getElementById("notes");
      const goalZoneMeta = report.visualization.goalZone;

      let activeRunKey = "reality";
      let stepIndex = 0;
      let playing = true;
      let timer = null;
      let lastToastMessage = "";

      function pointToSvg(point) {
        const padding = 10;
        const size = 400;
        const min = report.target.fieldMin;
        const max = report.target.fieldMax;
        const clampedX = Math.min(max, Math.max(min, point.x));
        const clampedY = Math.min(max, Math.max(min, point.y));
        const x = padding + ((clampedX - min) / (max - min)) * size;
        const y = padding + (1 - (clampedY - min) / (max - min)) * size;
        return { x, y };
      }

      function worldRadiusToSvg(worldRadius) {
        const size = 400;
        const min = report.target.fieldMin;
        const max = report.target.fieldMax;
        return (worldRadius / (max - min)) * size;
      }

      function createPath(points, color, dashArray, width) {
        if (points.length === 0) {
          return "";
        }

        const d = points
          .map((point, index) => {
            const projected = pointToSvg(point);
            return \`\${index === 0 ? "M" : "L"} \${projected.x.toFixed(2)} \${projected.y.toFixed(2)}\`;
          })
          .join(" ");

        return \`<path d="\${d}" fill="none" stroke="\${color}" stroke-width="\${width}" \${dashArray ? \`stroke-dasharray="\${dashArray}"\` : ""} stroke-linecap="round" stroke-linejoin="round"></path>\`;
      }

      function setCirclePosition(node, point) {
        const projected = pointToSvg(point);
        node.setAttribute("cx", projected.x);
        node.setAttribute("cy", projected.y);
      }

      function setCircleRadius(node, worldRadius) {
        node.setAttribute("r", worldRadiusToSvg(worldRadius));
      }

      function setVector(node, origin, vector, scaleMultiplier) {
        const from = pointToSvg(origin);
        const to = pointToSvg({
          x: origin.x + vector.x * scaleMultiplier,
          y: origin.y + vector.y * scaleMultiplier
        });
        node.setAttribute("x1", from.x);
        node.setAttribute("y1", from.y);
        node.setAttribute("x2", to.x);
        node.setAttribute("y2", to.y);
      }

      function setAlertLink(step) {
        const actual = pointToSvg(step.actualPosition);
        const predicted = pointToSvg(step.predictedPosition);
        alertLink.setAttribute("x1", actual.x);
        alertLink.setAttribute("y1", actual.y);
        alertLink.setAttribute("x2", predicted.x);
        alertLink.setAttribute("y2", predicted.y);
        const hasAlert = Boolean(step.verifierAlert);
        alertLink.setAttribute("stroke", hasAlert ? "var(--alert)" : "transparent");
      }

      function renderAuditLog(run, activeStep) {
        auditLogBody.innerHTML = run.auditLog
          .map((row) => \`
            <tr class="\${row.k === activeStep.k ? "activeRow" : ""}">
              <td>\${row.k}</td>
              <td>\${row.disturbanceDelta}</td>
              <td>\${row.expectedPosition}</td>
              <td>\${row.actualPosition}</td>
              <td>\${row.errorScore}</td>
              <td>\${row.deltaError}</td>
              <td>\${row.errorTrend}</td>
            </tr>
          \`)
          .join("");
      }

      function renderLineChart(svgNode, values, color) {
        const width = 320;
        const height = 120;
        const padding = 12;
        const cleanValues = values.map((value) => (typeof value === "number" ? value : 0));
        const maxValue = Math.max(1, ...cleanValues.map((value) => Math.abs(value)));
        const points = cleanValues.map((value, index) => {
          const x = padding + ((width - padding * 2) * index) / Math.max(1, cleanValues.length - 1);
          const normalized = (value + maxValue) / (maxValue * 2);
          const y = height - padding - normalized * (height - padding * 2);
          return { x, y };
        });
        const path = points
          .map((point, index) => \`\${index === 0 ? "M" : "L"} \${point.x.toFixed(2)} \${point.y.toFixed(2)}\`)
          .join(" ");
        const midline = height / 2;
        svgNode.innerHTML = \`
          <line x1="\${padding}" y1="\${midline}" x2="\${width - padding}" y2="\${midline}" stroke="rgba(148,163,184,0.25)" stroke-width="1"></line>
          <path d="\${path}" fill="none" stroke="\${color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"></path>
        \`;
      }

      function showToast(message) {
        if (!message || message === lastToastMessage) {
          return;
        }

        lastToastMessage = message;
        toast.textContent = message;
        toast.classList.add("visible");
        window.clearTimeout(showToast.timeoutId);
        showToast.timeoutId = window.setTimeout(() => {
          toast.classList.remove("visible");
        }, 2200);
      }

      function activeRun() {
        return report.runs[activeRunKey];
      }

      function renderNotes() {
        notesRoot.innerHTML = report.notes.map((note) => \`<div>\${note}</div>\`).join("");
      }

      function render() {
        const run = activeRun();
        const steps = run.steps;
        if (steps.length === 0) {
          return;
        }

        stepIndex = Math.min(stepIndex, steps.length - 1);
        stepSlider.max = String(Math.max(0, steps.length - 1));
        stepSlider.value = String(stepIndex);

        const step = steps[stepIndex];
        const actualPath = steps.slice(0, stepIndex + 1).map((entry) => entry.actualPosition);
        const ghostPath = steps.slice(0, stepIndex + 1).map((entry) => entry.predictedPosition);
        const previewPath = run.previewPath;

        previewPathLayer.innerHTML = createPath(previewPath, "var(--preview)", "6 4", 2);
        actualPathLayer.innerHTML = createPath(actualPath, "var(--actual)", "", 3);
        ghostPathLayer.innerHTML = createPath(ghostPath, "rgba(203, 213, 225, 0.65)", "5 4", 2);

        setCirclePosition(goalZone, report.target.target);
        setCircleRadius(goalZone, goalZoneMeta.successRadiusWorld);
        setCirclePosition(targetCenter, report.target.target);
        setCirclePosition(actualBall, step.actualPosition);
        setCirclePosition(ghostBall, step.predictedPosition);
        setVector(controlVector, step.actualPosition, step.controlForce, 1);
        setVector(noiseVector, step.predictedPosition, step.noiseForce, 1);
        setAlertLink(step);

        stepValue.textContent = String(step.k);
        statusValue.textContent = step.status || run.finalStatus;
        checkpointValue.textContent = step.checkpointId || "n/a";
        modeValue.textContent = activeRunKey;
        goalZoneSummary.textContent =
          goalZoneMeta.label +
          ": " +
          goalZoneMeta.successRadiusWorld.toFixed(2) +
          "u radius, reach at error <= " +
          goalZoneMeta.epsilon.toFixed(2);
        errorScoreValue.textContent = typeof step.errorScore === "number" ? step.errorScore.toFixed(3) : "n/a";
        deltaErrorValue.textContent = typeof step.deltaError === "number" ? step.deltaError.toFixed(3) : "n/a";
        disturbanceValue.textContent = \`\${step.disturbanceDelta.x >= 0 ? "+" : ""}\${step.disturbanceDelta.x.toFixed(2)}, \${step.disturbanceDelta.y >= 0 ? "+" : ""}\${step.disturbanceDelta.y.toFixed(2)}\`;
        trendValue.textContent = step.errorTrend || "n/a";

        const details = [];
        details.push(step.reasoningTrace);
        if (step.diagnosticsCode) {
          details.push(\`Diagnostics: \${step.diagnosticsCode}\`);
        }
        reasoningTrace.textContent = details.join("\\n\\n");

        const hasAlert = Boolean(step.verifierAlert);
        alertBanner.classList.toggle("visible", hasAlert);
        alertBanner.textContent = hasAlert ? step.verifierAlert : "";

        renderAuditLog(run, step);
        renderLineChart(errorChart, steps.map((entry) => entry.errorScore), "var(--accent)");
        renderLineChart(deltaChart, steps.map((entry) => entry.deltaError), "var(--alert)");

        if (step.compactionToast) {
          showToast(step.compactionToast);
        }
      }

      function startPlayback() {
        if (timer) {
          window.clearInterval(timer);
        }

        timer = window.setInterval(() => {
          const run = activeRun();
          if (!playing || run.steps.length === 0) {
            return;
          }

          stepIndex = (stepIndex + 1) % run.steps.length;
          render();
        }, 450);
      }

      runSelect.addEventListener("change", () => {
        activeRunKey = runSelect.value;
        stepIndex = 0;
        lastToastMessage = "";
        render();
        startPlayback();
      });

      playPauseButton.addEventListener("click", () => {
        playing = !playing;
        playPauseButton.textContent = playing ? "Pause" : "Play";
      });

      stepSlider.addEventListener("input", () => {
        stepIndex = Number(stepSlider.value);
        render();
      });

      renderNotes();
      render();
      startPlayback();
    </script>
  </body>
</html>`;
}
