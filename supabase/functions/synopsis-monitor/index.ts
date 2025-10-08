import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

const supabaseUrl = Deno.env.get('SUPABASE_URL')!
const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const supabase = createClient(supabaseUrl, supabaseKey)

interface MonitorResult {
  jobs_checked: number
  jobs_fixed: number
  actions_taken: Array<{
    job_id: string
    domain: string
    issue: string
    action: string
    result: string
  }>
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const result: MonitorResult = {
      jobs_checked: 0,
      jobs_fixed: 0,
      actions_taken: []
    }

    // 1. Check for jobs with page count mismatches
    const { data: processingJobs } = await supabase
      .from('synopsis_jobs')
      .select(`
        *,
        synopsis_page_tasks!inner(
          id,
          status
        )
      `)
      .eq('status', 'processing')
      .lt('updated_at', new Date(Date.now() - 2 * 60 * 1000).toISOString()) // Jobs not updated in 2 minutes

    if (processingJobs) {
      for (const job of processingJobs) {
        result.jobs_checked++
        
        // Count actual completed pages
        const completedTasks = job.synopsis_page_tasks.filter(
          (task: any) => task.status === 'completed'
        ).length
        
        // Check if count is wrong
        if (completedTasks !== job.completed_pages) {
          console.log(`Job ${job.id}: Fixing count mismatch (DB: ${job.completed_pages}, Actual: ${completedTasks})`)
          
          // Update the count
          await supabase
            .from('synopsis_jobs')
            .update({ 
              completed_pages: completedTasks,
              updated_at: new Date().toISOString()
            })
            .eq('id', job.id)
          
          result.jobs_fixed++
          result.actions_taken.push({
            job_id: job.id,
            domain: job.domain,
            issue: 'page_count_mismatch',
            action: 'updated_count',
            result: `Updated from ${job.completed_pages} to ${completedTasks}`
          })
        }
        
        // Check if all pages are done but analysis hasn't started
        if (completedTasks >= job.total_pages && job.total_pages > 0) {
          console.log(`Job ${job.id}: All pages completed, triggering analyzer`)
          
          // Trigger the analyzer
          const analyzerResponse = await fetch(`${supabaseUrl}/functions/v1/synopsis-analyzer`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${supabaseKey}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ job_id: job.id })
          })
          
          if (analyzerResponse.ok) {
            result.actions_taken.push({
              job_id: job.id,
              domain: job.domain,
              issue: 'pages_completed_analyzer_not_triggered',
              action: 'triggered_analyzer',
              result: 'success'
            })
          } else {
            result.actions_taken.push({
              job_id: job.id,
              domain: job.domain,
              issue: 'pages_completed_analyzer_not_triggered',
              action: 'triggered_analyzer',
              result: `failed: ${await analyzerResponse.text()}`
            })
          }
        }
      }
    }

    // 2. Check for jobs stuck in analyzing phase
    const { data: analyzingJobs } = await supabase
      .from('synopsis_jobs')
      .select(`
        *,
        synopsis_analysis_tasks!inner(
          id,
          status
        )
      `)
      .eq('status', 'analyzing')
      .lt('updated_at', new Date(Date.now() - 5 * 60 * 1000).toISOString()) // Jobs not updated in 5 minutes

    if (analyzingJobs) {
      for (const job of analyzingJobs) {
        result.jobs_checked++
        
        // Check if analysis tasks are done
        const completedAnalyses = job.synopsis_analysis_tasks.filter(
          (task: any) => task.status === 'completed'
        ).length
        
        // If we have some completed analyses, try to finalize
        if (completedAnalyses > 0) {
          console.log(`Job ${job.id}: Has ${completedAnalyses} completed analyses, triggering finalizer`)
          
          const finalizerResponse = await fetch(`${supabaseUrl}/functions/v1/synopsis-finalizer`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${supabaseKey}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ job_id: job.id })
          })
          
          if (finalizerResponse.ok) {
            result.jobs_fixed++
            result.actions_taken.push({
              job_id: job.id,
              domain: job.domain,
              issue: 'stuck_in_analyzing',
              action: 'triggered_finalizer',
              result: `success with ${completedAnalyses} analyses`
            })
          }
        }
      }
    }

    // 3. Check for very old pending jobs (likely abandoned)
    const { data: oldJobs } = await supabase
      .from('synopsis_jobs')
      .select('*')
      .in('status', ['pending', 'processing'])
      .lt('created_at', new Date(Date.now() - 30 * 60 * 1000).toISOString()) // Jobs older than 30 minutes

    if (oldJobs) {
      for (const job of oldJobs) {
        console.log(`Job ${job.id}: Marking as failed due to timeout`)
        
        await supabase
          .from('synopsis_jobs')
          .update({
            status: 'failed',
            error_message: 'Job timed out after 30 minutes',
            updated_at: new Date().toISOString()
          })
          .eq('id', job.id)
        
        result.jobs_fixed++
        result.actions_taken.push({
          job_id: job.id,
          domain: job.domain,
          issue: 'job_timeout',
          action: 'marked_as_failed',
          result: 'Job exceeded 30 minute timeout'
        })
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: `Checked ${result.jobs_checked} jobs, fixed ${result.jobs_fixed}`,
        ...result
      }),
      { 
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    )
  } catch (error) {
    console.error('Error in synopsis-monitor:', error)
    return new Response(
      JSON.stringify({ 
        success: false,
        error: error.message 
      }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    )
  }
})