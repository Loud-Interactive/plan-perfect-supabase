const https = require('https');

// Get ONE incomplete job
const checkOptions = {
  hostname: 'jsypctdhynsdqrfifvdh.supabase.co',
  path: '/rest/v1/outline_generation_jobs?content_plan_guid=eq.503cf6b2-93e9-455e-8ea7-6d3cd7d0e347&status=neq.completed&select=id,post_keyword,status&limit=1',
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

    if (!jobs || jobs.length === 0) {
      console.log('✅ All CMO jobs are completed!');
      return;
    }

    const job = jobs[0];
    console.log('\n🎯 Testing with ONE job:');
    console.log('  Job ID: ' + job.id);
    console.log('  Status: ' + job.status);
    console.log('  Keyword: ' + job.post_keyword);

    // Reset the job
    const resetData = JSON.stringify({
      status: 'pending',
      fast_mode: true,
      updated_at: new Date().toISOString()
    });

    const resetOptions = {
      hostname: 'jsypctdhynsdqrfifvdh.supabase.co',
      path: '/rest/v1/outline_generation_jobs?id=eq.' + job.id,
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': 'Bearer ' + process.env.SUPABASE_SERVICE_ROLE_KEY
      }
    };

    console.log('\n⏳ Resetting job to pending...');

    const resetReq = https.request(resetOptions, (res) => {
      console.log('  Reset status code: ' + res.statusCode);

      // Trigger fast-outline-search
      const triggerData = JSON.stringify({ job_id: job.id });

      const triggerOptions = {
        hostname: 'jsypctdhynsdqrfifvdh.supabase.co',
        path: '/functions/v1/fast-outline-search',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + process.env.SUPABASE_SERVICE_ROLE_KEY
        }
      };

      console.log('\n🚀 Triggering fast-outline-search...');

      const triggerReq = https.request(triggerOptions, (triggerRes) => {
        console.log('  Trigger status code: ' + triggerRes.statusCode);
        let responseData = '';
        triggerRes.on('data', chunk => responseData += chunk);
        triggerRes.on('end', () => {
          console.log('  Response: ' + responseData);
          console.log('\n✅ Job triggered. Monitor the logs for this job ID:');
          console.log('  ' + job.id);
          console.log('\nWait 2-3 minutes then check:');
          console.log('  - Job status in outline_generation_jobs');
          console.log('  - New record in content_plan_outlines');
        });
      });

      triggerReq.write(triggerData);
      triggerReq.end();
    });

    resetReq.write(resetData);
    resetReq.end();
  });
});

checkReq.end();