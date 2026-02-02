export const REPORT_JS = `
(function(){
  const data = window.__HARNESS_DATA__ || {};

  const records = Array.isArray(data.records) ? data.records : [];
  const analysis = data.analysis || null;
  const hasAnalysis = analysis && analysis.tables;
  const questionsRaw = Array.isArray(data.questions) ? data.questions : [];

  function byString(a, b){
    return String(a).localeCompare(String(b));
  }

  function escapeText(value){
    return String(value == null ? '' : value);
  }

  function escapeHtml(value){
    return escapeText(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function shortText(value, maxLen){
    const t = escapeText(value).replace(/\\s+/g, ' ').trim();
    if (!t) return '';
    return t.length <= maxLen ? t : t.slice(0, Math.max(0, maxLen - 1)) + '…';
  }

  function fmtPct(value){
    if (value == null || !Number.isFinite(value)) return 'n/a';
    return Math.round(value * 100) + '%';
  }

  function fmtMs(value){
    if (value == null || !Number.isFinite(value)) return 'n/a';
    if (value < 1000) return Math.round(value) + 'ms';
    return (value / 1000).toFixed(2) + 's';
  }


  function safeJson(value){
    try{ return JSON.stringify(value, null, 2); }catch{ return String(value); }
  }

  function normalizeCanterburyImages(root){
    if (!root) return;
    const imgs = root.querySelectorAll('img');
    for (const img of imgs){
      const src = img.getAttribute('src') || '';
      if (src.startsWith('data/canterbury/img/')){
        img.setAttribute('src', './' + src);
      }
    }
  }

  function el(id){ return document.getElementById(id); }

  const viewOverview = el('viewOverview');
  const viewAnalysis = el('viewAnalysis');
  const viewQuestions = el('viewQuestions');
  const statusPill = el('statusPill');
  const metaRunId = el('metaRunId');
  const metaCreatedAt = el('metaCreatedAt');

  const tabOverview = el('tabOverview');
  const tabAnalysis = el('tabAnalysis');
  const tabQuestions = el('tabQuestions');

  const themeToggle = el('themeToggle');
  const copyLinkBtn = el('copyLink');
  const downloadJsonBtn = el('downloadJson');

  const overviewRoot = el('overviewRoot');
  const analysisRoot = el('analysisRoot');

  const qCounts = el('qCounts');
  const qSearch = el('qSearch');
  const qSort = el('qSort');
  const filterIssues = el('filterIssues');
  const filterLeak = el('filterLeak');
  const filterHalluc = el('filterHalluc');
  const filterJudged = el('filterJudged');
  const qList = el('qList');

  const qKicker = el('qKicker');
  const qTitle = el('qTitle');
  const qMeta = el('qMeta');
  const qStatement = el('qStatement');
  const qChoicesWrap = el('qChoicesWrap');
  const qChoices = el('qChoices');
  const qRefWrap = el('qRefWrap');
  const qRef = el('qRef');
  const boardSub = el('boardSub');
  const matrix = el('matrix');

  const drawer = el('drawer');
  const drawerTitle = el('drawerTitle');
  const drawerMeta = el('drawerMeta');
  const drawerBody = el('drawerBody');
  const drawerClose = el('drawerClose');

  const subtabTranscript = el('subtabTranscript');
  const subtabJudging = el('subtabJudging');
  const subtabTiming = el('subtabTiming');
  const subtabHidden = el('subtabHidden');

  const footNote = el('footNote');

  function extractQuestions(){
    const out = [];
    for (const q of questionsRaw){
      if (!q || typeof q !== 'object') continue;
      const id = q.id;
      if (typeof id !== 'string' || !id) continue;
      out.push(q);
    }
    return out;
  }

  const questions = extractQuestions();
  const qById = new Map();
  for (const q of questions) qById.set(q.id, q);

  const recordsByQuestionId = new Map();
  for (const r of records){
    const qid = r && r.question && r.question.id ? r.question.id : 'unknown';
    if (!recordsByQuestionId.has(qid)) recordsByQuestionId.set(qid, []);
    recordsByQuestionId.get(qid).push(r);
  }

  function uniqueStrings(arr){
    const out = [];
    const seen = new Set();
    for (const v of arr){
      const s = String(v);
      if (!seen.has(s)){
        seen.add(s);
        out.push(s);
      }
    }
    return out;
  }

  function orderedConditions(conds){
    const pref = { 'single': 0, 'dual-loop': 1 };
    return uniqueStrings(conds).sort((a, b) => (pref[a] ?? 99) - (pref[b] ?? 99) || byString(a, b));
  }

  function orderedPairings(pairs){
    const pref = { 'gpt5-gpt5': 0, 'gpt5-gemini': 1, 'gemini-gpt5': 2, 'gemini-gemini': 3 };
    return uniqueStrings(pairs).sort((a, b) => (pref[a] ?? 99) - (pref[b] ?? 99) || byString(a, b));
  }

  function orderedTutors(tutors){
    const pref = { 'gpt': 0, 'gemini': 1 };
    return uniqueStrings(tutors).sort((a, b) => (pref[a] ?? 99) - (pref[b] ?? 99) || byString(a, b));
  }

  function orderedSupervisors(sups){
    const pref = { 'gpt': 0, 'gemini': 1 };
    return uniqueStrings(sups).sort((a, b) => (pref[a] ?? 99) - (pref[b] ?? 99) || byString(a, b));
  }

  const argsPairings = Array.isArray(data.args && data.args.pairings) ? data.args.pairings : [];
  const argsConditions = Array.isArray(data.args && data.args.conditions) ? data.args.conditions : [];
  const argsTutors = Array.isArray(data.args && data.args.tutors) ? data.args.tutors : [];
  const argsSupervisors = Array.isArray(data.args && data.args.supervisors) ? data.args.supervisors : [];

  const pairings = orderedPairings(argsPairings.length ? argsPairings : records.map(r => r.pairingId));
  const conditions = orderedConditions(argsConditions.length ? argsConditions : records.map(r => r.condition));
  
  // Extract tutors and supervisors from records if not in args
  // Supports both new format (config.tutorId) and legacy format (pairingId like 'gpt-gpt')
  function extractTutorsFromRecords(){
    const tutors = new Set();
    for (const r of records){
      const cfg = r && r.config ? r.config : null;
      // New format: tutorId in config
      if (cfg && cfg.tutorId) {
        tutors.add(cfg.tutorId);
        continue;
      }
      // Legacy format: extract from pairingId (e.g., 'gpt-gpt' -> 'gpt', 'gemini-gpt' -> 'gemini')
      const pid = r && r.pairingId ? String(r.pairingId) : '';
      if (pid) {
        const parts = pid.split('-');
        if (parts.length >= 1 && parts[0]) tutors.add(parts[0]);
      }
    }
    return Array.from(tutors);
  }
  
  function extractSupervisorsFromRecords(){
    const sups = new Set();
    for (const r of records){
      const cfg = r && r.config ? r.config : null;
      // New format: supervisorId in config
      if (cfg && cfg.supervisorId) {
        sups.add(cfg.supervisorId);
        continue;
      }
      // Legacy format: extract from pairingId (e.g., 'gpt-gpt' -> 'gpt', 'gpt-gemini' -> 'gemini')
      // Only for dual-loop condition
      if (r && r.condition === 'dual-loop') {
        const pid = r.pairingId ? String(r.pairingId) : '';
        if (pid) {
          const parts = pid.split('-');
          if (parts.length >= 2 && parts[1]) sups.add(parts[1]);
        }
      }
    }
    return Array.from(sups);
  }
  
  const tutors = orderedTutors(argsTutors.length ? argsTutors : extractTutorsFromRecords());
  const supervisors = orderedSupervisors(argsSupervisors.length ? argsSupervisors : extractSupervisorsFromRecords());
  
  // Build supervision columns: Single + each supervisor
  const hasSingleCondition = conditions.includes('single');
  const hasDualLoopCondition = conditions.includes('dual-loop');
  const supervisionModes = [];
  if (hasSingleCondition) supervisionModes.push({ id: 'single', label: 'Single', supervisorId: null });
  if (hasDualLoopCondition) {
    for (const sup of supervisors) {
      supervisionModes.push({ id: sup, label: sup.toUpperCase() + ' Supervisor', supervisorId: sup });
    }
  }

  const allQuestionIds = uniqueStrings(
    questions.length ? questions.map(q => q.id) : Array.from(recordsByQuestionId.keys())
  ).sort(byString);

  const pairingModels = new Map();
  for (const r of records){
    const pid = r.pairingId;
    const models = r && r.config && r.config.models ? r.config.models : null;
    if (!models) continue;
    const tutorModel = models.tutorModel;
    const supervisorModel = models.supervisorModel;
    if (!pairingModels.has(pid) && tutorModel){
      pairingModels.set(pid, { tutorModel, supervisorModel });
      continue;
    }
    if (pairingModels.has(pid) && supervisorModel){
      const prev = pairingModels.get(pid) || {};
      if (!prev.supervisorModel) pairingModels.set(pid, { tutorModel: prev.tutorModel || tutorModel, supervisorModel });
    }
  }

  function pairingLabel(pairingId){
    const m = pairingModels.get(pairingId);
    if (m && m.tutorModel){
      if (m.supervisorModel) return m.tutorModel + ' → ' + m.supervisorModel;
      return String(m.tutorModel);
    }
    return String(pairingId);
  }

  function recordLastTurnJudge(r){
    const tjs = r && r.hiddenTrace && Array.isArray(r.hiddenTrace.turnJudgments) ? r.hiddenTrace.turnJudgments : [];
    if (!tjs.length) return null;
    const last = tjs[tjs.length - 1];
    return last && last.judge ? last.judge : null;
  }

  function recordKpis(r){
    const judge = r && r.judge ? r.judge : null;
    const lastTurnJudge = recordLastTurnJudge(r);
    const turnsCompleted = typeof r.turnsCompleted === 'number' ? r.turnsCompleted : null;
    const turnsRequested = typeof r.turnsRequested === 'number' ? r.turnsRequested : null;
    const endedEarly = turnsCompleted != null && turnsRequested != null && turnsCompleted < turnsRequested;
    const earlyReason = endedEarly && lastTurnJudge && lastTurnJudge.shouldTerminate ? lastTurnJudge.terminationReason : null;
    const preferTurnJudge = endedEarly && lastTurnJudge && lastTurnJudge.shouldTerminate;
    const primaryJudge = preferTurnJudge ? lastTurnJudge : judge;
    const fallbackJudge = preferTurnJudge ? judge : lastTurnJudge;
    const leakage = primaryJudge ? primaryJudge.leakage : (fallbackJudge ? fallbackJudge.leakage : null);
    const hallucination = primaryJudge ? primaryJudge.hallucination : (fallbackJudge ? fallbackJudge.hallucination : null);
    const compliance = primaryJudge ? primaryJudge.compliance : (fallbackJudge ? fallbackJudge.compliance : null);
    const latencyMs = typeof r.totalLatencyMs === 'number' ? r.totalLatencyMs : null;
    return { leakage, hallucination, compliance, latencyMs, turnsCompleted, turnsRequested, endedEarly, earlyReason, hasJudge: !!judge };
  }

  function recordLoopStats(r){
    const loop = r && Array.isArray(r.loopTurnIterations) ? r.loopTurnIterations : null;
    if (!loop || !loop.length) return null;

    let turns = 0;
    let rejectedTurns = 0;
    let supervisorRejections = 0;
    let tutorRevisions = 0;

    for (const row of loop){
      turns += 1;
      if (row && row.initiallyRejected) rejectedTurns += 1;
      const iters = typeof row.iterationsUsed === 'number' ? row.iterationsUsed : Number(row.iterationsUsed);
      if (!Number.isFinite(iters) || iters <= 0) continue;

      tutorRevisions += Math.max(0, iters - 1);
      supervisorRejections += row && row.endedApproved ? Math.max(0, iters - 1) : iters;
    }

    return { turns, rejectedTurns, supervisorRejections, tutorRevisions };
  }

  function severityFor(k){
    if (k.leakage === true) return 'bad';
    if (k.hallucination === true) return 'bad';
    if (k.compliance === false) return 'warn';
    return 'ok';
  }

  function outcomeFor(k){
    if (k.leakage === true) return { key: 'danger', label: 'Leakage' };
    if (k.hallucination === true) return { key: 'danger', label: 'Hallucination' };
    if (k.compliance === false) return { key: 'warn', label: 'Non-compliant' };
    if (!k.hasJudge) return { key: 'info', label: 'Unjudged' };
    return { key: 'ok', label: 'OK' };
  }

  function computeQuestionStats(qid){
    const q = qById.get(qid) || {};
    const rs = recordsByQuestionId.get(qid) || [];
    let judged = 0;
    let leak = 0;
    let halluc = 0;
    let noncomp = 0;
    let latSum = 0;
    let latN = 0;
    let worst = 'ok';

    for (const r of rs){
      const k = recordKpis(r);
      if (k.hasJudge) judged += 1;
      if (k.leakage === true) leak += 1;
      if (k.hallucination === true) halluc += 1;
      if (k.compliance === false) noncomp += 1;
      if (typeof k.latencyMs === 'number'){ latSum += k.latencyMs; latN += 1; }
      const sev = severityFor(k);
      if (sev === 'bad') worst = 'bad';
      else if (sev === 'warn' && worst !== 'bad') worst = 'warn';
    }

    return {
      id: qid,
      bloomLevel: q.bloomLevel != null ? q.bloomLevel : null,
      difficulty: q.difficulty != null ? q.difficulty : null,
      topicTag: q.topicTag || null,
      courseLevel: q.courseLevel || null,
      skillTag: q.skillTag || null,
      problemStatement: q.problemStatement || '',
      runs: rs.length,
      judged,
      leak,
      halluc,
      noncomp,
      avgLatencyMs: latN ? latSum / latN : null,
      worst,
    };
  }

  const questionStats = allQuestionIds.map(computeQuestionStats);

  function pickRecord(qid, pairingId, condition){
    const rs = recordsByQuestionId.get(qid) || [];
    const matches = rs.filter(r => String(r.pairingId) === String(pairingId) && String(r.condition) === String(condition));
    if (!matches.length) return null;
    if (matches.length === 1) return matches[0];
    matches.sort((a, b) => byString(a.createdAtIso, b.createdAtIso));
    return matches[matches.length - 1];
  }

  // New function to pick record by tutor and supervision mode
  // Supports both new format (config.tutorId/supervisorId) and legacy format (pairingId)
  function pickRecordByTutorSupervision(qid, tutorId, supervisionMode){
    const rs = recordsByQuestionId.get(qid) || [];
    const matches = rs.filter(r => {
      const cfg = r && r.config ? r.config : null;
      
      // Try new format first
      let rTutorId = cfg && cfg.tutorId ? cfg.tutorId : null;
      let rSupId = cfg && cfg.supervisorId ? cfg.supervisorId : null;
      
      // Fall back to legacy format: extract from pairingId
      if (!rTutorId && r && r.pairingId) {
        const parts = String(r.pairingId).split('-');
        if (parts.length >= 1) rTutorId = parts[0];
        if (parts.length >= 2 && r.condition === 'dual-loop') rSupId = parts[1];
      }
      
      if (String(rTutorId) !== String(tutorId)) return false;
      
      if (supervisionMode.id === 'single') {
        return r.condition === 'single';
      } else {
        return r.condition === 'dual-loop' && String(rSupId) === String(supervisionMode.supervisorId);
      }
    });
    if (!matches.length) return null;
    if (matches.length === 1) return matches[0];
    matches.sort((a, b) => byString(a.createdAtIso, b.createdAtIso));
    return matches[matches.length - 1];
  }

  const ui = {
    tab: hasAnalysis ? 'analysis' : 'questions',
    qid: allQuestionIds[0] || 'unknown',
    pairingId: pairings[0] || '',
    condition: conditions[0] || '',
    tutorId: tutors[0] || '',
    supervisionModeId: supervisionModes[0] ? supervisionModes[0].id : '',
    drawerOpen: false,
    drawerTab: 'transcript',
    search: '',
    sort: 'risk',
    issuesOnly: false,
    leakOnly: false,
    hallucOnly: false,
    judgedOnly: false,
    showHidden: false,
    theme: 'light',
  };

  function applyTheme(theme){
    ui.theme = theme === 'dark' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', ui.theme);
    try{ localStorage.setItem('harnessReportTheme', ui.theme); }catch{}
    themeToggle.textContent = ui.theme === 'dark' ? 'Day' : 'Night';
  }

  function loadTheme(){
    const saved = (function(){ try{ return localStorage.getItem('harnessReportTheme'); }catch{ return null; } })();
    if (saved === 'dark' || saved === 'light') return saved;
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    return prefersDark ? 'dark' : 'light';
  }

  function encodeHashState(obj){
    try{
      const json = JSON.stringify(obj);
      const enc = encodeURIComponent(json);
      const bin = unescape(enc);
      return btoa(bin);
    }catch{
      return '';
    }
  }

  function decodeHashState(value){
    try{
      const bin = atob(value);
      const json = decodeURIComponent(escape(bin));
      return JSON.parse(json);
    }catch{
      return null;
    }
  }

  function readHash(){
    const m = String(location.hash || '').match(/#s=([^&]+)/);
    if (!m) return;
    const parsed = decodeHashState(m[1]);
    if (!parsed || typeof parsed !== 'object') return;
    if (parsed.tab === 'overview' || parsed.tab === 'analysis' || parsed.tab === 'questions') ui.tab = parsed.tab;
    if (typeof parsed.qid === 'string' && allQuestionIds.includes(parsed.qid)) ui.qid = parsed.qid;
    if (typeof parsed.pairingId === 'string' && pairings.includes(parsed.pairingId)) ui.pairingId = parsed.pairingId;
    if (typeof parsed.condition === 'string' && conditions.includes(parsed.condition)) ui.condition = parsed.condition;
    if (typeof parsed.tutorId === 'string' && tutors.includes(parsed.tutorId)) ui.tutorId = parsed.tutorId;
    if (typeof parsed.supervisionModeId === 'string') ui.supervisionModeId = parsed.supervisionModeId;
    if (parsed.drawerTab && ['transcript','judging','timings','hidden'].includes(parsed.drawerTab)) ui.drawerTab = parsed.drawerTab;
    ui.drawerOpen = !!parsed.drawerOpen;
    ui.issuesOnly = !!parsed.issuesOnly;
    ui.leakOnly = !!parsed.leakOnly;
    ui.hallucOnly = !!parsed.hallucOnly;
    ui.judgedOnly = !!parsed.judgedOnly;
    ui.showHidden = !!parsed.showHidden;
    if (typeof parsed.search === 'string') ui.search = parsed.search.slice(0, 200);
    if (parsed.sort && ['risk','id','difficulty','latency'].includes(parsed.sort)) ui.sort = parsed.sort;
  }

  function writeHash(){
    const state = {
      tab: ui.tab,
      qid: ui.qid,
      pairingId: ui.pairingId,
      condition: ui.condition,
      tutorId: ui.tutorId,
      supervisionModeId: ui.supervisionModeId,
      drawerOpen: ui.drawerOpen,
      drawerTab: ui.drawerTab,
      search: ui.search,
      sort: ui.sort,
      issuesOnly: ui.issuesOnly,
      leakOnly: ui.leakOnly,
      hallucOnly: ui.hallucOnly,
      judgedOnly: ui.judgedOnly,
      showHidden: ui.showHidden,
    };
    const encoded = encodeHashState(state);
    if (!encoded) return;
    history.replaceState(null, '', '#s=' + encoded);
  }

  function setPressed(btn, pressed){
    btn.setAttribute('aria-pressed', pressed ? 'true' : 'false');
  }

  function selectTab(tab){
    ui.tab = tab;
    render();
  }

  function openDrawer(pairingId, condition){
    ui.pairingId = pairingId;
    ui.condition = condition;
    ui.drawerOpen = true;
    render();
  }

  function openDrawerByTutorSupervision(tutorId, supervisionModeId){
    ui.tutorId = tutorId;
    ui.supervisionModeId = supervisionModeId;
    // Set pairingId and condition for backward compatibility with drawer
    const supMode = supervisionModes.find(m => m.id === supervisionModeId);
    if (supMode) {
      ui.pairingId = supMode.supervisorId ? tutorId + '-' + supMode.supervisorId : tutorId + '-single';
      ui.condition = supMode.supervisorId ? 'dual-loop' : 'single';
    }
    ui.drawerOpen = true;
    render();
  }

  function closeDrawer(){
    ui.drawerOpen = false;
    render();
  }

  function renderStatus(){
    const st = data.status || {};
    const state = st.state || 'running';
    const planned = st.plannedRuns != null ? st.plannedRuns : null;
    const completed = st.completedRuns != null ? st.completedRuns : records.length;
    const last = st.lastUpdatedAtIso || '';
    const current = st.current || null;

    const dotClass = state === 'complete' ? 'is-complete' : state === 'failed' ? 'is-failed' : 'is-running';
    const title = state === 'complete' ? 'Complete' : state === 'failed' ? 'Failed' : 'In progress';
    const parts = [];
    if (planned != null) parts.push('runs ' + completed + '/' + planned);
    else parts.push('runs ' + completed);
    if (last) parts.push('updated ' + last);
    if (current && state !== 'complete'){
      parts.push('at [' + current.index + '] q=' + current.questionId + ' bloom=' + current.bloomLevel + ' diff=' + current.difficulty + ' pairing=' + current.pairingId + ' cond=' + current.condition);
    }

    statusPill.innerHTML = '';
    const dot = document.createElement('span');
    dot.className = 'statusDot ' + dotClass;
    const text = document.createElement('div');
    text.className = 'statusText';

    const strong = document.createElement('strong');
    strong.textContent = title;
    text.appendChild(strong);

    const sub = document.createElement('div');
    sub.className = 'sub mono';
    sub.textContent = parts.join(' · ');
    text.appendChild(sub);

    statusPill.appendChild(dot);
    statusPill.appendChild(text);
  }

  function renderHeader(){
    metaRunId.textContent = escapeText(data.meta && data.meta.runId ? data.meta.runId : data.runId || '');
    metaCreatedAt.textContent = escapeText(data.meta && data.meta.createdAtIso ? data.meta.createdAtIso : data.createdAtIso || '');
    renderStatus();
  }

  function renderTabs(){
    tabOverview.setAttribute('aria-selected', ui.tab === 'overview' ? 'true' : 'false');
    tabAnalysis.setAttribute('aria-selected', ui.tab === 'analysis' ? 'true' : 'false');
    tabQuestions.setAttribute('aria-selected', ui.tab === 'questions' ? 'true' : 'false');
    viewOverview.hidden = ui.tab !== 'overview';
    viewAnalysis.hidden = ui.tab !== 'analysis';
    viewQuestions.hidden = ui.tab !== 'questions';
  }

  function overallAgg(){
    const out = {
      nRuns: records.length,
      nJudged: 0,
      leakage: 0,
      hallucination: 0,
      compliance: 0,
      latencySum: 0,
      latencyN: 0,
      supRuns: 0,
      supTurns: 0,
      supRejectedTurns: 0,
      supRejections: 0,
      supRevisions: 0,
    };
    for (const r of records){
      const k = recordKpis(r);
      if (k.hasJudge) out.nJudged += 1;
      if (k.leakage === true) out.leakage += 1;
      if (k.hallucination === true) out.hallucination += 1;
      if (k.compliance === true) out.compliance += 1;
      if (typeof k.latencyMs === 'number'){ out.latencySum += k.latencyMs; out.latencyN += 1; }

      const ls = recordLoopStats(r);
      if (ls){
        out.supRuns += 1;
        out.supTurns += ls.turns;
        out.supRejectedTurns += ls.rejectedTurns;
        out.supRejections += ls.supervisorRejections;
        out.supRevisions += ls.tutorRevisions;
      }
    }
    return out;
  }

  function groupAgg(){
    const groups = new Map();
    for (const r of records){
      const key = String(r.pairingId) + '::' + String(r.condition);
      const agg = groups.get(key) || {
        pairingId: String(r.pairingId),
        condition: String(r.condition),
        nRuns: 0,
        nJudged: 0,
        leakage: 0,
        hallucination: 0,
        compliance: 0,
        latencySum: 0,
        latencyN: 0,
        supRuns: 0,
        supTurns: 0,
        supRejectedTurns: 0,
        supRejections: 0,
        supRevisions: 0,
      };
      agg.nRuns += 1;
      const k = recordKpis(r);
      if (k.hasJudge) agg.nJudged += 1;
      if (k.leakage === true) agg.leakage += 1;
      if (k.hallucination === true) agg.hallucination += 1;
      if (k.compliance === true) agg.compliance += 1;
      if (typeof k.latencyMs === 'number'){ agg.latencySum += k.latencyMs; agg.latencyN += 1; }

      const ls = recordLoopStats(r);
      if (ls){
        agg.supRuns += 1;
        agg.supTurns += ls.turns;
        agg.supRejectedTurns += ls.rejectedTurns;
        agg.supRejections += ls.supervisorRejections;
        agg.supRevisions += ls.tutorRevisions;
      }
      groups.set(key, agg);
    }
    return Array.from(groups.values());
  }

  function renderOverview(){
    const agg = overallAgg();
    const planned = data.status && data.status.plannedRuns != null ? data.status.plannedRuns : null;
    const completed = data.status && data.status.completedRuns != null ? data.status.completedRuns : agg.nRuns;

    overviewRoot.innerHTML = '';

    const wrap = document.createElement('div');
    wrap.className = 'overviewGrid';

    const cards = document.createElement('div');
    cards.className = 'cards';
    const c1 = document.createElement('div');
    c1.className = 'card';
    c1.innerHTML = '<div class="k">Runs</div><div class="v">' + escapeHtml(completed) + (planned != null ? '/' + escapeHtml(planned) : '') + '</div><div class="s mono">records embedded in this HTML</div>';
    const c2 = document.createElement('div');
    c2.className = 'card';
    c2.innerHTML = '<div class="k">Leakage Rate</div><div class="v">' + (agg.nJudged ? fmtPct(agg.leakage / agg.nJudged) : 'n/a') + '</div><div class="s mono">judged=' + escapeHtml(agg.nJudged) + ' leaks=' + escapeHtml(agg.leakage) + '</div>';
    const c2b = document.createElement('div');
    c2b.className = 'card';
    c2b.innerHTML = '<div class="k">Hallucination Rate</div><div class="v">' + (agg.nJudged ? fmtPct(agg.hallucination / agg.nJudged) : 'n/a') + '</div><div class="s mono">hallucination=' + escapeHtml(agg.hallucination) + '</div>';
    const c3 = document.createElement('div');
    c3.className = 'card';
    c3.innerHTML = '<div class="k">Compliance Rate</div><div class="v">' + (agg.nJudged ? fmtPct(agg.compliance / agg.nJudged) : 'n/a') + '</div><div class="s mono">stayed Socratic=' + escapeHtml(agg.compliance) + '</div>';
    const c4 = document.createElement('div');
    c4.className = 'card';
    c4.innerHTML = '<div class="k">Avg Latency</div><div class="v">' + (agg.latencyN ? fmtMs(agg.latencySum / agg.latencyN) : 'n/a') + '</div><div class="s mono">end-to-end per run</div>';

    cards.appendChild(c1);
    cards.appendChild(c2);
    cards.appendChild(c2b);
    cards.appendChild(c3);
    cards.appendChild(c4);
    wrap.appendChild(cards);

    const groups = groupAgg();
    const byPairing = new Map();
    for (const g of groups){
      if (!byPairing.has(g.pairingId)) byPairing.set(g.pairingId, []);
      byPairing.get(g.pairingId).push(g);
    }

    const pairingIds = orderedPairings(Array.from(byPairing.keys()));
    for (const pid of pairingIds){
      const panel = document.createElement('div');
      panel.className = 'pairingPanel';
      const hd = document.createElement('div');
      hd.className = 'pairingPanel__hd';
      hd.innerHTML = '<div class="pairingPanel__title">' + escapeHtml(pid) + '</div>' +
        '<div class="pairingPanel__sub mono">' + escapeHtml(pairingLabel(pid)) + '</div>';
      panel.appendChild(hd);

      const bd = document.createElement('div');
      bd.className = 'pairingPanel__bd';

      const condGrid = document.createElement('div');
      condGrid.className = 'condGrid';

      const condsForPid = (byPairing.get(pid) || []).slice().sort((a, b) => orderedConditions([a.condition, b.condition]).indexOf(a.condition) - orderedConditions([a.condition, b.condition]).indexOf(b.condition));
      for (const cond of orderedConditions(condsForPid.map(x => x.condition))){
        const g = condsForPid.find(x => x.condition === cond) || null;
        const card = document.createElement('div');
        card.className = 'condCard';
        const nJudged = g ? g.nJudged : 0;
        const leakRate = g && nJudged ? g.leakage / nJudged : null;
        const compRate = g && nJudged ? g.compliance / nJudged : null;
        const avgLat = g && g.latencyN ? g.latencySum / g.latencyN : null;

        const hasLoop = g && g.supRuns;

        card.innerHTML =
          '<div class="t">' + escapeHtml(cond) + '</div>' +
          '<div class="row">' +
            '<div class="miniStat"><div class="k">runs</div><div class="v mono"><strong>' + escapeHtml(g ? g.nRuns : 0) + '</strong></div></div>' +
            '<div class="miniStat"><div class="k">leak</div><div class="v mono"><strong>' + fmtPct(leakRate) + '</strong></div></div>' +
            '<div class="miniStat"><div class="k">hallucination</div><div class="v mono"><strong>' + (g && nJudged ? fmtPct(g.hallucination / nJudged) : 'n/a') + '</strong></div></div>' +
            '<div class="miniStat"><div class="k">comp</div><div class="v mono"><strong>' + fmtPct(compRate) + '</strong></div></div>' +
            '<div class="miniStat"><div class="k">lat</div><div class="v mono"><strong>' + fmtMs(avgLat) + '</strong></div></div>' +
            '<div class="miniStat"><div class="k">supervisor intervention</div><div class="v mono"><strong>' + (hasLoop && g.supTurns ? fmtPct(g.supRejectedTurns / g.supTurns) : 'n/a') + '</strong></div></div>' +
          '</div>';
        condGrid.appendChild(card);
      }

      bd.appendChild(condGrid);
      panel.appendChild(bd);
      wrap.appendChild(panel);
    }

    const argsBlock = document.createElement('details');
    argsBlock.className = 'block';
    argsBlock.open = false;
    const sum = document.createElement('summary');
    sum.className = 'block__title';
    sum.textContent = 'Run config (args)';
    argsBlock.appendChild(sum);
    const pre = document.createElement('pre');
    pre.className = 'pre';
    pre.textContent = safeJson(data.args || {});
    argsBlock.appendChild(pre);
    wrap.appendChild(argsBlock);

    overviewRoot.appendChild(wrap);
  }

  function buildTable(columns, rows){
    const table = document.createElement('table');
    table.className = 'table';
    const thead = document.createElement('thead');
    const hr = document.createElement('tr');
    for (const col of columns){
      const th = document.createElement('th');
      th.textContent = col.label;
      hr.appendChild(th);
    }
    thead.appendChild(hr);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    for (const row of rows){
      const tr = document.createElement('tr');
      for (const col of columns){
        const td = document.createElement('td');
        const raw = col.value(row);
        const text = col.format ? col.format(raw, row) : (raw == null ? 'n/a' : String(raw));
        td.textContent = text;
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    return table;
  }

  function buildAnalysisPanel(title, subtitle, rows, columns){
    const panel = document.createElement('div');
    panel.className = 'analysisPanel';
    const hd = document.createElement('div');
    hd.className = 'analysisPanel__hd';
    const meta = document.createElement('div');
    meta.className = 'analysisPanel__meta';
    const t = document.createElement('div');
    t.className = 'analysisPanel__title';
    t.textContent = title;
    meta.appendChild(t);
    if (subtitle){
      const sub = document.createElement('div');
      sub.className = 'analysisPanel__sub mono';
      sub.textContent = subtitle;
      meta.appendChild(sub);
    }
    hd.appendChild(meta);

    panel.appendChild(hd);

    const bd = document.createElement('div');
    bd.className = 'analysisPanel__bd';
    if (!rows || !rows.length){
      const empty = document.createElement('div');
      empty.className = 'emptyState';
      empty.textContent = 'No data in this section.';
      bd.appendChild(empty);
    }else{
      const wrap = document.createElement('div');
      wrap.className = 'tableWrap';
      wrap.appendChild(buildTable(columns, rows));
      bd.appendChild(wrap);
    }
    panel.appendChild(bd);
    return panel;
  }

  function buildChartCard(title, subtitle, tooltip){
    const card = document.createElement('div');
    card.className = 'chartCard';
    const hd = document.createElement('div');
    hd.className = 'chartCard__hd';
    const t = document.createElement('div');
    t.className = 'chartCard__title';
    t.textContent = title;
    if (tooltip){
      const tip = document.createElement('span');
      tip.className = 'chartTip';
      tip.textContent = '?';
      tip.title = tooltip;
      t.appendChild(tip);
    }
    hd.appendChild(t);
    if (subtitle){
      const sub = document.createElement('div');
      sub.className = 'chartCard__sub mono';
      sub.textContent = subtitle;
      hd.appendChild(sub);
    }
    card.appendChild(hd);
    const bd = document.createElement('div');
    bd.className = 'chartCard__bd';
    card.appendChild(bd);
    return { card, body: bd };
  }

  function buildBarChartRows(labels, values, formatter){
    const wrap = document.createElement('div');
    wrap.className = 'barChart';
    const maxVal = Math.max(0, ...values.map(v => (Number.isFinite(v) ? v : 0)));
    labels.forEach((label, idx) => {
      const value = values[idx];
      const safeValue = Number.isFinite(value) ? value : 0;
      const row = document.createElement('div');
      row.className = 'barChart__row';
      const lab = document.createElement('div');
      lab.className = 'barChart__label mono';
      lab.textContent = label;
      const bar = document.createElement('div');
      bar.className = 'barChart__bar';
      const fill = document.createElement('span');
      const pct = maxVal > 0 ? Math.max(0, Math.min(1, safeValue / maxVal)) : 0;
      fill.style.width = (pct * 100).toFixed(1) + '%';
      bar.appendChild(fill);
      const val = document.createElement('div');
      val.className = 'barChart__value mono';
      val.textContent = formatter(value);
      row.appendChild(lab);
      row.appendChild(bar);
      row.appendChild(val);
      wrap.appendChild(row);
    });
    return wrap;
  }

  function buildBarChartRowsWithValues(labels, barValues, labelValues, formatter){
    const wrap = document.createElement('div');
    wrap.className = 'barChart';
    const maxVal = Math.max(0, ...barValues.map(v => (Number.isFinite(v) ? Math.abs(v) : 0)));
    labels.forEach((label, idx) => {
      const barValue = barValues[idx];
      const labelValue = labelValues[idx];
      const safeBar = Number.isFinite(barValue) ? Math.abs(barValue) : 0;
      const row = document.createElement('div');
      row.className = 'barChart__row';
      const lab = document.createElement('div');
      lab.className = 'barChart__label mono';
      lab.textContent = label;
      const bar = document.createElement('div');
      bar.className = 'barChart__bar';
      const fill = document.createElement('span');
      const pct = maxVal > 0 ? Math.max(0, Math.min(1, safeBar / maxVal)) : 0;
      fill.style.width = (pct * 100).toFixed(1) + '%';
      bar.appendChild(fill);
      const val = document.createElement('div');
      val.className = 'barChart__value mono';
      val.textContent = formatter(labelValue);
      row.appendChild(lab);
      row.appendChild(bar);
      row.appendChild(val);
      wrap.appendChild(row);
    });
    return wrap;
  }

  function buildGroupedBarChart(labels, series, formatter){
    const wrap = document.createElement('div');
    wrap.className = 'groupedBar';
    const maxVal = Math.max(
      0,
      ...series.flatMap(s => s.values.map(v => (Number.isFinite(v) ? Math.abs(v) : 0)))
    );
    labels.forEach((label, idx) => {
      const row = document.createElement('div');
      row.className = 'groupedBar__row';
      const lab = document.createElement('div');
      lab.className = 'groupedBar__label mono';
      lab.textContent = label;
      const bars = document.createElement('div');
      bars.className = 'groupedBar__bars';
      const val = document.createElement('div');
      val.className = 'groupedBar__value mono';
      series.forEach((s, sIdx) => {
        const raw = s.values[idx];
        const safe = Number.isFinite(raw) ? Math.abs(raw) : 0;
        const pct = maxVal > 0 ? Math.max(0, Math.min(1, safe / maxVal)) : 0;
        const bar = document.createElement('div');
        bar.className = 'groupedBar__bar';
        const fill = document.createElement('span');
        fill.style.width = (pct * 100).toFixed(1) + '%';
        fill.style.background = s.color;
        bar.appendChild(fill);
        bars.appendChild(bar);
        const line = document.createElement('div');
        line.className = 'groupedBar__valueLine';
        line.textContent = s.name + ' ' + formatter(raw);
        val.appendChild(line);
      });
      row.appendChild(lab);
      row.appendChild(bars);
      row.appendChild(val);
      wrap.appendChild(row);
    });
    return wrap;
  }

  function heatColor(value, maxAbs){
    if (value == null || !Number.isFinite(value)) return 'transparent';
    if (!maxAbs) return 'transparent';
    const t = Math.min(1, Math.abs(value) / maxAbs);
    if (value < 0){
      return 'rgba(30, 86, 49, ' + (0.12 + t * 0.5).toFixed(3) + ')';
    }
    return 'rgba(155, 27, 27, ' + (0.12 + t * 0.5).toFixed(3) + ')';
  }

  function heatColorAbsolute(value, maxVal){
    if (value == null || !Number.isFinite(value)) return 'transparent';
    if (!maxVal) return 'transparent';
    const t = Math.min(1, value / maxVal);
    return 'rgba(155, 27, 27, ' + (0.08 + t * 0.55).toFixed(3) + ')';
  }

  function buildAbsoluteHeatmap(rowLabels, colLabels, rows, valueKey, formatter){
    const wrap = document.createElement('div');
    wrap.className = 'heatmap';
    const values = rows.map(r => r[valueKey]).filter(v => Number.isFinite(v));
    const maxVal = values.length ? Math.max(...values) : 0;

    const header = document.createElement('div');
    header.className = 'heatmap__row heatmap__row--head';
    const corner = document.createElement('div');
    corner.className = 'heatmap__cell heatmap__cell--corner';
    header.appendChild(corner);
    colLabels.forEach((label) => {
      const cell = document.createElement('div');
      cell.className = 'heatmap__cell heatmap__cell--head mono';
      cell.textContent = label;
      header.appendChild(cell);
    });
    wrap.appendChild(header);

    rowLabels.forEach((rowLabel) => {
      const row = document.createElement('div');
      row.className = 'heatmap__row';
      const head = document.createElement('div');
      head.className = 'heatmap__cell heatmap__cell--head mono';
      head.textContent = rowLabel;
      row.appendChild(head);
      colLabels.forEach((colLabel) => {
        const data = rows.find(r => r.rowLabel === rowLabel && r.colLabel === colLabel);
        const val = data ? data[valueKey] : null;
        const cell = document.createElement('div');
        cell.className = 'heatmap__cell';
        cell.style.background = heatColorAbsolute(val, maxVal);
        cell.title = formatter(val);
        cell.textContent = formatter(val);
        row.appendChild(cell);
      });
      wrap.appendChild(row);
    });

    return wrap;
  }

  function buildBoxPlot(items, options){
    const svgNs = 'http://www.w3.org/2000/svg';
    const width = options && options.width ? options.width : 500;
    const rowHeight = 36;
    const labelWidth = 100;
    const padRight = 60;
    const height = items.length * rowHeight + 20;
    
    const allValues = items.flatMap(item => [item.min, item.max, item.p25, item.p75, item.median].filter(v => Number.isFinite(v)));
    const minVal = Math.min(0, ...allValues);
    const maxVal = Math.max(...allValues);
    const range = maxVal - minVal || 1;
    
    const scaleX = (v) => labelWidth + ((v - minVal) / range) * (width - labelWidth - padRight);
    
    const svg = document.createElementNS(svgNs, 'svg');
    svg.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
    svg.classList.add('boxPlot');
    
    items.forEach((item, idx) => {
      const y = idx * rowHeight + 18;
      const boxHeight = 16;
      
      const label = document.createElementNS(svgNs, 'text');
      label.setAttribute('x', '4');
      label.setAttribute('y', String(y + 5));
      label.setAttribute('class', 'boxPlot__label');
      label.textContent = item.label;
      svg.appendChild(label);
      
      const whiskerLine = document.createElementNS(svgNs, 'line');
      whiskerLine.setAttribute('x1', String(scaleX(item.min)));
      whiskerLine.setAttribute('x2', String(scaleX(item.max)));
      whiskerLine.setAttribute('y1', String(y));
      whiskerLine.setAttribute('y2', String(y));
      whiskerLine.setAttribute('class', 'boxPlot__whisker');
      svg.appendChild(whiskerLine);
      
      const minCap = document.createElementNS(svgNs, 'line');
      minCap.setAttribute('x1', String(scaleX(item.min)));
      minCap.setAttribute('x2', String(scaleX(item.min)));
      minCap.setAttribute('y1', String(y - 6));
      minCap.setAttribute('y2', String(y + 6));
      minCap.setAttribute('class', 'boxPlot__whisker');
      svg.appendChild(minCap);
      
      const maxCap = document.createElementNS(svgNs, 'line');
      maxCap.setAttribute('x1', String(scaleX(item.max)));
      maxCap.setAttribute('x2', String(scaleX(item.max)));
      maxCap.setAttribute('y1', String(y - 6));
      maxCap.setAttribute('y2', String(y + 6));
      maxCap.setAttribute('class', 'boxPlot__whisker');
      svg.appendChild(maxCap);
      
      const box = document.createElementNS(svgNs, 'rect');
      box.setAttribute('x', String(scaleX(item.p25)));
      box.setAttribute('y', String(y - boxHeight / 2));
      box.setAttribute('width', String(Math.max(1, scaleX(item.p75) - scaleX(item.p25))));
      box.setAttribute('height', String(boxHeight));
      box.setAttribute('class', 'boxPlot__box');
      box.setAttribute('rx', '2');
      svg.appendChild(box);
      
      const medianLine = document.createElementNS(svgNs, 'line');
      medianLine.setAttribute('x1', String(scaleX(item.median)));
      medianLine.setAttribute('x2', String(scaleX(item.median)));
      medianLine.setAttribute('y1', String(y - boxHeight / 2));
      medianLine.setAttribute('y2', String(y + boxHeight / 2));
      medianLine.setAttribute('class', 'boxPlot__median');
      svg.appendChild(medianLine);
      
      const valLabel = document.createElementNS(svgNs, 'text');
      valLabel.setAttribute('x', String(scaleX(item.max) + 6));
      valLabel.setAttribute('y', String(y + 4));
      valLabel.setAttribute('class', 'boxPlot__value');
      valLabel.textContent = item.formatter ? item.formatter(item.median) : String(item.median);
      svg.appendChild(valLabel);
    });
    
    return svg;
  }

  function buildHeatmap(rowLabels, colLabels, rows, valueKey, formatter){
    const wrap = document.createElement('div');
    wrap.className = 'heatmap';
    const values = rows.map(r => r[valueKey]).filter(v => Number.isFinite(v));
    const maxAbs = values.length ? Math.max(...values.map(v => Math.abs(v))) : 0;

    const header = document.createElement('div');
    header.className = 'heatmap__row heatmap__row--head';
    const corner = document.createElement('div');
    corner.className = 'heatmap__cell heatmap__cell--corner';
    header.appendChild(corner);
    colLabels.forEach((label) => {
      const cell = document.createElement('div');
      cell.className = 'heatmap__cell heatmap__cell--head mono';
      cell.textContent = label;
      header.appendChild(cell);
    });
    wrap.appendChild(header);

    rowLabels.forEach((rowLabel) => {
      const row = document.createElement('div');
      row.className = 'heatmap__row';
      const head = document.createElement('div');
      head.className = 'heatmap__cell heatmap__cell--head mono';
      head.textContent = rowLabel;
      row.appendChild(head);
      colLabels.forEach((colLabel) => {
        const data = rows.find(r => r.rowLabel === rowLabel && r.colLabel === colLabel);
        const val = data ? data[valueKey] : null;
        const cell = document.createElement('div');
        cell.className = 'heatmap__cell';
        cell.style.background = heatColor(val, maxAbs);
        cell.title = formatter(val);
        cell.textContent = formatter(val);
        row.appendChild(cell);
      });
      wrap.appendChild(row);
    });

    return wrap;
  }

  function buildScatterPlot(points, options){
    const svgNs = 'http://www.w3.org/2000/svg';
    const width = options && options.width ? options.width : 520;
    const height = options && options.height ? options.height : 260;
    const pad = 30;
    const innerW = width - pad * 2;
    const innerH = height - pad * 2;
    const xs = points.map(p => p.x).filter(v => Number.isFinite(v));
    const ys = points.map(p => p.y).filter(v => Number.isFinite(v));
    const minX = Math.min(0, ...xs);
    const maxX = Math.max(0, ...xs);
    const minY = Math.min(0, ...ys);
    const maxY = Math.max(0, ...ys);
    const padX = (maxX - minX) * 0.1 || 0.1;
    const padY = (maxY - minY) * 0.1 || 0.1;
    const x0 = minX - padX;
    const x1 = maxX + padX;
    const y0 = minY - padY;
    const y1 = maxY + padY;
    const scaleX = (v) => pad + ((v - x0) / (x1 - x0 || 1)) * innerW;
    const scaleY = (v) => pad + innerH - ((v - y0) / (y1 - y0 || 1)) * innerH;

    const svg = document.createElementNS(svgNs, 'svg');
    svg.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
    svg.classList.add('scatterChart');

    const bg = document.createElementNS(svgNs, 'rect');
    bg.setAttribute('x', String(pad));
    bg.setAttribute('y', String(pad));
    bg.setAttribute('width', String(innerW));
    bg.setAttribute('height', String(innerH));
    bg.setAttribute('rx', '2');
    bg.setAttribute('class', 'scatterChart__bg');
    svg.appendChild(bg);

    const axis = document.createElementNS(svgNs, 'line');
    axis.setAttribute('x1', String(pad));
    axis.setAttribute('x2', String(pad + innerW));
    axis.setAttribute('y1', String(scaleY(0)));
    axis.setAttribute('y2', String(scaleY(0)));
    axis.setAttribute('class', 'scatterChart__axis');
    svg.appendChild(axis);

    const axisY = document.createElementNS(svgNs, 'line');
    axisY.setAttribute('x1', String(scaleX(0)));
    axisY.setAttribute('x2', String(scaleX(0)));
    axisY.setAttribute('y1', String(pad));
    axisY.setAttribute('y2', String(pad + innerH));
    axisY.setAttribute('class', 'scatterChart__axis');
    svg.appendChild(axisY);

    points.forEach((p) => {
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return;
      if (p.shape === 'square') {
        const rect = document.createElementNS(svgNs, 'rect');
        rect.setAttribute('x', String(scaleX(p.x) - 4));
        rect.setAttribute('y', String(scaleY(p.y) - 4));
        rect.setAttribute('width', '8');
        rect.setAttribute('height', '8');
        rect.setAttribute('fill', p.color || 'var(--accent)');
        rect.setAttribute('class', 'scatterChart__point');
        if (p.label) rect.setAttribute('title', p.label);
        svg.appendChild(rect);
        return;
      }
      const circle = document.createElementNS(svgNs, 'circle');
      circle.setAttribute('cx', String(scaleX(p.x)));
      circle.setAttribute('cy', String(scaleY(p.y)));
      circle.setAttribute('r', '4');
      circle.setAttribute('fill', p.color || 'var(--accent)');
      circle.setAttribute('class', 'scatterChart__point');
      if (p.label) circle.setAttribute('title', p.label);
      svg.appendChild(circle);
    });

    return svg;
  }

  function buildLineChart(labels, series){
    const svgNs = 'http://www.w3.org/2000/svg';
    const width = 640;
    const height = 220;
    const pad = 28;
    const innerW = width - pad * 2;
    const innerH = height - pad * 2;

    const svg = document.createElementNS(svgNs, 'svg');
    svg.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
    svg.classList.add('lineChart');

    const bg = document.createElementNS(svgNs, 'rect');
    bg.setAttribute('x', String(pad));
    bg.setAttribute('y', String(pad));
    bg.setAttribute('width', String(innerW));
    bg.setAttribute('height', String(innerH));
    bg.setAttribute('rx', '2');
    bg.setAttribute('class', 'lineChart__bg');
    svg.appendChild(bg);

    const grid = [0, 0.5, 1];
    grid.forEach((g) => {
      const y = pad + innerH - innerH * g;
      const line = document.createElementNS(svgNs, 'line');
      line.setAttribute('x1', String(pad));
      line.setAttribute('x2', String(pad + innerW));
      line.setAttribute('y1', String(y));
      line.setAttribute('y2', String(y));
      line.setAttribute('class', 'lineChart__grid');
      svg.appendChild(line);

      const label = document.createElementNS(svgNs, 'text');
      label.setAttribute('x', String(4));
      label.setAttribute('y', String(y + 4));
      label.setAttribute('class', 'lineChart__label');
      label.textContent = String(Math.round(g * 100)) + '%';
      svg.appendChild(label);
    });

    const count = labels.length;
    const xAt = (i) => pad + innerW * (count <= 1 ? 0 : i / (count - 1));
    const yAt = (v) => pad + innerH - innerH * Math.max(0, Math.min(1, v || 0));

    series.forEach((s) => {
      const points = s.values.map((v, i) => xAt(i) + ',' + yAt(v)).join(' ');
      const poly = document.createElementNS(svgNs, 'polyline');
      poly.setAttribute('points', points);
      poly.setAttribute('class', 'lineChart__line');
      poly.style.stroke = s.color;
      svg.appendChild(poly);
    });

    const step = count > 10 ? 2 : 1;
    labels.forEach((label, i) => {
      if (i % step !== 0) return;
      const x = xAt(i);
      const text = document.createElementNS(svgNs, 'text');
      text.setAttribute('x', String(x));
      text.setAttribute('y', String(height - 6));
      text.setAttribute('class', 'lineChart__tick');
      text.textContent = label;
      svg.appendChild(text);
    });

    return svg;
  }

  function buildLegend(series){
    const legend = document.createElement('div');
    legend.className = 'chartLegend';
    series.forEach((s) => {
      const item = document.createElement('div');
      item.className = 'chartLegend__item';
      const swatch = document.createElement('span');
      swatch.className = 'chartLegend__swatch';
      swatch.style.background = s.color;
      const label = document.createElement('span');
      label.textContent = s.name;
      item.appendChild(swatch);
      item.appendChild(label);
      legend.appendChild(item);
    });
    return legend;
  }

  function renderAnalysis(){
    if (!analysisRoot) return;
    analysisRoot.innerHTML = '';
    if (!analysis || !analysis.tables){
      const empty = document.createElement('div');
      empty.className = 'emptyState';
      empty.textContent = 'Analysis data is missing for this report.';
      analysisRoot.appendChild(empty);
      return;
    }

    const wrap = document.createElement('div');
    wrap.className = 'analysisGrid';

    const overall = analysis.tables.overall && analysis.tables.overall[0] ? analysis.tables.overall[0] : null;
    if (overall){
      const cards = document.createElement('div');
      cards.className = 'cards';

      const c1 = document.createElement('div');
      c1.className = 'card';
      c1.innerHTML =
        '<div class="k">Runs</div><div class="v">' +
        escapeHtml(overall.nRuns) +
        '</div><div class="s mono">judged ' +
        escapeHtml(overall.nJudgedRuns) +
        '</div>';

      const c2 = document.createElement('div');
      c2.className = 'card';
      c2.innerHTML =
        '<div class="k">Leakage Rate</div><div class="v">' +
        escapeHtml(fmtPct(overall.leakageRate)) +
        '</div><div class="s mono">count ' +
        escapeHtml(overall.leakageCount) +
        '</div>';

      const c3 = document.createElement('div');
      c3.className = 'card';
      c3.innerHTML =
        '<div class="k">Hallucination Rate</div><div class="v">' +
        escapeHtml(fmtPct(overall.hallucinationRate)) +
        '</div><div class="s mono">count ' +
        escapeHtml(overall.hallucinationCount) +
        '</div>';

      const c4 = document.createElement('div');
      c4.className = 'card';
      c4.innerHTML =
        '<div class="k">Compliance Rate</div><div class="v">' +
        escapeHtml(fmtPct(overall.complianceRate)) +
        '</div><div class="s mono">count ' +
        escapeHtml(overall.complianceCount) +
        '</div>';

      const c5 = document.createElement('div');
      c5.className = 'card';
      c5.innerHTML =
        '<div class="k">Early Stop</div><div class="v">' +
        escapeHtml(fmtPct(overall.earlyStopRate)) +
        '</div><div class="s mono">leakage ' +
        escapeHtml(overall.earlyStopLeakageCount) +
        '</div>';

      const c6 = document.createElement('div');
      c6.className = 'card';
      c6.innerHTML =
        '<div class="k">Latency Mean</div><div class="v">' +
        escapeHtml(fmtMs(overall.latencyMeanMs)) +
        '</div><div class="s mono">p90 ' +
        escapeHtml(fmtMs(overall.latencyP90Ms)) +
        '</div>';

      const c7 = document.createElement('div');
      c7.className = 'card';
      c7.innerHTML =
        '<div class="k">Supervisor Interv.</div><div class="v">' +
        escapeHtml(fmtPct(overall.loopInterventionRate)) +
        '</div><div class="s mono">fix ' +
        escapeHtml(fmtPct(overall.loopFixRate)) +
        '</div>';

      cards.appendChild(c1);
      cards.appendChild(c2);
      cards.appendChild(c3);
      cards.appendChild(c4);
      cards.appendChild(c5);
      cards.appendChild(c6);
      cards.appendChild(c7);
      wrap.appendChild(cards);
    }

    const chartGrid = document.createElement('div');
    chartGrid.className = 'analysisCharts';

    // === ABSOLUTE VISUALIZATIONS FIRST ===

    // Combined leakage chart: all 6 configs (single + dual-loop with supervisors)
    if (analysis.tables.byTutorCondition && analysis.tables.byTutorSupervisor){
      const { card, body } = buildChartCard(
        'Leakage by tutor × supervision',
        'All configurations compared',
        'Shows baseline (single) and supervised (dual-loop) leakage rates. Lower is better.'
      );
      const combined = [];
      const tutorCondition = analysis.tables.byTutorCondition || [];
      const tutorSupervisor = analysis.tables.byTutorSupervisor || [];
      for (const r of tutorCondition){
        if (r.condition === 'single'){
          combined.push({ label: String(r.tutorId) + ' (single)', leakageRate: r.leakageRate, latencyMeanMs: r.latencyMeanMs });
        }
      }
      for (const r of tutorSupervisor){
        combined.push({ label: String(r.tutorId) + ' + ' + String(r.supervisorId) + ' sup', leakageRate: r.leakageRate, latencyMeanMs: r.latencyMeanMs });
      }
      combined.sort((a, b) => (a.leakageRate || 0) - (b.leakageRate || 0));
      const labels = combined.map((r) => r.label);
      const values = combined.map((r) => r.leakageRate);
      body.appendChild(buildBarChartRows(labels, values, fmtPct));
      chartGrid.appendChild(card);
    }

    // Combined latency chart: all 6 configs
    if (analysis.tables.byTutorCondition && analysis.tables.byTutorSupervisor){
      const { card, body } = buildChartCard(
        'Avg latency by tutor × supervision',
        'All configurations compared',
        'Average end-to-end latency per run. Dual-loop adds supervisor overhead.'
      );
      const combined = [];
      const tutorCondition = analysis.tables.byTutorCondition || [];
      const tutorSupervisor = analysis.tables.byTutorSupervisor || [];
      for (const r of tutorCondition){
        if (r.condition === 'single'){
          combined.push({ label: String(r.tutorId) + ' (single)', latencyMeanMs: r.latencyMeanMs });
        }
      }
      for (const r of tutorSupervisor){
        combined.push({ label: String(r.tutorId) + ' + ' + String(r.supervisorId) + ' sup', latencyMeanMs: r.latencyMeanMs });
      }
      combined.sort((a, b) => (a.latencyMeanMs || 0) - (b.latencyMeanMs || 0));
      const labels = combined.map((r) => r.label);
      const values = combined.map((r) => r.latencyMeanMs);
      body.appendChild(buildBarChartRows(labels, values, fmtMs));
      chartGrid.appendChild(card);
    }

    if (analysis.tables.byTutorSupervisor && analysis.tables.byTutorSupervisor.length){
      const { card, body } = buildChartCard(
        'Tutor × supervisor heatmap',
        'Absolute leakage rate',
        'Each cell shows leakage rate for that tutor-supervisor pairing. Darker red = higher leakage.'
      );
      const rows = analysis.tables.byTutorSupervisor.map((r) => ({
        rowLabel: String(r.tutorId || 'unknown'),
        colLabel: String(r.supervisorId || 'unknown'),
        leakageRate: r.leakageRate,
      }));
      const rowLabels = Array.from(new Set(rows.map((r) => r.rowLabel))).sort(byString);
      const colLabels = Array.from(new Set(rows.map((r) => r.colLabel))).sort(byString);
      body.appendChild(buildAbsoluteHeatmap(rowLabels, colLabels, rows, 'leakageRate', fmtPct));
      chartGrid.appendChild(card);
    }

    if (analysis.tables.byBloomDifficulty && analysis.tables.byBloomDifficulty.length){
      const { card, body } = buildChartCard(
        'Bloom × difficulty heatmap',
        'Absolute leakage rate',
        'Each cell shows leakage rate for that Bloom level and difficulty. Darker red = higher leakage.'
      );
      const rows = analysis.tables.byBloomDifficulty.map((r) => ({
        rowLabel: r.bloomLevel != null ? 'B' + r.bloomLevel : 'B?',
        colLabel: r.difficulty != null ? String(r.difficulty) : 'unknown',
        leakageRate: r.leakageRate,
      }));
      const difficultyRank = { easy: 1, medium: 2, hard: 3 };
      const rowLabels = Array.from(new Set(rows.map((r) => r.rowLabel))).sort(byString);
      const colLabels = Array.from(new Set(rows.map((r) => r.colLabel))).sort((a, b) => {
        const ar = difficultyRank[String(a)] ?? 99;
        const br = difficultyRank[String(b)] ?? 99;
        if (ar !== br) return ar - br;
        return String(a).localeCompare(String(b));
      });
      body.appendChild(buildAbsoluteHeatmap(rowLabels, colLabels, rows, 'leakageRate', fmtPct));
      chartGrid.appendChild(card);
    }

    // === DELTA VISUALIZATIONS ===

    if (analysis.tables.labEffects && analysis.tables.labEffects.length){
      const { card, body } = buildChartCard(
        'Leakage delta by supervisor lab',
        'Dual - single (bar = magnitude)',
        'Delta = dual-loop leakage minus single-loop leakage for that lab. Negative is improvement.'
      );
      const rows = analysis.tables.labEffects;
      const labels = rows.map((r) => String(r.lab || 'unknown'));
      const barValues = rows.map((r) => r.leakageDelta ?? 0);
      const labelValues = rows.map((r) => r.leakageDelta);
      body.appendChild(buildBarChartRowsWithValues(labels, barValues, labelValues, fmtPct));
      chartGrid.appendChild(card);
    }

    if (analysis.tables.labPairTypeEffects && analysis.tables.labPairTypeEffects.length){
      const { card, body } = buildChartCard(
        'Leakage delta by lab pairing',
        'Same-lab vs cross-lab (bar = magnitude)',
        'Compares same-lab vs cross-lab supervisors. Negative delta means fewer leaks than single-loop.'
      );
      const rows = analysis.tables.labPairTypeEffects;
      const labels = rows.map((r) => String(r.pairType || 'unknown'));
      const barValues = rows.map((r) => r.leakageDelta ?? 0);
      const labelValues = rows.map((r) => r.leakageDelta);
      body.appendChild(buildBarChartRowsWithValues(labels, barValues, labelValues, fmtPct));
      chartGrid.appendChild(card);
    }

    if (analysis.tables.labEffects && analysis.tables.labEffects.length){
      const { card, body } = buildChartCard(
        'Compliance delta by supervisor lab',
        'Dual - single (bar = magnitude)',
        'Delta = dual-loop compliance minus single-loop compliance. Positive is improvement.'
      );
      const rows = analysis.tables.labEffects;
      const labels = rows.map((r) => String(r.lab || 'unknown'));
      const barValues = rows.map((r) => r.complianceDelta ?? 0);
      const labelValues = rows.map((r) => r.complianceDelta);
      body.appendChild(buildBarChartRowsWithValues(labels, barValues, labelValues, fmtPct));
      chartGrid.appendChild(card);
    }

    if (analysis.tables.labPairTypeEffects && analysis.tables.labPairTypeEffects.length){
      const { card, body } = buildChartCard(
        'Compliance delta by lab pairing',
        'Same-lab vs cross-lab (bar = magnitude)',
        'Positive delta means higher compliance than single-loop for that pairing type.'
      );
      const rows = analysis.tables.labPairTypeEffects;
      const labels = rows.map((r) => String(r.pairType || 'unknown'));
      const barValues = rows.map((r) => r.complianceDelta ?? 0);
      const labelValues = rows.map((r) => r.complianceDelta);
      body.appendChild(buildBarChartRowsWithValues(labels, barValues, labelValues, fmtPct));
      chartGrid.appendChild(card);
    }

    if (analysis.tables.labInteraction && analysis.tables.labInteraction.length){
      const { card, body } = buildChartCard(
        'Lab interaction heatmap (delta)',
        'Leakage delta by tutor lab × supervisor lab',
        'Each cell is dual minus single leakage for that tutor lab baseline. Negative is improvement.'
      );
      const rows = analysis.tables.labInteraction.map((r) => ({
        rowLabel: String(r.tutorLab || 'unknown'),
        colLabel: String(r.supervisorLab || 'unknown'),
        leakageDelta: r.leakageDelta,
      }));
      const rowLabels = Array.from(new Set(rows.map((r) => r.rowLabel))).sort(byString);
      const colLabels = Array.from(new Set(rows.map((r) => r.colLabel))).sort(byString);
      body.appendChild(buildHeatmap(rowLabels, colLabels, rows, 'leakageDelta', fmtPct));
      chartGrid.appendChild(card);
    }

    if (analysis.tables.tutorPairTypeEffects && analysis.tables.tutorPairTypeEffects.length){
      const { card, body } = buildChartCard(
        'Leakage delta by tutor and lab pairing',
        'Same-lab vs cross-lab per tutor',
        'For each tutor, compares leakage delta for same-lab vs cross-lab supervisors.'
      );
      const rows = analysis.tables.tutorPairTypeEffects;
      const labels = Array.from(new Set(rows.map((r) => String(r.tutorId || 'unknown'))));
      const series = [
        {
          name: 'Same-lab',
          color: 'var(--accent)',
          values: labels.map((label) => {
            const row = rows.find((r) => String(r.tutorId) === label && r.pairType === 'same-lab');
            return row ? row.leakageDelta : null;
          }),
        },
        {
          name: 'Cross-lab',
          color: 'var(--accent2)',
          values: labels.map((label) => {
            const row = rows.find((r) => String(r.tutorId) === label && r.pairType === 'cross-lab');
            return row ? row.leakageDelta : null;
          }),
        },
      ];
      body.appendChild(buildGroupedBarChart(labels, series, fmtPct));
      chartGrid.appendChild(card);
    }

    if (analysis.tables.bloomDifficultyEffects && analysis.tables.bloomDifficultyEffects.length){
      const { card, body } = buildChartCard(
        'Bloom × difficulty heatmap (delta)',
        'Leakage delta (dual - single)',
        'Shows where supervision helps most across curriculum complexity. Negative (green) is improvement.'
      );
      const rows = analysis.tables.bloomDifficultyEffects.map((r) => ({
        rowLabel: r.bloomLevel != null ? 'B' + r.bloomLevel : 'B?',
        colLabel: r.difficulty != null ? String(r.difficulty) : 'unknown',
        leakageDelta: r.leakageDelta,
      }));
      const difficultyRank = { easy: 1, medium: 2, hard: 3 };
      const rowLabels = Array.from(new Set(rows.map((r) => r.rowLabel))).sort(byString);
      const colLabels = Array.from(new Set(rows.map((r) => r.colLabel))).sort((a, b) => {
        const ar = difficultyRank[String(a)] ?? 99;
        const br = difficultyRank[String(b)] ?? 99;
        if (ar !== br) return ar - br;
        return String(a).localeCompare(String(b));
      });
      body.appendChild(buildHeatmap(rowLabels, colLabels, rows, 'leakageDelta', fmtPct));
      chartGrid.appendChild(card);
    }

    if (analysis.tables.survivalByCondition && analysis.tables.survivalByCondition.length){
      const { card, body } = buildChartCard(
        'Survival curve',
        'Probability of no leak yet by turn',
        'Kaplan–Meier style: higher lines mean fewer leaks over time.'
      );
      const rows = analysis.tables.survivalByCondition.concat(
        (analysis.tables.survivalByPairType || []).map((r) => ({
          group: 'pair:' + r.group,
          turnIndex: r.turnIndex,
          survivalRate: r.survivalRate,
        }))
      );
      const maxTurn = Math.max(0, ...rows.map((r) => r.turnIndex ?? 0));
      const labels = Array.from({ length: maxTurn + 1 }, (_, i) => String(i + 1));
      const buildSeries = (name, color, key) => {
        const points = rows.filter((r) => r.group === key);
        if (!points.length) return null;
        const values = labels.map((_, idx) => {
          const row = points.find((p) => p.turnIndex === idx);
          return row ? row.survivalRate : 0;
        });
        return { name, color, values };
      };
      const series = [
        buildSeries('Single', 'var(--danger)', 'single'),
        buildSeries('Dual-loop', 'var(--ok)', 'dual-loop'),
        buildSeries('Same-lab', 'var(--accent)', 'pair:same-lab'),
        buildSeries('Cross-lab', 'var(--accent2)', 'pair:cross-lab'),
      ].filter(Boolean);
      body.appendChild(buildLineChart(labels, series));
      body.appendChild(buildLegend(series));
      chartGrid.appendChild(card);
    }

    if (analysis.tables.labEffects && analysis.tables.labEffects.length){
      const { card, body } = buildChartCard(
        'Leakage vs compliance',
        'Lab and pairing trade-offs',
        'Each point is a lab or lab pairing. Left/down is better.'
      );
      const labPoints = analysis.tables.labEffects.map((r) => ({
        x: r.leakageDelta,
        y: r.complianceDelta,
        label: String(r.lab || 'unknown'),
        color: 'var(--accent)',
        shape: 'circle',
      }));
      const pairPoints = (analysis.tables.labPairTypeEffects || []).map((r) => ({
        x: r.leakageDelta,
        y: r.complianceDelta,
        label: String(r.pairType || 'unknown'),
        color: 'var(--accent2)',
        shape: 'square',
      }));
      body.appendChild(buildScatterPlot(labPoints.concat(pairPoints)));
      body.appendChild(
        buildLegend([
          { name: 'Lab', color: 'var(--accent)' },
          { name: 'Pair type', color: 'var(--accent2)' },
        ])
      );
      chartGrid.appendChild(card);
    }

    if (analysis.tables.perTurn && analysis.tables.perTurn.byTurnIndex && analysis.tables.perTurn.byTurnIndex.length){
      const { card, body } = buildChartCard(
        'Outcomes by turn',
        'Per-turn leakage, hallucination, compliance',
        'Turn-by-turn rates across the conversation to show when failures appear.'
      );
      const rows = analysis.tables.perTurn.byTurnIndex;
      const labels = rows.map((r) => String((r.turnIndex ?? 0) + 1));
      const series = [
        { name: 'Leakage', color: 'var(--danger)', values: rows.map((r) => r.leakageRate || 0) },
        { name: 'Hallucination', color: 'var(--warn)', values: rows.map((r) => r.hallucinationRate || 0) },
        { name: 'Compliance', color: 'var(--ok)', values: rows.map((r) => r.complianceRate || 0) },
      ];
      body.appendChild(buildLineChart(labels, series));
      body.appendChild(buildLegend(series));
      chartGrid.appendChild(card);
    }

    if (chartGrid.children.length){
      wrap.appendChild(chartGrid);
    }

    const rateCol = (label, rateKey) => ({
      label,
      value: (row) => row[rateKey],
      format: (_, row) => fmtPct(row[rateKey]),
    });
    const latencyMeanCol = {
      label: 'Latency mean',
      value: (row) => row.latencyMeanMs,
      format: (_, row) => fmtMs(row.latencyMeanMs),
    };
    const loopIntervCol = {
      label: 'Sup. interv.',
      value: (row) => row.loopInterventionRate,
      format: (_, row) => fmtPct(row.loopInterventionRate),
    };

    const baseRunCols = [
      { label: 'Runs', value: (row) => row.nRuns },
      { label: 'Judged', value: (row) => row.nJudgedRuns },
      rateCol('Leakage', 'leakageRate'),
      rateCol('Halluc', 'hallucinationRate'),
      rateCol('Compliance', 'complianceRate'),
      rateCol('Early stop', 'earlyStopRate'),
      latencyMeanCol,
      loopIntervCol,
    ];

    const conditionEffectsCols = [
      { label: 'Tutor', value: (row) => row.tutorId },
      { label: 'n single', value: (row) => row.nSingleRuns },
      { label: 'n dual', value: (row) => row.nDualRuns },
      { label: 'Leak single', value: (row) => row.leakageSingleRate, format: (v) => fmtPct(v) },
      { label: 'Leak dual', value: (row) => row.leakageDualRate, format: (v) => fmtPct(v) },
      { label: 'Leak delta', value: (row) => row.leakageDelta, format: (v) => fmtPct(v) },
      { label: 'Halluc single', value: (row) => row.hallucinationSingleRate, format: (v) => fmtPct(v) },
      { label: 'Halluc dual', value: (row) => row.hallucinationDualRate, format: (v) => fmtPct(v) },
      { label: 'Halluc delta', value: (row) => row.hallucinationDelta, format: (v) => fmtPct(v) },
      { label: 'Comp single', value: (row) => row.complianceSingleRate, format: (v) => fmtPct(v) },
      { label: 'Comp dual', value: (row) => row.complianceDualRate, format: (v) => fmtPct(v) },
      { label: 'Comp delta', value: (row) => row.complianceDelta, format: (v) => fmtPct(v) },
      { label: 'Early single', value: (row) => row.earlyStopSingleRate, format: (v) => fmtPct(v) },
      { label: 'Early dual', value: (row) => row.earlyStopDualRate, format: (v) => fmtPct(v) },
      { label: 'Early delta', value: (row) => row.earlyStopDelta, format: (v) => fmtPct(v) },
    ];

    const labEffectCols = [
      { label: 'Lab', value: (row) => row.lab },
      { label: 'Supervisors', value: (row) => row.supervisorCount },
      { label: 'n single', value: (row) => row.nSingleRuns },
      { label: 'n dual', value: (row) => row.nDualRuns },
      { label: 'Leak single', value: (row) => row.leakageSingleRate, format: (v) => fmtPct(v) },
      { label: 'Leak dual', value: (row) => row.leakageDualRate, format: (v) => fmtPct(v) },
      { label: 'Leak delta', value: (row) => row.leakageDelta, format: (v) => fmtPct(v) },
      { label: 'Comp single', value: (row) => row.complianceSingleRate, format: (v) => fmtPct(v) },
      { label: 'Comp dual', value: (row) => row.complianceDualRate, format: (v) => fmtPct(v) },
      { label: 'Comp delta', value: (row) => row.complianceDelta, format: (v) => fmtPct(v) },
      { label: 'Early single', value: (row) => row.earlyStopSingleRate, format: (v) => fmtPct(v) },
      { label: 'Early dual', value: (row) => row.earlyStopDualRate, format: (v) => fmtPct(v) },
      { label: 'Early delta', value: (row) => row.earlyStopDelta, format: (v) => fmtPct(v) },
    ];

    const labPairTypeEffectCols = [
      { label: 'Lab pair', value: (row) => row.pairType },
      { label: 'n single', value: (row) => row.nSingleRuns },
      { label: 'n dual', value: (row) => row.nDualRuns },
      { label: 'Leak single', value: (row) => row.leakageSingleRate, format: (v) => fmtPct(v) },
      { label: 'Leak dual', value: (row) => row.leakageDualRate, format: (v) => fmtPct(v) },
      { label: 'Leak delta', value: (row) => row.leakageDelta, format: (v) => fmtPct(v) },
      { label: 'Comp single', value: (row) => row.complianceSingleRate, format: (v) => fmtPct(v) },
      { label: 'Comp dual', value: (row) => row.complianceDualRate, format: (v) => fmtPct(v) },
      { label: 'Comp delta', value: (row) => row.complianceDelta, format: (v) => fmtPct(v) },
      { label: 'Early single', value: (row) => row.earlyStopSingleRate, format: (v) => fmtPct(v) },
      { label: 'Early dual', value: (row) => row.earlyStopDualRate, format: (v) => fmtPct(v) },
      { label: 'Early delta', value: (row) => row.earlyStopDelta, format: (v) => fmtPct(v) },
    ];

    const labInteractionCols = [
      { label: 'Tutor lab', value: (row) => row.tutorLab },
      { label: 'Supervisor lab', value: (row) => row.supervisorLab },
      { label: 'n single', value: (row) => row.nSingleRuns },
      { label: 'n dual', value: (row) => row.nDualRuns },
      { label: 'Leak single', value: (row) => row.leakageSingleRate, format: (v) => fmtPct(v) },
      { label: 'Leak dual', value: (row) => row.leakageDualRate, format: (v) => fmtPct(v) },
      { label: 'Leak delta', value: (row) => row.leakageDelta, format: (v) => fmtPct(v) },
      { label: 'Comp single', value: (row) => row.complianceSingleRate, format: (v) => fmtPct(v) },
      { label: 'Comp dual', value: (row) => row.complianceDualRate, format: (v) => fmtPct(v) },
      { label: 'Comp delta', value: (row) => row.complianceDelta, format: (v) => fmtPct(v) },
    ];

    const tutorPairTypeCols = [
      { label: 'Tutor', value: (row) => row.tutorId },
      { label: 'Lab pair', value: (row) => row.pairType },
      { label: 'n single', value: (row) => row.nSingleRuns },
      { label: 'n dual', value: (row) => row.nDualRuns },
      { label: 'Leak single', value: (row) => row.leakageSingleRate, format: (v) => fmtPct(v) },
      { label: 'Leak dual', value: (row) => row.leakageDualRate, format: (v) => fmtPct(v) },
      { label: 'Leak delta', value: (row) => row.leakageDelta, format: (v) => fmtPct(v) },
      { label: 'Comp single', value: (row) => row.complianceSingleRate, format: (v) => fmtPct(v) },
      { label: 'Comp dual', value: (row) => row.complianceDualRate, format: (v) => fmtPct(v) },
      { label: 'Comp delta', value: (row) => row.complianceDelta, format: (v) => fmtPct(v) },
    ];

    const bloomDifficultyEffectCols = [
      { label: 'Bloom', value: (row) => row.bloomLevel },
      { label: 'Difficulty', value: (row) => row.difficulty },
      { label: 'n single', value: (row) => row.nSingleRuns },
      { label: 'n dual', value: (row) => row.nDualRuns },
      { label: 'Leak single', value: (row) => row.leakageSingleRate, format: (v) => fmtPct(v) },
      { label: 'Leak dual', value: (row) => row.leakageDualRate, format: (v) => fmtPct(v) },
      { label: 'Leak delta', value: (row) => row.leakageDelta, format: (v) => fmtPct(v) },
      { label: 'Comp single', value: (row) => row.complianceSingleRate, format: (v) => fmtPct(v) },
      { label: 'Comp dual', value: (row) => row.complianceDualRate, format: (v) => fmtPct(v) },
      { label: 'Comp delta', value: (row) => row.complianceDelta, format: (v) => fmtPct(v) },
      { label: 'Halluc single', value: (row) => row.hallucinationSingleRate, format: (v) => fmtPct(v) },
      { label: 'Halluc dual', value: (row) => row.hallucinationDualRate, format: (v) => fmtPct(v) },
      { label: 'Halluc delta', value: (row) => row.hallucinationDelta, format: (v) => fmtPct(v) },
    ];

    const turnRateCol = (label, rateKey) => ({
      label,
      value: (row) => row[rateKey],
      format: (_, row) => fmtPct(row[rateKey]),
    });
    const baseTurnCols = [
      { label: 'Turns', value: (row) => row.nTurns },
      { label: 'Judged', value: (row) => row.nJudgedTurns },
      turnRateCol('Leakage', 'leakageRate'),
      turnRateCol('Halluc', 'hallucinationRate'),
      turnRateCol('Compliance', 'complianceRate'),
      turnRateCol('Terminate', 'terminationRate'),
    ];

    wrap.appendChild(
      buildAnalysisPanel(
        'Condition effects',
        'Single vs dual-loop by tutor',
        analysis.tables.conditionEffects,
        conditionEffectsCols
      )
    );

    wrap.appendChild(
      buildAnalysisPanel(
        'Lab effects',
        'Single vs dual-loop by supervisor lab',
        analysis.tables.labEffects,
        labEffectCols
      )
    );

    wrap.appendChild(
      buildAnalysisPanel(
        'Lab pair effects',
        'Single vs dual-loop by lab pairing',
        analysis.tables.labPairTypeEffects,
        labPairTypeEffectCols
      )
    );

    wrap.appendChild(
      buildAnalysisPanel(
        'Lab interaction',
        'Tutor lab x supervisor lab deltas',
        analysis.tables.labInteraction,
        labInteractionCols
      )
    );

    wrap.appendChild(
      buildAnalysisPanel(
        'Tutor pairing effects',
        'Same-lab vs cross-lab per tutor',
        analysis.tables.tutorPairTypeEffects,
        tutorPairTypeCols
      )
    );

    wrap.appendChild(
      buildAnalysisPanel(
        'By tutor',
        'Aggregate outcomes by tutor',
        analysis.tables.byTutor,
        [{ label: 'Tutor', value: (row) => row.tutorId }, ...baseRunCols]
      )
    );

    wrap.appendChild(
      buildAnalysisPanel(
        'By supervisor',
        'Dual-loop outcomes by supervisor',
        analysis.tables.bySupervisor,
        [{ label: 'Supervisor', value: (row) => row.supervisorId }, ...baseRunCols]
      )
    );

    wrap.appendChild(
      buildAnalysisPanel(
        'By tutor lab',
        'Aggregate outcomes by tutor lab',
        analysis.tables.byTutorLab,
        [{ label: 'Tutor lab', value: (row) => row.tutorLab }, ...baseRunCols]
      )
    );

    wrap.appendChild(
      buildAnalysisPanel(
        'By supervisor lab',
        'Dual-loop outcomes by supervisor lab',
        analysis.tables.bySupervisorLab,
        [{ label: 'Supervisor lab', value: (row) => row.supervisorLab }, ...baseRunCols]
      )
    );

    wrap.appendChild(
      buildAnalysisPanel(
        'Tutor x supervisor',
        'Dual-loop outcomes by tutor and supervisor',
        analysis.tables.byTutorSupervisor,
        [
          { label: 'Tutor', value: (row) => row.tutorId },
          { label: 'Supervisor', value: (row) => row.supervisorId },
          ...baseRunCols,
        ]
      )
    );

    wrap.appendChild(
      buildAnalysisPanel(
        'Lab pairing',
        'Dual-loop outcomes by tutor lab and supervisor lab',
        analysis.tables.byLabPair,
        [
          { label: 'Tutor lab', value: (row) => row.tutorLab },
          { label: 'Supervisor lab', value: (row) => row.supervisorLab },
          ...baseRunCols,
        ]
      )
    );

    wrap.appendChild(
      buildAnalysisPanel(
        'Lab pairing type',
        'Dual-loop outcomes by same-lab vs cross-lab',
        analysis.tables.byLabPairType,
        [{ label: 'Lab pair', value: (row) => row.labPairType }, ...baseRunCols]
      )
    );

    wrap.appendChild(
      buildAnalysisPanel(
        'Condition',
        'Single vs dual-loop aggregates',
        analysis.tables.byCondition,
        [{ label: 'Condition', value: (row) => row.condition }, ...baseRunCols]
      )
    );

    wrap.appendChild(
      buildAnalysisPanel(
        'Bloom x difficulty',
        'Outcome rates by Bloom level and difficulty',
        analysis.tables.byBloomDifficulty,
        [
          { label: 'Bloom', value: (row) => row.bloomLevel },
          { label: 'Difficulty', value: (row) => row.difficulty },
          ...baseRunCols,
        ]
      )
    );

    wrap.appendChild(
      buildAnalysisPanel(
        'Bloom x difficulty effects',
        'Dual minus single by Bloom level and difficulty',
        analysis.tables.bloomDifficultyEffects,
        bloomDifficultyEffectCols
      )
    );

    wrap.appendChild(
      buildAnalysisPanel(
        'Attack level',
        'Per-turn outcomes by attack level',
        analysis.tables.perTurn.byAttackLevel,
        [{ label: 'Attack level', value: (row) => row.attackLevel }, ...baseTurnCols]
      )
    );

    wrap.appendChild(
      buildAnalysisPanel(
        'Turn index',
        'Per-turn outcomes by turn index',
        analysis.tables.perTurn.byTurnIndex,
        [{ label: 'Turn', value: (row) => (row.turnIndex != null ? row.turnIndex + 1 : null) }, ...baseTurnCols]
      )
    );

    wrap.appendChild(
      buildAnalysisPanel(
        'By question',
        'Outcome rates by question',
        analysis.tables.byQuestion,
        [
          { label: 'Question', value: (row) => row.questionId },
          { label: 'Bloom', value: (row) => row.bloomLevel },
          { label: 'Difficulty', value: (row) => row.difficulty },
          { label: 'Topic', value: (row) => row.topicTag },
          ...baseRunCols,
        ]
      )
    );

    analysisRoot.appendChild(wrap);
  }

  function filteredQuestionStats(){
    const needle = ui.search.trim().toLowerCase();
    let out = questionStats.slice();

    out = out.filter((q) => {
      if (!needle) return true;
      const topic = q.topicTag ? String(q.topicTag).toLowerCase() : '';
      const course = q.courseLevel ? String(q.courseLevel).toLowerCase() : '';
      const skill = q.skillTag ? String(q.skillTag).toLowerCase() : '';
      const stmt = q.problemStatement ? String(q.problemStatement).toLowerCase() : '';
      return String(q.id).toLowerCase().includes(needle)
        || topic.includes(needle)
        || course.includes(needle)
        || skill.includes(needle)
        || stmt.includes(needle);
    });

    if (ui.judgedOnly) out = out.filter(q => q.judged > 0);
    if (ui.leakOnly) out = out.filter(q => q.leak > 0);
    if (ui.hallucOnly) out = out.filter(q => q.halluc > 0);
    if (ui.issuesOnly) out = out.filter(q => q.leak > 0 || q.halluc > 0 || q.noncomp > 0);

    if (ui.sort === 'id') out.sort((a, b) => byString(a.id, b.id));
    if (ui.sort === 'difficulty') out.sort((a, b) => (a.difficulty ?? 99) - (b.difficulty ?? 99) || byString(a.id, b.id));
    if (ui.sort === 'latency') out.sort((a, b) => (b.avgLatencyMs ?? -1) - (a.avgLatencyMs ?? -1) || byString(a.id, b.id));
    if (ui.sort === 'risk'){
      const sev = { bad: 0, warn: 1, ok: 2 };
      out.sort((a, b) => (sev[a.worst] ?? 99) - (sev[b.worst] ?? 99) || (b.leak - a.leak) || byString(a.id, b.id));
    }

    return out;
  }

  function renderQuestionList(){
    qCounts.textContent = escapeText(filteredQuestionStats().length) + ' shown · ' + escapeText(allQuestionIds.length) + ' total';
    qList.innerHTML = '';

    const rows = filteredQuestionStats();
    for (const q of rows){
      const btn = document.createElement('button');
      btn.type = 'button';
      const sevClass = q.worst === 'bad' ? 'sev-bad' : q.worst === 'warn' ? 'sev-warn' : 'sev-ok';
      btn.className = 'qItem ' + sevClass + (q.id === ui.qid ? ' is-active' : '');

      const top = document.createElement('div');
      top.className = 'qRow';
      const id = document.createElement('div');
      id.className = 'qId';
      id.textContent = q.id;
      top.appendChild(id);

      const tags = document.createElement('div');
      tags.className = 'qTags';
      if (q.bloomLevel != null){
        const t = document.createElement('span');
        t.className = 'tag';
        t.textContent = 'bloom ' + q.bloomLevel;
        tags.appendChild(t);
      }
      if (q.difficulty != null){
        const t = document.createElement('span');
        t.className = 'tag';
        t.textContent = q.difficulty;
        tags.appendChild(t);
      }
      if (q.topicTag){
        const t = document.createElement('span');
        t.className = 'tag';
        t.textContent = q.topicTag;
        tags.appendChild(t);
      }
      top.appendChild(tags);
      btn.appendChild(top);

      const stmt = document.createElement('div');
      stmt.className = 'qStmt';
      const snippet = shortText(q.problemStatement, 140) || '(no statement)';
      stmt.innerHTML = escapeHtml(snippet);
      btn.appendChild(stmt);

      const mini = document.createElement('div');
      mini.className = 'qMini mono';
      const parts = [];
      parts.push('runs ' + q.runs);
      if (q.judged) parts.push('judged ' + q.judged);
      if (q.leak) parts.push('leaks ' + q.leak);
      if (q.halluc) parts.push('hallucination ' + q.halluc);
      if (q.noncomp) parts.push('noncomp ' + q.noncomp);
      if (q.avgLatencyMs != null) parts.push('lat ' + fmtMs(q.avgLatencyMs));
      mini.textContent = parts.join(' · ');
      btn.appendChild(mini);

      btn.addEventListener('click', () => {
        ui.qid = q.id;
        render();
      });

      qList.appendChild(btn);
    }
  }

  function renderSelectedQuestion(){
    const q = qById.get(ui.qid) || { id: ui.qid };
    const rs = recordsByQuestionId.get(ui.qid) || [];
    qKicker.textContent = 'Selected question';
    qTitle.textContent = escapeText(q.id || ui.qid);

    qMeta.innerHTML = '';
    const pills = [];
    function pill(label, value){
      const p = document.createElement('span');
      p.className = 'pill';
      const s = document.createElement('strong');
      s.textContent = label;
      const v = document.createElement('span');
      v.className = 'mono';
      v.textContent = String(value);
      p.appendChild(s);
      p.appendChild(v);
      return p;
    }
    pills.push(pill('runs', rs.length));
    if (q.bloomLevel != null) pills.push(pill('bloom', q.bloomLevel));
    if (q.difficulty != null) pills.push(pill('difficulty', q.difficulty));
    if (q.courseLevel) pills.push(pill('course', q.courseLevel));
    if (q.skillTag) pills.push(pill('skill', q.skillTag));
    if (q.topicTag) pills.push(pill('topic', q.topicTag));
    for (const p of pills) qMeta.appendChild(p);

    const stmtHtml = q.problemStatement || '(no statement found)';
    qStatement.innerHTML = stmtHtml;
    normalizeCanterburyImages(qStatement);

    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
    const choices = Array.isArray(q.choices) ? q.choices : [];
    if (choices.length){
      qChoicesWrap.hidden = false;
      qChoices.innerHTML = choices.map((c, i) => escapeHtml(letters[i] + ') ') + c).join('<br>');
      normalizeCanterburyImages(qChoices);
    }else{
      qChoicesWrap.hidden = true;
      qChoices.textContent = '';
    }

    const ref = q.referenceAnswerDescription || '';
    const idx = Number.isFinite(Number(q.correctChoiceIndex)) ? Number(q.correctChoiceIndex) : null;
    const correct = idx != null && idx >= 0 && idx < letters.length ? letters[idx] : null;
    const refText = correct ? ('Correct choice: ' + correct + '\n\n' + String(ref)) : String(ref);
    if (refText && String(refText).trim()){
      qRefWrap.hidden = false;
      qRef.innerHTML = refText;
      normalizeCanterburyImages(qRef);
    }else{
      qRefWrap.hidden = true;
      qRef.textContent = '';
    }

    boardSub.textContent = 'condition × pairing · click a tile for details';
  }

  function renderMatrix(){
    matrix.innerHTML = '';
    const grid = document.createElement('div');
    grid.className = 'matrixGrid';
    // New matrix: rows = tutors, columns = supervision modes (Single, GPT Supervisor, Gemini Supervisor)
    grid.style.setProperty('--cols', String(supervisionModes.length));

    const corner = document.createElement('div');
    corner.className = 'headCell';
    corner.innerHTML = '<div class="t mono">tutor ↓ / supervision →</div><div class="s">Each tile is one run record.</div>';
    grid.appendChild(corner);

    // Column headers: supervision modes
    for (const supMode of supervisionModes){
      const head = document.createElement('div');
      head.className = 'headCell';
      head.innerHTML =
        '<div class="t">' + escapeHtml(supMode.label) + '</div>' +
        '<div class="s mono">' + (supMode.supervisorId ? 'dual-loop with ' + supMode.supervisorId : 'no supervisor') + '</div>';
      grid.appendChild(head);
    }

    // Row for each tutor
    for (const tutorId of tutors){
      const row = document.createElement('div');
      row.className = 'rowCell';
      row.innerHTML = '<div class="t">' + escapeHtml(tutorId.toUpperCase()) + ' Tutor</div>' +
        '<div class="s mono">' + escapeHtml(pairingModels.get(tutorId + '-single')?.tutorModel || tutorId) + '</div>';
      grid.appendChild(row);

      for (const supMode of supervisionModes){
        const rec = pickRecordByTutorSupervision(ui.qid, tutorId, supMode);
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'tile';
        btn.setAttribute('aria-selected', (ui.drawerOpen && ui.tutorId === tutorId && ui.supervisionModeId === supMode.id) ? 'true' : 'false');
        if (!rec){
          btn.disabled = true;
          btn.innerHTML = '<div class="emptyState">No run for this cell yet.</div>';
          grid.appendChild(btn);
          continue;
        }

        const k = recordKpis(rec);
        const outcome = outcomeFor(k);
        btn.className = 'tile tile--' + outcome.key;

        const top = document.createElement('div');
        top.className = 'tile__top';
        const statusTag = document.createElement('span');
        statusTag.className = 'statusTag statusTag--' + outcome.key;
        statusTag.textContent = outcome.label;
        top.appendChild(statusTag);

        btn.appendChild(top);

        const kpis = document.createElement('div');
        kpis.className = 'tile__kpis';
        function kpi(label, valueHtml){
          const d = document.createElement('div');
          d.className = 'kpi';
          const kEl = document.createElement('div');
          kEl.className = 'k';
          kEl.textContent = label;
          const vEl = document.createElement('div');
          vEl.className = 'v';
          vEl.innerHTML = valueHtml;
          d.appendChild(kEl);
          d.appendChild(vEl);
          return d;
        }

        const leakText = k.leakage == null ? 'n/a' : (k.leakage ? '<strong>yes</strong>' : 'no');
        const hallucText = k.hallucination == null ? 'n/a' : (k.hallucination ? '<strong>yes</strong>' : 'no');
        const compText = k.compliance == null ? 'n/a' : (k.compliance ? '<strong>yes</strong>' : '<strong>no</strong>');
        kpis.appendChild(kpi('leakage', leakText));
        kpis.appendChild(kpi('hallucination', hallucText));
        kpis.appendChild(kpi('compliance', compText));

        const loopStats = recordLoopStats(rec);
        if (loopStats && loopStats.turns > 0){
          const intervRate = loopStats.rejectedTurns / loopStats.turns;
          const intervText = '<strong>' + fmtPct(intervRate) + '</strong>';
          kpis.appendChild(kpi('sup. interv.', intervText));
        }

        btn.appendChild(kpis);

        const foot = document.createElement('div');
        foot.className = 'tile__foot mono';
        const left = document.createElement('div');
        left.textContent =
          (k.turnsCompleted != null && k.turnsRequested != null)
            ? ('turns ' + k.turnsCompleted + '/' + k.turnsRequested + (k.earlyReason ? ' (' + k.earlyReason + ')' : ''))
            : 'turns n/a';
        const meter = document.createElement('div');
        meter.className = 'meter';
        const span = document.createElement('span');
        const maxMs = Math.max(1, ...records.map(r => (r.totalLatencyMs || 0)));
        const w = k.latencyMs != null ? Math.round((k.latencyMs / maxMs) * 100) : 0;
        span.style.setProperty('--w', w + '%');
        meter.appendChild(span);
        foot.appendChild(left);
        foot.appendChild(meter);
        btn.appendChild(foot);

        btn.addEventListener('click', () => openDrawerByTutorSupervision(tutorId, supMode.id));
        grid.appendChild(btn);
      }
    }

    matrix.appendChild(grid);
  }

  function renderDrawer(){
    // Try new tutor-based lookup first, fall back to legacy pairing lookup
    const supMode = supervisionModes.find(m => m.id === ui.supervisionModeId);
    const recNew = ui.drawerOpen && ui.tutorId && supMode ? pickRecordByTutorSupervision(ui.qid, ui.tutorId, supMode) : null;
    const recLegacy = ui.drawerOpen && !recNew ? pickRecord(ui.qid, ui.pairingId, ui.condition) : null;
    const rec = recNew || recLegacy;
    drawer.className = ui.drawerOpen ? 'drawer is-open' : 'drawer';

    if (!ui.drawerOpen){
      drawerTitle.textContent = 'Run details';
      drawerMeta.textContent = 'Select a tile to inspect transcript, judging, and timings.';
      drawerBody.innerHTML = '<div class="emptyState">No tile selected.</div>';
      subtabTranscript.setAttribute('aria-selected', 'false');
      subtabJudging.setAttribute('aria-selected', 'false');
      subtabTiming.setAttribute('aria-selected', 'false');
      subtabHidden.setAttribute('aria-selected', 'false');
      return;
    }

    // Build title from tutor/supervision or fallback to pairing
    const titleText = ui.tutorId && supMode 
      ? escapeText(ui.tutorId.toUpperCase()) + ' Tutor · ' + escapeText(supMode.label)
      : escapeText(ui.pairingId) + ' · ' + escapeText(ui.condition);

    if (!rec){
      drawerTitle.textContent = titleText;
      drawerMeta.textContent = 'No record found for this cell.';
      drawerBody.innerHTML = '<div class="emptyState">This run is missing.</div>';
      return;
    }

    const k = recordKpis(rec);
    drawerTitle.textContent = titleText;
    const metaParts = [];
    metaParts.push('q=' + escapeText(rec.question && rec.question.id ? rec.question.id : ui.qid));
    metaParts.push('lat=' + fmtMs(k.latencyMs));
    if (k.turnsCompleted != null && k.turnsRequested != null) metaParts.push('turns=' + k.turnsCompleted + '/' + k.turnsRequested);
    if (k.endedEarly && k.earlyReason) metaParts.push('early=' + k.earlyReason);
    drawerMeta.textContent = metaParts.join(' · ');

    subtabTranscript.setAttribute('aria-selected', ui.drawerTab === 'transcript' ? 'true' : 'false');
    subtabJudging.setAttribute('aria-selected', ui.drawerTab === 'judging' ? 'true' : 'false');
    subtabTiming.setAttribute('aria-selected', ui.drawerTab === 'timings' ? 'true' : 'false');
    subtabHidden.setAttribute('aria-selected', ui.drawerTab === 'hidden' ? 'true' : 'false');

    drawerBody.innerHTML = '';

    const actions = el('drawerActions');
    if (actions){
      actions.innerHTML = '';
    }

    function addBlock(title){
      const b = document.createElement('div');
      b.className = 'block';
      const t = document.createElement('div');
      t.className = 'block__title';
      t.textContent = title;
      b.appendChild(t);
      return b;
    }

    if (ui.drawerTab === 'transcript'){
      const b = addBlock('Transcript (student-visible)');
      const transcript = Array.isArray(rec.transcriptVisible) ? rec.transcriptVisible : [];
      if (!transcript.length){
        const empty = document.createElement('div');
        empty.className = 'emptyState';
        empty.textContent = '(empty)';
        b.appendChild(empty);
      } else {
        for (const m of transcript){
          const row = document.createElement('div');
          const role = m && m.role === 'student' ? 'student' : 'tutor';
          row.className = 'msg is-' + role;
          const rEl = document.createElement('div');
          rEl.className = 'msg__role';
          rEl.textContent = role;
          const bubble = document.createElement('div');
          bubble.className = 'msg__bubble';
          bubble.textContent = escapeText(m && m.content ? m.content : '');
          row.appendChild(rEl);
          row.appendChild(bubble);
          b.appendChild(row);
        }
      }
      drawerBody.appendChild(b);
    }

    if (ui.drawerTab === 'judging'){
      const judgeBlock = addBlock('Judge');
      const judge = rec.judge || null;
      const lastTurnJudge = recordLastTurnJudge(rec);

      if (!judge){
        const empty = document.createElement('div');
        empty.className = 'emptyState';
        empty.textContent = 'No final judge output present.';
        judgeBlock.appendChild(empty);
      }else{
        const p = document.createElement('div');
        p.className = 'pre';
        p.textContent = safeJson(judge);
        judgeBlock.appendChild(p);
      }

      if (lastTurnJudge){
        const t = document.createElement('div');
        t.style.marginTop = '12px';
        t.className = 'block__title';
        t.textContent = 'Turn judge (last)';
        judgeBlock.appendChild(t);
        const p2 = document.createElement('div');
        p2.className = 'pre';
        p2.textContent = safeJson(lastTurnJudge);
        judgeBlock.appendChild(p2);
      }

      drawerBody.appendChild(judgeBlock);

      const loop = Array.isArray(rec.loopTurnIterations) ? rec.loopTurnIterations : null;
      if (loop && loop.length){
        const loopBlock = addBlock('Dual-loop iterations');

        const ls = recordLoopStats(rec);
        if (ls){
          const meta = document.createElement('div');
          meta.className = 'mono';
          meta.style.color = 'var(--muted2)';
          meta.style.fontSize = '11px';
          meta.style.marginBottom = '10px';
          meta.textContent =
            'rejected turns ' + ls.rejectedTurns + '/' + ls.turns +
            ' · supervisor rejects ' + ls.supervisorRejections +
            ' · tutor revisions ' + ls.tutorRevisions;
          loopBlock.appendChild(meta);
        }

        const table = document.createElement('table');
        table.className = 'table mono';
        table.innerHTML = '<thead><tr><th>turn</th><th>iters</th><th>rejected</th><th>approved</th><th>rationale</th></tr></thead>';
        const tb = document.createElement('tbody');
        for (const row of loop){
          const tr = document.createElement('tr');
          const rationale = row.rationale ? String(row.rationale) : '';
          tr.innerHTML =
            '<td>' + escapeHtml(row.turnIndex) + '</td>' +
            '<td>' + escapeHtml(row.iterationsUsed) + '</td>' +
            '<td>' + escapeHtml(row.initiallyRejected ? 'yes' : 'no') + '</td>' +
            '<td>' + escapeHtml(row.endedApproved ? 'yes' : 'no') + '</td>' +
            '<td>' + escapeHtml(rationale) + '</td>';
          tb.appendChild(tr);
        }
        table.appendChild(tb);
        loopBlock.appendChild(table);
        drawerBody.appendChild(loopBlock);
      }
    }

    if (ui.drawerTab === 'timings'){
      const b = addBlock('Timed calls');
      const calls = Array.isArray(rec.calls) ? rec.calls : [];
      if (!calls.length){
        const empty = document.createElement('div');
        empty.className = 'emptyState';
        empty.textContent = '(no calls logged)';
        b.appendChild(empty);
      } else {
        const maxDur = Math.max(1, ...calls.map(c => c && c.durationMs ? c.durationMs : 0));
        for (const c of calls){
          const line = document.createElement('div');
          line.style.marginBottom = '10px';
          const name = c && c.name ? String(c.name) : '(unnamed)';
          const model = c && c.model ? String(c.model) : '';
          const dur = c && c.durationMs ? Number(c.durationMs) : 0;

          const top = document.createElement('div');
          top.className = 'mono';
          top.style.display = 'flex';
          top.style.justifyContent = 'space-between';
          top.style.gap = '10px';
          top.style.color = 'var(--muted)';
          top.style.fontSize = '12px';
          const left = document.createElement('div');
          left.textContent = name + (model ? ' · ' + model : '');
          const right = document.createElement('div');
          right.textContent = Math.round(dur) + 'ms';
          top.appendChild(left);
          top.appendChild(right);

          const meter = document.createElement('div');
          meter.className = 'meter';
          meter.style.width = '100%';
          meter.style.marginTop = '8px';
          const span = document.createElement('span');
          const w = Math.round((dur / maxDur) * 100);
          span.style.setProperty('--w', w + '%');
          meter.appendChild(span);

          if (c && c.error && c.error.message){
            const err = document.createElement('div');
            err.className = 'pre';
            err.style.marginTop = '10px';
            err.textContent = safeJson(c.error);
            line.appendChild(top);
            line.appendChild(meter);
            line.appendChild(err);
          } else {
            line.appendChild(top);
            line.appendChild(meter);
          }

          b.appendChild(line);
        }
      }
      drawerBody.appendChild(b);
    }

    if (ui.drawerTab === 'hidden'){
      const b = addBlock('Hidden trace');
      const toggleRow = document.createElement('div');
      toggleRow.className = 'filterRow';
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'chip';
      toggle.textContent = ui.showHidden ? 'Hide raw JSON' : 'Show raw JSON';
      toggle.setAttribute('aria-pressed', ui.showHidden ? 'true' : 'false');
      toggle.addEventListener('click', () => {
        ui.showHidden = !ui.showHidden;
        render();
      });
      toggleRow.appendChild(toggle);
      b.appendChild(toggleRow);

      if (!ui.showHidden){
        const hint = document.createElement('div');
        hint.className = 'emptyState';
        hint.textContent = 'Hidden trace includes attacker turns, tutor drafts, and supervisor verdicts. Enable to view.';
        b.appendChild(hint);
      }else{
        const pre = document.createElement('pre');
        pre.className = 'pre';
        pre.textContent = safeJson(rec.hiddenTrace || {});
        b.appendChild(pre);

        const calls = document.createElement('details');
        calls.className = 'block';
        calls.open = false;
        const sum = document.createElement('summary');
        sum.className = 'block__title';
        sum.textContent = 'Calls (inputs/outputs)';
        calls.appendChild(sum);
        const pre2 = document.createElement('pre');
        pre2.className = 'pre';
        pre2.textContent = safeJson(rec.calls || []);
        calls.appendChild(pre2);
        b.appendChild(calls);
      }
      drawerBody.appendChild(b);
    }
  }

  function render(){
    renderHeader();
    renderTabs();

    qSearch.value = ui.search;
    qSort.value = ui.sort;
    setPressed(filterIssues, ui.issuesOnly);
    setPressed(filterLeak, ui.leakOnly);
    setPressed(filterHalluc, ui.hallucOnly);
    setPressed(filterJudged, ui.judgedOnly);

    if (ui.tab === 'overview') renderOverview();
    if (ui.tab === 'analysis') renderAnalysis();
    if (ui.tab === 'questions'){
      renderQuestionList();
      renderSelectedQuestion();
      renderMatrix();
      renderDrawer();
    }

    footNote.textContent = 'Self-contained report · run ' + escapeText(data.meta && data.meta.runId ? data.meta.runId : data.runId || '') + ' · ' + escapeText(records.length) + ' records';
    writeHash();
  }

  tabOverview.addEventListener('click', () => selectTab('overview'));
  tabAnalysis.addEventListener('click', () => selectTab('analysis'));
  tabQuestions.addEventListener('click', () => selectTab('questions'));

  themeToggle.addEventListener('click', () => applyTheme(ui.theme === 'dark' ? 'light' : 'dark'));

  qSearch.addEventListener('input', () => {
    ui.search = qSearch.value || '';
    renderQuestionList();
    writeHash();
  });

  qSort.addEventListener('change', () => {
    ui.sort = qSort.value || 'risk';
    render();
  });

  filterIssues.addEventListener('click', () => { ui.issuesOnly = !ui.issuesOnly; render(); });
  filterLeak.addEventListener('click', () => { ui.leakOnly = !ui.leakOnly; render(); });
  filterHalluc.addEventListener('click', () => { ui.hallucOnly = !ui.hallucOnly; render(); });
  filterJudged.addEventListener('click', () => { ui.judgedOnly = !ui.judgedOnly; render(); });

  drawerClose.addEventListener('click', () => closeDrawer());

  subtabTranscript.addEventListener('click', () => { ui.drawerTab = 'transcript'; render(); });
  subtabJudging.addEventListener('click', () => { ui.drawerTab = 'judging'; render(); });
  subtabTiming.addEventListener('click', () => { ui.drawerTab = 'timings'; render(); });
  subtabHidden.addEventListener('click', () => { ui.drawerTab = 'hidden'; render(); });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && ui.drawerOpen){
      closeDrawer();
      return;
    }
    if (ui.tab !== 'questions') return;
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable)) return;
    if (e.key === 'j' || e.key === 'ArrowDown'){
      const idx = allQuestionIds.indexOf(ui.qid);
      const next = allQuestionIds[Math.min(allQuestionIds.length - 1, idx + 1)];
      if (next){ ui.qid = next; render(); }
    }
    if (e.key === 'k' || e.key === 'ArrowUp'){
      const idx = allQuestionIds.indexOf(ui.qid);
      const prev = allQuestionIds[Math.max(0, idx - 1)];
      if (prev){ ui.qid = prev; render(); }
    }
    if (e.key === '/'){
      e.preventDefault();
      qSearch.focus();
    }
  });

  copyLinkBtn.addEventListener('click', async () => {
    try{
      await navigator.clipboard.writeText(location.href);
      copyLinkBtn.textContent = 'Copied';
      setTimeout(() => { copyLinkBtn.textContent = 'Copy link'; }, 900);
    }catch{
      copyLinkBtn.textContent = 'Copy failed';
      setTimeout(() => { copyLinkBtn.textContent = 'Copy link'; }, 900);
    }
  });

  downloadJsonBtn.addEventListener('click', () => {
    try{
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const runId = (data.meta && data.meta.runId) ? data.meta.runId : (data.runId || 'run');
      a.download = String(runId) + '_report_data.json';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1200);
    }catch{}
  });

  readHash();
  applyTheme(loadTheme());
  render();
})();
`.trim();
