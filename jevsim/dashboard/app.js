"use strict";

const icons = {
  layout: '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M9 3v18M9 9h12"/>',
  route: '<circle cx="6" cy="5" r="2"/><circle cx="18" cy="19" r="2"/><path d="M8 5h8a4 4 0 010 8H8a4 4 0 000 8h8"/>',
  scan: '<path d="M8 3H5a2 2 0 00-2 2v3m13-5h3a2 2 0 012 2v3M3 16v3a2 2 0 002 2h3m8 0h3a2 2 0 002-2v-3M8 12l3 3 5-6"/>',
  box: '<path d="M12 3l9 5-9 5-9-5 9-5zM3 8v9l9 5 9-5V8M12 13v9M7 5.8l9 5"/>',
  book: '<path d="M12 5C9 3 5 3 3 4v15c3-1 6-1 9 1 3-2 6-2 9-1V4c-3-1-6-1-9 1v15"/>',
  settings: '<path d="M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1 1-3z"/><circle cx="12" cy="12" r="3"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9 9a3 3 0 016 0c0 2-3 2-3 4m0 3v.1"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v4h16v-4"/>',
  play: '<path d="M8 5l11 7-11 7V5z"/>',
  shuffle: '<path d="M3 6h3c5 0 7 12 12 12h3m-4-4 4 4-4 4M3 18h3c2 0 3-2 5-5m2-2c2-3 3-5 5-5h3m-4-4 4 4-4 4"/>',
  branch: '<circle cx="6" cy="5" r="2"/><circle cx="18" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><path d="M6 7v10m12-10v3a5 5 0 01-5 5H6"/>',
  sliders: '<path d="M5 3v5m0 4v9M12 3v10m0 4v4M19 3v3m0 4v11M2 8h6m1 9h6m1-11h6"/>',
  robot: '<rect x="4" y="7" width="16" height="13" rx="3"/><path d="M12 3v4M1 12h3m16 0h3M8 12h1m6 0h1m-7 4h6"/>',
  check: '<path d="M5 12l4 4L19 6"/>',
  target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r=".5"/>',
  warning: '<path d="M10 4a2 2 0 014 0l8 15H2L10 4zM12 9v4m0 3v.1"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  arrow: '<path d="M4 12h15m-5-5 5 5-5 5"/>',
  expand: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m8 0h5v-5"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  chart: '<path d="M4 3v17h17M8 15l4-5 4 2 5-7"/>',
  terminal: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M7 9l3 3-3 3m6 0h4"/>',
  heart: '<path d="M20 5c-3-3-7-1-8 2-2-3-6-5-9-2-3 4 2 9 9 15 7-6 12-11 8-15z"/>',
};
const icon = name => `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.box}</svg>`;
const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const escapeHTML = value => String(value).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const num = value => Number(value).toLocaleString("en-US");
const pct = value => `${(value * 100).toFixed(1)}%`;
const labels = {success:"Success", safe_return:"Safe return", failure:"Failure", critical_failure:"Critical failure", timeout:"Timeout", frontier:"Unresolved", pruned:"Pruned"};
const colors = {success:"#72b49b", safe_return:"#8ba8d0", failure:"#d9988e", critical_failure:"#c77c8b", timeout:"#d8c48d", frontier:"#c1cbd8", pruned:"#e4c49f"};
const app = {catalog:[], environment:"warehouse", parameters:{}, policy:"jev", settings:null, mode:"replay", resultMode:"replay", page:"overview", episodes:10, seed:42, max_steps:35, depth:5, result:null, tree:null, selected:0, treeTab:"tree", treeRoot:0, zoom:1, busy:false, fuzz:null, traceFilter:"all"};

async function api(path, data) {
  const response = await fetch(path, data === undefined ? {} : {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(data)});
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "The simulation could not complete");
  return result;
}
function toast(message) { $("#toast").textContent=message; $("#toast").classList.add("show"); clearTimeout(app.toastTimer); app.toastTimer=setTimeout(()=>$("#toast").classList.remove("show"),3200); }
function showError(error) { $("#error-message").textContent=error.message; $("#error-message").hidden=false; }
function setBusy(busy, label="Running simulation…") { app.busy=busy; $$("#run-button, #environment, #settings-button, #quick-settings, #settings-form button[type=submit], #hunt-button, [data-mode], [data-use-environment], #export-button, #policy-select, #connect-button, #save-connection, #test-connection, #reload-config, [data-counterfactual]").forEach(el=>el.disabled=busy); $("#run-button span:last-child").textContent=busy?label:"Run simulation"; }
const config = () => ({environment:app.environment,parameters:app.parameters,seed:app.seed,max_steps:app.max_steps,episodes:app.episodes,policy:app.policy});
function environmentTitle() { return app.catalog.find(e=>e.id===app.environment)?.title || "Simulation"; }

