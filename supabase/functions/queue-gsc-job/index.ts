// PagePerfect: queue-gsc-job
// Function to add jobs to the GSC processing queue

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface GSCJobRequest {
  clientId: string;
  siteUrl: string;
  startDate: string;
  endDate: string;
  priority?: number;
  maxAttempts?: number;
  
  // Filtering criteria
  minPosition?: number;
  maxPosition?: number;
  minImpressions?: number;
  minClicks?: number;
  maxKeywordsPerUrl?: number;
  keywordsSortBy?: 'impressions' | 'clicks' | 'position';
  specificUrls?: string[]; // Optional array of specific URLs to query
  additionalFilters?: Record<string, any>;
}

serve(async (req) => {
  // Handle CORS preflight request
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Create Supabase client
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Parse request body
    const { 
      clientId, 
      siteUrl, 
      startDate, 
      endDate, 
      priority = 1, 
      maxAttempts = 3,
      
      // Filtering criteria
      minPosition = null,
      maxPosition = 20, // Default to top 20 results
      minImpressions = null,
      minClicks = null,
      maxKeywordsPerUrl = null,
      keywordsSortBy = 'impressions', // Default sort by impressions
      specificUrls = null, // Optional array of specific URLs to query
      additionalFilters = null
    } = await req.json() as GSCJobRequest;

    // Validate required fields
    if (!clientId || !siteUrl || !startDate || !endDate) {
      throw new Error('clientId, siteUrl, startDate, and endDate are required');
    }

    // Validate date format
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(startDate) || !dateRegex.test(endDate)) {
      throw new Error('Dates must be in YYYY-MM-DD format');
    }

    // Validate priority
    if (priority < 1 || priority > 10) {
      throw new Error('Priority must be between 1 and 10');
    }

    // Validate sort option
    const validSortOptions = ['impressions', 'clicks', 'position'];
    if (!validSortOptions.includes(keywordsSortBy)) {
      throw new Error(`Invalid keywordsSortBy value. Must be one of: ${validSortOptions.join(', ')}`);
    }
    
    // Validate specificUrls if provided
    if (specificUrls !== null && (!Array.isArray(specificUrls) || specificUrls.length === 0)) {
      throw new Error('specificUrls must be an array of URL strings with at least one URL');
    }
    
    // Log filtering criteria
    let filterMsg = `Adding GSC job for client ${clientId}, site ${siteUrl} from ${startDate} to ${endDate}`;
    if (maxPosition !== null) filterMsg += `, max position: ${maxPosition}`;
    if (minPosition !== null) filterMsg += `, min position: ${minPosition}`;
    if (minImpressions !== null) filterMsg += `, min impressions: ${minImpressions}`;
    if (minClicks !== null) filterMsg += `, min clicks: ${minClicks}`;
    if (maxKeywordsPerUrl !== null) filterMsg += `, max keywords per URL: ${maxKeywordsPerUrl} (sorted by ${keywordsSortBy})`;
    if (specificUrls !== null) filterMsg += `, specific URLs: ${specificUrls.length} URLs provided`;
    console.log(filterMsg);

    // Add job to queue
    const { data, error } = await supabaseClient
      .from('gsc_job_queue')
      .insert({
        client_id: clientId,
        site_url: siteUrl,
        start_date: startDate,
        end_date: endDate,
        priority: priority,
        max_attempts: maxAttempts,
        
        // Filtering criteria
        min_position: minPosition,
        max_position: maxPosition,
        min_impressions: minImpressions,
        min_clicks: minClicks,
        max_keywords_per_url: maxKeywordsPerUrl,
        keywords_sort_by: keywordsSortBy,
        specific_urls: specificUrls ? specificUrls : null,
        additional_filters: additionalFilters
      })
      .select('id, created_at');

    if (error) {
      console.error('Error adding job to queue:', error);
      throw new Error(`Failed to add job to queue: ${error.message}`);
    }

    // Return success with job ID
    return new Response(
      JSON.stringify({
        success: true,
        message: 'Job added to queue successfully',
        jobId: data[0].id,
        queuedAt: data[0].created_at
      }),
      {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      }
    );
  } catch (error) {
    console.error('Error in queue-gsc-job:', error);
    
    // Return error response
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
      {
        status: 400,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      }
    );
  }
});