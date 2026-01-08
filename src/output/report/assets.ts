export const REPORT_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Libre+Baskerville:ital,wght@0,400;0,700;1,400&family=JetBrains+Mono:wght@400;500;700&display=swap');

:root{
  --paper: #faf8f3;
  --paper2: #f4f1e8;
  --paper3: #ebe7db;
  --ink: #1a1c1e;
  --muted: rgba(26,28,30,.68);
  --muted2: rgba(26,28,30,.45);
  --line: rgba(26,28,30,.12);
  --line2: rgba(26,28,30,.08);
  --shadow: 0 1px 3px rgba(0,0,0,.08), 0 8px 40px rgba(0,0,0,.06);
  --shadow2: 0 1px 2px rgba(0,0,0,.06), 0 4px 20px rgba(0,0,0,.04);
  --radius: 3px;
  --radius2: 2px;

  --accent: #1e5631;
  --accent2: #8b4513;
  --danger: #9b1b1b;
  --ok: #1e5631;
  --warn: #b45309;
  --stamp: #c41e3a;

  --font-display: "Libre Baskerville", "Georgia", "Times New Roman", serif;
  --font-body: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
  --font-mono: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
}

html[data-theme="dark"]{
  --paper: #141618;
  --paper2: #1a1d20;
  --paper3: #22262a;
  --ink: #e8e6e1;
  --muted: rgba(232,230,225,.68);
  --muted2: rgba(232,230,225,.45);
  --line: rgba(232,230,225,.12);
  --line2: rgba(232,230,225,.08);
  --shadow: 0 1px 3px rgba(0,0,0,.3), 0 8px 40px rgba(0,0,0,.25);
  --shadow2: 0 1px 2px rgba(0,0,0,.2), 0 4px 20px rgba(0,0,0,.15);

  --accent: #4ade80;
  --accent2: #d4a574;
  --danger: #ef4444;
  --ok: #4ade80;
  --warn: #fbbf24;
  --stamp: #f87171;
}

*{ box-sizing: border-box; }
html,body{ height:100%; }
body{
  margin:0;
  color: var(--ink);
  font-family: var(--font-body);
  font-size: 14px;
  line-height: 1.6;
  background: var(--paper);
  background-image: 
    repeating-linear-gradient(0deg, transparent, transparent 31px, var(--line2) 31px, var(--line2) 32px),
    repeating-linear-gradient(90deg, transparent, transparent 31px, var(--line2) 31px, var(--line2) 32px);
}
html[data-theme="dark"] body{
  background: var(--paper);
  background-image: 
    repeating-linear-gradient(0deg, transparent, transparent 31px, var(--line2) 31px, var(--line2) 32px),
    repeating-linear-gradient(90deg, transparent, transparent 31px, var(--line2) 31px, var(--line2) 32px);
}

a{ color: inherit; text-decoration: none; }
button{ font: inherit; }

.mono{ font-family: var(--font-mono); }

.app{
  position: relative;
  max-width: none;
  margin: 0;
  padding: 40px 48px 80px;
}

.paperFrame{
  border-radius: 0;
  border: 2px solid var(--ink);
  background: var(--paper2);
  box-shadow: 6px 6px 0 var(--ink);
  overflow: clip;
  position: relative;
}
.paperFrame::before{
  content: "CLASSIFIED";
  position: absolute;
  top: 12px;
  right: 12px;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: .2em;
  color: var(--stamp);
  border: 2px solid var(--stamp);
  padding: 4px 8px;
  transform: rotate(12deg);
  opacity: .7;
  z-index: 100;
}
html[data-theme="dark"] .paperFrame{
  background: var(--paper2);
}

.mast{
  display:flex;
  align-items:flex-start;
  justify-content: space-between;
  gap: 32px;
  padding: 24px 32px 20px;
  border-bottom: 2px solid var(--ink);
  background: var(--paper3);
  position: sticky;
  top: 0;
  z-index: 50;
}
html[data-theme="dark"] .mast{ background: var(--paper3); }