async function runSimulation() {
  if(app.busy || !readyToRun()) return;
  setBusy(true); $("#error-message").hidden=true;
  $("#run-status").textContent=app.mode==="branch"?"Exploring possible futures…":"Simulating possible futures…";
  if(!app.result) $("#page-content").innerHTML='<div class="loading-panel"><span class="loader"></span><h2>A little foresight goes a long way.</h2><p>Follow the decisions and environment state in the live panel above.</p></div>';
  const start=performance.now();
  try {
    if(app.mode==="branch") {
      app.tree=await streamAPI("/api/explore",{...config(),depth:app.depth,branches:3,max_nodes:1500});
      $("#run-status").textContent=`Explored ${num(app.tree.nodes.length)} nodes in ${((performance.now()-start)/1000).toFixed(2)}s`;
    } else {
      app.result=await streamAPI("/api/run",{...config(),mode:app.mode});
      app.tree=app.result.tree;
      $("#trace-count").textContent=num(app.result.episodes);
      $("#run-status").textContent=`Simulation complete · ${num(app.result.episodes)} ${app.result.episodes===1?"episode":"episodes"} in ${app.result.elapsed.toFixed(2)}s`;
    }
    app.resultMode=app.mode; app.treeConfig=JSON.parse(JSON.stringify(config())); app.selected=0; app.treeRoot=0; app.zoom=1;
    $("#run-metadata").textContent=`SEED ${app.seed} · ${escapeHTML(app.resultMode==="branch"?app.tree.policy:app.result.policy)} · ${app.mode.replaceAll("_"," ").toUpperCase()}`;
    render();
  } catch(error) { if(!error.cancelled)showError(error); $("#run-status").textContent=error.cancelled?"Run stopped · partial progress retained above":"Simulation did not complete"; if(!app.result) $("#page-content").innerHTML='<div class="empty-state">This run ended before completion. Partial decisions are retained in the live panel above.</div>'; }
  finally {setBusy(false);}
}

function statCard(title, value, suffix, foot, name, pill="", spark="") {
  return `<article class="stat-card"><div class="stat-label">${title}${icon(name)}</div><div class="stat-number">${value}<span>${suffix}</span></div><div class="stat-foot">${pill}${foot}</div>${spark}</article>`;
}
function convergenceSpark() {
  const traces=app.result?.trajectories || []; if(traces.length<5)return "";
  let wins=0;const points=traces.map((t,i)=>{wins+=t.outcome==="success"?1:0;return `${(i/(traces.length-1)*80).toFixed(1)},${(30-wins/(i+1)*25).toFixed(1)}`;}).join(" ");
  return `<svg class="sparkline" viewBox="0 0 84 33" aria-label="Success rate convergence for stored trajectories"><polyline points="${points}" stroke="#72b49b" stroke-width="1.5" fill="none"/></svg>`;
}
function stats() {
  if(app.resultMode==="branch") { const t=app.tree; const terminal=Object.values(t.outcome_mass).reduce((a,b)=>a+b,0);return `<section class="stat-grid">${statCard("Explored states",num(t.nodes.length),"","Bounded probability tree","branch")}${statCard("Terminal mass",(terminal*100).toFixed(1),"%","Resolved simulation outcomes","check")}${statCard("Unresolved mass",(t.frontier_mass*100).toFixed(1),"%","Reached depth or node limit","clock")}${statCard("Pruned mass",(t.pruned_mass*100).toFixed(1),"%","Excluded paths; not renormalized","scan")}</section>`; }
  const r=app.result; const failure=r.outcomes.failure.rate+r.outcomes.critical_failure.rate;
  return `<section class="stat-grid">${statCard("Episodes simulated",num(r.episodes),"",`${num(r.total_steps)} decisions explored`,"branch",'<span class="pill">COMPLETED</span>')}${statCard("Success rate",(r.outcomes.success.rate*100).toFixed(1),"%",`${num(r.outcomes.success.count)} goals reached`,"target","",convergenceSpark())}${statCard("Failure rate",(failure*100).toFixed(1),"%",`${num(r.outcomes.failure.count+r.outcomes.critical_failure.count)} failures detected`,"warning",'<span class="pill red">OBSERVED</span>')}${statCard("Avg. episode length",r.mean_steps.toFixed(1),"steps",`${r.mean_entropy.toFixed(2)} bits mean action entropy`,"clock")}</section>`;
}

