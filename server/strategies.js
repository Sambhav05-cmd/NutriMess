import { foodImpacts } from './food-impact.js';
import { randomUUID } from 'node:crypto';
import PDFDocument from 'pdfkit';
import { dateKey, shiftDate, totals, portionStep } from './nutrition.js';
import { slots } from './catalog.js';
import { scoreStrategy } from './active-planner.js';
import { targets } from './nutrition.js';

// Keep estimates separate from actual logs; derive missed meals on every read,
// including absences spanning restarts. Activation snapshots preserve history.
export function effectiveIntake(s, now=new Date()) {
  const today=dateKey(now), hour=Number(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Kolkata',hour:'2-digit',hourCycle:'h23'}).format(now));
  const cutoff={breakfast:10,lunch:15,snacks:18,dinner:22};
  const actual=new Set([...s.logs,...(s.completedMeals||[])].map(e=>`${e.date}:${e.meal}`));
  const versions=[...(s.activations||[])].sort((a,b)=>a.from.localeCompare(b.from));
  const estimates=[];
  for(let i=0;i<versions.length;i++) {
    const v=versions[i], end=versions[i+1]?shiftDate(versions[i+1].from,-1):today;
    for(let d=v.from;d<=end&&d<=today;d=shiftDate(d,1)) {
      const weekday=(new Date(`${d}T12:00:00Z`).getUTCDay()+6)%7;
      for(const e of v.days[weekday].entries)if(!actual.has(`${d}:${e.meal}`)&&(d<today||hour>=cutoff[e.meal]))estimates.push({...e,date:d,assumed:true,strategyName:v.name});
    }
  }
  return estimates;
}
export function installStrategies(app, {foods,fail,text,num,date,meal,foodId,response}) {
  const find=(req)=>{const s=req.student.strategies.find(s=>s.id===req.params.id);if(!s){const e=new Error('Strategy not found.');e.status=404;throw e;}return s;};
  function validate(body) {
    if(!Array.isArray(body.days)||body.days.length!==7)fail('A strategy needs seven days, Monday to Sunday.');
    return {name:text(body.name,80,'Strategy name'),notes:typeof body.notes==='string'?body.notes.slice(0,2000):'',days:body.days.map(d=>{
      if(!Array.isArray(d?.entries))fail('Each day needs a list of foods.');
      const seen=new Set();
      return {entries:d.entries.map(e=>{
        const entry={foodId:foodId(e.foodId),meal:meal(e.meal),portions:num(e.portions,.1,Number.MAX_VALUE,'Portions')},key=`${entry.meal}:${entry.foodId}`;
        if(portionStep(foods.get(entry.foodId))===1&&!Number.isInteger(entry.portions))fail('Use whole portions for foods not served in bowls.');
        if(!Number.isInteger(entry.portions/portionStep(foods.get(entry.foodId))))fail('Use multiples of half a portion for bowl or katori servings.');
        if(seen.has(key))fail('Each food can appear once per meal. Combine its portions.');seen.add(key);
        return entry;
      })};
    })};
  }
  app.post('/api/strategies/impact',async(req,res)=>{
    const strategy=validate({...req.body,name:req.body.name||'Editing preview'});
    const day=num(req.body.day,0,6,'Day');if(!Number.isInteger(day))fail('Choose a whole day index.');
    const slot=meal(req.body.meal);
    if(!Array.isArray(req.body.candidates)||req.body.candidates.length>150)fail('Choose up to 150 candidate foods.');
    const requests=[...new Set(req.body.candidates.map(foodId))].map(id=>({day,meal:slot,foodId:id}));
    res.json(foodImpacts(strategy,foods,targets(req.student.profile),req.student.profile,req.student,requests,'addition'));
  });
  app.post('/api/strategies/score',async(req,res)=>{
    const strategy=validate({...req.body,name:req.body.name||'Draft strategy'});
    res.json(scoreStrategy(strategy,foods,targets(req.student.profile),req.student.profile,req.student));
  });
  app.post('/api/strategies',async(req,res)=>{
    if(req.student.strategies.length>=50)fail('You can save up to 50 strategies.');
    req.student.strategies.push({...validate(req.body),id:randomUUID(),updatedAt:new Date().toISOString(),revision:1});
    await req.save();res.status(201).json(await response(req));
  });
  app.put('/api/strategies/:id',async(req,res)=>{
    const strategy=find(req);
    if(req.body.revision!==strategy.revision)return res.status(409).json({error:'This strategy changed. Reopen it before editing.'});
    Object.assign(strategy,validate(req.body),{updatedAt:new Date().toISOString(),revision:strategy.revision+1});await req.save();res.json(await response(req));
  });
  app.delete('/api/strategies/:id',async(req,res)=>{find(req);req.student.strategies=req.student.strategies.filter(s=>s.id!==req.params.id);await req.save();res.json(await response(req));});
  app.post('/api/strategies/:id/activate',async(req,res)=>{
    const strategy=find(req), from=dateKey();
    req.student.activations=req.student.activations.filter(a=>a.from<from);
    req.student.activations.push({id:randomUUID(),strategyId:strategy.id,from,name:strategy.name,days:structuredClone(strategy.days)});
    await req.save();res.json(await response(req));
  });
  app.post('/api/strategies/:id/log',async(req,res)=>{
    const strategy=find(req), d=date(req.body.date), slot=meal(req.body.meal);
    if(d>dateKey())fail('Future meals cannot be logged yet.');
    if(req.student.logs.some(l=>l.date===d&&l.meal===slot)||req.student.completedMeals.some(l=>l.date===d&&l.meal===slot))return res.status(409).json({error:'This meal is already recorded. Edit it in the journal.'});
    const index=(new Date(`${d}T12:00:00Z`).getUTCDay()+6)%7;
    const entries=strategy.days[index].entries.filter(e=>e.meal===slot);
    if(!entries.length)fail('This strategy has no foods for that meal.');
    if(req.student.logs.length+entries.length>15000)fail('The log limit has been reached.');
    req.student.logs.push(...entries.map(e=>({...e,id:randomUUID(),date:d})));
    req.student.completedMeals.push({date:d,meal:slot});req.student.plan=null;await req.save();res.json(await response(req));
  });
  app.get('/api/strategies/:id/pdf',async(req,res)=>{
    const s=find(req), doc=new PDFDocument({margin:48,size:'A4',bufferPages:true});
    res.type('application/pdf');res.set('Content-Disposition',`attachment; filename="nutrimess-plan-${s.id}.pdf"`);
    doc.pipe(res);
    const clean=v=>String(v).replace(/[^\x20-\x7e]/g,' ').replace(/ +/g,' ');
    const label=(value,size=11,color='#334433')=>doc.fontSize(size).fillColor(color).text(clean(value),{lineGap:4});
    label('NUTRIMESS / SAVED STRATEGY',11);label(s.name,25);label(`For ${req.student.profile.name} | Updated ${s.updatedAt.slice(0,10)}`);
    doc.moveDown();label('Portions and nutrients are estimates. This is a reusable Monday-Sunday plan.');
    label('Missed meals follow your active strategy and are labeled assumed. Actual logs override estimates.');
    if(s.notes){doc.moveDown();label(s.notes);}
    s.days.forEach((day,i)=>{
      doc.addPage();label(['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'][i],23);doc.moveDown();
      for(const slot of slots){
        label(slot.toUpperCase(),12);
        const entries=day.entries.filter(e=>e.meal===slot);
        if(!entries.length)label('No foods selected.');
        for(const e of entries){const f=foods.get(e.foodId);label(`${e.portions} x ${f.name} (${f.serving})`);}
        doc.moveDown(.6);
      }
      const t=totals(day.entries,foods);label(`Daily estimate: ${Math.round(t.calories)} kcal | Protein ${Math.round(t.protein)} g | Carbs ${Math.round(t.carbs)} g | Fat ${Math.round(t.fat)} g`,11);
    });
    const range=doc.bufferedPageRange();
    for(let p=0;p<range.count;p++){doc.switchToPage(p);doc.fontSize(9).fillColor('#647464').text(`NutriMess | ${p+1} / ${range.count}`,48,doc.page.height-35,{lineBreak:false});}
    doc.end();
  });
}