.mark{
  display:flex;
  flex-direction: column;
  gap: 2px;
}
.mark__title{
  font-family: var(--font-display);
  font-size: 32px;
  font-weight: 700;
  letter-spacing: -.02em;
  text-transform: uppercase;
}
.mark__sub{
  font-size: 11px;
  color: var(--accent);
  text-transform: uppercase;
  letter-spacing: .25em;
  font-weight: 700;
  border-left: 3px solid var(--accent);
  padding-left: 10px;
  margin-top: 6px;
}

.mast__left{
  display:flex;
  gap: 16px;
  align-items: flex-start;
}
.meta{
  display:flex;
  flex-direction: column;
  gap: 6px;
  padding-top: 2px;
}
.meta__row{
  display:flex;
  gap: 8px;
  align-items: baseline;
}
.meta__k{
  font-size: 12px;
  color: var(--muted2);
  text-transform: uppercase;
  letter-spacing: .12em;
  min-width: 72px;
}
.meta__v{
  font-size: 13px;
  color: var(--muted);
}

.mast__right{
  display:flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 10px;
}

.statusPill{
  display:inline-flex;
  align-items:center;
  gap: 10px;
  padding: 8px 12px;
  border: 2px solid var(--ink);
  background: var(--paper);
  max-width: 560px;
}
html[data-theme="dark"] .statusPill{ background: var(--paper); }
.statusDot{
  width: 8px;
  height: 8px;
  border-radius: 0;
  background: var(--muted2);
  animation: blink 1.5s infinite;
}
@keyframes blink {
  0%, 100% { opacity: 1; }
  50% { opacity: .4; }
}
.statusDot.is-running{ background: var(--accent); animation: blink 1s infinite; }
.statusDot.is-complete{ background: var(--ok); animation: none; }
.statusDot.is-failed{ background: var(--danger); animation: none; }
.statusText{
  font-size: 11px;
  color: var(--muted);
  line-height: 1.3;
}
.statusText strong{
  color: var(--ink);
  font-weight: 700;
  text-transform: uppercase;
}
.statusText .sub{
  margin-top: 2px;
  color: var(--muted2);
  font-size: 10px;
}

.actions{
  display:flex;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: flex-end;
}
.btn{
  appearance: none;
  border: 2px solid var(--ink);
  background: var(--paper);
  color: var(--ink);
  border-radius: 0;
  padding: 10px 16px;
  font-size: 12px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: .05em;
  cursor: pointer;
  transition: all .12s ease;
}
html[data-theme="dark"] .btn{ background: var(--paper); }
.btn:hover{
  background: var(--ink);
  color: var(--paper);
}
html[data-theme="dark"] .btn:hover{ background: var(--ink); color: var(--paper); }
.btn:active{ transform: translate(2px, 2px); }

.btn--primary{
  background: var(--accent);
  color: #fff;
  border-color: var(--accent);
}
html[data-theme="dark"] .btn--primary{
  background: var(--accent);
  border-color: var(--accent);
}
.btn--primary:hover{
  background: var(--ink);
  border-color: var(--ink);
}

.btn--small{
  padding: 8px 12px;
  font-size: 11px;
}

.tabs{
  display:flex;
  gap: 0;
  padding: 0;
  border-bottom: 2px solid var(--ink);
  background: var(--paper2);
}
html[data-theme="dark"] .tabs{ background: var(--paper2); }

.tab{
  border: none;
  border-right: 2px solid var(--ink);
  border-radius: 0;
  padding: 14px 24px;
  background: transparent;
  color: var(--muted);
  cursor:pointer;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: .12em;
  text-transform: uppercase;
  transition: all .12s ease;
}
html[data-theme="dark"] .tab{ background: transparent; }
.tab:hover{ background: var(--paper); color: var(--ink); }
html[data-theme="dark"] .tab:hover{ background: var(--paper3); }
.tab[aria-selected="true"]{
  color: var(--paper);
  background: var(--ink);
}
html[data-theme="dark"] .tab[aria-selected="true"]{
  background: var(--ink);
  color: var(--paper);
}

