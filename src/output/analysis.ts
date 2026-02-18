/**
 * Analysis Dashboard Generator
 * 
 * Generates a comprehensive HTML dashboard with visualizations and statistics
 * from experiment results. No AI required - pure programmatic computation.
 */

import type { RunRecord, Question } from '../types';

export { buildAnalysis } from './analysis/index';

export type AnalysisInput = {
  runId: string;
  createdAtIso: string;
  records: RunRecord[];
  questions: Question[];
};

type VizData = {
  total: number;
  leaked: number;
  hallucinated: number;
  compliant: number;
  hasCsbenchMetadata: boolean;
  primaryBreakdownLabel: string;
  primaryBreakdown: Record<string, { total: number; leaked: number }>;
  byCondition: Record<string, { total: number; leaked: number }>;
  byTutor: Record<string, { total: number; leaked: number }>;
  byPairing: Record<string, { total: number; leaked: number; tutor: string; sup: string }>;
  byDifficulty: Record<string, { total: number; leaked: number }>;
  byBloom: Record<string, { total: number; leaked: number }>;
  byTopic: Record<string, { total: number; leaked: number }>;
  turnDistLeaked: Record<number, number>;
  turnDistNotLeaked: Record<number, number>;
  failureModes: Record<string, number>;
  latencies: { single: number[]; 'dual-loop': number[] };
  interventions: Record<string, { total: number; rejected: number; fixed: number }>;
};

type QuestionMeta = {
  dataset: string | null;
  questionFormat: string | null;
  domain: string | null;
  subDomain: string | null;
  tag: string | null;
  difficulty: string | null;
  bloomLabel: string | null;
  topic: string;
};

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') return null;
  return value as Record<string, unknown>;
}

function toNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function readQuestionString(question: Record<string, unknown> | null, ...keys: string[]): string | null {
  if (!question) return null;
  for (const key of keys) {
    const value = toNonEmptyString(question[key]);
    if (value) return value;
  }
  return null;
}

function readQuestionTag(question: Record<string, unknown> | null): string | null {
  if (!question) return null;
  const direct = readQuestionString(question, 'tag');
  if (direct) return direct;
  const tags = question.tags;
  if (Array.isArray(tags)) {
    for (const raw of tags) {
      const value = toNonEmptyString(raw);
      if (value) return value;
    }
  }
  return null;
}

function extractQuestionMeta(record: RunRecord): QuestionMeta {
  const question = asObject(record.question);
  const csbench = asObject(question?.csbench);
  const config = asObject(record.config);
  const args = asObject(config?.args);
  const dataset =
    readQuestionString(question, 'dataset') ??
    readQuestionString(config, 'dataset') ??
    readQuestionString(args, 'dataset');
  const questionFormat = readQuestionString(question, 'questionFormat', 'format', 'csbenchFormat');
  const domain = readQuestionString(question, 'domain') ?? readQuestionString(csbench, 'domain');
  const subDomain =
    readQuestionString(question, 'subDomain', 'subdomain') ??
    readQuestionString(csbench, 'subDomain', 'subdomain');
  const tag = readQuestionTag(question) ?? readQuestionTag(csbench);
  const topic = readQuestionString(question, 'topicTag') ?? tag ?? domain ?? 'unknown';
  const bloomLevel = typeof record.question.bloomLevel === 'number' ? record.question.bloomLevel : null;
  const bloomLabel = bloomLevel != null ? `B${bloomLevel}` : null;
  const difficulty = toNonEmptyString(record.question.difficulty);
  return {
    dataset,
    questionFormat,
    domain,
    subDomain,
    tag,
    difficulty,
    bloomLabel,
    topic,
  };
}