function treePanel() {
  return `<section class="panel tree-panel"><div class="panel-head"><div class="tree-tabs"><button class="tree-tab ${app.treeTab==="tree"?"active":""}" data-tree-tab="tree">${icon("branch")}${app.tree.kind==="recorded_trace"?"Recorded decisions":"Decision tree"}</button><button class="tree-tab ${app.treeTab==="world"?"active":""}" data-tree-tab="world">${icon("grid")}Environment</button></div><span class="tag">${num(app.tree.nodes.length)} NODES</span></div><div class="tree-surface" id="tree-surface"></div><div class="panel-foot"><div class="tree-legend"><span><i class="legend-dot orange"></i>Selected path</span><span><i class="legend-dot"></i>Alternative decision</span><span><i class="legend-dot red"></i>Failure</span></div><span id="tree-footer">Representative paths</span></div></section>`;
}
function inspector() {
  return `<aside class="panel inspector"><div class="panel-head"><div class="panel-title">${icon("sliders")}Decision inspector</div><span class="tag">LIVE STATE</span></div><div class="inspector-body" id="inspector-body"></div></aside>`;
}
function outcomeChart() {
  let outcomes;
  if(app.resultMode==="branch") outcomes={...app.tree.outcome_mass,frontier:app.tree.frontier_mass,pruned:app.tree.pruned_mass};
  else outcomes=Object.fromEntries(Object.entries(app.result.outcomes).map(([k,v])=>[k,v.rate]));
  const entries=Object.entries(outcomes).filter(([,v])=>v>0);let acc=0;const gradient=entries.map(([k,v])=>{const from=acc;acc+=v*100;return `${colors[k]||"#9ba8b6"} ${from}% ${acc}%`;}).join(",");
  return `<section class="panel"><div class="panel-head"><div><div class="panel-title">Outcome distribution</div><div class="panel-subtitle">${app.resultMode==="branch"?"Accounted probability mass across the tree":"Every episode tells a different story"}</div></div>${icon("chart")}</div><div class="outcome-body"><div class="donut" style="background:conic-gradient(${gradient || "#eee 0% 100%"})"><div class="donut-label">${app.resultMode==="branch"?"100%":num(app.result.episodes)}<small>${app.resultMode==="branch"?"total mass":"total episodes"}</small></div></div><div class="outcome-legend">${entries.map(([key,value])=>`<div class="outcome-item"><i class="outcome-swatch" style="background:${colors[key]||"#9ba8b6"}"></i><span>${labels[key]||escapeHTML(key)}</span><strong>${pct(value)}</strong>${app.resultMode!=="branch"?`<span class="count">${num(app.result.outcomes[key].count)}</span>`:""}</div>`).join("")}</div></div></section>`;
}
function failurePanel() {
  if(app.resultMode==="branch") return `<section class="panel"><div class="panel-head"><div class="panel-title">A complete picture of uncertainty</div><span class="tag">MASS ACCOUNTING</span></div><div class="failure-body"><div class="failure-alert">${icon("branch")}The tree includes environment randomness.</div><p style="margin-top:16px">Branch edges combine the action probability with the probability of the environment transition. Unresolved and pruned paths remain unknown; they are never counted as successes.</p><div class="failure-path"><span class="path-chip">TERMINAL</span><span class="path-arrow">+</span><span class="path-chip">FRONTIER</span><span class="path-arrow">+</span><span class="path-chip">PRUNED</span><span class="path-arrow">= 100%</span></div><button class="text-button" data-page="docs">Understand the engine ${icon("arrow")}</button></div></section>`;
  const path=app.result.failure_paths[0];
  return `<section class="panel"><div class="panel-head"><div><div class="panel-title">Most common failure path</div><div class="panel-subtitle">Understand where things went off course</div></div><span class="tag">LAST 4 ACTIONS</span></div><div class="failure-body">${path?`<div class="failure-alert">${icon("warning")}Observed in ${path.count} failed ${path.count===1?"episode":"episodes"}</div><div class="failure-path">${path.path.split(" → ").map((action,i)=>`${i?'<span class="path-arrow">→</span>':""}<span class="path-chip">${escapeHTML(action)}</span>`).join("")}</div><p>Inspect a failure, then change one decision to see how the outcome shifts.</p><button class="text-button" id="inspect-failure">Explore a failure ${icon("arrow")}</button>`:'<div class="empty-state" style="padding:15px 0">No failures in this run. Increase episode count or vary environment parameters to explore more states.</div><button class="text-button" data-page="failures">Start failure hunting '+icon("arrow")+'</button>'}</div></section>`;
}
function renderOverview() { return `${stats()}<div class="workspace-grid">${treePanel()}${inspector()}</div><div class="bottom-grid">${outcomeChart()}${failurePanel()}</div>`; }