.views{
  padding: 32px;
}

.view[hidden]{ display:none !important; }

.layoutQuestions{
  display:grid;
  grid-template-columns: minmax(320px, 380px) minmax(0, 1fr) minmax(400px, 520px);
  gap: 28px;
  align-items: start;
}

.sidebar{
  position: relative;
  min-width: 0;
}

.panel{
  border: 2px solid var(--ink);
  background: var(--paper);
  overflow: clip;
}
html[data-theme="dark"] .panel{ background: var(--paper); }
.panel__hd{
  padding: 14px 18px 12px;
  border-bottom: 2px solid var(--ink);
  background: var(--paper3);
}
html[data-theme="dark"] .panel__hd{ background: var(--paper3); }
.panel__title{
  font-family: var(--font-display);
  font-weight: 700;
  letter-spacing: -.01em;
  font-size: 16px;
  text-transform: uppercase;
}
.panel__meta{
  margin-top: 6px;
  font-size: 11px;
  color: var(--muted2);
}
.panel__bd{ padding: 16px; }

.panel--sticky{
  position: sticky;
  top: 100px;
  z-index: 5;
}

.field{
  display:flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 14px;
}
.field__label{
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: .15em;
  color: var(--muted2);
  font-weight: 500;
}
.input, .select{
  width: 100%;
  border: 2px solid var(--line);
  border-radius: 0;
  padding: 10px 12px;
  background: var(--paper);
  color: var(--ink);
  outline: none;
  font-size: 13px;
  font-family: var(--font-mono);
}
html[data-theme="dark"] .input, html[data-theme="dark"] .select{ background: var(--paper); }
.input:focus, .select:focus{
  border-color: var(--accent);
}
html[data-theme="dark"] .input:focus, html[data-theme="dark"] .select:focus{
  border-color: var(--accent);
}

.filterRow{
  display:flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 14px;
}

.chip{
  border: 2px solid var(--line);
  border-radius: 0;
  padding: 6px 10px;
  background: var(--paper);
  color: var(--muted);
  cursor: pointer;
  font-size: 11px;
  font-weight: 500;
  letter-spacing: .05em;
  text-transform: uppercase;
  transition: all .12s ease;
}
html[data-theme="dark"] .chip{ background: var(--paper); }
.chip:hover{ border-color: var(--ink); color: var(--ink); }
html[data-theme="dark"] .chip:hover{ border-color: var(--ink); }
.chip[aria-pressed="true"]{
  background: var(--ink);
  border-color: var(--ink);
  color: var(--paper);
}
html[data-theme="dark"] .chip[aria-pressed="true"]{
  background: var(--ink);
  border-color: var(--ink);
  color: var(--paper);
}
.chip--danger[aria-pressed="true"]{
  background: var(--danger);
  border-color: var(--danger);
}
.chip--warn[aria-pressed="true"]{
  background: var(--warn);
  border-color: var(--warn);
}

.qList{
  margin-top: 16px;
  display:flex;
  flex-direction: column;
  gap: 10px;
}

.qItem{
  width: 100%;
  text-align: left;
  border: 2px solid var(--line);
  border-left: 5px solid var(--line);
  background: var(--paper);
  padding: 14px 14px 14px 16px;
  cursor:pointer;
  position: relative;
  overflow: hidden;
  transition: all .12s ease;
}
html[data-theme="dark"] .qItem{ background: var(--paper); }
.qItem:hover{ border-color: var(--ink); background: var(--paper2); }
html[data-theme="dark"] .qItem:hover{ border-color: var(--ink); background: var(--paper2); }
.qItem:active{ transform: translate(2px, 2px); }
.qItem.is-active{
  border-color: var(--ink);
  border-left-color: var(--accent);
  background: var(--paper3);
}
html[data-theme="dark"] .qItem.is-active{
  border-color: var(--ink);
  border-left-color: var(--accent);
  background: var(--paper3);
}

