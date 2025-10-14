const https = require('https');

// Check Fractional CMO job statuses
const checkOptions = {
  hostname: 'jsypctdhynsdqrfifvdh.supabase.co',
  path: '/rest/v1/outline_generation_jobs?content_plan_guid=eq.503cf6b2-93e9-455e-8ea7-6d3cd7d0e347&select=id,post_keyword,status,updated_at&order=updated_at.desc',
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

    // Count statuses
    const statusCounts = {};
    jobs.forEach(j => {
      statusCounts[j.status] = (statusCounts[j.status] || 0) + 1;
    });

    console.log('=== FRACTIONAL CMO JOB STATUS ===');
    Object.entries(statusCounts).forEach(([status, count]) => {
      console.log(status + ': ' + count);
    });

    // Show recent completions
    const recentJobs = jobs.slice(0, 10);
    console.log('\n=== MOST RECENT UPDATES ===');
    recentJobs.forEach(job => {
      const age = Math.round((Date.now() - new Date(job.updated_at).getTime()) / 1000);
      const emoji = job.status === 'completed' ? '✅' : job.status === 'failed' ? '❌' : '⏳';
      console.log(emoji + ' ' + job.status.padEnd(20) + ' - ' + job.post_keyword + ' (' + age + 's ago)');
    });

    const incompleteCount = jobs.filter(j => j.status !== 'completed').length;
    const completedCount = jobs.filter(j => j.status === 'completed').length;

    console.log('\n=== SUMMARY ===');
    console.log('✅ Completed: ' + completedCount + '/' + jobs.length);
    if (incompleteCount > 0) {
      console.log('⏳ Still processing: ' + incompleteCount + ' jobs');
    } else {
      console.log('🎉 All Fractional CMO jobs completed!');
    }
  });
});

checkReq.end();