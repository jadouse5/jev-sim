"use strict";

function policyLabel() { return app.policy === "demo" ? "demo-policy-v1" : (app.settings?.model || "jev-latest"); }

async function refreshConnection() {
  app.settings = await api("/api/settings");
  const ready = app.settings.configured;
  $("#provider-status").textContent = app.policy === "demo" ? "Offline · explicitly selected" : ready ? `Key configured · ${app.settings.source}` : "API key required";
  $("#provider-dot").classList.toggle("disconnected", app.policy === "jev" && !ready);
  $("#connection-title").textContent = app.policy === "demo" ? "Offline demo" : ready ? "Jev configured" : "Connect your model";
  $("#connection-description").textContent = app.policy === "demo" ? "Hand-authored probabilities. No API calls." : "Real decisions from TypeSafe. State and progress stream as the simulation runs.";
  $("#connection-model").textContent = policyLabel();
  $("#connect-button").innerHTML = icon("settings") + (ready ? "API settings" : "Connect Jev");
  $("#env-location").textContent = `Configuration file: ${app.settings.env_file}`;
  $("#api-model").value = app.settings.model;
  $("#api-budget").value = app.settings.max_requests;
  $("#api-key").required = !ready;
  $("#key-hint").textContent = ready ? "Key configured. Leave blank to keep it, or enter a replacement." : "Stored in a private .env file on this machine. Never returned by the settings API.";
  $("#test-connection").disabled = !ready || app.busy;
}
function openConnection() {
  $("#connection-error").hidden = true;
  $("#connection-feedback").textContent = "";
  $("#api-key").value = "";
  $("#connection-dialog").showModal();
  refreshConnection().catch(connectionError);
}
function connectionError(error) { $("#connection-error").textContent = error.message; $("#connection-error").hidden = false; }
function readyToRun() {
  if(app.policy === "jev" && !app.settings?.configured) { openConnection(); return false; }
  return true;
}
function renderReady() {
  if(app.page!=="overview"){render();return;}
  $$(".sidebar [data-page]").forEach(el=>el.classList.toggle("active",el.dataset.page==="overview"));
  $("#breadcrumb-current").textContent="Overview";
  const configured = app.policy === "demo" || app.settings?.configured;
  $("#page-content").innerHTML = `<section class="panel ready-panel"><span class="scenario-icon">${icon("branch")}</span><div class="eyebrow">REAL-TIME SIMULATION</div><h2>${configured ? "Ready when you are." : "Connect your decision model."}</h2><p>${configured ? `Run ${escapeHTML(environmentTitle())} with ${escapeHTML(policyLabel())}. Watch each decision, action probability, and outcome arrive live.` : "Add your TypeSafe API key in the interface, or copy .env.example to .env and add it there."}</p><button class="button primary" id="ready-action">${configured ? "Start live simulation" : "Connect Jev"}</button><small>Runs only start when you ask. Each Jev decision uses one API call.</small></section>`;
  $("#ready-action").onclick = configured ? runSimulation : openConnection;
  $("#run-status").textContent = configured ? "Ready · press Run simulation to begin" : "Set up your Jev API connection to begin";
  $("#run-metadata").textContent = `SEED ${app.seed} · ${policyLabel().toUpperCase()}`;
}
async function setupConnectionUI() {
  $("#connect-button").onclick = openConnection;
  $("#policy-select").onchange = async e => {
    app.policy = e.target.value;
    await refreshConnection();
    // Existing results retain their recorded model label until another run completes.
    if(!app.result && !app.tree) renderReady();
    else {if(app.page!=="overview")render();toast(`Next run: ${policyLabel()}`);}
  };
  $("#reload-config").onclick = async () => {
    try { await refreshConnection(); $("#connection-error").hidden=true; $("#connection-feedback").textContent=app.settings.configured?"Configuration loaded. Ready to run.":"No key found. Add it to .env and reload."; if(!app.tree)renderReady(); }
    catch(error) { connectionError(error); }
  };
  $("#connection-form").onsubmit = async e => {
    e.preventDefault(); $("#save-connection").disabled=true; $("#connection-error").hidden=true;
    try {
      await api("/api/settings", {api_key:$("#api-key").value.trim(),model:$("#api-model").value.trim(),max_requests:Number($("#api-budget").value)});
      $("#api-key").value=""; app.policy="jev"; $("#policy-select").value="jev";
      await refreshConnection(); $("#connection-feedback").textContent="Saved to .env. Ready to use immediately.";
      if(!app.tree)renderReady();
    } catch(error) { connectionError(error); }
    finally {$("#save-connection").disabled=false;}
  };
  $("#test-connection").onclick = async () => {
    $("#test-connection").disabled=true; $("#save-connection").disabled=true; $("#connection-error").hidden=true;
    $("#connection-feedback").textContent="Testing the saved key with one real inference call…";
    try {const result=await api("/api/test-connection",{});$("#connection-feedback").textContent=`Connected successfully · ${result.model} · 1 API call`;}
    catch(error) {$("#connection-feedback").textContent="";connectionError(error);}
    finally {$("#test-connection").disabled=false;$("#save-connection").disabled=false;}
  };
  $("#stop-button").onclick=stopLiveRun;
  await refreshConnection();
}