.qStripe{
  display: none;
}
.qItem.sev-ok{ border-left-color: var(--ok); }
.qItem.sev-warn{ border-left-color: var(--warn); }
.qItem.sev-bad{ border-left-color: var(--danger); }

.qRow{
  display:flex;
  justify-content: space-between;
  gap: 10px;
  align-items: baseline;
}
.qId{
  font-family: var(--font-mono);
  font-size: 13px;
  font-weight: 700;
  color: var(--ink);
}
.qTags{
  display:flex;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: flex-end;
}
.tag{
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 500;
  color: var(--muted);
  border: 1px solid var(--line);
  border-radius: 0;
  padding: 3px 8px;
  background: var(--paper2);
  text-transform: uppercase;
  letter-spacing: .05em;
}
html[data-theme="dark"] .tag{ background: var(--paper2); }
.qStmt{
  margin-top: 8px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--muted);
  max-height: 3em;
  overflow: hidden;
}
.qMini{
  margin-top: 8px;
  display:flex;
  gap: 8px;
  flex-wrap: wrap;
  color: var(--muted2);
  font-size: 11px;
}

.canvas{
  display:flex;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
}

.hero{
  border: 2px solid var(--ink);
  background: var(--paper);
  padding: 28px;
  position: relative;
  overflow: hidden;
  min-width: 0;
}
html[data-theme="dark"] .hero{ background: var(--paper); }
.hero::before{
  content: "SPECIMEN";
  position: absolute;
  top: 20px;
  right: 20px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: .2em;
  color: var(--accent);
  border: 2px solid var(--accent);
  padding: 5px 10px;
  opacity: .6;
}
html[data-theme="dark"] .hero::before{
  color: var(--accent);
  border-color: var(--accent);
}

.hero__kicker{
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: .2em;
  color: var(--muted2);
  font-weight: 500;
  position: relative;
  z-index: 1;
}
.hero__title{
  margin: 10px 0 0;
  font-family: var(--font-display);
  font-size: 24px;
  font-weight: 700;
  letter-spacing: -.01em;
  position: relative;
  z-index: 1;
}
.hero__meta{
  margin-top: 16px;
  display:flex;
  gap: 10px;
  flex-wrap: wrap;
  position: relative;
  z-index: 1;
}
.hero__statement{
  margin-top: 20px;
  white-space: pre-wrap;
  line-height: 1.7;
  color: var(--ink);
  font-size: 14px;
  position: relative;
  z-index: 1;
  border-left: 4px solid var(--accent);
  padding-left: 16px;
}
html[data-theme="dark"] .hero__statement{ color: var(--ink); }
.hero__ref{
  margin-top: 20px;
  border-top: 2px dashed var(--line);
  padding-top: 16px;
  position: relative;
  z-index: 1;
}
.hero__refSum{
  cursor: pointer;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: .15em;
  color: var(--muted2);
  font-weight: 500;
}
.hero__refBody{
  margin-top: 12px;
  white-space: pre-wrap;
  color: var(--muted);
  line-height: 1.5;
  font-size: 13px;
}

.pill{
  display:inline-flex;
  align-items:center;
  gap: 8px;
  border: 2px solid var(--line);
  padding: 6px 10px;
  background: var(--paper2);
  font-size: 11px;
  color: var(--muted);
}
html[data-theme="dark"] .pill{ background: var(--paper2); }
.pill strong{
  color: var(--ink);
  font-weight: 700;
  text-transform: uppercase;
}