function visibleTree() {
  const all=app.tree.nodes; const byParent=new Map(); all.forEach(n=>{if(!byParent.has(n.parent))byParent.set(n.parent,[]);byParent.get(n.parent).push(n);});
  function representatives(parent,limit) {const best=new Map();(byParent.get(parent)||[]).forEach(n=>{if(!best.has(n.action)||best.get(n.action).mass<n.mass)best.set(n.action,n);});const chosen=[...best.values()].sort((a,b)=>b.mass-a.mass).slice(0,limit);const failure=(byParent.get(parent)||[]).filter(n=>n.outcome?.includes("failure")).sort((a,b)=>b.mass-a.mass)[0];if(failure&&limit>1&&!chosen.some(n=>n.id===failure.id)){if(chosen.length===limit)chosen.pop();chosen.push(failure);}return chosen;}
  const first=representatives(app.treeRoot,3); const selected=[{node:all[app.treeRoot],x:24,y:152}];
  const ys=first.length===1?[152]:first.length===2?[90,220]:[51,152,253];
  first.forEach((node,i)=>{selected.push({node,x:238,y:ys[i]});const children=representatives(node.id,2);children.forEach((child,j)=>selected.push({node:child,x:460,y:ys[i]+(children.length===1?0:j===0?-24:24)}));});
  return selected;
}
function drawTree() {
  const surface=$("#tree-surface");if(!surface)return;
  if(app.treeTab==="world") { drawWorld(surface); return; }
  const shown=visibleTree();const positions=new Map(shown.map(p=>[p.node.id,p])); const width=146,height=42;
  const edges=shown.filter(p=>p.node.id!==app.treeRoot).map(p=>{const parent=positions.get(p.node.parent);if(!parent)return "";const x=parent.x+width,y=parent.y;const mid=(x+p.x)/2;return `<path class="tree-edge ${p.node.id===app.selected?"highlight":""}" d="M${x},${y} C${mid},${y} ${mid},${p.y} ${p.x},${p.y}"/><text class="edge-label" x="${mid-3}" y="${p.y-7}" text-anchor="middle">${(p.node.probability*100).toFixed(0)}%</text>`;}).join("");
  const nodes=shown.map(({node:n,x,y})=>`<g class="tree-node ${n.outcome?.includes("failure")?"failure-node":""} ${app.selected===n.id?"selected":""}" tabindex="0" role="button" aria-label="Inspect ${n.action}, path probability ${pct(n.mass)}" data-node="${n.id}" transform="translate(${x},${y-height/2})"><rect width="${width}" height="${height}" rx="6"/><rect class="node-icon-bg" x="8" y="9" width="24" height="24" rx="5"/><text class="node-icon-text" x="20" y="25" text-anchor="middle">${n.outcome?.includes("failure")?"!":n.outcome==="success"?"✓":n.action==="START"?"∴":"↳"}</text><text class="node-title" x="41" y="17">${n.action==="START"?"Initial state":escapeHTML(n.action.replaceAll("_"," "))}</text><text x="41" y="30">${n.outcome?escapeHTML(labels[n.outcome]||n.outcome):n.id===0?`${Object.keys(n.probabilities||{}).length} legal actions`:`path mass ${(n.mass*100).toFixed(1)}%`}</text></g>`).join("");
  surface.innerHTML=`<div class="tree-context"><span>${escapeHTML(app.environment.toUpperCase())}</span><span>DEPTH ${app.tree.depth}</span>${app.treeRoot?'<button id="tree-home">← Initial state</button>':""}</div><svg class="tree-svg" viewBox="0 0 ${650/app.zoom} ${330/app.zoom}" aria-label="Interactive decision tree">${edges}${nodes}</svg><div class="tree-controls"><button id="zoom-out" aria-label="Zoom out">−</button><button id="zoom-in" aria-label="Zoom in">+</button><button id="zoom-reset" aria-label="Fit tree">${icon("expand")}</button></div><span class="tree-hint">Click any node to inspect its decision</span>`;
  if($("#tree-home"))$("#tree-home").onclick=()=>{app.treeRoot=0;app.selected=0;drawTree();drawInspector();};
  $("#tree-footer").textContent=`${app.tree.kind==="recorded_trace"?"Recorded episode · ":""}${shown.length} of ${num(app.tree.nodes.length)} states shown`;
  $$("[data-node]").forEach(el=>{const select=()=>{app.selected=Number(el.dataset.node);drawTree();drawInspector();if(matchMedia("(max-width:660px)").matches)openNode();};el.addEventListener("click",select);el.addEventListener("keydown",e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();select();}});});
  $("#zoom-in").onclick=()=>{app.zoom=Math.min(1.3,app.zoom+.1);drawTree();};$("#zoom-out").onclick=()=>{app.zoom=Math.max(.7,app.zoom-.1);drawTree();};$("#zoom-reset").onclick=()=>{app.zoom=1;drawTree();};
}
function stateValue(value) { return typeof value==="boolean"?(value?"Yes":"No"):typeof value==="object"?JSON.stringify(value):String(value); }
function inspectorContent() {
  const n=app.tree.nodes[app.selected]||app.tree.nodes[0];
  const state=Object.entries(n.state).filter(([key])=>!["kind","obstacle_rate","fragility","slip"].includes(key)).slice(0,4);
  const probabilities=Object.entries(n.probabilities||{}).sort((a,b)=>b[1]-a[1]);
  return `<div class="inspector-kicker"><span>STATE ${String(n.id).padStart(3,"0")}</span><span>DEPTH ${n.depth}</span></div><h3>${n.id===0?"Where it all begins.":n.outcome?escapeHTML(labels[n.outcome]||n.outcome):"The next decision."}</h3><p class="inspector-description">${n.id===0?"One state. Multiple possible futures.":escapeHTML(n.event)}</p><div class="state-chips">${state.map(([k,v])=>`<div class="state-chip"><span>${escapeHTML(k.replaceAll("_"," "))}</span><strong>${escapeHTML(stateValue(v))}${k==="battery"?"%":""}</strong></div>`).join("")}</div><div class="prob-heading"><span>ACTION PROBABILITIES</span><span>P(A | S)</span></div><div>${probabilities.length?probabilities.map(([action,p])=>`<div class="prob-row"><div class="prob-row-label"><span>${escapeHTML(action)}</span><span>${pct(p)}</span></div><div class="prob-track"><div class="prob-fill" style="width:${p*100}%"></div></div></div>`).join(""):`<p class="muted" style="font-size:10px">${n.outcome?"Terminal state. No further decisions.":"Frontier state. Its decision has not been expanded."}</p>`}</div><button class="button inspect-button" id="inspect-state">${icon("terminal")}View full state ${icon("arrow")}</button>${app.selected!==app.treeRoot&&app.tree.nodes.some(child=>child.parent===app.selected)?'<button class="text-button drill-button" id="focus-branch">Explore this branch →</button>':""}`;
}
function drawInspector() { if(!$("#inspector-body"))return;$("#inspector-body").innerHTML=inspectorContent();$("#inspect-state").onclick=openNode;if($("#focus-branch"))$("#focus-branch").onclick=()=>{app.treeRoot=app.selected;drawTree();drawInspector();}; }
function openNode() {const n=app.tree.nodes[app.selected];openDetail(`<div class="dialog-heading"><div><div class="eyebrow">DECISION INSPECTOR · STATE ${n.id}</div><h2>${n.action==="START"?"Initial state":escapeHTML(n.action)}</h2></div>${closeDetail()}</div><p class="muted">Path mass ${pct(n.mass)} · ${escapeHTML(n.event)} · ${escapeHTML(n.status)}</p><pre class="code-state">${escapeHTML(JSON.stringify(n.state,null,2))}</pre><div class="prob-heading"><span>ACTION DISTRIBUTION</span><span>${escapeHTML(app.tree.policy||app.result?.policy||policyLabel())}</span></div>${Object.entries(n.probabilities||{}).map(([a,p])=>`<div class="prob-row"><div class="prob-row-label"><span>${escapeHTML(a)}</span><span>${pct(p)}</span></div><div class="prob-track"><div class="prob-fill" style="width:${p*100}%"></div></div></div>`).join("")}`); }
function drawWorld(surface) {
  const s=(app.tree.nodes[app.selected]||app.tree.nodes[0]).state;
  if(s.kind==="warehouse")surface.innerHTML=`<div class="tree-context"><span>WAREHOUSE FLOOR</span><span>STATE ${app.selected}</span></div><div class="world-view"><div class="warehouse-grid">${Array.from({length:40},(_,i)=>{const row=Math.floor(i/8),col=i%8;const shelf=(row===0||row===1||row===3||row===4)&&col>0&&col<7;const robot=row===2&&col===s.position;const goal=row===2&&col===7;return `<div class="warehouse-cell ${shelf?"shelf":robot?"robot":goal?"goal":""}">${shelf?"▤":robot?icon("robot"):goal?"⚑":""}</div>`;}).join("")}</div></div><span class="tree-hint">Parcel route · 7 aisles · ${s.battery}% battery</span>`;
  else if(s.kind==="gridworld")surface.innerHTML=`<div class="tree-context"><span>5 × 5 GRID WORLD</span></div><div class="world-view"><div class="warehouse-grid" style="grid-template-columns:repeat(5,1fr);max-width:270px;transform:none">${Array.from({length:25},(_,i)=>{const x=i%5,y=Math.floor(i/5),robot=x===s.x&&y===s.y,hazard=x===2&&(y===1||y===3),goal=x===4&&y===4;return `<div class="warehouse-cell ${robot?"robot":hazard?"hazard":goal?"goal":""}">${robot?icon("robot"):hazard?"×":goal?"⚑":"·"}</div>`;}).join("")}</div></div>`;
  else surface.innerHTML=`<div class="tree-context"><span>${escapeHTML(s.kind.toUpperCase())} · CURRENT STATE</span></div><div class="world-view"><div class="world-state">${Object.entries(s).filter(([k])=>k!=="kind").map(([k,v])=>`<div class="state-chip"><span>${escapeHTML(k.replaceAll("_"," "))}</span><strong>${escapeHTML(stateValue(v))}</strong></div>`).join("")}</div></div>`;
  $("#tree-footer").textContent="State snapshot";
}