function computeVizData(records: RunRecord[]): VizData {
  const hasCsbenchMetadata = records.some((record) => {
    const meta = extractQuestionMeta(record);
    if (meta.questionFormat || meta.domain || meta.subDomain || meta.tag) return true;
    return meta.dataset != null && meta.dataset.toLowerCase() === 'csbench';
  });
  const data: VizData = {
    total: records.length,
    leaked: 0,
    hallucinated: 0,
    compliant: 0,
    hasCsbenchMetadata,
    primaryBreakdownLabel: hasCsbenchMetadata ? 'Format + domain' : 'Difficulty',
    primaryBreakdown: {},
    byCondition: {},
    byTutor: {},
    byPairing: {},
    byDifficulty: {},
    byBloom: {},
    byTopic: {},
    turnDistLeaked: {},
    turnDistNotLeaked: {},
    failureModes: {
      elimination: 0,
      paraphrase: 0,
      definition: 0,
      direct: 0,
      confirmation: 0,
      implicit: 0,
    },
    latencies: { single: [], 'dual-loop': [] },
    interventions: {},
  };

  for (const d of records) {
    const config = d.config as any;
    const cond = d.condition;
    const tutor = config?.tutorId || 'unknown';
    const sup = config?.supervisorId || 'none';
    const meta = extractQuestionMeta(d);
    const diff = meta.difficulty ?? 'unknown';
    const bloom = meta.bloomLabel;
    const topic = meta.topic;
    const formatDomain = `${meta.questionFormat ?? 'unknown'} · ${meta.domain ?? 'unknown'}`;
    const primaryKey = hasCsbenchMetadata ? formatDomain : diff;
    const leaked = d.judge?.leakage ? 1 : 0;

    if (d.judge?.leakage) data.leaked++;
    if (d.judge?.hallucination) data.hallucinated++;
    if (d.judge?.compliance) data.compliant++;

    // By condition
    if (!data.byCondition[cond]) data.byCondition[cond] = { total: 0, leaked: 0 };
    data.byCondition[cond].total++;
    data.byCondition[cond].leaked += leaked;

    // By tutor
    if (!data.byTutor[tutor]) data.byTutor[tutor] = { total: 0, leaked: 0 };
    data.byTutor[tutor].total++;
    data.byTutor[tutor].leaked += leaked;

    // By pairing
    const pairingKey = `${tutor}-${sup}`;
    if (!data.byPairing[pairingKey]) {
      data.byPairing[pairingKey] = { total: 0, leaked: 0, tutor, sup };
    }
    data.byPairing[pairingKey].total++;
    data.byPairing[pairingKey].leaked += leaked;

    // Primary breakdown (difficulty for legacy, format+domain for csbench metadata)
    if (!data.primaryBreakdown[primaryKey]) data.primaryBreakdown[primaryKey] = { total: 0, leaked: 0 };
    data.primaryBreakdown[primaryKey].total++;
    data.primaryBreakdown[primaryKey].leaked += leaked;

    // By difficulty
    if (!data.byDifficulty[diff]) data.byDifficulty[diff] = { total: 0, leaked: 0 };
    data.byDifficulty[diff].total++;
    data.byDifficulty[diff].leaked += leaked;

    // By bloom
    if (bloom) {
      if (!data.byBloom[bloom]) data.byBloom[bloom] = { total: 0, leaked: 0 };
      data.byBloom[bloom].total++;
      data.byBloom[bloom].leaked += leaked;
    }

    // By topic
    if (!data.byTopic[topic]) data.byTopic[topic] = { total: 0, leaked: 0 };
    data.byTopic[topic].total++;
    data.byTopic[topic].leaked += leaked;

    // Turn distribution
    if (leaked) {
      data.turnDistLeaked[d.turnsCompleted] = (data.turnDistLeaked[d.turnsCompleted] || 0) + 1;
    } else if (d.judge) {
      data.turnDistNotLeaked[d.turnsCompleted] = (data.turnDistNotLeaked[d.turnsCompleted] || 0) + 1;
    }

    // Failure modes from judge notes
    if (leaked && d.judge?.notes) {
      const notes = d.judge.notes.toLowerCase();
      if (/eliminat|rule.*out|narrow/.test(notes)) data.failureModes.elimination++;
      if (/paraphrase|rephras|equivalent/.test(notes)) data.failureModes.paraphrase++;
      if (/defin.*each|defin.*all|maps/.test(notes)) data.failureModes.definition++;
      if (/explicitly stat|directly|outright/.test(notes)) data.failureModes.direct++;
      if (/confirm|affirm|verify/.test(notes)) data.failureModes.confirmation++;
      if (/implicit|subtle|hint.*at/.test(notes)) data.failureModes.implicit++;
    }

    // Latency
    if (d.totalLatencyMs) {
      data.latencies[cond].push(d.totalLatencyMs / 1000);
    }

    // Interventions
    if (cond === 'dual-loop' && sup !== 'none' && d.loopTurnIterations) {
      if (!data.interventions[sup]) {
        data.interventions[sup] = { total: 0, rejected: 0, fixed: 0 };
      }
      for (const turn of d.loopTurnIterations) {
        data.interventions[sup].total++;
        if (turn.initiallyRejected) {
          data.interventions[sup].rejected++;
          if (turn.endedApproved) data.interventions[sup].fixed++;
        }
      }
    }
  }

  return data;
}