.board{
  border: 2px solid var(--ink);
  background: var(--paper);
  overflow: clip;
  min-width: 0;
}
html[data-theme="dark"] .board{ background: var(--paper); }
.board__hd{
  padding: 16px 20px 14px;
  border-bottom: 2px solid var(--ink);
  background: var(--paper3);
  display:flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 12px;
}
.board__title{
  font-family: var(--font-display);
  font-size: 16px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: -.01em;
}
.board__sub{
  font-size: 11px;
  color: var(--muted2);
}
.matrix{
  padding: 20px;
  overflow: auto;
  min-width: 0;
}

.matrixGrid{
  display:grid;
  grid-template-columns: 180px repeat(var(--cols), minmax(220px, 1fr));
  gap: 12px;
  align-items: stretch;
  min-width: calc(180px + (var(--cols) * 220px) + (var(--cols) * 12px));
}

.headCell, .rowCell{
  border: 2px solid var(--line);
  background: var(--paper2);
  padding: 14px;
}
html[data-theme="dark"] .headCell, html[data-theme="dark"] .rowCell{ background: var(--paper2); }
.headCell .t{
  font-weight: 700;
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: .05em;
}
.headCell .s{
  margin-top: 6px;
  color: var(--muted2);
  font-size: 11px;
  line-height: 1.4;
}
.rowCell{
  display:flex;
  flex-direction: column;
  gap: 8px;
}
.rowCell .t{
  font-weight: 700;
  font-size: 12px;
  text-transform: uppercase;
}
.rowCell .s{
  color: var(--muted2);
  font-size: 11px;
}

.tile{
  appearance: none;
  text-align: left;
  width: 100%;
  border: 2px solid var(--line);
  border-left: 5px solid var(--muted2);
  background: var(--paper);
  padding: 14px;
  cursor: pointer;
  position: relative;
  overflow: hidden;
  transition: all .12s ease;
}
html[data-theme="dark"] .tile{ background: var(--paper); }
.tile:hover{ border-color: var(--ink); background: var(--paper2); }
html[data-theme="dark"] .tile:hover{ border-color: var(--ink); background: var(--paper2); }
.tile:active{ transform: translate(2px, 2px); }
.tile[disabled]{ cursor: default; opacity: .4; }
.tile::before{ display: none; }
.tile.tile--ok{ border-left-color: var(--ok); }
.tile.tile--warn{ border-left-color: var(--warn); }
.tile.tile--danger{ border-left-color: var(--danger); }
.tile.tile--info{ border-left-color: var(--accent2); }
html[data-theme="dark"] .tile.tile--info{ border-left-color: var(--accent2); }
.tile[aria-selected="true"]{
  border-color: var(--ink);
  background: var(--paper3);
}
html[data-theme="dark"] .tile[aria-selected="true"]{
  border-color: var(--ink);
  background: var(--paper3);
}

.tile__top{
  display:flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 8px;
}

.statusTag{
  display:inline-flex;
  align-items:center;
  gap: 8px;
  border: 2px solid var(--line);
  padding: 5px 10px;
  background: var(--paper);
  color: var(--muted);
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: .1em;
  text-transform: uppercase;
  line-height: 1;
}
html[data-theme="dark"] .statusTag{ background: var(--paper); }
.statusTag::before{
  content:"";
  width: 8px;
  height: 8px;
  background: var(--muted2);
}
.statusTag--ok{ color: var(--ok); border-color: var(--ok); }
.statusTag--ok::before{ background: var(--ok); }
.statusTag--warn{ color: var(--warn); border-color: var(--warn); }
.statusTag--warn::before{ background: var(--warn); }
.statusTag--danger{ color: var(--danger); border-color: var(--danger); }
.statusTag--danger::before{ background: var(--danger); }
.statusTag--info{ color: var(--accent2); border-color: var(--accent2); }
html[data-theme="dark"] .statusTag--info{ color: var(--accent2); border-color: var(--accent2); }
.statusTag--info::before{ background: var(--accent2); }