function renderTrajectories() {
  if(!app.result)return '<div class="empty-state">Run Monte Carlo or replay mode to record trajectories.</div>';
  const traces=app.result.trajectories.filter(t=>app.traceFilter==="all"||t.outcome===app.traceFilter);
  return `<div class="content-title"><div><h2>Every path has a story.</h2><p>${num(app.result.episodes)} episodes simulated. First ${app.result.trajectories.length} traces retained in the dashboard.</p></div><div class="filters"><select id="trace-filter" aria-label="Filter trajectories by outcome">${["all","success","safe_return","failure","critical_failure","timeout"].map(k=>`<option value="${k}" ${app.traceFilter===k?"selected":""}>${k==="all"?"All outcomes":labels[k]}</option>`).join("")}</select><button class="button secondary" id="import-trace">${icon("download")}Import trace</button><input type="file" id="trace-file" accept=".json,application/json" hidden></div></div><div class="panel table-scroll"><table class="trace-table"><thead><tr><th>Episode</th><th>Outcome</th><th>Seed</th><th>Steps</th><th>Reward</th><th></th></tr></thead><tbody>${traces.map(t=>`<tr><td class="mono">#${String(t.episode+1).padStart(4,"0")}</td><td><span class="badge ${t.outcome}">${labels[t.outcome]||escapeHTML(t.outcome)}</span></td><td class="mono">${t.seed}</td><td>${t.steps.length}</td><td>${t.total_reward.toFixed(1)}</td><td><button class="text-button" data-trace="${t.episode}">Inspect ${icon("arrow")}</button></td></tr>`).join("")}</tbody></table>${!traces.length?'<div class="empty-state">No stored trajectories match this outcome.</div>':""}</div>`;
}
function closeDetail() { return '<button class="icon-button" data-close="detail-dialog" aria-label="Close details">×</button>'; }
function openDetail(html) { $("#detail-content").innerHTML=html;bindClose();if(!$("#detail-dialog").open)$("#detail-dialog").showModal(); }
function openTrace(trace) {
  app.activeTrace=trace;
  openDetail(`<div class="dialog-heading"><div><div class="eyebrow">TRAJECTORY #${String(trace.episode+1).padStart(4,"0")} · SEED ${trace.seed}</div><h2>A decision-by-decision replay.</h2></div>${closeDetail()}</div><p class="muted"><span class="badge ${escapeHTML(trace.outcome)}">${escapeHTML(labels[trace.outcome]||trace.outcome)}</span> ${escapeHTML(trace.policy)} · ${trace.steps.length} decisions · reward ${trace.total_reward.toFixed(1)}</p><div class="trace-timeline"><table><thead><tr><th>Step</th><th>Action / probability</th><th>What happened</th><th>Alternative futures</th></tr></thead><tbody>${trace.steps.map((s,i)=>`<tr><td class="mono">${String(i).padStart(2,"0")}</td><td class="mono">${escapeHTML(s.action)}<small style="display:block;color:#a1abb8;margin-top:4px">${pct(s.probabilities[s.action]||0)}</small></td><td>${escapeHTML(s.event)}</td><td><button data-counterfactual="${i}">Explore ↗</button></td></tr>`).join("")}</tbody></table></div><div style="display:flex;justify-content:space-between;align-items:center"><span class="muted" style="font-size:10px">Choose a step to intervene on its action.</span><button class="button secondary" id="download-trace">${icon("download")}Save trace</button></div><div id="counterfactual-results"></div>`);
  $("#download-trace").onclick=()=>download(trace,`jev-sim-${trace.environment}-trace-${trace.episode}.json`);
  $$("[data-counterfactual]").forEach(button=>button.onclick=()=>runCounterfactual(trace,Number(button.dataset.counterfactual)));
}
async function runCounterfactual(trace, step) {
  if(app.busy || !readyToRun())return;
  const cfEpisodes=app.policy==="demo"?200:Math.min(app.episodes,20);
  const container=$("#counterfactual-results"); $$("[data-counterfactual]").forEach(b=>b.disabled=true);
  container.innerHTML=`<div class="counterfactual-results"><p class="muted">${cfEpisodes} continuations per action · ${escapeHTML(policyLabel())}</p><p class="muted" id="cf-live">Starting…</p><button class="button secondary" id="cf-stop">Stop</button></div>`; $("#cf-stop").onclick=stopLiveRun;
  try {
    const result=await streamAPI("/api/counterfactual",{trace,step,episodes:cfEpisodes,max_steps:app.max_steps,seed:app.seed});
    const best=Math.max(...result.alternatives.map(a=>a.outcomes.success.rate));
    container.innerHTML=`<div class="counterfactual-results"><h3>What if step ${step} went differently?</h3><p class="muted" style="font-size:10px">${result.episodes_per_action} sampled futures per action · ${escapeHTML(result.continuation_policy)} · from the recorded state</p>${result.alternatives.map(a=>`<div class="cf-row ${a.outcomes.success.rate===best?"best":""}"><span>${escapeHTML(a.action)}${a.action===result.selected_action?" *":""}</span><div class="cf-track">${Object.entries(a.outcomes).filter(([,v])=>v.rate>0).map(([k,v])=>`<span title="${labels[k]} ${pct(v.rate)}" style="width:${v.rate*100}%;background:${colors[k]}"></span>`).join("")}</div><span>${pct(a.outcomes.success.rate)}</span></div>`).join("")}<p class="muted" style="font-size:10px">Percentages show goal success. * Recorded action. Green: success · blue: safe return · red: failure · gold: timeout. Estimates describe this simulator, not real-world guarantees.</p></div>`;
    container.scrollIntoView({block:"nearest",behavior:"smooth"});
  } catch(error) {container.innerHTML=`<p class="error-message">${escapeHTML(error.message)}</p>`;}
  finally {$$("[data-counterfactual]").forEach(b=>b.disabled=false);}
}