function computeStats(records: RunRecord[]) {
  const single = records.filter((d) => d.condition === 'single');
  const dual = records.filter((d) => d.condition === 'dual-loop');
  const singleLeak = single.filter((d) => d.judge?.leakage).length;
  const dualLeak = dual.filter((d) => d.judge?.leakage).length;

  // Chi-square calculation
  const chiSquare = (a: number, b: number, c: number, d: number) => {
    const n = a + b + c + d;
    if (n === 0) return 0;
    const row1 = a + b, row2 = c + d, col1 = a + c, col2 = b + d;
    const expected = [
      [row1 * col1 / n, row1 * col2 / n],
      [row2 * col1 / n, row2 * col2 / n],
    ];
    const observed = [[a, b], [c, d]];
    let chi = 0;
    for (let i = 0; i < 2; i++) {
      for (let j = 0; j < 2; j++) {
        if (expected[i][j] > 0) {
          chi += Math.pow(observed[i][j] - expected[i][j], 2) / expected[i][j];
        }
      }
    }
    return chi;
  };

  // Wilson score interval
  const wilsonCI = (successes: number, n: number) => {
    if (n === 0) return { lower: 0, upper: 0, point: 0 };
    const z = 1.96;
    const p = successes / n;
    const denom = 1 + z * z / n;
    const center = p + z * z / (2 * n);
    const spread = z * Math.sqrt((p * (1 - p) + z * z / (4 * n)) / n);
    return {
      lower: ((center - spread) / denom) * 100,
      upper: ((center + spread) / denom) * 100,
      point: p * 100,
    };
  };

  const singleRate = single.length > 0 ? singleLeak / single.length : 0;
  const dualRate = dual.length > 0 ? dualLeak / dual.length : 0;

  // Odds ratio
  const a = singleLeak, b = single.length - singleLeak;
  const c = dualLeak, d = dual.length - dualLeak;
  const oddsRatio = (b > 0 && c > 0) ? (a * d) / (b * c) : 0;

  // Relative risk reduction
  const rrr = singleRate > 0 ? (singleRate - dualRate) / singleRate : 0;

  return {
    singleN: single.length,
    dualN: dual.length,
    singleLeak,
    dualLeak,
    singleRate: singleRate * 100,
    dualRate: dualRate * 100,
    singleCI: wilsonCI(singleLeak, single.length),
    dualCI: wilsonCI(dualLeak, dual.length),
    chiSquare: chiSquare(singleLeak, single.length - singleLeak, dualLeak, dual.length - dualLeak),
    oddsRatio,
    rrr: rrr * 100,
  };
}

