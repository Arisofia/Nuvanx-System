const https = require('https');
const zlib = require('zlib');
const { execSync } = require('child_process');
const token = execSync('git credential fill', { input: 'protocol=https\nhost=github.com\n', timeout: 3000, encoding: 'utf8' }).match(/password=(.+)/)[1].trim();

function getJobLog(runId, jobName) {
  return new Promise((resolve) => {
    https.get({hostname:'api.github.com',path:'/repos/Arisofia/Nuvanx-System/actions/runs/'+runId+'/jobs',headers:{'User-Agent':'nuvanx','Authorization':'Bearer '+token,'Accept':'application/vnd.github+json'}}, r => {
      let d=''; r.on('data',c=>d+=c); r.on('end',()=>{
        const jobs = JSON.parse(d).jobs;
        const job = jobs.find(j=>j.name===jobName);
        if (!job) { resolve('Job not found: '+jobName); return; }
        https.get({hostname:'api.github.com',path:'/repos/Arisofia/Nuvanx-System/actions/jobs/'+job.id+'/logs',headers:{'User-Agent':'nuvanx','Authorization':'Bearer '+token,'Accept':'application/vnd.github+json'}}, res => {
          if (res.statusCode === 302) {
            const u = new URL(res.headers.location);
            https.get({hostname:u.hostname,path:u.pathname+u.search,headers:{'Accept-Encoding':'gzip'}}, r2 => {
              const chunks=[]; r2.on('data',c=>chunks.push(c)); r2.on('end',()=>{
                const buf=Buffer.concat(chunks);
                zlib.gunzip(buf,(e,out)=>resolve(e?buf.toString():out.toString()));
              });
            });
          } else { let d2=''; res.on('data',c=>d2+=c); res.on('end',()=>resolve('HTTP '+res.statusCode+': '+d2)); }
        });
      });
    });
  });
}

https.get({hostname:'api.github.com',path:'/repos/Arisofia/Nuvanx-System/actions/runs?per_page=10',headers:{'User-Agent':'nuvanx','Authorization':'Bearer '+token,'Accept':'application/vnd.github+json'}}, r => {
  let d=''; r.on('data',c=>d+=c); r.on('end', async ()=>{
    const runs = JSON.parse(d).workflow_runs;
    const deploy = runs.find(r=>r.name==='Deploy Supabase');
    const security = runs.find(r=>r.name==='Supabase Security Check');
    console.log('Deploy #'+deploy.run_number+' run_id:'+deploy.id);
    console.log('Security #'+security.run_number+' run_id:'+security.id);
    const [dl, sl] = await Promise.all([
      getJobLog(deploy.id, 'Supabase - DB migrations'),
      getJobLog(security.id, 'RLS & security lint'),
    ]);
    // Show the key error lines for deploy
    const depLines = dl.split('\n');
    const errStart = Math.max(0, depLines.findIndex(l=>l.includes('Connecting to remote')||l.includes('error')||l.includes('Error')));
    console.log('\n=== DEPLOY: DB migrations (error context) ===');
    depLines.filter(l=>!l.includes('##[endgroup]')&&!l.includes('git config')&&!l.includes('git submodule')&&l.trim()).slice(-40).forEach(l=>console.log(l));
    
    console.log('\n=== SECURITY: lint (error context) ===');
    sl.split('\n').filter(l=>!l.includes('##[endgroup]')&&!l.includes('git config')&&!l.includes('git submodule')&&l.trim()).slice(-30).forEach(l=>console.log(l));
  });
});