function startLive() {
  app.live={decisions:0,calls:0,completed:0,outcomes:{},feed:[],started:performance.now(),stage:"Connecting to the simulation engine…",model:policyLabel(),state:null,probabilities:{}};
  $("#live-run").hidden=false;$("#live-policy").textContent=policyLabel();
  $("#stop-button").hidden=false;$("#stop-button").disabled=true;$("#stop-button").textContent="Stop run";
  $("#live-progress").value=0;$("#live-progress").max=app.mode==="replay"?1:app.episodes;
  renderLive();
  app.liveTimer=setInterval(()=>{if(app.live)$("#live-elapsed").textContent=((performance.now()-app.live.started)/1000).toFixed(1)+"s";},100);
}
function renderLive() {
  const live=app.live;if(!live)return;
  $("#live-stage").textContent=live.stage;
  $("#live-episodes").textContent=num(live.completed);
  $("#live-decisions").textContent=num(live.decisions);
  $("#live-calls").textContent=num(live.calls);
  $("#live-latency").textContent=live.latency==null?"—":`${live.latency} ms`;
  $("#live-policy").textContent=live.model;
  $("#live-outcomes").innerHTML=Object.entries(live.outcomes).map(([outcome,count])=>`<span class="badge ${escapeHTML(outcome)}">${escapeHTML(labels[outcome]||outcome)} ${count}</span>`).join("");
  if(live.state) {
    const s=live.state;
    const map=s.kind==="warehouse"?`<div class="live-aisles">${Array.from({length:8},(_,i)=>`<div class="${s.position===i?"occupied":""}">${s.position===i?icon("robot"):i===7?"⚑":i+1}</div>`).join("")}</div>`:"";
    $("#live-state").innerHTML=map+`<div class="state-chips">${Object.entries(s).filter(([key])=>key!=="kind").slice(0,8).map(([key,value])=>`<div class="state-chip"><span>${escapeHTML(key.replaceAll("_"," "))}</span><strong>${escapeHTML(stateValue(value))}</strong></div>`).join("")}</div>`;
  } else $("#live-state").innerHTML='<p class="muted">Waiting for the first state…</p>';
  $("#live-probabilities").innerHTML=Object.keys(live.probabilities).length?'<div class="prob-heading">LAST DECISION · INPUT-STATE PROBABILITIES</div>'+Object.entries(live.probabilities).sort((a,b)=>b[1]-a[1]).map(([action,p])=>`<div class="prob-row"><div class="prob-row-label"><span>${escapeHTML(action)}</span><span>${pct(p)}</span></div><div class="prob-track"><div class="prob-fill" style="width:${p*100}%"></div></div></div>`).join(""):"";
  $("#live-feed").innerHTML=live.feed.slice(-30).reverse().map(item=>`<li><span>${escapeHTML(item.label)}</span><strong>${escapeHTML(item.action)}</strong><small>${escapeHTML(item.event)}</small></li>`).join("");
  if($("#cf-live"))$("#cf-live").textContent=`${live.stage} · ${live.decisions} decisions · ${live.calls} API calls`;
}
function onLiveEvent(event) {
  const live=app.live;
  if(event.type==="start")$("#stop-button").disabled=false;
  if(event.type==="inference") {live.stage=`Waiting for ${event.policy}…`;live.state=event.state;live.calls=event.pending_call||event.api_calls;}
  if(event.type==="inference_complete") {live.calls=event.api_calls;live.latency=event.latency_ms;live.model=event.model;}
  if(event.type==="episode_start") {live.state=event.state;live.stage=`Episode ${event.episode+1} started`;}
  if(event.type==="step") {
    live.decisions++;live.state=event.step.next_state;live.probabilities=event.step.probabilities;
    live.stage=`Episode ${event.episode+1} · step ${event.step.index+1} · ${event.step.action}`;
    live.feed.push({label:`E${event.episode+1} · S${event.step.index+1}`,action:event.step.action,event:event.step.event});
  }
  if(event.type==="episode") {live.completed++;live.outcomes[event.outcome]=(live.outcomes[event.outcome]||0)+1;$("#live-progress").max=event.total;$("#live-progress").value=event.completed;}
  if(event.type==="branch_visit") {live.state=event.node.state;live.stage=`Exploring state ${event.node.id} · ${event.nodes} nodes discovered`;$("#live-progress").removeAttribute("value");}
  if(event.type==="branch_decision") {live.decisions++;live.probabilities=event.node.probabilities;live.feed.push({label:`STATE ${event.node.id}`,action:event.node.action,event:`${event.nodes} nodes · depth ${event.node.depth}`});}
  if(event.type==="alternative")live.stage=`Counterfactual: force ${event.action}`;
  if(event.type==="scenario")live.stage=`Searching scenario ${event.scenario} / ${event.total}`;
  live.feed=live.feed.slice(-30);
  // Coalesce fast offline events; real API events render as each response arrives.
  if(!app.liveFrame)app.liveFrame=setTimeout(()=>{app.liveFrame=null;renderLive();},50);
}
async function streamAPI(path,data) {
  if(app.runId)throw new Error("A run is already active");
  app.runId=crypto.randomUUID();setBusy(true);startLive();
  let result,finished=false,reader;
  try {
    const response=await fetch(path+"/stream",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({...data,policy:app.policy,run_id:app.runId})});
    if(!response.ok){const error=await response.json();throw new Error(error.error||"Could not start the run");}
    reader=response.body.getReader();const decoder=new TextDecoder();let pending="";
    const consume=line=>{
      if(!line.trim())return;
      const event=JSON.parse(line);
      if(event.type==="error")throw new Error(event.error);
      if(event.type==="cancelled"){const error=new Error(event.message);error.cancelled=true;throw error;}
      if(event.type==="result"){result=event.result;finished=true;}else onLiveEvent(event);
    };
    while(true){const {done,value}=await reader.read();pending+=done?decoder.decode():decoder.decode(value,{stream:true});let end;while((end=pending.indexOf("\n"))>=0){consume(pending.slice(0,end));pending=pending.slice(end+1);}if(done){consume(pending);break;}}
    if(!finished)throw new Error("Live connection closed before completion. Partial progress is shown above.");
    app.live.stage="Complete · all decisions received";$("#live-progress").value=$("#live-progress").max;
    return result;
  } catch(error) {app.live.stage=error.cancelled?"Stopped · partial progress retained":"Run failed · "+error.message;throw error;}
  finally {
    if(reader)await reader.cancel().catch(()=>{});
    clearInterval(app.liveTimer);clearTimeout(app.liveFrame);app.liveFrame=null;
    app.runId=null;$("#stop-button").hidden=true;renderLive();setBusy(false);
  }
}
async function stopLiveRun() {
  if(!app.runId)return;
  $("#stop-button").disabled=true;$("#stop-button").textContent="Stopping…";
  const runId=app.runId;
  try {const result=await api("/api/cancel",{run_id:runId});if(app.runId!==runId)return;app.live.stage=result.cancel_requested?"Stop requested · waiting for any in-flight API call to finish":"Run has already finished";renderLive();}
  catch(error){showError(error);$("#stop-button").disabled=false;}
}