.tile__kpis{
  margin-top: 12px;
  display:grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px 10px;
}
.kpi{
  display:flex;
  flex-direction: column;
  gap: 3px;
  border-top: 1px solid var(--line2);
  padding-top: 8px;
}
.kpi .k{
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: .12em;
  color: var(--muted2);
}
.kpi .v{
  font-size: 12px;
  color: var(--muted);
  font-family: var(--font-mono);
}
.kpi .v strong{ color: var(--ink); font-weight: 700; }

.tile__foot{
  margin-top: 12px;
  display:flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
  color: var(--muted2);
  font-size: 11px;
}
.meter{
  height: 8px;
  border: 1px solid var(--line);
  background: var(--paper2);
  overflow: hidden;
  width: 100px;
}
html[data-theme="dark"] .meter{ background: var(--paper2); }
.meter > span{
  display:block;
  height: 100%;
  width: var(--w, 0%);
  background: var(--accent);
}
html[data-theme="dark"] .meter > span{
  background: var(--accent);
}

.drawer{
  position: sticky;
  top: 120px;
}

.drawer__inner{
  border: 2px solid var(--ink);
  background: var(--paper);
  overflow: clip;
}
html[data-theme="dark"] .drawer__inner{ background: var(--paper); }
.drawer__hd{
  padding: 16px 20px 14px;
  border-bottom: 2px solid var(--ink);
  background: var(--paper3);
  display:flex;
  flex-direction: column;
  gap: 8px;
}
html[data-theme="dark"] .drawer__hd{ background: var(--paper3); }
.drawer__title{
  font-family: var(--font-display);
  font-size: 18px;
  font-weight: 700;
  text-transform: uppercase;
}
.drawer__meta{
  color: var(--muted2);
  font-size: 12px;
  line-height: 1.4;
}
.drawer__actions{
  display:flex;
  gap: 10px;
  flex-wrap: wrap;
}
.drawer__tabs{
  display:flex;
  gap: 0;
  padding: 0;
  border-bottom: 2px solid var(--ink);
}
.subtab{
  border: none;
  border-right: 2px solid var(--ink);
  padding: 10px 16px;
  background: transparent;
  color: var(--muted);
  cursor:pointer;
  font-size: 11px;
  font-weight: 500;
  letter-spacing: .08em;
  transition: all .12s ease;
  text-transform: uppercase;
}
html[data-theme="dark"] .subtab{ background: transparent; }
.subtab:hover{ background: var(--paper); color: var(--ink); }
html[data-theme="dark"] .subtab:hover{ background: var(--paper3); }
.subtab[aria-selected="true"]{
  background: var(--ink);
  color: var(--paper);
}
html[data-theme="dark"] .subtab[aria-selected="true"]{
  background: var(--ink);
  color: var(--paper);
}

.drawer__bd{
  padding: 16px;
  max-height: calc(100vh - 260px);
  overflow: auto;
}

.emptyState{
  border: 2px dashed var(--line);
  padding: 16px;
  color: var(--muted);
  background: var(--paper2);
  font-size: 12px;
}
html[data-theme="dark"] .emptyState{ background: var(--paper2); }

.block{
  border: 2px solid var(--line);
  background: var(--paper);
  padding: 14px;
  margin-bottom: 14px;
}
html[data-theme="dark"] .block{ background: var(--paper); }
.block__title{
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: .15em;
  color: var(--muted2);
  margin-bottom: 12px;
  font-weight: 500;
}

