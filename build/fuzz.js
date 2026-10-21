const fs=require('fs'); eval(fs.readFileSync('run.js','utf8').split('const D = JSON')[0].replace("const fs = require('fs');",'') + '\nglobalThis.Frac = Frac;');
const rnd=n=>Math.floor(Math.random()*n);
const tags={}; const counts={ok:0,notcalc:0,err:0}; const errs=new Map();
for(let t=0;t<60000;t++){
  const P=[{id:'X',sex:rnd(2)?'m':'f',alive:false,father:null,mother:null}]; let k=0;
  const add=(sex,alive,f,m)=>{const id='p'+(k++);P.push({id,sex,alive,father:f,mother:m});return id;};
  const X=P[0];
  X.father=add('m',rnd(5)===0,null,null); X.mother=add('f',rnd(4)===0,null,null);
  const F_=P.find(p=>p.id===X.father), M_=P.find(p=>p.id===X.mother);
  F_.father=add('m',rnd(6)===0,null,null); F_.mother=add('f',rnd(6)===0,null,null);
  M_.father=add('m',rnd(6)===0,null,null); M_.mother=add('f',rnd(6)===0,null,null);
  const n=rnd(9)+1;
  for(let i=0;i<n;i++){
    const ids=P.map(p=>p.id); const base=ids[rnd(ids.length)]; const b=P.find(p=>p.id===base);
    if(base==='X'||rnd(3)){ // child
      const par=b; const sex=rnd(2)?'m':'f';
      add(sex,rnd(2)===0,par.sex==='m'?par.id:null,par.sex==='f'?par.id:null);
    } else if(b.father||b.mother){ // sibling of base
      const typ=rnd(3); add(rnd(2)?'m':'f',rnd(2)===0,typ!==2?b.father:null,typ!==1?b.mother:null);
    }
  }
  const sp=[]; const st=rnd(4); if(st===1) sp.push({id:X.sex==='f'?'H':'W1',type:X.sex==='f'?'husband':'wife'}); if(st===2&&X.sex==='m'){sp.push({id:'W1',type:'wife'});sp.push({id:'W2',type:'wife'});}
  try{ const r=E.calculate({deceased_sex:X.sex,persons:P,spouses:sp}); let tot=Frac.ZERO; for(const v of Object.values(r.shares)) tot=Frac.add(tot,Frac.parse(v));
    for(const id in r.shares){ if(id!=='charity'&&!sp.some(s=>s.id===id)){const pp=P.find(p=>p.id===id); if(!pp||!pp.alive) throw new Error('share to a non-living person');} }
    if(!Frac.eq(tot,Frac.ONE)) throw new Error('total '+Frac.str(tot)); counts.ok++; for(const x of r.steps){const k=x.rule.split(/[ ,]/)[0]+' '+(x.rule.match(/SA[0-9.]+(\([a-z]\))?|Stage \d/)||[''])[0]; tags[k]=(tags[k]||0)+1;} }
  catch(e){ if(/^Not calculated/.test(e.message)){counts.notcalc++; errs.set(e.message.slice(0,90),(errs.get(e.message.slice(0,90))||0)+1);} else {counts.err++; const key=e.message.slice(0,90); if(!errs.has(key)){errs.set(key,1); fs.writeFileSync('fuzz_fail_'+errs.size+'.json',JSON.stringify({deceased_sex:X.sex,persons:P,spouses:sp}));} else errs.set(key,errs.get(key)+1);} }
}
console.log(counts); console.log(Object.entries(tags).sort((a,b)=>b[1]-a[1]).map(e=>e[1]+' '+e[0]).join('\n')); for(const [k,v] of errs) console.log(v,k);
