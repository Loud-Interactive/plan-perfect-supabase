import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

serve(async (req) => {
  try {
    // Initialize Supabase client with service role key for admin rights
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') || '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
    )
    
    // Fetch all content plans that have content_plan_table data
    const { data: contentPlans, error: fetchError } = await supabaseClient
      .from('content_plans')
      .select('guid, content_plan_table')
      .not('content_plan_table', 'is', null)
    
    if (fetchError) {
      throw new Error(`Failed to fetch content plans: ${fetchError.message}`)
    }
    
    console.log(`Found ${contentPlans.length} content plans to process`)
    
    if (contentPlans.length === 0) {
      return new Response(
        JSON.stringify({ 
          success: true, 
          message: 'No content plans found to process' 
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    }
    
    // Process each content plan
    const results = []
    const errors = []
    
    for (const plan of contentPlans) {
      try {
        console.log(`Processing content plan ID: ${plan.guid}`)
        
        // Call the process-content-plan function for each content plan
        const response = await fetch(
          'https://jsypctdhynsdqrfifvdh.supabase.co/functions/v1/process-content-plan',
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpzeXBjdGRoeW5zZHFyZmlmdmRoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDA2OTIwMzIsImV4cCI6MjA1NjI2ODAzMn0.2QxOFFLzmp6VByWImiw6zDz3rWy-5hsvEHw3EMemIKY'
            },
            body: JSON.stringify({ content_plan_id: plan.guid })
          }
        )
        
        const result = await response.json()
        
        if (!response.ok) {
          throw new Error(`Failed to process content plan ID ${plan.guid}: ${result.error || 'Unknown error'}`)
        }
        
        results.push({ guid: plan.guid, success: true })
        console.log(`Successfully processed content plan ID: ${plan.guid}`)
        
        // Add a small delay to avoid rate limits
        await new Promise(resolve => setTimeout(resolve, 500))
        
      } catch (error) {
        console.error(`Error processing content plan ID ${plan.guid}:`, error)
        errors.push({ guid: plan.guid, error: error.message })
      }
    }
    
    return new Response(
      JSON.stringify({ 
        success: true, 
        message: `Processed ${results.length} content plans with ${errors.length} errors`, 
        results,
        errors
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
    
  } catch (error) {
    console.error('Error processing all content plans:', error)
    
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error.message 
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}) 