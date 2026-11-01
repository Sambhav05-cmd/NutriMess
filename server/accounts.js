import { randomBytes, randomUUID, scrypt as derive, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { dateKey, monday, targets, normalizeGender, migrateProfileGender } from './nutrition.js';
import { sampleMenu, slots, foods } from './catalog.js';
import { listColleges } from './colleges.js';
import { generatePlan } from './planner.js';
const scrypt = promisify(derive);
const digest = value => createHash('sha256').update(value).digest('hex');
export function newStudent() {
  return { profile: { name: 'Student', age: 21, gender: 'male', height: 163, weight: 65, activity: 'moderate', calorieCap: null, preferred: [], excluded: [], dairyFree: false },
    collegeId: 'custom', collegeName: 'My hostel', menu: sampleMenu(), attendance: Array.from({length:7}, () => Object.fromEntries(slots.map(s => [s,true]))), extras: [], logs: [], colleges: [], strategies: [], activations: [], completedMeals: [], plan: null };
}
export function installAccounts(app, db, {read, write, response}) {
  db.exec(`CREATE TABLE IF NOT EXISTS accounts (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, salt TEXT NOT NULL, password_hash TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, student_id TEXT NOT NULL, expires INTEGER NOT NULL);`);
  const accountByEmail = db.prepare('SELECT * FROM accounts WHERE email = ?');
  const session = db.prepare('SELECT student_id FROM sessions WHERE token_hash = ? AND expires > ?');
  const attempts = new Map();
  function issue(req, res, id) {
    const token = randomBytes(32).toString('hex');
    db.prepare('DELETE FROM sessions WHERE expires <= ?').run(Date.now());
    db.prepare('INSERT INTO sessions VALUES (?, ?, ?)').run(digest(token), id, Date.now()+30*86400000);
    res.cookie('nutrimess',token,{httpOnly:true,sameSite:'strict',secure:req.secure,maxAge:30*86400000});
    req.studentId=id; req.student=JSON.parse(read.get(id).document); migrateProfileGender(req.student.profile); req.save=()=>write.run(id,JSON.stringify(req.student));req.save();
  }
  app.get('/api/health',(req,res)=>res.json({ok:true}));
  app.get('/api/auth/options',(req,res)=>res.json({colleges:listColleges(db), defaults:{male:{height:163,weight:65},female:{height:151,weight:55}}, reference:'https://aspirational.vikaspedia.in/viewcontent/health/nutrition/dietary-guidelines-1/recommended-dietary-allowance?lgn=en'}));
  app.post('/api/auth/:action',async(req,res,next)=>{
    try {
      const action=req.params.action;
      if(!['login','register'].includes(action))return next();
      const key=req.ip, now=Date.now(), prior=attempts.get(key);
      const bucket=prior&&prior.until>now?prior:{count:0,until:now+15*60000};
      if(attempts.size>10000)for(const [k,v] of attempts)if(v.until<=now)attempts.delete(k);
      attempts.set(key,bucket);
      if(++bucket.count>30)return res.status(429).json({error:'Too many attempts. Try again in 15 minutes.'});
      const {password}=req.body, email=String(req.body.email||'').trim().toLowerCase();
      if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254||typeof password!=='string'||password.length===0||password.length>128)return res.status(400).json({error:'Enter a valid email and a nonempty password of at most 128 characters.'});
      const existing=accountByEmail.get(email);
      if(action==='login') {
        const hash=await scrypt(password,existing?.salt||'invalid-account-salt',64);
        if(!existing||!timingSafeEqual(hash,Buffer.from(existing.password_hash,'hex')))return res.status(401).json({error:'Email or password is incorrect.'});
        issue(req,res,existing.id);
      } else {
        if(existing)return res.status(409).json({error:'An account already uses this email. Log in instead.'});
        const {name,collegeId}=req.body, gender=normalizeGender(req.body.gender??req.body.sex);
        if(typeof name!=='string'||!name.trim()||name.length>60||!gender)return res.status(400).json({error:'Enter your name and choose your gender.'});
        const college=listColleges(db).find(c=>c.id===collegeId);
        if(!college&&collegeId!=='custom')return res.status(400).json({error:'Select a college menu or My own hostel.'});
        // The old prototype used a UUID bearer cookie. Claim only that browser's
        // unclaimed record, preserving its measurements, menus and actual logs.
        const legacyToken=(req.headers.cookie||'').split(';').map(c=>c.trim()).find(c=>c.startsWith('nutrimess='))?.slice(10);
        const legacyRow=/^[a-f0-9-]{36}$/.test(legacyToken||'')&&!db.prepare('SELECT id FROM accounts WHERE id = ?').get(legacyToken)?read.get(legacyToken):null;
        const s=legacyRow?{...newStudent(),...JSON.parse(legacyRow.document)}:newStudent();
        Object.assign(s.profile,{name:name.trim(),gender,...(!legacyRow?{height:gender==='female'?151:163,weight:gender==='female'?55:65}:{})});
        delete s.profile.sex;
        delete s.profile.decay;
        if(college)Object.assign(s,{collegeId:college.id,collegeName:college.name,menu:college.menu});
        s.plan=generatePlan({...s,logs:[],completedMeals:[]},foods,targets(s.profile),monday());
        const repeating=s.plan;
        s.activations=[{id:randomUUID(),from:dateKey(),name:'Initial optimized plan',days:repeating.days.map(d=>({entries:d.entries}))}];
        const salt=randomBytes(16).toString('hex'), hash=await scrypt(password,salt,64), id=legacyRow?legacyToken:randomUUID();
        db.exec('BEGIN');
        try { db.prepare('INSERT INTO accounts VALUES (?, ?, ?, ?)').run(id,email,salt,hash.toString('hex')); write.run(id,JSON.stringify(s)); db.exec('COMMIT'); }
        catch(e){db.exec('ROLLBACK');if(e.code?.includes('CONSTRAINT'))return res.status(409).json({error:'Account already exists.'});throw e;}
        issue(req,res,id);
      }
      res.json(response(req));
    }catch(e){next(e);}
  });
  app.use('/api',(req,res,next)=>{
    const token=(req.headers.cookie||'').split(';').map(c=>c.trim()).find(c=>c.startsWith('nutrimess='))?.slice(10);
    const found=token&&/^[a-f0-9]{64}$/.test(token)?session.get(digest(token),Date.now()):null;
    if(!found)return res.status(401).json({error:'Please log in to continue.'});
    const row=read.get(found.student_id);
    if(!row)return res.status(401).json({error:'Please log in again.'});
    req.studentId=found.student_id;req.student=JSON.parse(row.document);
    const before=JSON.stringify(req.student.profile);
    migrateProfileGender(req.student.profile);
    if(before!==JSON.stringify(req.student.profile))write.run(req.studentId,JSON.stringify(req.student));
    delete req.student.profile.decay;
    req.student.strategies||=[];req.student.activations||=[];req.student.completedMeals||=[];
    req.save=()=>write.run(req.studentId,JSON.stringify(req.student));
    req.sessionHash=digest(token);next();
  });
  app.post('/api/auth/logout',(req,res)=>{db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(req.sessionHash);res.clearCookie('nutrimess',{httpOnly:true,sameSite:'strict',secure:req.secure});res.json({ok:true});});
}
