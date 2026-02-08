import { REPORT_CSS, REPORT_JS } from './assets';
import type { ReportInput } from './types';

function safeJsonForInlineScript(data: unknown): string {
  // Prevent `</script>` injection and keep the report self-contained.
  return JSON.stringify(data).replace(/</g, '\\u003c');
}

export function renderReportHtml(input: ReportInput): string {
  const inlineRecords = input.inlineRecords ?? true;
  const payload = {
    meta: {
      runId: input.runId,
      createdAtIso: input.createdAtIso,
      recordsInline: inlineRecords,
    },
    status: input.status,
    args: input.args,
    questions: input.questions,
    summary: input.summary,
    analysis: input.analysis,
    records: inlineRecords ? input.records : [],
  };

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Tutor Harness Report</title>
    <style>${REPORT_CSS}</style>
  </head>
  <body>
    <div class="app">
      <div class="paperFrame">
        <header class="mast">
          <div class="mast__left">
            <div class="mark">
              <div class="mark__title">Tutor Harness</div>
              <div class="mark__sub">Field report</div>
            </div>
            <div class="meta">
              <div class="meta__row"><span class="meta__k">run</span><span class="meta__v mono" id="metaRunId"></span></div>
              <div class="meta__row"><span class="meta__k">created</span><span class="meta__v mono" id="metaCreatedAt"></span></div>
            </div>
          </div>
          <div class="mast__right">
            <div class="statusPill" id="statusPill"></div>
            <div class="actions">
              <button class="btn" id="themeToggle" type="button">Night</button>
              <button class="btn" id="copyLink" type="button">Copy link</button>
              <button class="btn btn--primary" id="downloadJson" type="button">Download data</button>
            </div>
          </div>
        </header>

        <nav class="tabs" role="tablist" aria-label="Report sections">
          <button class="tab" id="tabOverview" type="button" role="tab" aria-selected="false">Overview</button>
          <button class="tab" id="tabAnalysis" type="button" role="tab" aria-selected="false">Analysis</button>
          <button class="tab" id="tabQuestions" type="button" role="tab" aria-selected="true">Questions</button>
        </nav>

        <main class="views">
          <section class="view" id="viewOverview" hidden>
            <div id="overviewRoot"></div>
          </section>

          <section class="view" id="viewAnalysis" hidden>
            <div id="analysisRoot"></div>
          </section>

          <section class="view" id="viewQuestions">
            <div class="layoutQuestions">
              <aside class="sidebar">
                <div class="panel panel--sticky">
                  <div class="panel__hd">
                    <div class="panel__title">Questions</div>
                    <div class="panel__meta mono" id="qCounts"></div>
                  </div>
                  <div class="panel__bd">
                    <label class="field">
                      <span class="field__label">Search</span>
                      <input id="qSearch" class="input" type="search" placeholder="id, topic, text…" />
                    </label>

                    <div class="filterRow">
                      <button class="chip" id="filterIssues" type="button" aria-pressed="false">Only issues</button>
                      <button class="chip chip--danger" id="filterLeak" type="button" aria-pressed="false">Leak</button>
                      <button class="chip chip--danger" id="filterHalluc" type="button" aria-pressed="false">Halluc</button>
                      <button class="chip" id="filterJudged" type="button" aria-pressed="false">Judged</button>
                    </div>

                    <label class="field">
                      <span class="field__label">Sort</span>
                      <select id="qSort" class="select">
                        <option value="risk">Risk</option>
                        <option value="id">ID</option>
                        <option value="difficulty">Difficulty</option>
                        <option value="latency">Latency</option>
                      </select>
                    </label>
                  </div>
                </div>
                <div class="qList" id="qList" role="list"></div>
              </aside>

              <section class="canvas">
                <div class="hero">
                  <div class="hero__kicker" id="qKicker"></div>
                  <h1 class="hero__title" id="qTitle"></h1>
                  <div class="hero__meta" id="qMeta"></div>
                  <div class="hero__statement" id="qStatement"></div>
                  <details class="hero__ref" id="qChoicesWrap">
                    <summary class="hero__refSum">Choices</summary>
                    <pre class="hero__refBody" id="qChoices"></pre>
                  </details>
                  <details class="hero__ref" id="qRefWrap">
                    <summary class="hero__refSum">Reference outline</summary>
                    <div class="hero__refBody" id="qRef"></div>
                  </details>
                </div>

                <div class="board">
                  <div class="board__hd">
                    <div class="board__title">Comparisons</div>
                    <div class="board__sub mono" id="boardSub"></div>
                  </div>
                  <div class="matrix" id="matrix"></div>
                </div>
              </section>

              <aside class="drawer" id="drawer">
                <div class="drawer__inner">
                  <div class="drawer__hd">
                    <div class="drawer__title" id="drawerTitle">Run details</div>
                    <div class="drawer__meta mono" id="drawerMeta"></div>
                    <div class="drawer__actions" id="drawerActions">
                      <button class="btn btn--small" id="drawerClose" type="button">Close</button>
                    </div>
                  </div>
                  <div class="drawer__tabs" role="tablist" aria-label="Details tabs">
                    <button class="subtab" id="subtabTranscript" type="button" role="tab" aria-selected="true">Transcript</button>
                    <button class="subtab" id="subtabJudging" type="button" role="tab" aria-selected="false">Judging</button>
                    <button class="subtab" id="subtabTiming" type="button" role="tab" aria-selected="false">Timings</button>
                    <button class="subtab" id="subtabHidden" type="button" role="tab" aria-selected="false">Hidden</button>
                  </div>
                  <div class="drawer__bd" id="drawerBody"></div>
                </div>
              </aside>
            </div>
          </section>
        </main>

        <footer class="foot">
          <div class="mono" id="footNote"></div>
        </footer>
      </div>
    </div>

    <script>
      window.__HARNESS_DATA__ = ${safeJsonForInlineScript(payload)};
    </script>
    <script>${REPORT_JS}</script>
  </body>
</html>`;
}
