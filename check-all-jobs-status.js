const https = require('https');

const checkAllJobs = () => {
  // Check all job statuses
  const statusOptions = {
    hostname: 'jsypctdhynsdqrfifvdh.supabase.co',
    path: '/rest/v1/outline_generation_jobs?content_plan_guid=in.(503cf6b2-93e9-455e-8ea7-6d3cd7d0e347,926d211d-323f-4f8f-9e85-a9adf7324b63)&select=id,status,post_keyword,updated_at&order=updated_at.desc',
    method: 'GET',
    headers: {
      'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY,
      'Authorization': 'Bearer ' + process.env.SUPABASE_SERVICE_ROLE_KEY
    }
  };

  const statusReq = https.request(statusOptions, (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
      const jobs = JSON.parse(data);

      if (!Array.isArray(jobs)) {
        console.log('Error fetching jobs:', data);
        return;
      }

      // Count statuses
      const statusCounts = {};
      jobs.forEach(job => {
        statusCounts[job.status] = (statusCounts[job.status] || 0) + 1;
      });

      console.log('\n=== JOB STATUS SUMMARY ===');
      Object.entries(statusCounts).forEach(([status, count]) => {
        console.log(`${status}: ${count}`);
      });

      // Show recent failures
      const failedJobs = jobs.filter(j => j.status === 'failed').slice(0, 5);
      if (failedJobs.length > 0) {
        console.log('\n=== RECENT FAILED JOBS ===');
        failedJobs.forEach(job => {
          const age = Math.round((Date.now() - new Date(job.updated_at).getTime()) / 1000);
          console.log(`${job.id.substring(0, 8)}... - ${job.post_keyword} (${age}s ago)`);
        });
      }

      // Show successful completions
      const completedJobs = jobs.filter(j => j.status === 'completed').slice(0, 5);
      if (completedJobs.length > 0) {
        console.log('\n=== RECENT COMPLETED JOBS ===');
        completedJobs.forEach(job => {
          const age = Math.round((Date.now() - new Date(job.updated_at).getTime()) / 1000);
          console.log(`${job.id.substring(0, 8)}... - ${job.post_keyword} (${age}s ago)`);
        });
      }
    });
  });
  statusReq.end();

  // Check content_plan_outlines
  setTimeout(() => {
    const outlineOptions = {
      hostname: 'jsypctdhynsdqrfifvdh.supabase.co',
      path: '/rest/v1/content_plan_outlines?select=guid,post_title,status,updated_at&order=updated_at.desc&limit=10',
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
        console.log('\n=== CONTENT_PLAN_OUTLINES TABLE ===');
        if (outlines.length === 0) {
          console.log('❌ No records found in content_plan_outlines table');
        } else {
          console.log(`Found ${outlines.length} recent records:`);
          outlines.slice(0, 5).forEach(outline => {
            const age = Math.round((Date.now() - new Date(outline.updated_at).getTime()) / 1000 / 60);
            console.log(`  ${outline.guid.substring(0, 8)}... - ${(outline.post_title || '').substring(0, 40)} (${age}m ago)`);
          });
        }
      });
    });
    outlineReq.end();
  }, 500);
};

checkAllJobs();