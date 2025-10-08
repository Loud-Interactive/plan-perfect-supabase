// cron-update-indexation
// Cron job to update indexation status for pages in page_seo_recommendations
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';
import { logError } from '../utils/error-handling.ts';

// CORS headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Default batch size
const DEFAULT_BATCH_SIZE = 30;

// Default frequency settings in days
const DEFAULT_FREQUENCY = {
  highPriority: 7,     // Check high-priority pages weekly
  mediumPriority: 14,  // Check medium-priority pages every 2 weeks
  lowPriority: 30      // Check low-priority pages monthly
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Create Supabase client
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Parse request body for custom settings
    let customSettings = {};
    try {
      customSettings = await req.json();
    } catch (e) {
      // Use defaults if no JSON provided
      customSettings = {};
    }

    // Merge defaults with custom settings
    const settings = {
      batchSize: customSettings.batchSize || DEFAULT_BATCH_SIZE,
      frequency: {
        ...DEFAULT_FREQUENCY,
        ...customSettings.frequency
      }
    };

    // Verify this is a legitimate cron request or has proper authentication
    // Extract authorization header
    const authHeader = req.headers.get('Authorization');
    const cronSecret = Deno.env.get('CRON_SECRET');
    
    // Check for token in the form of Bearer CRON_SECRET
    if (cronSecret && (!authHeader || authHeader !== `Bearer ${cronSecret}`)) {
      const url = new URL(req.url);
      // Allow specific query parameter for testing
      if (!url.searchParams.get('secret') || url.searchParams.get('secret') !== cronSecret) {
        throw new Error('Unauthorized access to cron job');
      }
    }

    console.log(`Starting indexation status update cron job with batch size ${settings.batchSize}`);

    // 1. Determine priority groups based on various factors
    const priorityGroups = await determinePriorityGroups(supabaseClient, settings);
    
    // 2. Process each priority group
    const results = {
      highPriority: await processUrlGroup(supabaseClient, priorityGroups.highPriority, 'high'),
      mediumPriority: await processUrlGroup(supabaseClient, priorityGroups.mediumPriority, 'medium'),
      lowPriority: await processUrlGroup(supabaseClient, priorityGroups.lowPriority, 'low')
    };

    // 3. Return results summary
    return new Response(
      JSON.stringify({
        success: true,
        message: "Indexation status update cron job completed",
        results
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error(`Error in cron job: ${error.message}`);
    await logError('cron-update-indexation', null, error);
    
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message,
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});

/**
 * Determines priority groups for indexation status updates based on various factors
 */
async function determinePriorityGroups(supabase: any, settings: any) {
  // Calculate cutoff dates for each priority level
  const now = new Date();
  const highPriorityCutoff = new Date(now);
  highPriorityCutoff.setDate(now.getDate() - settings.frequency.highPriority);
  
  const mediumPriorityCutoff = new Date(now);
  mediumPriorityCutoff.setDate(now.getDate() - settings.frequency.mediumPriority);
  
  const lowPriorityCutoff = new Date(now);
  lowPriorityCutoff.setDate(now.getDate() - settings.frequency.lowPriority);

  // Prioritize URLs by various factors (GSC data, traffic, last checked)
  // URLs with GSC data and high impressions/clicks are high priority
  const { data: highPriorityPages, error: highPriorityError } = await supabase
    .from('page_seo_recommendations')
    .select('id, url')
    .or(`keywords.neq.null,has_gsc_data.eq.true`)
    .or(`indexation_last_checked.is.null,indexation_last_checked.lt.${highPriorityCutoff.toISOString()}`)
    .limit(Math.floor(settings.batchSize * 0.5)); // 50% of batch for high priority
  
  if (highPriorityError) {
    console.error(`Error getting high priority pages: ${highPriorityError.message}`);
  }
  
  // Medium priority: Pages with SEO recommendations but not checked recently
  const { data: mediumPriorityPages, error: mediumPriorityError } = await supabase
    .from('page_seo_recommendations')
    .select('id, url')
    .not('id', 'in', highPriorityPages ? highPriorityPages.map(p => p.id) : [])
    .or(`indexation_last_checked.is.null,indexation_last_checked.lt.${mediumPriorityCutoff.toISOString()}`)
    .limit(Math.floor(settings.batchSize * 0.3)); // 30% of batch for medium priority
  
  if (mediumPriorityError) {
    console.error(`Error getting medium priority pages: ${mediumPriorityError.message}`);
  }
  
  // Low priority: Other pages that haven't been checked in a while
  const { data: lowPriorityPages, error: lowPriorityError } = await supabase
    .from('page_seo_recommendations')
    .select('id, url')
    .not('id', 'in', 
      [...(highPriorityPages ? highPriorityPages.map(p => p.id) : []), 
       ...(mediumPriorityPages ? mediumPriorityPages.map(p => p.id) : [])])
    .or(`indexation_last_checked.is.null,indexation_last_checked.lt.${lowPriorityCutoff.toISOString()}`)
    .limit(Math.floor(settings.batchSize * 0.2)); // 20% of batch for low priority
  
  if (lowPriorityError) {
    console.error(`Error getting low priority pages: ${lowPriorityError.message}`);
  }
  
  return {
    highPriority: highPriorityPages || [],
    mediumPriority: mediumPriorityPages || [],
    lowPriority: lowPriorityPages || []
  };
}

/**
 * Processes a group of URLs for indexation status updates
 */
async function processUrlGroup(supabase: any, urls: any[], priority: string) {
  if (!urls || urls.length === 0) {
    console.log(`No ${priority} priority URLs to process`);
    return { processed: 0, message: `No ${priority} priority URLs to process` };
  }
  
  console.log(`Processing ${urls.length} ${priority} priority URLs`);
  
  try {
    // Call the update-seo-indexation-status function
    const response = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/update-seo-indexation-status`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`
      },
      body: JSON.stringify({
        specificUrls: urls.map(u => u.url).filter(Boolean),
        force: true
      })
    });
    
    if (!response.ok) {
      throw new Error(`Error calling update-seo-indexation-status: ${response.status} ${response.statusText}`);
    }
    
    const result = await response.json();
    
    return {
      processed: urls.length,
      successful: result.results?.successful || 0,
      failed: result.results?.failed || 0
    };
  } catch (error) {
    console.error(`Error processing ${priority} priority group: ${error.message}`);
    return { 
      processed: urls.length, 
      error: error.message,
      successful: 0,
      failed: urls.length
    };
  }
}