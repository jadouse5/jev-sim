"use strict";
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const label = a => ({SUPPORT:"Express support",OPPOSE:"Push back",WAIT:"Wait & observe",ASK_PEERS:"Ask their peers",ADVOCATE:"Spread their view"}[a] || a);
const colors = {support:"#5b9c87",oppose:"#d88972",undecided:"#8c9cb5"};
const stance = n => n > .2 ? "support" : n < -.2 ? "oppose" : "undecided";
const pct = n => Number.isFinite(n) ? `${Math.round(n * 100)}%` : "—";
const state = {world:null, worlds:[], catalog:{presets:[],actions:{},drivers:{}}, person:null, decision:null, view:"world", map:"3d", round:0, busy:false, runId:null, pending:[], activePerson:null, settings:{}, layout:0, playback:null, comparison:null};
Object.assign(state,{requests:[],requestId:null,followActive:true});
Object.assign(state,{usage:null,usageLoading:false,castPage:0,peoplePage:0});
const number = n => Number(n||0).toLocaleString();
function renderUsage() {
  const u=state.usage;if(!u)return;
  $('#usage-requests').textContent=number(u.requests);
  $('#usage-flight').textContent=`${u.in_flight} in flight · ${u.failed} failed`;
  $('#usage-tokens').textContent=number(u.input_tokens+u.output_tokens);
  $('#usage-token-detail').textContent=`${number(u.input_tokens)} in · ${number(u.output_tokens)} out`;
  $('#usage-cost').textContent='$'+u.estimated_cost_usd.toFixed(6)+(u.unpriced_requests?'*':'');
  $('#usage-dot').classList.toggle('working',u.in_flight>0);
  $('#usage-status').textContent=u.in_flight?'Receiving live API responses':`This workspace · ${u.unreported_requests?'some usage unreported':'up to date'}`;
  $('#usage-detail').innerHTML=`<p>Counts calls made through this workspace since ${esc(new Date(u.since*1000).toLocaleString())}. Totals persist across reloads and server restarts.</p><table class="report-table"><tbody><tr><td>Requests started / responses</td><td>${number(u.requests)} / ${number(u.responses)}</td></tr><tr><td>In flight / failed</td><td>${u.in_flight} / ${u.failed}</td></tr><tr><td>Reported input tokens</td><td>${number(u.input_tokens)}</td></tr><tr><td>Reported output tokens</td><td>${number(u.output_tokens)}</td></tr><tr><td>Estimated USD cost</td><td>$${u.estimated_cost_usd.toFixed(8)}</td></tr><tr><td>Requests with incomplete token reports</td><td>${u.unreported_requests}</td></tr><tr><td>Requests not priced</td><td>${u.unpriced_requests}</td></tr></tbody></table><p class="callout">Estimate for ${esc(u.pricing.model)}: $${u.pricing.input_usd_per_million} per million input tokens; output tokens are free. <a href="${esc(u.pricing.source)}" target="_blank" rel="noopener">Official pricing ↗</a> · checked ${esc(u.pricing.checked_on)}. Unknown usage is not counted as zero cost; an asterisk means the estimate is incomplete. This is tracked API usage, not your account balance or invoice. Earlier calls made before tracking was installed are not included. Local demo runs do not add API usage.</p>`;
}
async function refreshUsage() {
  if(state.usageLoading)return;state.usageLoading=true;
  try{state.usage=await api('/api/usage');renderUsage();}catch{$('#usage-status').textContent='Usage meter reconnecting…';}finally{state.usageLoading=false;}
}
function visiblePeople() {
  const people=currentPeople();state.castPage=Math.max(0,Math.min(state.castPage,Math.ceil(people.length/24)-1));
  return people.slice(state.castPage*24,state.castPage*24+24);
}
function initialPerson(id) { return state.world?.snapshots[0]?.people.find(p=>p.id===id)||state.world?.arrivals?.find(a=>a.person.id===id)?.person||state.world?.people.find(p=>p.id===id); }
function recordRequest(event) {
  refreshUsage();
  if(event.type==='inference'){
    state.requests.push({...event,status:'pending',worldId:state.world?.id});
    state.requests=state.requests.slice(-100);
    if(state.followActive){state.person=event.person_id||state.person;state.requestId=event.request_id;state.castPage=Math.max(0,Math.floor(currentPeople().findIndex(p=>p.id===state.person)/24));}
  }else{
    const request=state.requests.find(r=>r.request_id===event.request_id);
    if(request)Object.assign(request,event,{status:event.type==='inference_error'?'error':'complete'});
  }
  renderRequests();
}
function renderRequests() {
  const requests=state.requests.filter(r=>r.worldId===state.world?.id);
  const selected=requests.find(r=>r.request_id===state.requestId)||requests.at(-1);
  $('#api-summary').textContent=requests.length?`${requests.filter(r=>r.status==='complete').length} responses · ${requests.filter(r=>r.status==='pending').length} in flight · ${requests.filter(r=>r.status==='error').length} errors`:'Ready · requests appear when you run';
  $('#follow-active').checked=state.followActive;
  $('#api-request-list').innerHTML=requests.length?requests.slice().reverse().map(r=>`<button class="api-request ${r.request_id===selected?.request_id?'selected':''}" data-request="${r.request_id}"><i class="${r.status}"></i><span>${esc(r.person_name||'Persona')}<small>${r.remote?'Jev API':'Local demo'} · ${r.status==='pending'?'Waiting for response':r.status==='error'?'Failed':r.latency_ms+' ms'}</small></span></button>`).join(''):'<p class="muted">No calls in this session yet. Run a simulation to inspect live requests.</p>';
  if(!selected){state.requestSignature=null;$('#api-request-detail').innerHTML='<p class="muted">Select a character or a request to inspect its state and returned probabilities. Your API key stays on the server.</p>';return;}
  const r=selected;
  const signature=r.request_id+':'+r.status;
  if(state.requestSignature===signature)return;
  state.requestSignature=signature;
  $('#api-request-detail').innerHTML=`<div class="api-detail-heading"><strong>${esc(r.person_name||'Persona')} · ${r.status==='pending'?'Deciding…':r.status==='error'?'Request failed':'Response received'}</strong><span>${r.remote?'POST '+esc(r.endpoint):'Offline demo'}</span></div>${r.error?`<p class="api-error">${esc(r.error)}</p>`:''}${r.status==='pending'?'<p class="api-wait">Waiting for the real provider response…</p>':''}${Object.entries(r.answers||{}).map(([key,a])=>`<div class="api-answer"><h3>${esc(key)} probabilities <span>sampled: ${esc(label(a.choice))}</span></h3>${probabilityBars(a.probabilities,a.choice)}${a.probabilities_normalized?`<p class="rounding-note">Provider total: ${a.provider_probability_total.toFixed(4)}. Normalized to 1 for sampling; original values preserved below.</p>`:''}<details><summary>Original provider probabilities</summary><pre class="raw-input">${esc(JSON.stringify(a.provider_probabilities||a.probabilities,null,2))}</pre></details></div>`).join('')}<details><summary>Request body · credentials excluded</summary><pre class="raw-input">${esc(JSON.stringify(r.request,null,2))}</pre></details>`;
}
function openPersonRequest() {
  state.requestId=state.requests.filter(r=>r.worldId===state.world?.id&&r.person_id===state.person).at(-1)?.request_id||null;
  renderRequests();$('#api-console').open=true;$('#api-console').scrollIntoView({behavior:'smooth',block:'nearest'});
}
function selectPerson(id) {
  state.person=id;state.decision=null;state.followActive=false;state.inspectorOpen=true;
  state.castPage=Math.max(0,Math.floor(currentPeople().findIndex(p=>p.id===id)/24));
  state.requestId=state.requests.filter(r=>r.worldId===state.world?.id&&r.person_id===id).at(-1)?.request_id||null;
  renderInspector();renderGraph();renderPaths();renderRequests();stage?.focusPerson(id);
}
function personRequestMarkup(person,decision) {
  const r=state.requests.filter(r=>r.worldId===state.world?.id&&r.person_id===person.id).at(-1);
  return `<div class="person-api"><span>${r?r.status==='pending'?'◉ Live API request in flight':r.status==='error'?'Request failed':`Response · ${r.latency_ms} ms`:state.busy?'Waiting for this person’s turn':'Select Run simulation for fresh API decisions'}</span>${r?'<button class="text-button" data-do="person-request">View request & response ↗</button>':''}${decision?.probabilities_normalized?`<p class="rounding-note">Provider total ${decision.provider_probability_total.toFixed(2)} · normalized for sampling.</p>`:''}</div>`;
}
let stage=null, stageFailed=false;
function renderStage() {
  if(!window.WorldStage||stageFailed)return;
  try {
    if(!stage)stage=new window.WorldStage($('#stage'),id=>{selectPerson(id);});
    const sample=Array.from({length:8},(_,i)=>({id:`preview-${i}`,name:['Alex','Maya','Sam','Noor','Leo','Sofia','Robin','Kai'][i],role:'Example character',avatar:i,stance:0}));
    stage.setState({worldId:state.world?.id||'preview',people:state.world?currentPeople():sample,edges:state.world?.edges||[],selected:state.person,active:state.activePerson,decisions:[...currentDecisions(),...state.pending],round:state.round,preview:!state.world});
    $('#stage-preview').classList.toggle('hidden',!!state.world);
    $('#city-population').textContent=state.world?`${currentPeople().length} people in the city · round ${state.round}`:'Your city awaits';
    if(state.activePerson&&state.followActive&&state.lastFollow!==state.activePerson){state.lastFollow=state.activePerson;stage.focusPerson(state.activePerson);}
    $('#stage-hint').textContent=state.activePerson?`${state.world?.people.find(p=>p.id===state.activePerson)?.name||'A person'} is deciding…`:'Drag to orbit · scroll to zoom · click a character';
  }catch(e){stageFailed=true;$('#stage').innerHTML='<div class="graph-path-empty">3D needs WebGL 2 in your browser. The interactive social graph is available in the next tab.</div>';$('#stage-preview').classList.add('hidden');console.error('3D renderer unavailable',e);}
}
$('#stage').addEventListener('city-view',e=>$$('[data-camera]').forEach(b=>b.classList.toggle('active',b.dataset.camera===e.detail)));
document.addEventListener('fullscreenchange',()=>{const host=document.fullscreenElement===$('#stage-wrap')?$('#stage-wrap'):$('.world-grid');host.appendChild($('#inspector'));});
window.addEventListener('worldstage-ready',()=>{if(state.map==='3d')renderStage();});
let toastTimer;
function toast(message) { const target=$('dialog[open]')||document.body;target.appendChild($('#toast'));$("#toast").textContent = message; $("#toast").classList.remove("hidden"); clearTimeout(toastTimer); toastTimer = setTimeout(() => $("#toast").classList.add("hidden"), 6500); }
async function api(route, data) {
  const response = await fetch(route, data === undefined ? {} : {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(data)});
  const result = await response.json(); if (!response.ok || result.error) throw new Error(result.error || `Request failed (${response.status})`); return result;
}
async function attempt(fn) { try { await fn(); } catch (error) { toast(error.message); } }
function status(text) { $("#status").textContent = text; }
function currentPeople() { const w=state.world; return w ? (state.round===w.round?w.people:w.snapshots.find(s=>s.round===state.round)?.people||[]) : []; }
function selectedPerson() { return currentPeople().find(p=>p.id===state.person) || currentPeople()[0]; }
function currentDecisions() { return (state.world?.decisions || []).filter(d=>d.round<=state.round); }
function selectedDecision() { const all=[...currentDecisions(),...state.pending];return all.find(d=>d.id===state.decision) || all.filter(d=>d.person_id===state.person).at(-1); }
function counts(people) { const c={support:0,oppose:0,undecided:0}; people.forEach(p=>c[stance(p.stance)]++); return c; }
function avatar(p, cls="avatar") {
  const i=p.avatar||0, backgrounds=["#e6edf2","#f1e3d8","#e4ece0","#eee4ec","#e6e7f3","#f2e8d5"], clothes=["#667d97","#bc886e","#859677","#a6859a","#8b87aa","#b39d6a"], hair=["#4b3c36","#6c5142","#3c3d42","#8c6d50"];
  return `<svg class="${cls}" viewBox="0 0 60 60" aria-hidden="true"><circle cx="30" cy="30" r="30" fill="${backgrounds[i%6]}"/><path d="M8 57 Q9 42 24 42 H36 Q51 43 52 57 Q30 65 8 57" fill="${clothes[i%6]}"/><path d="M25 35h10v11q-5 5-10 0" fill="#dfb697"/><ellipse cx="30" cy="26" rx="13" ry="16" fill="#ebc6a9"/><path d="M17 26q-5-18 11-19 17-2 16 21l-5-10q-10 5-17-1z" fill="${hair[i%4]}"/>${i%3===0?'<path d="M17 22v19l6-3-2-17m21 1v19l-6-3 3-17" fill="'+hair[i%4]+'"/>':''}<circle cx="25" cy="27" r="1.1" fill="#57483f"/><circle cx="35" cy="27" r="1.1" fill="#57483f"/><path d="M27 34q3 2 6 0" fill="none" stroke="#bc856e" stroke-width="1.2" stroke-linecap="round"/>${i%4===2?'<path d="M19 24h10v7H19zm12 0h10v7H31zm-2 2h2" stroke="#605b5e" stroke-width="1" fill="none"/>':''}</svg>`;
}
function probabilityBars(probabilities, selected) {
  return Object.entries(probabilities||{}).sort((a,b)=>b[1]-a[1]).map(([a,p])=>`<div class="probability"><div class="prob-top ${a===selected?'selected':''}"><span>${esc(label(a))}${a===selected?' ↗':''}</span><span>${pct(p)}</span></div><div class="bar"><span class="${a===selected?'selected':''}" style="width:${p*100}%"></span></div></div>`).join("");
}
function setWorld(w) { if(state.world?.id!==w.id){state.castPage=0;state.peoplePage=0;}state.world=w; state.round=w.round; state.person=w.people.some(p=>p.id===state.person)?state.person:w.people[0]?.id; state.decision=null; state.pending=[]; state.comparison=null; localStorage.setItem("jev-social-world",w.id); render(); }
async function refreshWorlds() { state.worlds=await api("/api/social/worlds"); renderWorldList(); }
function renderWorldList() {
  $('#world-switch').innerHTML='<option value="">Your worlds</option>'+state.worlds.map(w=>`<option value="${w.id}" ${w.id===state.world?.id?'selected':''}>${esc(w.title)}</option>`).join('');
  $("#world-list").innerHTML=state.worlds.length ? state.worlds.map(w=>`<button class="world-item ${w.id===state.world?.id?'active':''}" data-world="${w.id}" title="${esc(w.title)}"><span class="world-dot"></span><span>${w.parent_id?'⑂ ':''}${esc(w.title)}</span></button>`).join("") : '<p class="muted" style="font-size:10px;padding:5px 10px">Your worlds will live here.</p>';
  const previous=$("#compare-world").value;
  $("#compare-world").innerHTML='<option value="">Compare another world…</option>'+state.worlds.filter(w=>w.id!==state.world?.id).map(w=>`<option value="${w.id}">${esc(w.title)}</option>`).join("");
  $("#compare-world").value=previous;
}
function renderMetrics() {
  const people=currentPeople(), c=counts(people), initial=counts(state.world?.snapshots[0]?.people||people), n=people.length;
  const initialCount=state.world?.snapshots[0]?.people.length||n;const delta=n?Math.round((c.support/n-initial.support/Math.max(1,initialCount))*100):0;
  $("#metrics").innerHTML=[
    ["People in this world","♧",n||"—",n?`${new Set(people.map(p=>p.role)).size} stakeholder perspectives`:"A cast with distinct priorities"],
    ["Social connections","⑂",state.world?state.world.edges.length:"—","Opinions meet across the network"],
    ["Currently supportive","◔",n?pct(c.support/n):"—",n?`<span class="${delta>=0?'positive':''}">${delta>0?'+':''}${delta} percentage points</span> from the start`:"Views emerge as your world evolves"],
    ["Decisions explored","◇",state.world?currentDecisions().length:"—",`${state.round} completed rounds · ${state.world?.last_run_provider||state.world?.provider||'Jev'} ${state.world?'decisions':'ready'}`]
  ].map(([title,icon,value,note])=>`<div class="metric"><div class="metric-top"><span>${title}</span><span>${icon}</span></div><div class="metric-value">${value}</div><div class="metric-note">${note}</div></div>`).join("");
}
function graphPositions(people) {
  const roles=[...new Set(people.map(p=>p.role))], groups=roles.map((role,i)=>({role,x:400+240*Math.cos(i/roles.length*Math.PI*2-.7+state.layout*.45),y:248+115*Math.sin(i/roles.length*Math.PI*2-.7+state.layout*.45)}));
  const positions=people.map(p=>{const g=groups.find(g=>g.role===p.role), siblings=people.filter(q=>q.role===p.role),i=siblings.indexOf(p),t=i/siblings.length*Math.PI*2;return {p,x:g.x+65*Math.cos(t),y:g.y+64*Math.sin(t),cx:g.x,cy:g.y};});
  for(let k=0;k<100;k++) { for(const a of positions) {a.x+=(a.cx-a.x)*.008;a.y+=(a.cy-a.y)*.008;for(const b of positions) {if(a===b)continue;let dx=a.x-b.x,dy=a.y-b.y,dist=Math.hypot(dx,dy)||1;if(dist<117){a.x+=dx/dist*(117-dist)*.12;a.y+=dy/dist*(117-dist)*.12;}}a.x=Math.max(65,Math.min(735,a.x));a.y=Math.max(60,Math.min(423,a.y));}}
  return {positions,groups};
}
function renderGraph() {
  $('#stage-wrap').classList.toggle('hidden',state.map!=='3d');$('#graph').classList.toggle('hidden',state.map==='3d');
  const people=visiblePeople();$("#cast-page").innerHTML=Array.from({length:Math.max(1,Math.ceil(currentPeople().length/24))},(_,i)=>`<option value="${i}" ${i===state.castPage?'selected':''}>People ${i*24+1}–${Math.min((i+1)*24,currentPeople().length)} of ${currentPeople().length}</option>`).join('');$("#cast-page").classList.toggle('hidden',!state.world||state.map==='3d'); $('.world-grid').classList.toggle('city-open',!!state.inspectorOpen); $("#graph-title").textContent=state.map==='3d'?'One city. Every perspective.':state.map==='paths'?'A person’s decisions, over time':state.world?'People, connected by perspective':'A world of different perspectives';
  if(state.map==='3d'){renderStage();return;}
  if(state.map==='paths' && state.world) {$("#graph").innerHTML=`<div style="height:100%;overflow:auto;padding:25px">${pathsMarkup()}</div>`;return;}
  const sample=Array.from({length:12},(_,i)=>({id:`p${i}`,avatar:i,name:"",role:["Residents","Business owners","Commuters"][i%3],stance:0}));
  const {positions,groups}=graphPositions(state.world?people:sample), byId=Object.fromEntries(positions.map(p=>[p.p.id,p]));
  const edges=state.world?.edges||sample.map((p,i)=>({source:p.id,target:sample[(i+3)%12].id}));
  const connected=new Set(edges.filter(e=>e.source===state.person||e.target===state.person).flatMap(e=>[e.source,e.target]));
  let svg=`<svg viewBox="0 0 800 500" role="group" aria-label="Interactive social network">`;
  svg+=groups.map((g,i)=>`<ellipse cx="${g.x}" cy="${g.y}" rx="138" ry="112" fill="${['#ecf2f8','#f7efe8','#eef4ed','#f1edf5'][i%4]}" opacity=".48"/><text x="${g.x}" y="${g.y-126}" text-anchor="middle" fill="#a4adb9" font-size="9" letter-spacing="1.5">${esc(g.role.toUpperCase())}</text>`).join("");
  svg+=edges.map(e=>{const a=byId[e.source],b=byId[e.target];if(!a||!b)return '';const active=e.source===state.person||e.target===state.person;return `<path d="M${a.x},${a.y} Q${(a.x+b.x)/2+12},${(a.y+b.y)/2-15} ${b.x},${b.y}" fill="none" stroke="${active?'#c4a994':'#d8e0e9'}" stroke-width="${active?1.6:1}" ${active?'':'stroke-dasharray="4 5"'} opacity="${active?.8:.6}"/>`;}).join("");
  svg+=positions.map(({p,x,y})=>{const selected=p.id===state.person,c=colors[stance(p.stance)],active=p.id===state.activePerson;return `<g class="person-node" transform="translate(${x},${y})" data-person="${p.id}" role="button" tabindex="0" aria-label="Inspect ${esc(p.name||'example persona')}"><circle class="halo" r="${selected?33:29}" fill="white" stroke="${active?'#ee794b':selected?c:'#e4e9ef'}" stroke-width="${selected?2:1}"/>${selected?`<circle r="39" fill="none" stroke="${c}" opacity=".15"/>`:''}<svg x="-24" y="-24" width="48" height="48" viewBox="0 0 60 60">${avatar(p).replace(/^<svg[^>]*>|<\/svg>$/g,'')}</svg><circle cx="20" cy="19" r="5.5" fill="${c}" stroke="white" stroke-width="2"/>${p.name?`<rect x="-58" y="34" width="116" height="19" rx="4" fill="#ffffffdd"/><text y="47" text-anchor="middle" font-size="10" fill="${selected?'#343c46':'#6f7b8b'}" font-weight="${selected?'600':'400'}">${esc(p.name)}</text><text y="62" text-anchor="middle" font-size="8" fill="#9ca6b3">${esc(p.temperament||'')}</text>`:''}</g>`;}).join("");
  svg+='</svg>';
  if(!state.world)svg+='<div class="empty-graph"><h2>Start with a “what if.”</h2><p>A new policy. A bold product launch. A change that affects a community.</p><button class="primary" data-do="new">✳ Create your first world</button></div>';
  $("#graph").innerHTML=svg;
}
function renderInspector() {
  const p=selectedPerson(); if(!p) {$("#inspector").innerHTML='<div class="inspector-empty"><div class="orb">♧</div><h2>Not just a data point.</h2><p>Every person has a story, a set of priorities, and a reason to change their mind.</p><span class="eyebrow">MEET THEM HERE</span></div>';return;}
  const d=[...currentDecisions(),...state.pending].filter(d=>d.person_id===p.id).at(-1), c=stance(p.stance), links=state.world.edges.filter(e=>e.source===p.id||e.target===p.id).length;
  $("#inspector").innerHTML=`<div class="inspector-label"><span class="eyebrow">PERSONA SPOTLIGHT</span><button class="text-button city-close" data-do="inspector-close" aria-label="Close person details">×</button><button class="text-button" data-do="edit" ${state.world.round||state.busy?'disabled':''}>Edit ↗</button></div><div class="person-heading">${avatar(p)}<div><h2>${esc(p.name)}</h2><p>${esc(p.role)}</p></div></div><span class="stance-pill ${c}">${c==='support'?'Leaning supportive':c==='oppose'?'Leaning opposed':'Still undecided'}</span><p class="bio">${esc(p.bio)}</p><div class="traits"><span>${esc(p.temperament)}</span><span>${esc(p.priority)} first</span><span>${links} connections</span></div><div class="inspector-section"><h3>${d?`LATEST DECISION · ROUND ${d.round}`:'WHAT MATTERS TO THEM'}</h3>${d?`${probabilityBars(d.probabilities,d.action)}<p class="muted" style="font-size:9px;margin-top:12px">Likely driver: ${esc(state.catalog.drivers[d.driver])}</p>`:`<p>${esc(p.goal)}</p><p class="muted" style="font-size:10px">Run a round to see how they respond to the scenario.</p>`}</div>${personRequestMarkup(p,d)}<div class="inspector-actions"><button class="button" data-do="person-path">⑂ Decision path</button><button class="button" data-do="interview-toggle">Ask a question ↗</button></div><div id="interview-box" class="hidden"><form class="interview-form" id="interview-form"><input id="interview-question" placeholder="Would you support this proposal?" aria-label="Question for this persona" required maxlength="1000"><button class="button" type="submit" ${state.busy?'disabled':''}>Ask ${esc(p.name.split(' ')[0])} · ${$("#policy").value==='jev'?'1 API call':'local demo'}</button></form><div id="interview-answer"></div></div>`;
}
function renderFeed() {
  const all=[...currentDecisions(),...state.pending], display=all.slice(-8).reverse();
  $("#decision-count").textContent=`${all.length} decisions${state.pending.length?' · round in progress':''}`;
  $("#feed").innerHTML=display.length?display.map(d=>{const p=state.world.people.find(p=>p.id===d.person_id);return `<div class="feed-item" data-decision="${d.id}" role="button" tabindex="0">${avatar(p)}<div><strong>${esc(d.name)}</strong><p><span class="feed-action">${esc(label(d.action))}</span> · ${esc(state.catalog.drivers[d.driver]?.toLowerCase())}</p></div><span class="feed-meta">R${d.round} · ${pct(d.probabilities[d.action])}${d.forced?' · forced':''}</span></div>`;}).join(""):'<div class="empty-feed">The conversation hasn’t started yet. Run your world to watch decisions arrive here in real time.</div>';
  $("#events").innerHTML=(state.world?.events||[]).slice(-4).map(e=>`<div class="event-item"><small>${e.round?'ROUND '+e.round:'QUEUED FOR NEXT ROUND'}</small>${esc(e.text)}</div>`).join("");
}
function renderPeople() {
  const query=$("#people-search").value.toLowerCase(),matches=currentPeople().filter(p=>(p.name+' '+p.role+' '+p.bio).toLowerCase().includes(query));
  state.peoplePage=Math.max(0,Math.min(state.peoplePage,Math.ceil(matches.length/48)-1));
  const people=matches.slice(state.peoplePage*48,state.peoplePage*48+48);
  $('#people-pagination').innerHTML=`<button class="button" data-do="people-prev" ${state.peoplePage===0?'disabled':''}>← Previous</button><span>${number(matches.length)} people · page ${state.peoplePage+1} of ${Math.max(1,Math.ceil(matches.length/48))}</span><button class="button" data-do="people-next" ${(state.peoplePage+1)*48>=matches.length?'disabled':''}>Next →</button>`;
  $("#people-grid").innerHTML=people.length?people.map(p=>`<article class="person-card panel" data-person="${p.id}" role="button" tabindex="0"><div class="person-heading">${avatar(p)}<div><h2>${esc(p.name)}</h2><p>${esc(p.role)}</p></div></div><span class="stance-pill ${stance(p.stance)}">${stance(p.stance)}</span><p class="bio">${esc(p.bio)}</p><div class="traits"><span>${esc(p.temperament)}</span><span>${esc(p.priority)} first</span></div><div class="card-bottom"><span>${p.memory.length} remembered decisions</span><span>Meet ${esc(p.name.split(' ')[0])} ↗</span></div></article>`).join(""):'<div class="empty-feed">No people to show. Create a world or change your search.</div>';
}
function pathsMarkup() {
  const p=selectedPerson(), decisions=[...currentDecisions(),...state.pending].filter(d=>d.person_id===p?.id);
  if(!p)return '<div class="graph-path-empty">Create a world to map people’s decisions.</div>';
  return `<div class="person-heading" style="margin:0">${avatar(p)}<div><h2>${esc(p.name)}</h2><p>${esc(p.role)} · click a decision to inspect alternatives</p></div></div><div class="path-row"><div class="path-step"><small>${p.joined_after_round!==undefined?`JOINED AFTER ROUND ${p.joined_after_round}`:'STARTING VIEW'}</small><strong>${stance(initialPerson(p.id)?.stance||0)}</strong><span>Persona generation</span></div>${decisions.map(d=>`<span class="path-connector">⟶</span><button class="path-step ${d.id===selectedDecision()?.id?'active':''}" data-decision="${d.id}"><small>ROUND ${String(d.round).padStart(2,'0')}${d.forced?' · OVERRIDE':''}${state.pending.some(p=>p.id===d.id)?' · LIVE':''}</small><strong>${esc(label(d.action))}</strong><span>${pct(d.probabilities[d.action])} probability · ${stance(d.after)}</span></button>`).join('')}</div>${!decisions.length?'<p class="muted" style="font-size:11px">Run a round to grow this person’s decision path.</p>':''}`;
}
function renderPaths() {
  $("#person-select").innerHTML=currentPeople().map(p=>`<option value="${p.id}" ${p.id===state.person?'selected':''}>${esc(p.name)} · ${esc(p.role)}</option>`).join("");
  $("#paths").innerHTML=pathsMarkup();
  const d=selectedDecision();
  if(!d) {$("#decision-detail").innerHTML='<p class="muted">Each recorded decision includes its probability distribution, observed peers, memory, and model input.</p>';return;}
  $("#decision-detail").innerHTML=`<div class="detail-layout"><div><span class="eyebrow">${esc(d.name)} · ROUND ${d.round}</span><h2>${esc(label(d.action))}</h2><p>${d.forced?'This action was forced by a counterfactual intervention.':'This action was sampled from the model’s probability distribution.'}</p><p><strong>Likely driver:</strong> ${esc(state.catalog.drivers[d.driver])}</p><p><strong>Position:</strong> ${d.before.toFixed(2)} → ${d.after.toFixed(2)}</p><p><strong>Observed peers:</strong> ${d.observed.map(id=>esc(state.world.people.find(p=>p.id===id)?.name)).join(', ')}</p><p><strong>Decision entropy:</strong> ${d.entropy.toFixed(2)} bits / 2.32 max<br><strong>Model:</strong> ${esc(d.model)}</p></div><div><span class="eyebrow">WHAT IF THEY CHOSE DIFFERENTLY?</span>${Object.entries(d.probabilities).sort((a,b)=>b[1]-a[1]).map(([a,p])=>`<div class="alternative">${probabilityBars({[a]:p},d.action)}<button class="button" data-alternative="${a}" data-at="${d.round-1}" data-for="${d.person_id}">${a===d.action?'Replay choice':'Explore this'} ↗</button></div>`).join('')}</div></div><details><summary>Inspect the exact state sent to the model</summary><pre class="raw-input">${esc(JSON.stringify(d.input,null,2))}</pre></details><p class="muted" style="font-size:10px;margin-top:15px">Alternatives are unexecuted possibilities. Exploring one creates a separate world; run it to observe what follows.</p>`;
}
function chart(world) {
  if(!world?.snapshots.length)return '';
  const snaps=world.snapshots, n=world.people.length, max=Math.max(1,snaps.at(-1).round), x=r=>45+r/max*555, y=n=>205-n*160;
  return `<svg viewBox="0 0 650 250" role="img" aria-label="Share of supportive, opposed and undecided people across recorded rounds">${[0,.5,1].map(v=>`<line x1="45" x2="610" y1="${y(v)}" y2="${y(v)}" stroke="#edf0f3"/><text x="30" y="${y(v)+4}" text-anchor="end" font-size="9" fill="#9ba5b1">${pct(v)}</text>`).join('')}${Object.entries(colors).map(([k,c])=>`<polyline points="${snaps.map(s=>`${x(s.round)},${y(s.stats[k]/Math.max(1,s.people.length))}`).join(' ')}" fill="none" stroke="${c}" stroke-width="2.5"/>${snaps.map(s=>`<circle cx="${x(s.round)}" cy="${y(s.stats[k]/Math.max(1,s.people.length))}" r="3" fill="${c}"/>`).join('')}`).join('')}<text x="45" y="231" font-size="9" fill="#9ba5b1">Round 0</text><text x="610" y="231" font-size="9" text-anchor="end" fill="#9ba5b1">Round ${snaps.at(-1).round}</text></svg>`;
}
function reportMarkup() {
  return JevReport.build(state.world,state.catalog,chart(state.world),$('#comparison')?.innerHTML||'').html;
}
function renderReport() {
  const w=state.world;if(!w){$("#report").innerHTML='<div class="panel empty-feed">Create and run a world to see its conclusion.</div>';return;}
  $("#report").innerHTML=JevReport.build(w,state.catalog,chart(w)).html+'<div id="comparison"></div>';
  renderComparison();
}
function preparePrintReport() {
  $('#print-report').innerHTML=state.world?reportMarkup():'';
}
const reportStyle=document.createElement('style');reportStyle.textContent=JevReport.css;document.head.append(reportStyle);
window.addEventListener('beforeprint',preparePrintReport);
function renderComparison() {
  const target=$("#comparison");if(!target)return;const b=state.comparison,a=state.world;if(!b){target.innerHTML='';return;}
  const ar=JevReport.summarize(a),br=JevReport.summarize(b),ac=ar.counts,bc=br.counts,sameRound=ar.round===br.round;
  target.innerHTML=`<div class="panel report-card" style="margin-top:18px"><h2>Two worlds, side by side</h2><p>${sameRound?'Comparing the same completed round; people added afterward are excluded.':'These worlds have different round counts; differences also reflect elapsed simulation time.'} ${b.id===a.parent_id||a.id===b.parent_id?'These worlds share a recorded starting history.':'These worlds may have different casts or contexts.'}</p><table class="report-table"><thead><tr><th>Measure</th><th>${esc(a.title)}</th><th>${esc(b.title)}</th></tr></thead><tbody><tr><td>Completed rounds</td><td>${a.round}</td><td>${b.round}</td></tr>${Object.keys(colors).map(k=>`<tr><td>${k}</td><td>${pct(ac[k]/ar.n)} (${ac[k]})</td><td>${pct(bc[k]/br.n)} (${bc[k]})</td></tr>`).join('')}<tr><td>Decisions</td><td>${a.decisions.length}</td><td>${b.decisions.length}</td></tr></tbody></table></div>`;
}
function render() {
  const w=state.world; $("#world-title").textContent=w?w.title:'Every person. A possible future.';
  $("#world-subtitle").textContent=w?`${w.parent_id?'A parallel world. ':''}${w.people.length} synthetic people. Different priorities. One shared scenario.`:'Build a cast, set the scene, and see what happens when perspectives meet.';
  $("#scenario-question").textContent=w?w.question:'What would happen if your next big idea met the real world?';
  $("#nav-count").textContent=w?.people.length||0; $("#round-badge").textContent=`ROUND ${String(state.round).padStart(2,'0')}`;
  $("#timeline").max=w?.round||0; $("#timeline").value=state.round; $("#timeline").disabled=state.busy;
  $("#timeline-label").textContent=`Round ${state.round} of ${w?.round||0}`;
  $("#run").disabled=state.busy||!w||w.people.length<2;$("#run").textContent=w&&!w.complete_cast?`▶ Run ${w.people.length} generated people`:"▶ Run simulation"; $("#stop").classList.toggle('hidden',!state.busy);
  $("#policy").disabled=state.busy; $("#rounds").disabled=state.busy;
  $$('[data-do="new"], [data-do="export"], [data-do="fork"], [data-do="add-people"]').forEach(b=>b.disabled=state.busy||(b.dataset.do!=='new'&&!w));
  $$('[data-do="report"], [data-do="print-report"], [data-do="download-report"]').forEach(b=>b.disabled=!w||!w.complete_cast);
  $("#activity-dot").classList.toggle('working',state.busy);
  renderMetrics();renderGraph();renderInspector();renderFeed();renderPeople();renderPaths();renderReport();renderWorldList();renderRequests();
}
function changeView(view) { state.view=view;$$('.view').forEach(e=>e.classList.toggle('hidden',e.id!==view+'-view'));$$('[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===view)); }
function changeMap(map) {state.map=map;$$('[data-map]').forEach(b=>b.classList.toggle('active',b.dataset.map===map));changeView('world');renderGraph();}
function applyPreset(index) {const p=state.catalog.presets[index];if(!p)return;$("#create-title").value=p.title;$("#create-question").value=p.question;$("#create-context").value=p.context;$("#create-roles").value=p.roles.join('\n');$$('[data-preset]').forEach(b=>b.classList.toggle('active',Number(b.dataset.preset)===index));}
function createDialog() {if(state.busy)return;$("#create-policy").value=$("#policy").value;updateEstimate();$("#create-dialog").showModal();}
function updateEstimate() {$("#generate-cost").textContent=$("#create-policy").value==='jev'?`${$("#create-count").value} API requests · one per person`:'Explicit offline demo · no API requests';}
function forkDialog(round=state.round, person='',action='SUPPORT') { if(!state.world)return;$("#fork-round").value=round;$("#fork-round").max=state.world.round;$("#fork-text").value='';$("#fork-person").innerHTML='<option value="">No action override</option>'+state.world.people.map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join('');$("#fork-person").value=person;$("#fork-action").innerHTML=Object.keys(state.catalog.actions).map(a=>`<option value="${a}">${esc(label(a))}</option>`).join('');$("#fork-action").value=action;$("#fork-dialog").showModal();}
function stopPlayback() {if(state.playback){clearInterval(state.playback);state.playback=null;$("#play").textContent='▷';}}
async function stream(route,data,onResult) {
  if(state.busy)throw new Error('Stop the current operation first.');
  stopPlayback();state.busy=true;state.runId=crypto.randomUUID();state.pending=[];state.requests=[];state.requestId=null;state.round=state.world?.round||0;render();
  let error=null;
  try {
    const response=await fetch(route+'/stream',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...data,run_id:state.runId})});
    if(!response.ok){const problem=await response.json();throw new Error(problem.error||'Could not start operation');}
    const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='',terminal=false;
    const receive=e=>{
      if(e.type==='world_created'){setWorld(e.world);status('Building your cast…');}
      else if(e.type==='persona'){state.world.people.push(e.person);state.person=state.person||e.person.id;if(state.followActive)state.castPage=Math.floor((state.world.people.length-1)/24);render();status(`Generating people · ${e.completed} of ${e.total}`);}
      else if(e.type==='population_start'){setWorld(e.world);status(`Adding ${e.adding} people…`);}
      else if(e.type==='person_added'){state.world.people.push(e.person);state.world.edges=e.edges;if(state.followActive){state.person=e.person.id;state.castPage=Math.floor((state.world.people.length-1)/24);}render();status(`Added ${e.completed} of ${e.total} people · saved to your world`);}
      else if(e.type==='inference'){recordRequest(e);state.activePerson=e.person_id;renderInspector();$("#budget-label").textContent=data.policy==='demo'?'Demo policy · no API calls':`Jev is deciding · ${e.api_calls||0} API requests completed`;renderGraph();}
      else if(e.type==='inference_complete'){recordRequest(e);renderInspector();$("#budget-label").textContent=`${e.model} · ${e.latency_ms} ms · ${e.api_calls} API calls`;}
      else if(e.type==='inference_error'){recordRequest(e);renderInspector();}
      else if(e.type==='round_start'){state.pending=[];state.world.events=e.events;status(`Round ${e.round} · people are considering their next move`);renderFeed();}
      else if(e.type==='social_decision'){state.pending.push(e.decision);state.activePerson=null;status(`Round ${e.decision.round} · ${e.decision.name}: ${label(e.decision.action)} · ${e.completed}/${e.total}`);renderFeed();renderInspector();renderGraph();if(state.view==='decisions')renderPaths();}
      else if(e.type==='round_complete'){setWorld(e.world);status(`Round ${e.world.round} complete · saved to your workspace`);}
      else if(e.type==='result'){terminal=true;onResult(e.result);}
      else if(e.type==='error'){terminal=true;throw new Error(e.error);}
      else if(e.type==='cancelled'){terminal=true;status('Stopped · complete rounds are saved; an unfinished round is discarded.');}
    };
    while(true){const chunk=await reader.read();if(chunk.done)break;buffer+=decoder.decode(chunk.value,{stream:true});const lines=buffer.split('\n');buffer=lines.pop();for(const line of lines){if(line.trim())receive(JSON.parse(line));}}
    buffer+=decoder.decode();if(buffer.trim())receive(JSON.parse(buffer));if(!terminal)throw new Error('Connection ended before the operation finished. Completed rounds remain saved.');
  } catch(e){error=e;status(e.message);} finally {
    state.busy=false;state.runId=null;state.activePerson=null;state.pending=[];for(const r of state.requests)if(r.status==='pending'){r.status='error';r.error=error?.message||'Operation stopped before a response was delivered.';}
    if(state.world){try{state.world=await api('/api/social/worlds/'+state.world.id);state.round=state.world.round;}catch{}}
    render();await refreshWorlds();await refreshUsage();
  }
  if(error)throw error;
}
async function loadSettings() {state.settings=await api('/api/settings');$("#connection-label").textContent=state.settings.configured?'Jev connected':'Connect Jev API';$("#connection-dot").classList.toggle('connected',state.settings.configured);$("#api-model").value=state.settings.model;$("#api-budget").value=state.settings.max_requests;$("#api-key").placeholder=state.settings.configured?'Key saved · leave blank to keep it':'Paste your API key';$("#settings-info").textContent=state.settings.configured?`Configured from ${state.settings.source}. File: ${state.settings.env_path||'.env'}`:'No key connected. Save a key here or copy the environment template.';}
async function requireProvider(policy) {if(policy==='jev'&&!state.settings.configured){await loadSettings();if(!state.settings.configured){$("#connect-dialog").showModal();throw new Error('Connect your Jev API key, then generate or run your world.');}}}
async function run() {if(!state.world) return createDialog();const rounds=Number($("#rounds").value);if(!Number.isInteger(rounds)||rounds<1||rounds>20)throw new Error('Choose 1–20 rounds.');const policy=$("#policy").value;await requireProvider(policy);if(policy==='jev'&&rounds*state.world.people.length>state.settings.max_requests)throw new Error('This run exceeds your configured API request budget. Reduce the rounds or update settings.');changeView('world');status(`Starting ${rounds} rounds · up to ${rounds*state.world.people.length} ${policy==='jev'?'API calls':'local decisions'}`);await stream('/api/social/run',{world_id:state.world.id,rounds,policy,use_generated_cast:!state.world.complete_cast},w=>{setWorld(w);status(`World saved · ${w.round} rounds complete. Open Report to read the conclusion, or select a person to inspect decisions.`);});}
document.addEventListener('click', e=>attempt(async()=>{
  const el=e.target.closest('[data-do],[data-view],[data-map],[data-world],[data-person],[data-decision],[data-close],[data-preset],[data-alternative],[data-request],[data-camera]');if(!el||el.disabled)return;
  if(el.dataset.camera){stage?.flyTo(el.dataset.camera);$$('[data-camera]').forEach(b=>b.classList.toggle('active',b.dataset.camera===el.dataset.camera));return;}
  if(el.dataset.request){state.requestId=el.dataset.request;state.followActive=false;renderRequests();return;}
  if(el.dataset.close){$('#'+el.dataset.close).close();return;}
  if(el.dataset.view){changeView(el.dataset.view);return;}
  if(el.dataset.map){changeMap(el.dataset.map);return;}
  if(el.dataset.preset){applyPreset(Number(el.dataset.preset));return;}
  if(el.dataset.world){if(state.busy)throw new Error('Stop the current run before opening another world.');stopPlayback();setWorld(await api('/api/social/worlds/'+el.dataset.world));changeView('world');status(state.world.complete_cast?'World loaded · ready to explore':`Generation stopped at ${state.world.people.length} people. Run this saved cast, or create a new world.`);return;}
  if(el.dataset.alternative){forkDialog(Number(el.dataset.at),el.dataset.for,el.dataset.alternative);return;}
  if(el.dataset.person){if(!state.world)return;selectPerson(el.dataset.person);if(state.view==='people')changeView('world');return;}
  if(el.dataset.decision){const d=[...currentDecisions(),...state.pending].find(d=>d.id===el.dataset.decision);if(!d){toast('This round is still being processed. Inspect it once the round is saved.');return;}state.decision=d.id;state.person=d.person_id;changeView('decisions');renderPaths();return;}
  const action=el.dataset.do;
  if(action==='new')createDialog();
  if(action==='usage'){await refreshUsage();$('#usage-dialog').showModal();}
  if(action==='add-people'){if(!state.world)return;$('#add-people-context').textContent=`${state.world.title} currently has ${state.world.people.length} people. New arrivals will participate from the next round.`;updateAddEstimate();$('#add-people-dialog').showModal();}
  if(action==='people-prev'){state.peoplePage--;renderPeople();}
  if(action==='people-next'){state.peoplePage++;renderPeople();}
  if(action==='connect'){await loadSettings();$('#connect-dialog').showModal();}
  if(action==='refresh')await refreshWorlds();
  if(action==='run')await run();
  if(action==='stop'&&state.runId){el.disabled=true;await api('/api/cancel',{run_id:state.runId});status('Stopping after the current API response…');el.disabled=false;}
  if(action==='latest'){stopPlayback();state.round=state.world?.round||0;render();}
  if(action==='layout'){state.layout++;renderGraph();}
  if(action==='camera-reset'){stage?.reset();$$('[data-camera]').forEach(b=>b.classList.toggle('active',b.dataset.camera==='overview'));}
  if(action==='city-zoom-in')stage?.zoomBy(1.3);
  if(action==='city-zoom-out')stage?.zoomBy(1/1.3);
  if(action==='city-interiors'){const on=stage?.toggleInteriors();el.setAttribute('aria-pressed',String(on));el.classList.toggle('interiors-on',on);}
  if(action==='inspector-toggle'||action==='inspector-close'){state.inspectorOpen=!state.inspectorOpen;$('.world-grid').classList.toggle('city-open',state.inspectorOpen);}

  if(action==='fullscreen'){if(document.fullscreenElement)await document.exitFullscreen();else await $('#stage-wrap').requestFullscreen();}
  if(action==='person-request')openPersonRequest();
  if(action==='person-path'){changeView('decisions');renderPaths();}
  if(action==='fork')forkDialog();
  if(action==='play'){if(state.busy)return;if(state.playback){stopPlayback();return;}if(!state.world?.round)return;state.round=0;render();$('#play').textContent='Ⅱ';state.playback=setInterval(()=>{state.round++;render();if(state.round>=state.world.round)stopPlayback();},900);}
  if(action==='edit'){const p=selectedPerson();$('#edit-name').value=p.name;$('#edit-role').value=p.role;$('#edit-goal').value=p.goal;$('#edit-bio').value=p.bio;$('#person-dialog').showModal();}
  if(action==='interview-toggle')$('#interview-box').classList.toggle('hidden');
  if(action==='report'){changeView('report');$('#report-view').scrollIntoView({block:'start'});}
  if(action==='print-report'){if(!state.world)return;stopPlayback();preparePrintReport();window.print();}
  if(action==='download-report'){
    if(!state.world)return;
    const url=URL.createObjectURL(new Blob([JevReport.documentHTML(state.world.title,reportMarkup())],{type:'text/html;charset=utf-8'}));
    const a=document.createElement('a');a.href=url;a.download=state.world.title.replace(/[^a-z0-9]+/gi,'-').toLowerCase()+'-conclusion.html';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    toast('Report downloaded. Open it to read, share, or print.');
  }
  if(action==='export'){if(!state.world)return;const url=URL.createObjectURL(new Blob([JSON.stringify(state.world,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=state.world.title.replace(/[^a-z0-9]+/gi,'-').toLowerCase()+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('Exported the full world, people, memories, and decision records.');}
  if(action==='context'){$('#context-content').innerHTML=state.world?`<h3>${esc(state.world.question)}</h3><p>${esc(state.world.context)}</p><h3>Stakeholders</h3><p>${state.world.roles.map(esc).join(' · ')}</p><h3>Reproducibility</h3><p>Seed ${state.world.seed} · generated with ${esc(state.world.provider)}${state.world.parent_id?` · forked after round ${state.world.parent_round}`:''}. Seeded sampling is reproducible for the same returned model probabilities; live provider outputs can vary.</p>`:'<p>Create a scenario to give your world its question, facts, and constraints.</p>';$('#context-dialog').showModal();}
  if(action==='test'){el.disabled=true;try{const result=await api('/api/test-connection',{});toast(`Connected to ${result.model}. One real API request completed.`);}finally{el.disabled=false;}}
}));
document.addEventListener('keydown',e=>{if((e.key==='Enter'||e.key===' ')&&e.target.matches('[role=button]')){e.preventDefault();e.target.click();}if(e.key==='n'&&!e.metaKey&&!e.ctrlKey&&!e.altKey&&!e.target.matches('input,textarea,select')&&!$('dialog[open]'))createDialog();});
$('#create-form').addEventListener('submit',e=>{e.preventDefault();attempt(async()=>{const data={title:$('#create-title').value,question:$('#create-question').value,context:$('#create-context').value,roles:$('#create-roles').value.split('\n').map(s=>s.trim()).filter(Boolean),count:Number($('#create-count').value),seed:Number($('#create-seed').value),policy:$('#create-policy').value};await requireProvider(data.policy);if(data.policy==='jev'&&data.count>state.settings.max_requests)throw new Error('The cast exceeds your API request budget. Reduce the people count.');$('#create-dialog').close();$('#policy').value=data.policy;changeView('world');status('Creating your world…');await stream('/api/social/generate',data,w=>{setWorld(w);status(`Your cast is ready · ${w.people.length} people. Run the simulation to see their first decisions.`);});});});
$('#create-count').addEventListener('input',updateEstimate);$('#create-policy').addEventListener('change',updateEstimate);
$('#context-file').addEventListener('change',e=>attempt(async()=>{const file=e.target.files[0];if(!file)return;if(file.size>50000)throw new Error('Use a text file smaller than 50 KB.');const text=await file.text(),combined=$('#create-context').value+'\n\n'+text;if(combined.length>12000)throw new Error('Context is limited to 12,000 characters. Shorten your notes first.');$('#create-context').value=combined;toast('Source notes added to the scenario context.');}));
$('#event-form').addEventListener('submit',e=>{e.preventDefault();attempt(async()=>{if(!state.world)throw new Error('Create a world before introducing an event.');const text=$('#event-text').value.trim();if(!text)return;const event=await api('/api/social/inject',{world_id:state.world.id,text});state.world.events.push(event);$('#event-text').value='';renderFeed();toast('Event queued. People will see it at the next round boundary.');});});
$('#fork-form').addEventListener('submit',e=>{e.preventDefault();attempt(async()=>{if(state.busy)throw new Error('Stop the current operation before switching to a parallel world.');const person=$('#fork-person').value,data={world_id:state.world.id,round:Number($('#fork-round').value),text:$('#fork-text').value};if(person){data.person_id=person;data.action=$('#fork-action').value;}const w=await api('/api/social/fork',data);$('#fork-dialog').close();setWorld(w);changeView('world');await refreshWorlds();status('Parallel world created. Run it to explore what changes, then compare insights.');});});
$('#person-form').addEventListener('submit',e=>{e.preventDefault();attempt(async()=>{const w=await api('/api/social/edit',{world_id:state.world.id,person_id:state.person,name:$('#edit-name').value,role:$('#edit-role').value,goal:$('#edit-goal').value,bio:$('#edit-bio').value});$('#person-dialog').close();setWorld(w);toast('Persona updated. The revised profile will be used in future decisions.');});});
document.addEventListener('submit',e=>{if(e.target.id!=='interview-form')return;e.preventDefault();attempt(async()=>{if(state.busy)throw new Error('Wait for the current operation to finish.');const policy=$('#policy').value;await requireProvider(policy);const button=e.target.querySelector('button'),person=state.person,world=state.world.id;button.disabled=true;try{const r=await api('/api/social/interview',{world_id:world,person_id:person,question:$('#interview-question').value,policy});if(state.person===person&&state.world.id===world&&$('#interview-answer'))$('#interview-answer').innerHTML=`<div class="interview-answer">${esc(r.text)}${probabilityBars(r.answer.probabilities,r.answer.choice)}<small>Synthetic response · locally composed from typed Jev choices · ${esc(r.model)}. This interview does not change simulation memory.</small></div>`;}finally{button.disabled=false;}});});
$('#connect-form').addEventListener('submit',e=>{e.preventDefault();attempt(async()=>{const data={api_key:$('#api-key').value,model:$('#api-model').value,max_requests:Number($('#api-budget').value)};try{await api('/api/settings',data);await loadSettings();toast('Saved securely to the project .env file. Ready for live Jev decisions.');$('#connect-dialog').close();}finally{$('#api-key').value='';}});});
$('#connect-dialog').addEventListener('close',()=>{$('#api-key').value='';});
$('#timeline').addEventListener('input',e=>{stopPlayback();state.round=Number(e.target.value);state.pending=[];render();});
$('#people-search').addEventListener('input',()=>{state.peoplePage=0;renderPeople();});
$('#person-select').addEventListener('change',e=>{state.person=e.target.value;state.decision=null;renderPaths();});
$('#compare-world').addEventListener('change',e=>attempt(async()=>{const id=e.target.value;state.comparison=id?await api('/api/social/worlds/'+id):null;renderComparison();}));
$('#world-switch').addEventListener('change',e=>attempt(async()=>{if(!e.target.value)return;if(state.busy){renderWorldList();throw new Error('Stop the current operation before switching worlds.');}stopPlayback();setWorld(await api('/api/social/worlds/'+e.target.value));changeView('world');status('World loaded · ready to explore');}));
$('#policy').addEventListener('change',renderInspector);
$('#follow-active').addEventListener('change',e=>{state.followActive=e.target.checked;if(state.followActive&&state.activePerson){state.person=state.activePerson;state.requestId=state.requests.at(-1)?.request_id;renderInspector();renderGraph();}renderRequests();});
$('#rounds').addEventListener('input',()=>{$('#budget-label').textContent=state.world?`Up to ${Number($('#rounds').value)*state.world.people.length} ${$('#policy').value==='jev'?'API requests':'local decisions'}`:'Live decisions stream as they happen';});
async function init(){render();const results=await Promise.allSettled([api('/api/social/catalog'),refreshWorlds(),loadSettings(),refreshUsage()]);if(results[0].status==='fulfilled'){state.catalog=results[0].value;$('#presets').innerHTML=state.catalog.presets.map((p,i)=>`<button type="button" data-preset="${i}">${esc(p.title)}</button>`).join('');applyPreset(0);}for(const result of results)if(result.status==='rejected')toast(result.reason.message);const saved=localStorage.getItem('jev-social-world'),id=state.worlds.find(w=>w.id===saved)?.id||state.worlds[0]?.id;if(id){setWorld(await api('/api/social/worlds/'+id));status(state.world.complete_cast?'World loaded · ready to explore':`Generation stopped at ${state.world.people.length} people. Run this saved cast, or create a new world.`);}else render();}
function updateAddEstimate(){const count=Number($('#add-count').value);$('#add-estimate').textContent=$('#policy').value==='jev'?`${number(count)} API requests · budget ${number(state.settings.max_requests)}`:'Local demo · no API charges';}
$('#add-count').addEventListener('input',updateAddEstimate);
$('#add-people-form').addEventListener('submit',e=>{e.preventDefault();attempt(async()=>{const count=Number($('#add-count').value),policy=$('#policy').value;if(!Number.isSafeInteger(count)||count<1)throw new Error('Choose a positive whole number of people.');await requireProvider(policy);if(policy==='jev'&&count>state.settings.max_requests)throw new Error('This batch exceeds your API request budget. Add smaller batches or increase the budget in settings.');$('#add-people-dialog').close();changeView('world');await stream('/api/social/add-people',{world_id:state.world.id,count,policy},w=>{setWorld(w);status(`People added · your world now has ${w.people.length} people. Ready for the next round.`);});});});
$('#cast-page').addEventListener('change',e=>{state.castPage=Number(e.target.value);state.followActive=false;state.person=visiblePeople()[0]?.id;renderGraph();renderInspector();renderRequests();});
setInterval(()=>{if(!document.hidden)refreshUsage();},1500);
attempt(init);
