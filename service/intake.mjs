import { validateReport } from './registry.mjs';

export const allowedOrigin = 'https://zestyts.github.io';
const ownOrigin = 'https://uif-community-reports.freepig18.chatgpt.site';
const encoder = new TextEncoder();
const hex = bytes => Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
const randomId = () => crypto.randomUUID().replaceAll('-', '');
function canonical(value) {
  return JSON.stringify(value, (_, item) => item && typeof item==='object' && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])) : item);
}
export const digest = async value => hex(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
async function sign(secret, value) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, encoder.encode(value)));
}
function equal(a, b) { if (a.length !== b.length) return false; let result=0; for(let i=0;i<a.length;i++)result |= a.charCodeAt(i)^b.charCodeAt(i); return result===0; }
function fail(status, message) { throw Object.assign(new Error(message), { status }); }
function cors(request) {
  const origin = request.headers.get('origin');
  return { 'Access-Control-Allow-Origin': origin === allowedOrigin ? origin : ownOrigin, 'Vary':'Origin', 'Access-Control-Allow-Methods':'GET, POST, OPTIONS', 'Access-Control-Allow-Headers':'Content-Type', 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff', 'Referrer-Policy':'no-referrer' };
}
async function body(request) {
  if (!request.headers.get('content-type')?.startsWith('application/json')) fail(415,'Send a JSON report.');
  if(Number(request.headers.get('content-length'))>70000)fail(413,'Report is too large.');
  const reader=request.body?.getReader(); if(!reader)fail(400,'Missing report.');
  let size=0,parts=[];
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>70000){await reader.cancel();fail(413,'Report is too large.');}parts.push(value);}
  const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.byteLength;}
  try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{fail(400,'Invalid JSON report.');}
}
function writeOrigin(request, moderator=false) {
  const origin=request.headers.get('origin');
  if(moderator ? origin!==ownOrigin : ![allowedOrigin,ownOrigin].includes(origin))fail(403,'This submission origin is not allowed.');
}
export function isModerator(headers, env) {
  return Boolean(env.MODERATOR_EMAIL && headers.get('oai-authenticated-user-id') && headers.get('oai-authenticated-user-email')?.toLowerCase()===env.MODERATOR_EMAIL.toLowerCase());
}
async function checkChallenge(token, proof, origin, env, now) {
  if(typeof token!=='string'||token.length>200||!Number.isSafeInteger(proof)||proof<0||proof>2000000)fail(400,'Please retry browser verification.');
  const [stamp,nonce,signature,...extra]=token.split('.'), issued=Number(stamp);
  if(extra.length||!/^\d{13}$/.test(stamp)||!/^\w{32}$/.test(nonce)||!signature||now-issued>600000||issued>now)fail(400,'Verification expired. Please retry.');
  const expected=await sign(env.INTAKE_SECRET,stamp+'.'+nonce+'.'+origin);
  if(!equal(expected,signature)||!(await digest(token+'.'+proof)).startsWith('000'))fail(400,'Browser verification failed. Please retry.');
  return nonce;
}
async function prune(db, now) {
  await db.batch([
    db.prepare("DELETE FROM submissions WHERE status != 'approved' AND created_at < ?").bind(now-90*86400000),
    db.prepare('DELETE FROM rate_limits WHERE expires_at < ?').bind(now),
  ]);
}
export async function handle(request, env) {
  const headers=cors(request), reply=(data,status=200)=>Response.json(data,{status,headers});
  try{
    const path=new URL(request.url).pathname;
    if(request.method==='OPTIONS'){writeOrigin(request);return new Response(null,{status:204,headers});}
    if(!env.DB||!env.INTAKE_SECRET)fail(503,'Report service is not configured. Save your report and try later.');
    const db=env.DB, now=Date.now();
    if(request.method==='GET'&&path==='/api/challenge'){
      const origin=request.headers.get('origin')||ownOrigin;if(![allowedOrigin,ownOrigin].includes(origin))fail(403,'Origin not allowed.');
      await prune(db,now);const payload=now+'.'+randomId();
      return reply({challenge:payload+'.'+await sign(env.INTAKE_SECRET,payload+'.'+origin)});
    }
    if(request.method==='GET'&&path==='/api/reports'){
      const cursor=new URL(request.url).searchParams.get('after')||'';
      if(cursor&&!/^[a-f0-9]{32}$/.test(cursor))fail(400,'Invalid registry page.');
      const result=await db.prepare("SELECT receipt,body,reviewed_at FROM submissions WHERE status='approved' AND receipt>? ORDER BY receipt LIMIT 101").bind(cursor).all();
      const rows=result.results.slice(0,100);
      return reply({schemaVersion:1,nextCursor:result.results.length>100?rows.at(-1).receipt:null,reports:rows.map(row=>({report:JSON.parse(row.body),review:{reviewer:'UIF community moderation',reviewedAtUtc:new Date(row.reviewed_at).toISOString(),issueUrl:''}}))});
    }
    if(request.method==='GET'&&/^\/api\/receipts\/[a-f0-9]{32}$/.test(path)){
      const row=await db.prepare('SELECT status FROM submissions WHERE receipt=?').bind(path.split('/').at(-1)).first();
      if(!row)fail(404,'Receipt not found or expired.');return reply({status:row.status});
    }
    if(request.method==='POST'&&path==='/api/submissions'){
      writeOrigin(request);const input=await body(request);
      if(!input||Object.keys(input).sort().join(',')!=='challenge,consent,proof,report,website'||input.consent!==true||input.website!=='')fail(400,'Review the report and publication consent.');
      try{validateReport(input.report);}catch(error){fail(400,error.message);}
      const nonce=await checkChallenge(input.challenge,input.proof,request.headers.get('origin'),env,now);
      const reportBody=JSON.stringify(input.report), hash=await digest(canonical(input.report));
      const existing=await db.prepare('SELECT receipt,digest FROM submissions WHERE report_id=?').bind(input.report.reportId).first();
      if(existing){if(existing.digest!==hash)fail(409,'This report ID was already submitted with different contents. Keep its receipt for a correction request, or enter a new test.');return reply({receipt:existing.receipt,duplicate:true},200);}
      const hour=Math.floor(now/3600000), day=Math.floor(now/86400000);
      const network=request.headers.get('cf-connecting-ip') || 'unavailable';
      const buckets=[['hour:'+hour,60],['day:'+day,500]];
      if(network!=='unavailable')buckets.push(['net:'+hour+':'+await sign(env.INTAKE_SECRET,network),6]);
      const rates=await db.batch(buckets.map(([bucket])=>db.prepare('INSERT INTO rate_limits(bucket,attempts,expires_at) VALUES(?,1,?) ON CONFLICT(bucket) DO UPDATE SET attempts=attempts+1 RETURNING attempts').bind(bucket,now+86400000)));
      if(rates.some((r,i)=>r.results[0].attempts>buckets[i][1]))fail(429,'Submission limit reached. Save your report and try again later.');
      const count=await db.prepare("SELECT count(*) AS count FROM submissions WHERE status='pending'").first();
      if(count.count>=1000)fail(503,'The review queue is full. Save your report and try later.');
      const receipt=randomId();
      // D1 batch is transactional: a reused challenge cannot leave a partial submission.
      try{await db.batch([
        db.prepare('INSERT INTO rate_limits(bucket,attempts,expires_at) VALUES(?,1,?)').bind('proof:'+nonce,now+600000),
        db.prepare("INSERT INTO submissions(receipt,report_id,digest,body,status,created_at) VALUES(?,?,?,?,'pending',?)").bind(receipt,input.report.reportId,hash,reportBody,now),
      ]);}catch{
        const concurrent=await db.prepare('SELECT receipt,digest FROM submissions WHERE report_id=?').bind(input.report.reportId).first();
        if(concurrent?.digest===hash)return reply({receipt:concurrent.receipt,duplicate:true});
        fail(409,'This verification was already used. Retry to obtain a fresh verification.');
      }
      return reply({receipt,duplicate:false},202);
    }
    if(path==='/api/moderation'&&['GET','POST'].includes(request.method)){
      if(!isModerator(request.headers,env))fail(403,'Reviewer access is required.');
      if(request.method==='GET'){
        await prune(db,now);
        const query=new URL(request.url).searchParams, status=query.get('status')||'pending', after=query.get('after')||'';
        if(!['pending','approved','rejected'].includes(status)||(after&&!/^[a-f0-9]{32}$/.test(after)))fail(400,'Invalid review page.');
        const result=await db.prepare('SELECT receipt,body,status,created_at,reviewed_at FROM submissions WHERE status=? AND receipt>? ORDER BY receipt LIMIT 51').bind(status,after).all();
        const rows=result.results.slice(0,50);
        return reply({nextCursor:result.results.length>50?rows.at(-1).receipt:null,submissions:rows.map(row=>({...row,body:row.body==='{}'?null:JSON.parse(row.body)}))});
      }
      writeOrigin(request,true);const input=await body(request);
      if(!input||Object.keys(input).sort().join(',')!=='action,receipt'||!['approve','reject'].includes(input.action)||!(/^[a-f0-9]{32}$/.test(input.receipt)))fail(400,'Invalid moderation action.');
      const row=await db.prepare('SELECT status,body FROM submissions WHERE receipt=?').bind(input.receipt).first();
      if(!row)fail(404,'Submission not found.');
      if(input.action==='approve'){
        if(row.status!=='pending')fail(409,'Only a pending report can be approved.');validateReport(JSON.parse(row.body));
        await db.prepare("UPDATE submissions SET status='approved',reviewed_at=? WHERE receipt=? AND status='pending'").bind(now,input.receipt).run();
      }else await db.prepare("UPDATE submissions SET status='rejected',body='{}',reviewed_at=? WHERE receipt=?").bind(now,input.receipt).run();
      return reply({ok:true});
    }
    return reply({error:'Not found.'},404);
  }catch(error){return reply({error:error.status?error.message:'Report service is unavailable. Save your report and try later.'},error.status||503);}
}
