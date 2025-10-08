import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { corsHeaders } from '../_shared/cors.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

interface RequestBody {
  batchId: string;
  urlIds?: string[]; // Optional specific URL IDs to retry, otherwise retry all failed URLs
  premium?: boolean;
  ultraPremium?: boolean;
  timeout?: number;
}

interface ResponseData {
  success: boolean;
  message?: string;
  retriedCount?: number;
  error?: string;
}

// Get Supabase client
const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const supabase = createClient(supabaseUrl, supabaseServiceKey);

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Parse request body
    const requestBody: RequestBody = await req.json()
    const { batchId, urlIds, premium, ultraPremium, timeout } = requestBody

    if (!batchId) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Batch ID is required',
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 400,
        }
      )
    }
    
    // Get batch data
    const { data: batchData, error: batchError } = await supabase
      .from('page_perfect_batches')
      .select('*')
      .eq('id', batchId)
      .single();
      
    if (batchError) {
      return new Response(
        JSON.stringify({
          success: false,
          error: `Batch not found: ${batchError.message}`,
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 404,
        }
      )
    }
    
    // Get URLs to retry
    let query = supabase
      .from('page_perfect_url_status')
      .select('id')
      .eq('batch_id', batchId)
      .eq('status', 'error');
      
    if (urlIds && urlIds.length > 0) {
      query = query.in('id', urlIds);
    }
    
    const { data: urlsToRetry, error: urlsError } = await query;
    
    if (urlsError) {
      throw new Error(`Failed to fetch URLs to retry: ${urlsError.message}`);
    }
    
    if (!urlsToRetry || urlsToRetry.length === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          message: 'No URLs found to retry',
          retriedCount: 0
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      )
    }
    
    // Update the config with new settings if provided
    const config = {
      ...batchData.config,
      premium: premium !== undefined ? premium : batchData.config.premium,
      ultraPremium: ultraPremium !== undefined ? ultraPremium : batchData.config.ultraPremium,
      timeout: timeout !== undefined ? timeout : batchData.config.timeout
    };
    
    // Update batch status
    await supabase
      .from('page_perfect_batches')
      .update({
        status: 'processing',
        config,
        updated_at: new Date().toISOString()
      })
      .eq('id', batchId);
    
    // Reset URLs status to pending
    const urlIds = urlsToRetry.map(item => item.id);
    const { error: resetError } = await supabase
      .from('page_perfect_url_status')
      .update({
        status: 'pending',
        errormessage: null,
        updated_at: new Date().toISOString()
      })
      .in('id', urlIds);
      
    if (resetError) {
      throw new Error(`Failed to reset URL status: ${resetError.message}`);
    }
    
    // Start processing in the background
    fetch(`${supabaseUrl}/functions/v1/bulk-process-urls`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${supabaseServiceKey}`
      },
      body: JSON.stringify({
        batchId,
        batchSize: 10 // Default batch size
      })
    }).catch(error => console.error(`Error starting retry processing: ${error.message}`));
    
    return new Response(
      JSON.stringify({
        success: true,
        message: `Retrying ${urlsToRetry.length} URLs`,
        retriedCount: urlsToRetry.length
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
    
  } catch (error) {
    console.error(`Error: ${error.message}`);
    
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500
      }
    );
  }
});