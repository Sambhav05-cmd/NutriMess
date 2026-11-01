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
export function installAccounts(app, storage, {response}) {
  const attempts = new Map();
  function bindStudent(req, id, record) {
    req.studentId = id;
    req.student = record.student;
    req.studentRevision = record.revision;
    req.save = async () => { req.studentRevision = await storage.saveStudent(id, req.student, req.studentRevision); };
  }
  async function issue(req, res, id) {
    const record = await storage.getStudent(id);
    if (!record) { const error = new Error('Account data is unavailable.'); error.status = 401; throw error; }
    bindStudent(req, id, record);
    const before = JSON.stringify(req.student.profile);
    migrateProfileGender(req.student.profile);
    if (before !== JSON.stringify(req.student.profile)) await req.save();
    const token = randomBytes(32).toString('hex');
    await storage.createSession(digest(token), id, new Date(Date.now()+30*86400000));
    res.cookie('nutrimess',token,{httpOnly:true,sameSite:'strict',secure:req.secure,maxAge:30*86400000});
  }
  app.get('/api/health',async(req,res)=>{await storage.ping();res.json({ok:true});});
  app.get('/api/auth/options',async(req,res)=>res.json({colleges:await listColleges(storage), defaults:{male:{height:163,weight:65},female:{height:151,weight:55}}, reference:'https://aspirational.vikaspedia.in/viewcontent/health/nutrition/dietary-guidelines-1/recommended-dietary-allowance?lgn=en'}));
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
      const existing=await storage.findAccount(email);
      if(action==='login') {
        const hash=await scrypt(password,existing?.salt||'invalid-account-salt',64);
        if(!existing||!timingSafeEqual(hash,Buffer.from(existing.password_hash,'hex')))return res.status(401).json({error:'Email or password is incorrect.'});
        await issue(req,res,existing.id);
      } else {
        if(existing)return res.status(409).json({error:'An account already uses this email. Log in instead.'});
        const {name,collegeId}=req.body, gender=normalizeGender(req.body.gender??req.body.sex);
        if(typeof name!=='string'||!name.trim()||name.length>60||!gender)return res.status(400).json({error:'Enter your name and choose your gender.'});
        const college=(await listColleges(storage)).find(c=>c.id===collegeId);
        if(!college&&collegeId!=='custom')return res.status(400).json({error:'Select a college menu or My own hostel.'});
        // The old prototype used a UUID bearer cookie. Claim only that browser's
        // unclaimed record, preserving its measurements, menus and actual logs.
        const legacyToken=(req.headers.cookie||'').split(';').map(c=>c.trim()).find(c=>c.startsWith('nutrimess='))?.slice(10);
        const legacyRow=/^[a-f0-9-]{36}$/.test(legacyToken||'')&&!(await storage.getAccount(legacyToken))?await storage.getStudent(legacyToken):null;
        const s=legacyRow?{...newStudent(),...legacyRow.student}:newStudent();
        Object.assign(s.profile,{name:name.trim(),gender,...(!legacyRow?{height:gender==='female'?151:163,weight:gender==='female'?55:65}:{})});
        delete s.profile.sex;
        delete s.profile.decay;
        if(college)Object.assign(s,{collegeId:college.id,collegeName:college.name,menu:college.menu});
        s.plan=generatePlan({...s,logs:[],completedMeals:[]},foods,targets(s.profile),monday());
        const repeating=s.plan;
        s.activations=[{id:randomUUID(),from:dateKey(),name:'Initial optimized plan',days:repeating.days.map(d=>({entries:d.entries}))}];
        const salt=randomBytes(16).toString('hex'), hash=await scrypt(password,salt,64), id=legacyRow?legacyToken:randomUUID();
        try { await storage.createAccount({id,email,salt,password_hash:hash.toString('hex')},s,legacyRow?.revision); }
        catch(e){if(e.code===11000||String(e.code).includes('CONSTRAINT'))return res.status(409).json({error:'Account already exists.'});throw e;}
        await issue(req,res,id);
      }
      res.json(await response(req));
    }catch(e){next(e);}
  });
  app.use('/api',async(req,res,next)=>{
    const token=(req.headers.cookie||'').split(';').map(c=>c.trim()).find(c=>c.startsWith('nutrimess='))?.slice(10);
    const found=token&&/^[a-f0-9]{64}$/.test(token)?await storage.findSession(digest(token)):null;
    if(!found)return res.status(401).json({error:'Please log in to continue.'});
    const row=await storage.getStudent(found.student_id);
    if(!row)return res.status(401).json({error:'Please log in again.'});
    bindStudent(req, found.student_id, row);
    const before=JSON.stringify(req.student.profile);
    migrateProfileGender(req.student.profile);
    if(before!==JSON.stringify(req.student.profile))await req.save();
    delete req.student.profile.decay;
    req.student.strategies||=[];req.student.activations||=[];req.student.completedMeals||=[];
    req.sessionHash=digest(token);next();
  });
  app.post('/api/auth/logout',async(req,res)=>{await storage.deleteSession(req.sessionHash);res.clearCookie('nutrimess',{httpOnly:true,sameSite:'strict',secure:req.secure});res.json({ok:true});});
}
