# PagePerfect Orchestration & Scheduling

This document explains the orchestration and scheduling components of the PagePerfect system.

## Cron Jobs

PagePerfect uses three main cron jobs to automate its operations:

1. **Daily GSC Data Ingestion** (`pageperfect-cron-ingest-gsc`)
   - Runs at 2 AM UTC daily
   - Fetches keyword data from Google Search Console for yesterday
   - Processes multiple domains in a single run
   - Updates the `gsc_page_query_daily` and `gsc_keywords` tables

2. **Hourly URL Processing** (`pageperfect-cron-process-urls`)
   - Runs every hour
   - Identifies pages that need processing (new or not crawled recently)
   - Runs the full workflow: crawl → embed → cluster → analyze → rewrite
   - Limits processing to 50 URLs per run by default

3. **Weekly CTR Recalibration** (`pageperfect-cron-recalibrate-ctr`)
   - Runs at 3 AM UTC on Sundays
   - Analyzes 90 days of GSC data by default
   - Fits a logistic function to position-CTR data
   - Updates the alpha and beta parameters for opportunity scoring

## Database Tables

The cron system uses several database tables:

1. **`pageperfect_task_schedule`**
   - Tracks scheduled and completed tasks
   - Records task parameters, results, and timing
   - Allows for monitoring task execution history

2. **`pageperfect_cron_secrets`**
   - Stores authentication secrets for cron jobs
   - Provides security for cron job invocation
   - Prevents unauthorized execution of jobs

3. **`pageperfect_parameters`**
   - Stores system parameters like CTR curve coefficients
   - Updated by the recalibration process
   - Used by opportunity scoring functions

4. **`pageperfect_processing_events`**
   - Records detailed workflow execution events
   - Tracks start, completion, and errors for each processing step
   - Enables audit and debugging of the processing pipeline

## Workflow Orchestration

The `pageperfect-workflow` function provides end-to-end orchestration:

1. **Workflow Steps**
   - Crawl: Fetches HTML content from the URL
   - Embed: Segments content and generates embeddings
   - Cluster: Groups keywords by semantic similarity
   - Analyze: Identifies content gaps
   - Rewrite: Generates content improvements

2. **Features**
   - Step dependencies are automatically managed
   - Steps can be skipped with the `skipSteps` parameter
   - Recent step executions are reused to avoid redundant processing
   - Complete audit trail of workflow execution

3. **Execution Modes**
   - On-demand: Call the workflow function directly for specific URLs
   - Scheduled: Automatically processed via the hourly cron job
   - Force update: Override caching with `forceUpdate: true`

## Setting Up Cron Jobs

To set up the cron jobs, follow these steps:

1. **Deploy the database migrations**
   ```sql
   -- Run the migration files:
   psql -f migrations/20250430_pageperfect_cron_jobs.sql
   psql -f migrations/20250430_pageperfect_helper_functions.sql
   ```

2. **Deploy the edge functions**
   ```bash
   ./deploy-pageperfect-functions.sh
   ```

3. **Set environment variables**
   ```bash
   # Add these to your Supabase project's environment variables
   CRON_SECRET=your_secure_secret_here
   GSC_CREDENTIALS={"type":"service_account",...}
   OPENAI_API_KEY=your_openai_api_key_here
   ```

4. **Update the cron job URLs**
   ```sql
   -- Replace 'YOUR_PROJECT_REF' with your actual Supabase project reference
   UPDATE cron.job
   SET command = replace(command, 'YOUR_PROJECT_REF', 'your-actual-project-ref')
   WHERE jobname IN ('daily-gsc-ingest', 'hourly-url-processing', 'weekly-ctr-recalibration');
   ```

## Monitoring and Troubleshooting

To monitor cron job execution:

1. **View scheduled tasks**
   ```sql
   SELECT * FROM pageperfect_task_schedule ORDER BY created_at DESC LIMIT 20;
   ```

2. **Check processing events**
   ```sql
   SELECT * FROM pageperfect_processing_events 
   WHERE created_at > NOW() - INTERVAL '24 hours'
   ORDER BY created_at DESC;
   ```

3. **Manually trigger cron jobs**
   ```bash
   # Trigger GSC data ingestion for a specific date
   curl https://YOUR_PROJECT_REF.supabase.co/functions/v1/pageperfect-cron-ingest-gsc \
     -H "Content-Type: application/json" \
     -d '{"date":"2025-04-30","cronSecret":"your_secret_here"}'
   
   # Process URLs
   curl https://YOUR_PROJECT_REF.supabase.co/functions/v1/pageperfect-cron-process-urls \
     -H "Content-Type: application/json" \
     -d '{"limit":10,"olderThan":"2 days","cronSecret":"your_secret_here"}'
   
   # Recalibrate CTR curve
   curl https://YOUR_PROJECT_REF.supabase.co/functions/v1/pageperfect-cron-recalibrate-ctr \
     -H "Content-Type: application/json" \
     -d '{"lookbackDays":30,"cronSecret":"your_secret_here"}'
   ```

## Security Considerations

- Cron jobs use a secure secret for authentication
- Service role key is used for internal function calls
- All database operations use RLS or security definer functions
- Sensitive parameters are stored securely in environment variables

## Extending the System

To add new cron jobs:

1. Create a new edge function to handle the job
2. Add authentication using the `getCronSecret` pattern
3. Add a new scheduled job in the database:
   ```sql
   SELECT cron.schedule('job-name', 'cron-schedule', $$
     SELECT http_post('function-url', '{"params":"here"}', 'application/json', 
       ARRAY['Authorization: Bearer ' || current_setting('app.settings.service_token', true)]);
   $$);
   ```
4. Update the deployment script to include the new function