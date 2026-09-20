const {test}=require('node:test');
const assert=require('node:assert/strict');
const {summarize,build,documentHTML}=require('../jevsim/dashboard/report.js');
const person=(id,stance)=>({id,name:id,role:'Resident',stance});
const base=()=>({id:'example',title:'Test world',question:'A proposal?',context:'A test.',seed:42,round:1,people:[person('a',-.8),person('b',-.4),person('c',.6)],snapshots:[{round:0,people:[person('a',.5),person('b',-.3),person('c',.6)]},{round:1,people:[person('a',-.8),person('b',-.4),person('c',.6)]}],decisions:[{round:1,action:'OPPOSE',driver:'cost',entropy:2,model:'fixture',forced:true}],events:[]});
test('conclusion uses completed population and a matched starting cohort',()=>{
 const w=base();w.people.push(person('new',1));w.arrivals=[{after_round:1,person:person('new',1)}];
 const r=summarize(w);assert.equal(r.n,3);assert.equal(r.waiting,1);assert.equal(r.counts.oppose,2);assert.equal(r.originalSupport,2);assert.equal(r.currentSupport,1);assert.equal(r.changed,1);assert.match(r.title,/oppose/);assert.equal(r.forced,1);assert.equal(r.uncertain,1);
 assert.match(build(w).html,/1 newly added people/);
});
test('incomplete round decisions never enter a conclusion',()=>{
 const w=base();w.decisions.push({round:2,action:'SUPPORT',driver:'trust',entropy:0});
 assert.equal(summarize(w).decisions.length,1);
});
test('starting views and a tied result do not claim a majority',()=>{
 const w=base();w.round=0;assert.match(summarize(w).title,/Run a round/);
 w.round=1;w.snapshots[1].people=[person('a',-.4),person('b',.5)];
 assert.match(summarize(w).title,/no single leading/);
 w.snapshots[1].people.push(person('c',.2),person('d',-.2));
 assert.equal(summarize(w).counts.undecided,2);assert.match(summarize(w).title,/without a majority/);
});
test('arrivals use their own baseline and do not alter original cohort changes',()=>{
 const w=base();w.snapshots[1].people.push(person('new',-.8));w.arrivals=[{after_round:0,person:person('new',.8)}];
 const r=summarize(w);assert.equal(r.cohort,3);assert.equal(r.shifts[0].person.id,'new');assert.equal(r.shifts[0].delta,-1.6);
});
test('standalone report escapes user text and needs no external scripts or styles',()=>{
 const w=base();w.title='<script>alert(1)</script>';w.context='<img src=x onerror=alert(1)>';
 const html=documentHTML(w.title,build(w).html);assert.ok(!html.includes('<script>'));assert.ok(!html.includes('<img'));assert.ok(html.includes('&lt;script&gt;'));assert.ok(html.includes('@media print'));assert.ok(!html.includes('<link'));assert.match(html,/no additional API requests/);
});
test('empty and unchanged worlds have useful report states',()=>{
 const w=base();w.round=0;w.snapshots=[];w.people=[];w.decisions=[];
 const result=build(w);assert.equal(result.summary.n,0);assert.ok(!result.html.includes('NaN'));assert.match(result.html,/No changes in stance/);
});
