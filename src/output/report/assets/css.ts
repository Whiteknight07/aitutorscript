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

.analysisGrid{
  display:grid;
  grid-template-columns: 1fr;
  gap: 24px;
}
.analysisNote{
  font-size: 11px;
  color: var(--muted2);
}
.analysisPanel{
  border: 2px solid var(--ink);
  background: var(--paper);
  overflow: clip;
}
html[data-theme="dark"] .analysisPanel{ background: var(--paper); }
.analysisPanel__hd{
  display:flex;
  align-items:flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 16px 20px 14px;
  border-bottom: 2px solid var(--ink);
  background: var(--paper3);
}
html[data-theme="dark"] .analysisPanel__hd{ background: var(--paper3); }
.analysisPanel__meta{
  display:flex;
  flex-direction: column;
}
.analysisPanel__title{
  font-family: var(--font-display);
  font-size: 18px;
  font-weight: 700;
  text-transform: uppercase;
}
.analysisPanel__sub{
  margin-top: 6px;
  color: var(--muted2);
  font-size: 12px;
}
.analysisPanel__actions{
  display:flex;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: flex-end;
}
.analysisPanel__bd{ padding: 16px; }
.tableWrap{
  border: 2px solid var(--line);
  background: var(--paper2);
  padding: 8px;
  overflow-x: auto;
}
html[data-theme="dark"] .tableWrap{ background: var(--paper2); }

.analysisCharts{
  display:grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}
.chartCard{
  border: 2px solid var(--ink);
  background: var(--paper);
  padding: 16px;
}
html[data-theme="dark"] .chartCard{ background: var(--paper); }
.chartCard__hd{
  margin-bottom: 12px;
}
.chartCard__title{
  font-family: var(--font-display);
  font-size: 16px;
  font-weight: 700;
  text-transform: uppercase;
}
.chartCard__sub{
  margin-top: 6px;
  color: var(--muted2);
  font-size: 12px;
}
.chartTip{
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  margin-left: 6px;
  border-radius: 999px;
  border: 1px solid var(--ink-2);
  color: var(--ink-2);
  font-size: 11px;
  line-height: 1;
  cursor: help;
  user-select: none;
}
.barChart{
  display:flex;
  flex-direction: column;
  gap: 8px;
}
.barChart__row{
  display:grid;
  grid-template-columns: 120px minmax(0, 1fr) 70px;
  gap: 10px;
  align-items: center;
}
.barChart__label{
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: .08em;
  color: var(--muted2);
}
.barChart__bar{
  background: var(--paper2);
  border: 2px solid var(--line);
  height: 14px;
  position: relative;
}
.barChart__bar span{
  display:block;
  height: 100%;
  background: var(--accent);
}
.barChart__value{
  text-align: right;
  font-size: 11px;
  color: var(--muted);
}
.lineChart{
  width: 100%;
  height: 220px;
  display:block;
}
.lineChart__bg{
  fill: var(--paper2);
  stroke: var(--line);
  stroke-width: 2;
}
.lineChart__grid{
  stroke: var(--line);
  stroke-width: 1;
}
.lineChart__line{
  fill: none;
  stroke-width: 2.5;
}
.lineChart__label{
  font-size: 10px;
  fill: var(--muted2);
}
.lineChart__tick{
  font-size: 10px;
  fill: var(--muted2);
  text-anchor: middle;
}
.chartLegend{
  margin-top: 10px;
  display:flex;
  gap: 12px;
  flex-wrap: wrap;
  font-size: 11px;
  color: var(--muted2);
}
.chartLegend__item{
  display:flex;
  align-items: center;
  gap: 6px;
}
.chartLegend__swatch{
  width: 10px;
  height: 10px;
  display:inline-block;
  border: 1px solid var(--line);
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
  .analysisCharts{ grid-template-columns: 1fr; }
  .barChart__row{ grid-template-columns: 90px minmax(0, 1fr) 60px; }
}

@media (prefers-reduced-motion: reduce){
  .btn, .tab, .chip, .qItem, .tile, .subtab{ transition: none !important; }
}
`.trim();
