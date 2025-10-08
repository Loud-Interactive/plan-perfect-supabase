import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { corsHeaders } from '../_shared/cors.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

interface RequestBody {
  urls: string[];
  batchSize?: number;
  clientId?: string;
  projectId?: string;
  premium?: boolean;
  ultraPremium?: boolean;
  render?: boolean;
  timeout?: number;
  enableAnalysis?: boolean;
}

interface ResponseData {
  success: boolean;
  batchId?: string;
  error?: string;
  message?: string;
}

interface UrlStatus {
  url: string;
  status: 'pending' | 'processing' | 'completed' | 'error';
  errormessage?: string;
  html?: string;
  analysis?: any;
  html_length?: number;
  created_at: string;
  updated_at: string;
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
    const { urls, batchSize = 10, clientId, projectId, premium, ultraPremium, render, timeout, enableAnalysis } = requestBody

    if (!urls || !Array.isArray(urls) || urls.length === 0) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'A valid array of URLs is required',
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 400,
        }
      )
    }

    // Generate a batch ID
    const batchId = crypto.randomUUID();
    const timestamp = new Date().toISOString();
    
    // Create batch record in database
    const { error: batchError } = await supabase
      .from('page_perfect_batches')
      .insert({
        id: batchId,
        total_urls: urls.length,
        processed_urls: 0,
        successful_urls: 0,
        failed_urls: 0,
        client_id: clientId,
        project_id: projectId,
        status: 'pending',
        created_at: timestamp,
        updated_at: timestamp,
        config: {
          premium: premium || false,
          ultraPremium: ultraPremium || false,
          render: render !== false,
          timeout: timeout || 60000,
          enableAnalysis: enableAnalysis || false
        }
      });
      
    if (batchError) {
      throw new Error(`Failed to create batch: ${batchError.message}`);
    }
    
    // Prepare URL status records
    const urlStatusRecords: UrlStatus[] = urls.map(url => ({
      url,
      status: 'pending',
      created_at: timestamp,
      updated_at: timestamp
    }));
    
    // Insert URL status records
    const { error: urlStatusError } = await supabase
      .from('page_perfect_url_status')
      .insert(
        urlStatusRecords.map(status => ({
          ...status,
          batch_id: batchId
        }))
      );
      
    if (urlStatusError) {
      throw new Error(`Failed to create URL status records: ${urlStatusError.message}`);
    }
    
    // Start processing the first batch in the background
    processBatch(batchId, batchSize)
      .catch(error => console.error(`Error starting batch ${batchId}: ${error.message}`));
    
    // Return success response with batch ID
    return new Response(
      JSON.stringify({
        success: true,
        batchId,
        message: `Successfully created batch with ${urls.length} URLs. Processing has started.`
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

// Process a batch of URLs
async function processBatch(batchId: string, batchSize: number) {
  try {
    // Update batch status to processing
    await supabase
      .from('page_perfect_batches')
      .update({ status: 'processing', updated_at: new Date().toISOString() })
      .eq('id', batchId);
    
    // Get batch configuration
    const { data: batchData, error: batchError } = await supabase
      .from('page_perfect_batches')
      .select('*')
      .eq('id', batchId)
      .single();
      
    if (batchError || !batchData) {
      throw new Error(`Failed to get batch data: ${batchError?.message || 'Batch not found'}`);
    }
    
    const config = batchData.config || {};
    
    // Get pending URLs
    const { data: pendingUrls, error: pendingError } = await supabase
      .from('page_perfect_url_status')
      .select('*')
      .eq('batch_id', batchId)
      .eq('status', 'pending')
      .limit(batchSize);
      
    if (pendingError) {
      throw new Error(`Failed to get pending URLs: ${pendingError.message}`);
    }
    
    // If no pending URLs, check if we're done
    if (!pendingUrls || pendingUrls.length === 0) {
      const { data: statusCounts, error: countError } = await supabase
        .from('page_perfect_url_status')
        .select('status, count(*)')
        .eq('batch_id', batchId)
        .group('status');
        
      if (countError) {
        throw new Error(`Failed to get status counts: ${countError.message}`);
      }
      
      // Calculate counts
      const counts = {
        pending: 0,
        processing: 0,
        completed: 0,
        error: 0
      };
      
      statusCounts.forEach((item: any) => {
        counts[item.status] = item.count;
      });
      
      // Update batch status based on counts
      const totalProcessed = counts.completed + counts.error;
      const batchStatus = counts.pending + counts.processing > 0 ? 'processing' : 'completed';
      
      await supabase
        .from('page_perfect_batches')
        .update({
          status: batchStatus,
          processed_urls: totalProcessed,
          successful_urls: counts.completed,
          failed_urls: counts.error,
          updated_at: new Date().toISOString()
        })
        .eq('id', batchId);
      
      if (batchStatus === 'completed') {
        console.log(`Batch ${batchId} completed: ${counts.completed} successful, ${counts.error} failed`);
        return;
      }
    }
    
    // Process each URL in the batch
    for (const urlRecord of pendingUrls || []) {
      // Mark URL as processing
      await supabase
        .from('page_perfect_url_status')
        .update({
          status: 'processing',
          updated_at: new Date().toISOString()
        })
        .eq('id', urlRecord.id);
      
      try {
        // Fetch HTML using scraper-api-fetch Edge Function
        const scraperResponse = await fetch(`${supabaseUrl}/functions/v1/scraper-api-fetch`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${supabaseServiceKey}`
          },
          body: JSON.stringify({
            url: urlRecord.url,
            premium: config.premium,
            ultraPremium: config.ultraPremium,
            render: config.render,
            timeout: config.timeout
          })
        });
        
        const scraperData = await scraperResponse.json();
        
        if (!scraperData.success) {
          throw new Error(scraperData.error || 'HTML fetch failed');
        }
        
        const html = scraperData.html;
        let analysis = null;
        
        // If analysis is enabled, analyze the HTML
        if (config.enableAnalysis) {
          const analyzeResponse = await fetch(`${supabaseUrl}/functions/v1/analyze-html-content`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${supabaseServiceKey}`
            },
            body: JSON.stringify({
              html,
              url: urlRecord.url
            })
          });
          
          const analyzeData = await analyzeResponse.json();
          
          if (analyzeData.success) {
            analysis = analyzeData.analysis;
          }
        }
        
        // Mark URL as completed
        await supabase
          .from('page_perfect_url_status')
          .update({
            status: 'completed',
            html,
            html_length: html.length,
            analysis,
            updated_at: new Date().toISOString()
          })
          .eq('id', urlRecord.id);
          
      } catch (error) {
        console.error(`Error processing URL ${urlRecord.url}: ${error.message}`);
        
        // Mark URL as error
        await supabase
          .from('page_perfect_url_status')
          .update({
            status: 'error',
            errormessage: error.message,
            updated_at: new Date().toISOString()
          })
          .eq('id', urlRecord.id);
      }
    }
    
    // Update batch statistics
    const { data: statusCounts, error: countError } = await supabase
      .from('page_perfect_url_status')
      .select('status, count(*)')
      .eq('batch_id', batchId)
      .group('status');
      
    if (countError) {
      throw new Error(`Failed to get status counts: ${countError.message}`);
    }
    
    // Calculate counts
    const counts = {
      pending: 0,
      processing: 0,
      completed: 0,
      error: 0
    };
    
    statusCounts.forEach((item: any) => {
      counts[item.status] = item.count;
    });
    
    // Update batch status based on counts
    const totalProcessed = counts.completed + counts.error;
    const totalUrls = totalProcessed + counts.pending + counts.processing;
    const batchStatus = counts.pending + counts.processing > 0 ? 'processing' : 'completed';
    
    await supabase
      .from('page_perfect_batches')
      .update({
        status: batchStatus,
        processed_urls: totalProcessed,
        successful_urls: counts.completed,
        failed_urls: counts.error,
        updated_at: new Date().toISOString()
      })
      .eq('id', batchId);
    
    // If there are more pending URLs and we're not done, process the next batch
    if (counts.pending > 0 && batchStatus === 'processing') {
      // Continue with the next batch
      setTimeout(() => {
        processBatch(batchId, batchSize)
          .catch(error => console.error(`Error processing batch ${batchId}: ${error.message}`));
      }, 1000); // Small delay to prevent too rapid processing
    }
    
  } catch (error) {
    console.error(`Error processing batch ${batchId}: ${error.message}`);
    
    // Update batch status to error
    await supabase
      .from('page_perfect_batches')
      .update({
        status: 'error',
        updated_at: new Date().toISOString()
      })
      .eq('id', batchId);
  }
}