export function renderAnalysisDashboard(input: AnalysisInput): string {
  const { runId, createdAtIso, records } = input;
  
  if (records.length === 0) {
    return `<!DOCTYPE html><html><body><h1>No data available</h1></body></html>`;
  }

  const vizData = computeVizData(records);
  const stats = computeStats(records);

  // Prepare chart data
  const pairingsSorted = Object.entries(vizData.byPairing)
    .map(([key, val]) => ({ key, ...val, rate: val.total > 0 ? val.leaked / val.total * 100 : 0 }))
    .sort((a, b) => a.rate - b.rate);

  const topicsSorted = Object.entries(vizData.byTopic)
    .map(([key, val]) => ({ key, ...val, rate: val.total > 0 ? val.leaked / val.total * 100 : 0 }))
    .sort((a, b) => b.rate - a.rate);

  const difficultyRank: Record<string, number> = { easy: 1, medium: 2, hard: 3 };
  const primarySorted = Object.entries(vizData.primaryBreakdown)
    .map(([key, val]) => ({ key, ...val, rate: val.total > 0 ? val.leaked / val.total * 100 : 0 }))
    .sort((a, b) => {
      if (vizData.hasCsbenchMetadata) {
        const totalDelta = b.total - a.total;
        if (totalDelta !== 0) return totalDelta;
        const rateDelta = b.rate - a.rate;
        if (rateDelta !== 0) return rateDelta;
        return a.key.localeCompare(b.key);
      }
      const ar = difficultyRank[a.key.toLowerCase()] ?? 99;
      const br = difficultyRank[b.key.toLowerCase()] ?? 99;
      if (ar !== br) return ar - br;
      return a.key.localeCompare(b.key);
    });
  const primaryLabels = primarySorted.map((row) => row.key);
  const primaryValues = primarySorted.map((row) => Number(row.rate.toFixed(1)));
  const primaryChartMax = Math.max(50, ...primaryValues, 10);

  const leakRate = vizData.total > 0 ? (vizData.leaked / vizData.total * 100).toFixed(1) : '0';
  const hallucinationRate = vizData.total > 0 ? (vizData.hallucinated / vizData.total * 100).toFixed(1) : '0';
  const complianceRate = vizData.total > 0 ? (vizData.compliant / vizData.total * 100).toFixed(1) : '0';

  // Build latency histogram bins
  const binLatencies = (arr: number[], binSize: number, maxBin: number) => {
    const bins: Record<number, number> = {};
    for (let i = 0; i <= maxBin; i += binSize) bins[i] = 0;
    arr.forEach((v) => {
      const bin = Math.floor(v / binSize) * binSize;
      if (bin <= maxBin) bins[bin]++;
    });
    return bins;
  };

  const singleBins = binLatencies(vizData.latencies.single, 20, 180);
  const dualBins = binLatencies(vizData.latencies['dual-loop'], 20, 180);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Analysis Dashboard - ${runId}</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <style>
    :root {
      --bg-dark: #0f172a;
      --bg-card: #1e293b;
      --bg-card-hover: #334155;
      --text-primary: #f1f5f9;
      --text-secondary: #94a3b8;
      --accent-blue: #3b82f6;
      --accent-green: #22c55e;
      --accent-red: #ef4444;
      --accent-yellow: #eab308;
      --accent-purple: #a855f7;
      --accent-cyan: #06b6d4;
      --border: #334155;
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
      background: var(--bg-dark);
      color: var(--text-primary);
      line-height: 1.6;
      padding: 2rem;
    }
    .dashboard { max-width: 1600px; margin: 0 auto; }
    header {
      text-align: center;
      margin-bottom: 3rem;
      padding-bottom: 2rem;
      border-bottom: 1px solid var(--border);
    }
    header h1 {
      font-size: 2.5rem;
      font-weight: 700;
      background: linear-gradient(135deg, var(--accent-blue), var(--accent-purple));
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      margin-bottom: 0.5rem;
    }
    header p { color: var(--text-secondary); font-size: 1.1rem; }
    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 1.5rem;
      margin-bottom: 3rem;
    }
    .kpi-card {
      background: var(--bg-card);
      border-radius: 12px;
      padding: 1.5rem;
      text-align: center;
      border: 1px solid var(--border);
    }
    .kpi-value { font-size: 2.5rem; font-weight: 700; margin-bottom: 0.25rem; }
    .kpi-value.blue { color: var(--accent-blue); }
    .kpi-value.green { color: var(--accent-green); }
    .kpi-value.red { color: var(--accent-red); }
    .kpi-value.purple { color: var(--accent-purple); }
    .kpi-label { color: var(--text-secondary); font-size: 0.9rem; text-transform: uppercase; letter-spacing: 0.05em; }
    .section { margin-bottom: 3rem; }
    .section h2 {
      font-size: 1.5rem;
      margin-bottom: 1.5rem;
      padding-bottom: 0.5rem;
      border-bottom: 2px solid var(--accent-blue);
      display: inline-block;
    }
    .chart-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(400px, 1fr));
      gap: 2rem;
    }
    .chart-card {
      background: var(--bg-card);
      border-radius: 12px;
      padding: 1.5rem;
      border: 1px solid var(--border);
    }
    .chart-card h3 { font-size: 1.1rem; margin-bottom: 1rem; color: var(--text-primary); }
    .chart-container { position: relative; height: 300px; }
    .chart-container.tall { height: 400px; }
    .insight-box {
      background: linear-gradient(135deg, rgba(59, 130, 246, 0.1), rgba(168, 85, 247, 0.1));
      border: 1px solid var(--accent-blue);
      border-radius: 8px;
      padding: 1rem 1.5rem;
      margin-top: 1rem;
      font-size: 0.9rem;
    }
    .insight-box strong { color: var(--accent-cyan); }
    .findings-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
      gap: 1.5rem;
    }
    .finding-card {
      background: var(--bg-card);
      border-radius: 12px;
      padding: 1.5rem;
      border-left: 4px solid var(--accent-purple);
    }
    .finding-card h4 { color: var(--accent-cyan); margin-bottom: 0.75rem; font-size: 1rem; }
    .finding-card p { color: var(--text-secondary); font-size: 0.9rem; }
    .stat-highlight { color: var(--accent-yellow); font-weight: 600; }
    table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
    th, td { padding: 0.75rem 1rem; text-align: left; border-bottom: 1px solid var(--border); }
    th { background: var(--bg-dark); font-weight: 600; color: var(--accent-blue); text-transform: uppercase; font-size: 0.8rem; }
    tr:hover { background: var(--bg-card-hover); }
  </style>
