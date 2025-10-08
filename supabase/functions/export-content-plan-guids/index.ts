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
      .select('guid')
      .not('content_plan_table', 'is', null)
      .order('guid')
    
    if (fetchError) {
      throw new Error(`Failed to fetch content plans: ${fetchError.message}`)
    }
    
    console.log(`Found ${contentPlans.length} content plans to export`)
    
    // Extract just the GUIDs into an array
    const guids = contentPlans.map(plan => plan.guid)
    
    return new Response(
      JSON.stringify(guids),
      { 
        status: 200, 
        headers: { 
          'Content-Type': 'application/json',
          'Content-Disposition': 'attachment; filename="content_plan_guids.json"'
        } 
      }
    )
    
  } catch (error) {
    console.error('Error exporting content plan GUIDs:', error)
    
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error.message 
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}) 