.msg{
  display:flex;
  gap: 12px;
  align-items: flex-start;
  margin-bottom: 12px;
}
.msg:last-child{ margin-bottom: 0; }
.msg__role{
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--muted2);
  letter-spacing: .1em;
  text-transform: uppercase;
  padding-top: 4px;
  min-width: 64px;
  font-weight: 500;
}
.msg__bubble{
  flex: 1 1 auto;
  border: 2px solid var(--line);
  border-left: 5px solid var(--line);
  background: var(--paper);
  padding: 12px 14px;
  line-height: 1.6;
  white-space: pre-wrap;
  font-size: 13px;
  color: var(--ink);
}
html[data-theme="dark"] .msg__bubble{ background: var(--paper); }
.msg.is-student .msg__bubble{ border-left-color: var(--accent2); }
html[data-theme="dark"] .msg.is-student .msg__bubble{ border-left-color: var(--accent2); }
.msg.is-tutor .msg__bubble{ border-left-color: var(--accent); }
html[data-theme="dark"] .msg.is-tutor .msg__bubble{ border-left-color: var(--accent); }

.table{
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}
.table th, .table td{
  text-align: left;
  padding: 8px 10px;
  border-bottom: 1px solid var(--line);
  vertical-align: top;
}
.table th{
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: .12em;
  color: var(--muted2);
  font-weight: 500;
}

.pre{
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  border: 2px solid var(--line);
  background: var(--paper2);
  padding: 12px;
  color: var(--muted);
}
html[data-theme="dark"] .pre{ background: var(--paper2); }

.foot{
  padding: 18px 24px;
  border-top: 2px solid var(--ink);
  color: var(--muted2);
  font-size: 11px;
  background: var(--paper3);
}

.overviewGrid{
  display:grid;
  grid-template-columns: 1fr;
  gap: 24px;
}
.cards{
  display:grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 14px;
}
.card{
  border: 2px solid var(--ink);
  background: var(--paper);
  padding: 20px;
  overflow: hidden;
  position: relative;
}
html[data-theme="dark"] .card{ background: var(--paper); }
.card::before{
  content: "";
  position:absolute;
  top: 12px;
  right: 12px;
  width: 24px;
  height: 24px;
  border: 2px solid var(--accent);
  opacity: .3;
}
html[data-theme="dark"] .card::before{
  border-color: var(--accent);
}
.card .k{
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: .15em;
  color: var(--muted2);
  position: relative;
  z-index: 1;
  font-weight: 500;
}
.card .v{
  margin-top: 8px;
  font-family: var(--font-display);
  font-size: 36px;
  font-weight: 700;
  letter-spacing: -.02em;
  position: relative;
  z-index: 1;
}
.card .s{
  margin-top: 8px;
  color: var(--muted);
  font-size: 11px;
  line-height: 1.5;
  position: relative;
  z-index: 1;
}

.pairingPanel{
  border: 2px solid var(--ink);
  background: var(--paper);
  overflow: clip;
}
html[data-theme="dark"] .pairingPanel{ background: var(--paper); }
.pairingPanel__hd{
  padding: 16px 20px 14px;
  border-bottom: 2px solid var(--ink);
  background: var(--paper3);
}
html[data-theme="dark"] .pairingPanel__hd{ background: var(--paper3); }
.pairingPanel__title{
  font-family: var(--font-display);
  font-size: 18px;
  font-weight: 700;
  text-transform: uppercase;
}
.pairingPanel__sub{
  margin-top: 6px;
  color: var(--muted2);
  font-size: 12px;
}
.pairingPanel__bd{ padding: 16px; }
.condGrid{
  display:grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}
.condCard{
  border: 2px solid var(--line);
  background: var(--paper2);
  padding: 14px;
}
html[data-theme="dark"] .condCard{ background: var(--paper2); }
.condCard .t{
  font-family: var(--font-mono);
  font-size: 12px;
  font-weight: 700;
  color: var(--ink);
  letter-spacing: .08em;
  text-transform: uppercase;
}
.condCard .row{
  margin-top: 12px;
  display:flex;
  gap: 8px;
  flex-wrap: wrap;
}
.miniStat{
  border: 1px solid var(--line);
  padding: 8px 10px;
  background: var(--paper);
  min-width: 100px;
}
html[data-theme="dark"] .miniStat{ background: var(--paper); }
.miniStat .k{
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: .12em;
  color: var(--muted2);
}
.miniStat .v{
  margin-top: 5px;
  font-family: var(--font-mono);
  font-size: 13px;
  color: var(--muted);
}
.miniStat .v strong{ color: var(--ink); font-weight: 700; }