</head>
<body>
  <div class="dashboard">
    <header>
      <h1>AI Tutor Leakage Analysis</h1>
      <p>Run: ${runId} | ${vizData.total} Experiments | Generated: ${new Date(createdAtIso).toLocaleString()}</p>
    </header>

    <div class="kpi-grid">
      <div class="kpi-card">
        <div class="kpi-value blue">${vizData.total}</div>
        <div class="kpi-label">Total Experiments</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-value red">${leakRate}%</div>
        <div class="kpi-label">Leakage Rate</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-value green">${hallucinationRate}%</div>
        <div class="kpi-label">Hallucination</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-value green">${complianceRate}%</div>
        <div class="kpi-label">Socratic Compliance</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-value purple">${stats.rrr.toFixed(1)}%</div>
        <div class="kpi-label">Leak Reduction (Dual-Loop)</div>
      </div>
    </div>

    <div class="section">
      <h2>Primary Results</h2>
      <div class="chart-grid">
        <div class="chart-card">
          <h3>Leakage Rate by Condition</h3>
          <div class="chart-container">
            <canvas id="conditionChart"></canvas>
          </div>
          <div class="insight-box">
            <strong>Key Finding:</strong> ${stats.rrr > 0 ? `Dual-loop reduces leakage by ${stats.rrr.toFixed(1)}% (OR=${stats.oddsRatio.toFixed(2)})` : 'Insufficient data for comparison'}
          </div>
        </div>

        <div class="chart-card">
          <h3>Tutor-Supervisor Pairing Performance</h3>
          <div class="chart-container">
            <canvas id="pairingChart"></canvas>
          </div>
        </div>

        <div class="chart-card">
          <h3>Leakage Rate by ${vizData.primaryBreakdownLabel}</h3>
          <div class="chart-container">
            <canvas id="difficultyChart"></canvas>
          </div>
        </div>

        <div class="chart-card">
          <h3>Turn of First Leak</h3>
          <div class="chart-container">
            <canvas id="turnChart"></canvas>
          </div>
        </div>
      </div>
    </div>

    <div class="section">
      <h2>Failure Modes & Topics</h2>
      <div class="chart-grid">
        <div class="chart-card">
          <h3>How Tutors Leak (Failure Mode Taxonomy)</h3>
          <div class="chart-container">
            <canvas id="failureModesChart"></canvas>
          </div>
        </div>

        <div class="chart-card">
          <h3>Topic Vulnerability Ranking</h3>
          <div class="chart-container tall">
            <canvas id="topicChart"></canvas>
          </div>
        </div>
      </div>
    </div>

    <div class="section">
      <h2>Latency Analysis</h2>
      <div class="chart-grid">
        <div class="chart-card">
          <h3>Latency Distribution by Condition</h3>
          <div class="chart-container">
            <canvas id="latencyChart"></canvas>
          </div>
        </div>

        <div class="chart-card">
          <h3>Supervisor Intervention Effectiveness</h3>
          <div class="chart-container">
            <canvas id="interventionChart"></canvas>
          </div>
        </div>
      </div>
    </div>

    <div class="section">
      <h2>Statistical Summary</h2>
      <div class="chart-card">
        <table>
          <thead>
            <tr>
              <th>Metric</th>
              <th>Single-loop</th>
              <th>Dual-loop</th>
              <th>Difference</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Sample Size</td>
              <td>${stats.singleN}</td>
              <td>${stats.dualN}</td>
              <td>-</td>
            </tr>
            <tr>
              <td>Leak Rate</td>
              <td>${stats.singleRate.toFixed(1)}%</td>
              <td>${stats.dualRate.toFixed(1)}%</td>
              <td>${(stats.singleRate - stats.dualRate).toFixed(1)}pp</td>
            </tr>
            <tr>
              <td>95% CI</td>
              <td>[${stats.singleCI.lower.toFixed(1)}%, ${stats.singleCI.upper.toFixed(1)}%]</td>
              <td>[${stats.dualCI.lower.toFixed(1)}%, ${stats.dualCI.upper.toFixed(1)}%]</td>
              <td>-</td>
            </tr>
            <tr>
              <td>Chi-Square</td>
              <td colspan="2" style="text-align:center">${stats.chiSquare.toFixed(3)}</td>
              <td>${stats.chiSquare > 3.84 ? 'p<0.05 ✓' : 'n.s.'}</td>
            </tr>
            <tr>
              <td>Odds Ratio</td>
              <td colspan="2" style="text-align:center">${stats.oddsRatio.toFixed(2)}</td>
              <td>-</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>

  <script>
    Chart.defaults.color = '#94a3b8';
    Chart.defaults.borderColor = '#334155';

    const colors = {
      blue: '#3b82f6', green: '#22c55e', red: '#ef4444',
      yellow: '#eab308', purple: '#a855f7', cyan: '#06b6d4',
      orange: '#f97316', pink: '#ec4899'
    };

    // Condition Chart
    new Chart(document.getElementById('conditionChart'), {
      type: 'bar',
      data: {
        labels: ['Single-loop', 'Dual-loop'],
        datasets: [{
          label: 'Leak Rate (%)',
          data: [${stats.singleRate.toFixed(1)}, ${stats.dualRate.toFixed(1)}],
          backgroundColor: [colors.red, colors.green],
          borderRadius: 8
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true, max: Math.max(50, ${stats.singleRate + 10}), ticks: { callback: v => v + '%' } } }
      }
    });

    // Pairing Chart
    new Chart(document.getElementById('pairingChart'), {
      type: 'bar',
      data: {
        labels: ${JSON.stringify(pairingsSorted.map((p) => p.key))},
        datasets: [{
          label: 'Leak Rate (%)',
          data: ${JSON.stringify(pairingsSorted.map((p) => p.rate.toFixed(1)))},
          backgroundColor: ${JSON.stringify(pairingsSorted.map((_, i) => ['#22c55e', '#06b6d4', '#eab308', '#f97316', '#a855f7', '#ef4444'][i % 6]))},
          borderRadius: 8
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        indexAxis: 'y',
        plugins: { legend: { display: false } },
        scales: { x: { beginAtZero: true, max: 50, ticks: { callback: v => v + '%' } } }
      }
    });

    // Primary breakdown chart (difficulty for legacy, format+domain for csbench metadata)
    new Chart(document.getElementById('difficultyChart'), {
      type: 'bar',
      data: {
        labels: ${JSON.stringify(primaryLabels)},
        datasets: [{
          label: 'Leak Rate (%)',
          data: ${JSON.stringify(primaryValues)},
          backgroundColor: ${JSON.stringify(
            primaryValues.map((_, i) => ['#ef4444', '#eab308', '#22c55e', '#06b6d4', '#a855f7', '#f97316'][i % 6])
          )},
          borderRadius: 8
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true, max: ${primaryChartMax}, ticks: { callback: v => v + '%' } } }
      }
    });

    // Turn Chart
    new Chart(document.getElementById('turnChart'), {
      type: 'bar',
      data: {
        labels: ['Turn 1', 'Turn 2', 'Turn 3', 'Turn 4', 'Turn 5', 'Turn 6'],
        datasets: [
          {
            label: 'Leaked',
            data: [${[1,2,3,4,5,6].map((t) => vizData.turnDistLeaked[t] || 0).join(',')}],
            backgroundColor: colors.red,
            borderRadius: 8
          },
          {
            label: 'Not Leaked',
            data: [${[1,2,3,4,5,6].map((t) => vizData.turnDistNotLeaked[t] || 0).join(',')}],
            backgroundColor: colors.green,
            borderRadius: 8
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: { y: { beginAtZero: true } }
      }
    });

    // Failure Modes Chart
    new Chart(document.getElementById('failureModesChart'), {
      type: 'bar',
      data: {
        labels: ['Elimination', 'Paraphrase', 'Direct', 'Definition', 'Confirmation', 'Implicit'],
        datasets: [{
          label: 'Count',
          data: [${vizData.failureModes.elimination}, ${vizData.failureModes.paraphrase}, ${vizData.failureModes.direct}, ${vizData.failureModes.definition}, ${vizData.failureModes.confirmation}, ${vizData.failureModes.implicit}],
          backgroundColor: [colors.red, colors.orange, colors.yellow, colors.purple, colors.cyan, colors.blue],
          borderRadius: 8
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        indexAxis: 'y',
        plugins: { legend: { display: false } }
      }
    });

    // Topic Chart
    new Chart(document.getElementById('topicChart'), {
      type: 'bar',
      data: {
        labels: ${JSON.stringify(topicsSorted.slice(0, 12).map((t) => t.key))},
        datasets: [{
          label: 'Leak Rate (%)',
          data: ${JSON.stringify(topicsSorted.slice(0, 12).map((t) => t.rate.toFixed(1)))},
          backgroundColor: ${JSON.stringify(topicsSorted.slice(0, 12).map((t) => t.rate >= 30 ? '#ef4444' : t.rate >= 15 ? '#eab308' : t.rate > 0 ? '#06b6d4' : '#22c55e'))},
          borderRadius: 8
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        indexAxis: 'y',
        plugins: { legend: { display: false } },
        scales: { x: { beginAtZero: true, max: 110, ticks: { callback: v => v + '%' } } }
      }
    });

    // Latency Chart
    const singleBins = ${JSON.stringify(singleBins)};
    const dualBins = ${JSON.stringify(dualBins)};
    const binLabels = Object.keys(singleBins).map(k => k + '-' + (parseInt(k)+20) + 's');
    
    new Chart(document.getElementById('latencyChart'), {
      type: 'bar',
      data: {
        labels: binLabels,
        datasets: [
          { label: 'Single-loop', data: Object.values(singleBins), backgroundColor: colors.blue, borderRadius: 4 },
          { label: 'Dual-loop', data: Object.values(dualBins), backgroundColor: colors.purple, borderRadius: 4 }
        ]
      },
      options: { responsive: true, maintainAspectRatio: false }
    });

    // Intervention Chart
    const interventionData = ${JSON.stringify(vizData.interventions)};
    const supLabels = Object.keys(interventionData);
    
    new Chart(document.getElementById('interventionChart'), {
      type: 'bar',
      data: {
        labels: supLabels.map(s => s + ' Supervisor'),
        datasets: [
          { label: 'Total Turns', data: supLabels.map(s => interventionData[s].total), backgroundColor: colors.blue, borderRadius: 8 },
          { label: 'Rejected', data: supLabels.map(s => interventionData[s].rejected), backgroundColor: colors.yellow, borderRadius: 8 },
          { label: 'Fixed', data: supLabels.map(s => interventionData[s].fixed), backgroundColor: colors.green, borderRadius: 8 }
        ]
      },
      options: { responsive: true, maintainAspectRatio: false }
    });
  </script>
</body>
</html>`;
}

/**
 * Generate CSV exports for external tools
 */
export function generateAnalysisCsvs(records: RunRecord[]): Record<string, string> {
  const csvs: Record<string, string> = {};

  // Main experiments CSV
  let mainCsv =
    'experiment_id,condition,tutor,supervisor,pairing,dataset,question_format,domain,subdomain,tag,difficulty,bloom_level,topic,turns_completed,leaked,hallucinated,compliant,latency_ms\n';
  records.forEach((d, i) => {
    const config = d.config as any;
    const meta = extractQuestionMeta(d);
    const tutor = config?.tutorId || '';
    const sup = config?.supervisorId || 'none';
    mainCsv += [
      i + 1,
      d.condition,
      tutor,
      sup,
      `${tutor}-${sup}`,
      meta.dataset ?? '',
      meta.questionFormat ?? '',
      meta.domain ?? '',
      meta.subDomain ?? '',
      meta.tag ?? '',
      meta.difficulty ?? '',
      meta.bloomLabel ?? '',
      meta.topic,
      d.turnsCompleted,
      d.judge?.leakage ? 1 : 0,
      d.judge?.hallucination ? 1 : 0,
      d.judge?.compliance ? 1 : 0,
      d.totalLatencyMs || '',
    ].join(',') + '\n';
  });
  csvs['experiments.csv'] = mainCsv;

  // Topic summary CSV
  const topics: Record<string, { total: number; leaked: number }> = {};
  records.forEach((d) => {
    const t = extractQuestionMeta(d).topic;
    if (!topics[t]) topics[t] = { total: 0, leaked: 0 };
    topics[t].total++;
    if (d.judge?.leakage) topics[t].leaked++;
  });

  let topicCsv = 'topic,total,leaked,leak_rate\n';
  Object.entries(topics)
    .sort((a, b) => b[1].leaked / b[1].total - a[1].leaked / a[1].total)
    .forEach(([t, s]) => {
      topicCsv += [t, s.total, s.leaked, (s.leaked / s.total * 100).toFixed(1)].join(',') + '\n';
    });
  csvs['topics.csv'] = topicCsv;

  return csvs;
}
