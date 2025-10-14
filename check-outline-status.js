const https = require('https');

const jobId = '33b9756c-079e-4f3f-b66c-b0a71a167e5e';

// Check job status
const checkOptions = {
  hostname: 'jsypctdhynsdqrfifvdh.supabase.co',
  path: '/rest/v1/outline_generation_jobs?id=eq.' + jobId + '&select=id,status,post_keyword,updated_at',
  method: 'GET',
  headers: {
    'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY,
    'Authorization': 'Bearer ' + process.env.SUPABASE_SERVICE_ROLE_KEY
  }
};

const checkReq = https.request(checkOptions, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    const jobs = JSON.parse(data);
    if (jobs.length > 0) {
      const job = jobs[0];
      const age = Math.round((Date.now() - new Date(job.updated_at).getTime()) / 1000);
      console.log(`\nJob Status: ${job.status}`);
      console.log(`Keyword: ${job.post_keyword}`);
      console.log(`Updated: ${age}s ago`);
    }
  });
});

checkReq.end();

// Check if outline was saved
const outlineOptions = {
  hostname: 'jsypctdhynsdqrfifvdh.supabase.co',
  path: '/rest/v1/content_plan_outlines?guid=eq.' + jobId + '&select=guid,post_title,status,updated_at',
  method: 'GET',
  headers: {
    'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY,
    'Authorization': 'Bearer ' + process.env.SUPABASE_SERVICE_ROLE_KEY
  }
};

const outlineReq = https.request(outlineOptions, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    const outlines = JSON.parse(data);
    if (outlines.length > 0) {
      const outline = outlines[0];
      console.log(`\n✅ OUTLINE FOUND IN content_plan_outlines!`);
      console.log(`Title: ${outline.post_title}`);
      console.log(`Status: ${outline.status}`);
    } else {
      console.log(`\n❌ No outline found in content_plan_outlines for job ${jobId}`);
    }
  });
});

setTimeout(() => outlineReq.end(), 500);