/* Conclusions are derived from saved decisions; generating a report makes no API calls. */
(function (root) {
  'use strict';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const stance = n => n > .2 ? 'support' : n < -.2 ? 'oppose' : 'undecided';
  const names = {support:'Supportive', oppose:'Opposed', undecided:'Undecided'};
  const share = (n, total) => total ? `${(100*n/total).toFixed(1)}%` : '—';
  const tally = people => people.reduce((c,p) => {c[stance(p.stance)]++;return c;}, {support:0,oppose:0,undecided:0});
  function summarize(world) {
    const snapshots = world.snapshots || [];
    const last = snapshots.filter(s => s.round <= world.round).at(-1);
    const round = last?.round || 0, people = last?.people || [], n = people.length;
    const decisions = (world.decisions || []).filter(d => d.round <= round);
    const included = new Set(people.map(p=>p.id));
    const counts = tally(people), ranking = Object.entries(counts).sort((a,b) => b[1]-a[1]);
    let title = 'Run a round to reach a conclusion';
    if(round && n) {
      const [leading, count] = ranking[0];
      title = count > n/2 ? ({support:'Most simulated people support the proposal',oppose:'Most simulated people oppose the proposal',undecided:'Most simulated people remain undecided'}[leading]) : count === ranking[1][1] ? 'The simulated population has no single leading position' : `${names[leading]} is the largest group, without a majority`;
    }
    const starts = new Map((snapshots[0]?.people || []).map(p => [p.id,p]));
    const cohort = people.filter(p => starts.has(p.id));
    const originalSupport = cohort.filter(p => stance(starts.get(p.id).stance)==='support').length;
    const currentSupport = cohort.filter(p => stance(p.stance)==='support').length;
    const changed = cohort.filter(p => stance(p.stance)!==stance(starts.get(p.id).stance)).length;
    const baselines = new Map(starts);
    for(const a of world.arrivals || []) if(!baselines.has(a.person.id)) baselines.set(a.person.id,a.person);
    const shifts = people.filter(p => baselines.has(p.id)).map(p => ({person:p,start:baselines.get(p.id).stance,delta:p.stance-baselines.get(p.id).stance})).filter(x=>Math.abs(x.delta)>.00001).sort((a,b)=>Math.abs(b.delta)-Math.abs(a.delta)).slice(0,5);
    const roles = [...new Set(people.map(p=>p.role))].map(role=>{const group=people.filter(p=>p.role===role);return {role,n:group.length,...tally(group)};});
    const drivers = {}, actions = {};
    for(const d of decisions) {drivers[d.driver]=(drivers[d.driver]||0)+1;actions[d.action]=(actions[d.action]||0)+1;}
    return {round,people,n,counts,title,decisions,cohort:cohort.length,changed,originalSupport,currentSupport,shifts,roles,drivers,actions,
      waiting:(world.people || []).filter(p=>!included.has(p.id)).length,
      forced:decisions.filter(d=>d.forced).length,
      uncertain:decisions.filter(d=>d.entropy>1.8).length,
      models:[...new Set(decisions.map(d=>d.model))],
      entropy:decisions.length?decisions.reduce((sum,d)=>sum+d.entropy,0)/decisions.length:null};
  }
  function build(world,catalog={},chart='',comparison='') {
    const r=summarize(world), total=r.decisions.length;
    const table=(headers,rows)=>`<div class="conclusion-table"><table><thead><tr>${headers.map(h=>`<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${row.map(c=>`<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
    const frequencies=(values,labels)=>Object.entries(values).sort((a,b)=>b[1]-a[1]).map(([k,v])=>[labels?.[k]||k,v,share(v,total)]);
    const summary=r.round?`After ${r.round} completed rounds, ${r.counts.support} of ${r.n} people (${share(r.counts.support,r.n)}) are supportive, ${r.counts.oppose} (${share(r.counts.oppose,r.n)}) are opposed, and ${r.counts.undecided} (${share(r.counts.undecided,r.n)}) are undecided. These are final simulated positions, not probabilities of real-world outcomes.`:'Only starting viewpoints are available. Run the simulation to observe decisions and how views change.';
    const movement=r.cohort?`Among the ${r.cohort} original people still in this report, support moved from ${share(r.originalSupport,r.cohort)} to ${share(r.currentSupport,r.cohort)}. ${r.changed} changed position category. This comparison keeps the same people in both groups.`:'No shared starting cohort is available for a change comparison.';
    const suggested = !r.round?'Run at least one round, then return to this report.':r.counts.oppose>r.n/2?'Explore a parallel world with a revised proposal that addresses the most frequently recorded concerns. Compare the same number of rounds and people.':r.counts.support>r.n/2?'Explore a parallel world with less favorable conditions to see whether this simulated support persists.': 'Explore a parallel world with clearer information or different conditions to see whether undecided or divided views shift.';
    const events=(world.events||[]).map(e=>[e.round == null || e.round > r.round ? 'Pending' : e.round,e.text || e.message || '']);
    const html=`<article class="conclusion-report">
      <header class="conclusion-heading"><span class="eyebrow">JEV-SIM · CONCLUSION REPORT</span><h1>${esc(world.title)}</h1><p class="report-question">${esc(world.question)}</p><p class="report-meta">Generated ${esc(new Date().toLocaleString())} · completed round ${r.round} · ${r.n} people analyzed · ${total} recorded decisions</p></header>
      <section class="conclusion-hero"><span class="eyebrow">${r.round?'OBSERVED CONCLUSION':'AWAITING SIMULATION'}</span><h2>${esc(r.title)}</h2><p>${esc(summary)}</p>${r.round?`<p>${esc(movement)}</p>`:''}</section>
      ${r.waiting?`<p class="report-scope">${r.waiting} newly added people have not participated in the latest completed round. They are excluded from this conclusion; your current world has ${world.people.length} people.</p>`:''}
      <div class="conclusion-stats">${Object.entries(r.counts).map(([k,v])=>`<div class="conclusion-stat ${k}"><span>${r.round?'Final':'Starting'} ${names[k].toLowerCase()}</span><strong>${share(v,r.n)}</strong><small>${v} of ${r.n} people</small></div>`).join('')}</div>
      <section><h2>How views evolved</h2>${chart||'<p>No completed timeline available.</p>'}<p class="report-meta">Green: support · orange: opposition · blue: undecided. Each round uses its own population size. Stance above 0.2 is supportive; below −0.2 is opposed.</p></section>
      <section><h2>Stakeholder outcomes</h2>${table(['Role','People','Supportive','Opposed','Undecided'],r.roles.map(g=>[g.role,g.n,`${g.support} (${share(g.support,g.n)})`,`${g.oppose} (${share(g.oppose,g.n)})`,`${g.undecided} (${share(g.undecided,g.n)})`]))}</section>
      <section><h2>What people decided</h2>${total?table(['Action','Decisions','Share'],frequencies(r.actions,catalog.actions)):'<p>No decisions recorded yet.</p>'}</section>
      <section><h2>What shaped their choices</h2><p>Model-selected plausible drivers across all recorded rounds; these are not verified causes.</p>${total?table(['Recorded driver','Decisions','Share'],frequencies(r.drivers,catalog.drivers)):'<p>Drivers will appear after a completed round.</p>'}</section>
      <section><h2>Largest changes in viewpoint</h2>${r.shifts.length?table(['Person / role','Starting stance','Final stance','Change'],r.shifts.map(x=>[`${x.person.name} · ${x.person.role}`,x.start.toFixed(2),x.person.stance.toFixed(2),`${x.delta>0?'+':''}${x.delta.toFixed(2)}`])):'<p>No changes in stance have been recorded.</p>'}<p class="report-meta">Stance ranges from −1 to +1. New arrivals are compared with their own arrival state.</p></section>
      <section><h2>Uncertainty and coverage</h2>${table(['Measure','Result'],[['Average action entropy',r.entropy===null?'No decisions':`${r.entropy.toFixed(2)} bits`],['High-uncertainty decisions (> 1.8 bits)',`${r.uncertain} of ${total}`],['Forced counterfactual actions',r.forced],['Recorded decision models',r.models.join(', ')||'None yet'],['Scenario seed',world.seed],['World ID',world.id]])}<p>Entropy measures how spread out the model’s action probabilities were. It does not measure prediction accuracy. Forced actions, if any, were chosen by the user.</p></section>
      ${comparison?`<section class="conclusion-comparison">${comparison}</section>`:''}
      <section class="conclusion-next"><h2>What to explore next</h2><p>${esc(suggested)}</p><p>Repeat the scenario with other seeds and compare the results before treating any pattern as stable.</p></section>
      <section><h2>Scenario context</h2><p class="report-context">${esc(world.context)}</p>${events.length?`<h3>Recorded interventions</h3>${table(['First applied round','Event'],events)}<p class="report-meta">Pending events have not yet affected the completed results shown here.</p>`:''}</section>
      <footer class="conclusion-method"><strong>How to read this report</strong><p>This is one sampled trajectory of synthetic people, not a representative survey or a validated real-world forecast. Conclusions are calculated locally from saved simulation records; creating or printing this report makes no additional API requests. Support and opposition actions adjust stance by 0.22. Consulting peers blends previous-round views according to openness. Peer connections, persona traits, and scenario context affect the simulated decisions.</p></footer>
    </article>`;
    return {html,summary:r};
  }
  const css=`
.conclusion-report{font:14px/1.65 system-ui,-apple-system,sans-serif;color:#303b48;max-width:1000px;margin:0 auto;overflow-wrap:anywhere}
.conclusion-report *{box-sizing:border-box}.conclusion-report h1{font:38px/1.15 Georgia,serif;margin:12px 0}.conclusion-report h2{font:24px/1.25 Georgia,serif;margin:0 0 15px}.conclusion-report h3{font-size:16px}.conclusion-report p{margin:10px 0}.conclusion-report .eyebrow{font-size:10px;letter-spacing:2px;color:#a26444}.conclusion-heading{margin:0 0 26px}.report-question{font-size:18px}.conclusion-report .report-meta{font-size:11px;color:#697586}.conclusion-hero{padding:28px;background:#fff5ed;border:1px solid #efd8c7;border-radius:12px;margin-bottom:20px}.conclusion-hero h2{font-size:30px;margin:12px 0}.conclusion-report>section:not(.conclusion-hero){margin:30px 0}.report-scope{padding:14px 18px;background:#eef3f7;border-radius:8px}.conclusion-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}.conclusion-stat{padding:20px;border:1px solid #dfe5ea;border-radius:9px;display:flex;flex-direction:column}.conclusion-stat strong{font-size:30px;font-weight:500}.conclusion-stat span,.conclusion-stat small{font-size:12px}.conclusion-stat.support strong{color:#43806b}.conclusion-stat.oppose strong{color:#b66b53}.conclusion-stat.undecided strong{color:#7284a1}.conclusion-table{overflow-x:auto}.conclusion-report table{width:100%;border-collapse:collapse;text-align:left;font-size:12px}.conclusion-report th,.conclusion-report td{padding:11px 12px;border-bottom:1px solid #e2e7ec;vertical-align:top}.conclusion-report th{background:#f3f5f7;font-weight:600}.conclusion-report svg{display:block;width:100%;max-height:280px}.conclusion-next{border-left:3px solid #e69164;padding:8px 22px}.report-context{white-space:pre-wrap}.conclusion-report .conclusion-method{display:block;border-top:1px solid #dfe5ea;margin-top:30px;padding-top:20px;font-size:11px;color:#697586}.conclusion-comparison .panel{border:0;box-shadow:none}.conclusion-comparison .report-card{padding:0}.conclusion-comparison p{font-size:13px}
@media(max-width:680px){.conclusion-report{font-size:12px}.conclusion-report h1{font-size:29px}.conclusion-hero{padding:20px}.conclusion-hero h2{font-size:24px}.conclusion-stat{padding:10px}.conclusion-stat strong{font-size:24px}.conclusion-stat span,.conclusion-stat small{font-size:9px}.conclusion-report table{font-size:10px}.conclusion-report td,.conclusion-report th{padding:8px 5px}}
@page{size:A4;margin:17mm}
@media print{.conclusion-report{font-size:10pt;max-width:none;color:#18232e}.conclusion-report h1{font-size:27pt}.conclusion-report h2{font-size:18pt;break-after:avoid}.conclusion-hero h2{font-size:21pt}.conclusion-report .eyebrow{font-size:8pt}.conclusion-report .report-meta{font-size:8pt}.conclusion-hero,.conclusion-stats,.conclusion-next,.conclusion-method{break-inside:avoid}.conclusion-report tr{break-inside:avoid}.conclusion-report thead{display:table-header-group}.conclusion-report table{font-size:9pt}.conclusion-table{overflow:visible}.conclusion-report th,.conclusion-report td{padding:7px 8px}.conclusion-report svg{max-height:200px;break-inside:avoid}.conclusion-report p{orphans:3;widows:3}.conclusion-report{print-color-adjust:exact;-webkit-print-color-adjust:exact}}
`;
  function documentHTML(title,html) {return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)} — Conclusion report</title><style>body{margin:0;padding:32px;background:white}${css}</style></head><body>${html}</body></html>`;}
  const api={summarize,build,css,documentHTML};
  root.JevReport=api;
  if(typeof module!=='undefined')module.exports=api;
})(globalThis);