function renderFailures() {
  return `<section class="panel failure-hero"><div><div class="eyebrow"><span class="orange-line"></span>LOOK FOR THE EXCEPTION</div><h2>Find the failure. Before it finds you.</h2><p>Vary the starting conditions, probe uncertain decisions, and discover where your policy breaks. Every finding comes with a reproducible seed.</p><button class="button primary" id="hunt-button">${icon("scan")}Hunt for failures</button><p style="font-size:9px;margin-bottom:0">${app.policy==="demo"?"80 scenarios · 10 episodes each":"10 scenarios · 5 episodes each"} · ${escapeHTML(policyLabel())}</p></div><span class="hero-orbit" aria-hidden="true">◎</span></section>${app.fuzz?`<section class="panel"><div class="fuzz-metrics"><div><strong>${app.fuzz.scenarios}</strong><span>Scenarios searched</span></div><div><strong>${app.fuzz.failure_scenarios}</strong><span>With observed failures</span></div><div><strong>${app.fuzz.findings.filter(f=>f.boundary).length}</strong><span>Retained close decisions</span></div></div><div class="table-scroll"><table><thead><tr><th>Initial conditions</th><th>Failure rate</th><th>Top-action margin</th><th></th></tr></thead><tbody>${app.fuzz.findings.map((f,i)=>`<tr><td class="mono" style="font-size:9px;line-height:1.8">${Object.entries(f.config).map(([k,v])=>`${escapeHTML(k)} = ${v}`).join("<br>")}</td><td><span class="badge failure">${pct(f.failure_rate)}</span><small style="display:block;font-size:9px;margin-top:7px">${f.failures} / ${f.episodes} episodes</small></td><td>${pct(f.action_margin)}${f.boundary?'<small style="display:block;font-size:9px;margin-top:7px">Close decision boundary</small>':""}</td><td>${f.trace?`<button class="text-button" data-finding="${i}">Inspect ${icon("arrow")}</button>`:"No failed trace"}</td></tr>`).join("")}</tbody></table></div>${!app.fuzz.findings.length?'<div class="empty-state">No failures or close initial decisions found in this sample.</div>':""}</section>`:'<section class="panel empty-state">'+icon("scan")+'<h3>Every edge case is a chance to learn.</h3><p>Run a search to discover failure states for '+escapeHTML(environmentTitle())+'.<br>The engine varies all of this environment’s configurable parameters.</p></section>'}`;
}
async function huntFailures() {
  if(app.busy || !readyToRun())return;setBusy(true,"Searching…");$("#hunt-button").textContent="Searching scenarios…";$("#error-message").hidden=true;
  try {app.fuzz=await streamAPI("/api/fuzz",{...config(),scenarios:app.policy==="demo"?80:10,episodes:app.policy==="demo"?10:5});render();toast(`Search complete. ${app.fuzz.failure_scenarios} scenarios contained failures.`);}catch(error){showError(error);}finally{setBusy(false);if($("#hunt-button"))$("#hunt-button").innerHTML=icon("scan")+"Hunt for failures";}
}
function renderEnvironments() {
  const envIcons={warehouse:"robot",gridworld:"grid",support:"heart","npc-town":"box",incident:"scan"};
  return `<div class="content-title"><div><h2>Different worlds. One framework.</h2><p>Five starting points for exploring probabilistic decisions. Make any of them your own.</p></div><span class="tag">5 ENVIRONMENTS</span></div><div class="scenario-grid">${app.catalog.map(env=>`<article class="panel scenario-card"><span class="scenario-icon">${icon(envIcons[env.id])}</span><h3>${escapeHTML(env.title)}</h3><p>${escapeHTML(env.description)}</p><button class="text-button" data-use-environment="${env.id}">${env.id===app.environment?"Explore current environment":"Load environment"} ${icon("arrow")}</button></article>`).join("")}<article class="panel scenario-card" style="background:transparent;border-style:dashed"><span class="scenario-icon" style="background:#f2f4f7;color:#929dab;border-color:#e7ebf0">${icon("terminal")}</span><h3>Bring your own world.</h3><p>Define states, legal actions, and transitions in Python. Plug in any decision policy.</p><button class="text-button" data-page="docs">Read the environment API ${icon("arrow")}</button></article></div>`;
}
function renderDocs() {
  return `<article class="panel docs-content"><div class="eyebrow">JEV-SIM / GETTING STARTED</div><h2 style="margin-top:14px">Simulate first. Act with confidence.</h2><p>A provider-independent framework for probabilistic AI decisions. Run an environment thousands of times, inspect its probability tree, and ask what would happen if one decision changed.</p><div class="notice">Select <strong>TypeSafe Jev</strong> for real API decisions. Use <strong>Connect Jev</strong> to save your key to a private <code>.env</code>, or copy <code>.env.example</code> to <code>.env</code>. The dashboard streams each decision as it arrives. Offline demo mode is available only when explicitly selected.</div><h3>A small API. A lot of possible futures.</h3><pre>from jevsim import Simulation
from jevsim.environments import Warehouse
from jevsim.models import DemoPolicy

sim = Simulation(Warehouse(), DemoPolicy())
results = sim.run(episodes=10_000, seed=42)
results.report()

tree = sim.explore(depth=8, branches=3)</pre><h3>Three ways to explore</h3><p><strong>Replay</strong> selects the highest-probability action; environment transitions can still be stochastic. <strong>Monte Carlo</strong> samples actions and transitions with seeded randomness. <strong>Branch</strong> expands both distributions and tracks terminal, frontier, and pruned mass separately.</p><pre>python -m jevsim run warehouse
python -m jevsim run warehouse --episodes 10000 --policy demo
python -m jevsim explore warehouse --depth 8 --branches 3
python -m jevsim fuzz support --scenarios 100
python -m jevsim replay failure.json --step 2</pre><h3>Bring a model. Keep your simulation.</h3><p>Use <code>Jev()</code> with a server-side <code>TYPESAFE_API_KEY</code>, <code>HTTPPolicy(endpoint)</code> for any endpoint returning an action distribution, or <code>FunctionPolicy(fn)</code> for a deterministic Python policy. The TypeSafe adapter follows the <a href="https://docs.typesafe.ai/primitives/choice" target="_blank" rel="noreferrer">official Choice API ↗</a>. Live adapters have an explicit request budget.</p><h3>Create an environment</h3><pre>class MyWorld:
    name = "my-world"
    title = "My world"

    def reset(self, seed=0):
        return {"ready": True}

    def actions(self, state):
        return {"GO": "Complete the task"}

    def transitions(self, state, action):
        from jevsim import Transition
        return [Transition({"ready": False},
                           reward=1, outcome="success")]

    def objective(self):
        return "Complete the task safely"</pre><h3>What the numbers mean</h3><p>Monte Carlo outcome intervals in exports use 95% Wilson intervals. They measure sampling uncertainty within the simulator. They do not establish model calibration or real-world reliability. Counterfactuals resume a recorded state and force one action before sampling the continuation policy. Their results depend on the environment’s transition rules.</p><p>Failure hunting uses seeded uniform random search across configurable parameters. A small gap between the two leading actions is flagged as a close decision boundary, not a proven instability. Dashboard exports contain the first 100 episode traces plus the first failure; CLI exports contain every episode.</p></article>`;
}