@media (max-width: 1320px){
  .layoutQuestions{ grid-template-columns: 380px minmax(0, 1fr); }
  .drawer{ position: fixed; inset: auto 20px 20px 20px; top: auto; max-height: 70vh; display:none; }
  .drawer.is-open{ display:block; }
  .drawer__inner{ box-shadow: var(--shadow); }
}

@media (max-width: 980px){
  .app{ padding: 24px 20px 60px; }
  .mast{ position: static; }
  .panel--sticky{ position: static; }
  .layoutQuestions{ grid-template-columns: 1fr; }
  .drawer{ inset: auto 16px 16px 16px; max-height: 70vh; }
  .cards{ grid-template-columns: 1fr 1fr; }
  .condGrid{ grid-template-columns: 1fr; }
}

@media (prefers-reduced-motion: reduce){
  .btn, .tab, .chip, .qItem, .tile, .subtab{ transition: none !important; }
}
`.trim();

export const REPORT_JS = `
(function(){
  const data = window.__HARNESS_DATA__ || {};

  const records = Array.isArray(data.records) ? data.records : [];
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

  function el(id){ return document.getElementById(id); }

  const viewOverview = el('viewOverview');
  const viewQuestions = el('viewQuestions');
  const statusPill = el('statusPill');
  const metaRunId = el('metaRunId');
  const metaCreatedAt = el('metaCreatedAt');

  const tabOverview = el('tabOverview');
  const tabQuestions = el('tabQuestions');

  const themeToggle = el('themeToggle');
  const copyLinkBtn = el('copyLink');
  const downloadJsonBtn = el('downloadJson');

  const overviewRoot = el('overviewRoot');

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
    tab: 'questions',
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
    if (parsed.tab === 'overview' || parsed.tab === 'questions') ui.tab = parsed.tab;
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
    tabQuestions.setAttribute('aria-selected', ui.tab === 'questions' ? 'true' : 'false');
    viewOverview.hidden = ui.tab !== 'overview';
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

  function filteredQuestionStats(){
    const needle = ui.search.trim().toLowerCase();
    let out = questionStats.slice();

    out = out.filter((q) => {
      if (!needle) return true;
      const topic = q.topicTag ? String(q.topicTag).toLowerCase() : '';
      const stmt = q.problemStatement ? String(q.problemStatement).toLowerCase() : '';
      return String(q.id).toLowerCase().includes(needle) || topic.includes(needle) || stmt.includes(needle);
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
      stmt.textContent = shortText(q.problemStatement, 140) || '(no statement)';
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
    if (q.topicTag) pills.push(pill('topic', q.topicTag));
    for (const p of pills) qMeta.appendChild(p);

    qStatement.textContent = q.problemStatement || '(no statement found)';

    const letters = ['A', 'B', 'C', 'D'];
    const choices = Array.isArray(q.choices) ? q.choices : [];
    if (choices.length){
      qChoicesWrap.hidden = false;
      qChoices.textContent = choices.map((c, i) => letters[i] + ') ' + c).join('\\n');
    }else{
      qChoicesWrap.hidden = true;
      qChoices.textContent = '';
    }

    const ref = q.referenceAnswerDescription || '';
    const idx = Number.isFinite(Number(q.correctChoiceIndex)) ? Number(q.correctChoiceIndex) : null;
    const correct = idx != null && idx >= 0 && idx < 4 ? letters[idx] : null;
    const refText = correct ? ('Correct choice: ' + correct + '\\n\\n' + String(ref)) : String(ref);
    if (refText && String(refText).trim()){
      qRefWrap.hidden = false;
      qRef.textContent = refText;
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