function render() {
  const content=$("#page-content");if(!app.tree && app.page==="overview"){renderReady();return;}
  content.innerHTML=({overview:renderOverview,trajectories:renderTrajectories,failures:renderFailures,environments:renderEnvironments,docs:renderDocs}[app.page])();
  content.classList.remove("fade-in");void content.offsetWidth;content.classList.add("fade-in");
  $$(".sidebar [data-page]").forEach(el=>el.classList.toggle("active",el.dataset.page===app.page));
  $("#breadcrumb-current").textContent={overview:"Overview",trajectories:"Trajectories",failures:"Failure hunting",environments:"Environments",docs:"Documentation"}[app.page];
  $$("#page-content [data-page]").forEach(el=>el.onclick=()=>navigate(el.dataset.page));
  $$("[data-tree-tab]").forEach(el=>el.onclick=()=>{app.treeTab=el.dataset.treeTab;render();});
  if(app.page==="overview"){drawTree();drawInspector();if($("#inspect-failure"))$("#inspect-failure").onclick=()=>openTrace(app.result.first_failure);}
  if(app.page==="trajectories") {
    if($("#trace-filter"))$("#trace-filter").onchange=e=>{app.traceFilter=e.target.value;render();};
    $$("[data-trace]").forEach(el=>el.onclick=()=>openTrace(app.result.trajectories.find(t=>t.episode===Number(el.dataset.trace))));
    if($("#import-trace"))$("#import-trace").onclick=()=>$("#trace-file").click();
    if($("#trace-file"))$("#trace-file").onchange=async e=>{try{const file=e.target.files[0];if(!file)return;if(file.size>2_000_000)throw new Error("Trace must be smaller than 2 MB");const trace=JSON.parse(await file.text());validateTrace(trace);openTrace(trace);}catch(error){showError(error);}};
  }
  if(app.page==="failures"){ $("#hunt-button").onclick=huntFailures;$$("[data-finding]").forEach(el=>el.onclick=()=>openTrace(app.fuzz.findings[Number(el.dataset.finding)].trace));}
  $$("[data-use-environment]").forEach(el=>el.onclick=()=>changeEnvironment(el.dataset.useEnvironment));
  if(app.busy)setBusy(true);
}
function validateTrace(trace) {
  if(!trace||trace.schema_version!==1||!app.catalog.some(e=>e.id===trace.environment)||!Array.isArray(trace.steps)||trace.steps.length>10000||!Number.isInteger(trace.episode)||!Number.isInteger(trace.seed)||!Number.isFinite(trace.total_reward)||typeof trace.policy!=="string"||typeof trace.outcome!=="string"||!trace.config||typeof trace.config!=="object")throw new Error("Expected a version 1 Jev-Sim trace for a built-in environment");
  for(const step of trace.steps)if(!step||typeof step.action!=="string"||typeof step.event!=="string"||!step.state||!step.probabilities||!Object.values(step.probabilities).every(p=>typeof p==="number"&&Number.isFinite(p)&&p>=0&&p<=1))throw new Error("Trace contains an invalid decision step");
}
function navigate(page) {app.page=page;render();}
async function changeEnvironment(id) {
  if(app.busy)return;
  app.environment=id;app.parameters={};app.fuzz=null;app.result=null;app.tree=null;$("#trace-count").textContent="0";app.page="overview";app.traceFilter="all";
  $("#environment").value=id;$("#live-run").hidden=true;renderReady();
}
function openSettings() {
  const form=$("#settings-form");["episodes","seed","max_steps","depth"].forEach(key=>form.elements[key].value=app[key]);
  const env=app.catalog.find(e=>e.id===app.environment);
  $("#parameter-inputs").innerHTML=Object.entries(env.parameters).map(([key,spec])=>`<div class="parameter-row"><label for="param-${key}">${escapeHTML(spec.label)}<output id="output-${key}">${app.parameters[key]??spec.default}${spec.unit?" "+spec.unit:""}</output></label><input id="param-${key}" data-param="${key}" type="range" min="${spec.min}" max="${spec.max}" step="${spec.integer?1:.01}" value="${app.parameters[key]??spec.default}"></div>`).join("");
  $$("[data-param]").forEach(el=>el.oninput=()=>{$(`#output-${el.dataset.param}`).textContent=el.value+" "+env.parameters[el.dataset.param].unit;});
  $("#settings-dialog").showModal();
}
function bindClose() {$$("[data-close]").forEach(el=>el.onclick=()=>$("#"+el.dataset.close).close());}
function download(data,filename) {const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)+"\n"],{type:"application/json"}));const anchor=document.createElement("a");anchor.href=url;anchor.download=filename;document.body.append(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);toast("Export downloaded");}

async function init() {
  $$("[data-icon]").forEach(el=>el.innerHTML=icon(el.dataset.icon));bindClose();
  $$(".sidebar [data-page]").forEach(el=>el.onclick=()=>navigate(el.dataset.page));
  $("#help-button").onclick=()=>navigate("docs");$("#workspace-switch").onclick=()=>toast("Personal workspace · simulations run on this machine");
  $("#settings-button").onclick=openSettings;$("#quick-settings").onclick=openSettings;$("#run-button").onclick=runSimulation;
  $("#environment").onchange=e=>changeEnvironment(e.target.value);
  $$("[data-mode]").forEach(el=>el.onclick=()=>{app.mode=el.dataset.mode;$$("[data-mode]").forEach(b=>b.classList.toggle("selected",b===el));$("#episode-label").textContent=app.mode==="branch"?`Depth ${app.depth}`:app.mode==="replay"?"1 episode":`${num(app.episodes)} episodes`;toast(`${{replay:"Highest-probability actions",monte_carlo:"Sampled action distributions",branch:"Explore all leading decisions"}[app.mode]} · press Run simulation`);});
  $("#settings-form").onsubmit=e=>{e.preventDefault();const form=e.target;["episodes","seed","max_steps","depth"].forEach(k=>app[k]=Number(form.elements[k].value));app.parameters=Object.fromEntries($$("[data-param]").map(el=>[el.dataset.param,Number(el.value)]));$("#episode-label").textContent=app.mode==="branch"?`Depth ${app.depth}`:app.mode==="replay"?"1 episode":`${num(app.episodes)} episodes`;$("#settings-dialog").close();toast("Configuration saved. Run the simulation to apply.");};
  $("#export-button").onclick=()=>{if(!app.tree)return toast("Complete a simulation first");const data=app.page==="failures"&&app.fuzz?app.fuzz:app.resultMode==="branch"?{...app.treeConfig,policy:app.tree.policy,...app.tree}:app.result;download(data,`jev-sim-${app.environment}-${app.page==="failures"?"failures":app.resultMode}.json`);};
  $$("dialog").forEach(dialog=>dialog.addEventListener("click",event=>{if(event.target===dialog){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.close();}}));
  try {const catalog=await api("/api/catalog");app.catalog=catalog.environments;$("#environment").innerHTML=app.catalog.map(env=>`<option value="${env.id}">${escapeHTML(env.title)}</option>`).join("");await setupConnectionUI();renderReady();}
  catch(error){showError(error);$("#run-status").textContent="Local engine unavailable";}
}
init();
