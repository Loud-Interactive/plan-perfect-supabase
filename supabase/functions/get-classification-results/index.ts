import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { logError } from '../utils/error-handling.ts';

const FUNCTION_NAME = 'get-classification-results';
const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 1000;

serve(async (req) => {
  // Handle preflight OPTIONS request
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: corsHeaders,
    });
  }

  // Only GET method is supported
  if (req.method !== 'GET') {
    return new Response(
      JSON.stringify({ error: 'Method not allowed' }),
      {
        status: 405,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }

  try {
    // Get environment variables
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    
    // Create Supabase client
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    // Parse URL for query parameters
    const url = new URL(req.url);
    const jobId = url.searchParams.get('jobId');
    const format = url.searchParams.get('format') || 'json';
    const page = parseInt(url.searchParams.get('page') || '1');
    const pageSize = Math.min(
      parseInt(url.searchParams.get('pageSize') || String(DEFAULT_PAGE_SIZE)), 
      MAX_PAGE_SIZE
    );
    const relevantOnly = url.searchParams.get('relevantOnly') === 'true';
    const keyword = url.searchParams.get('keyword');
    const category = url.searchParams.get('category');
    const businessModel = url.searchParams.get('businessModel');
    
    // Get user authentication from request
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Missing authorization header' }),
        {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // Extract JWT token
    const token = authHeader.replace('Bearer ', '');
    
    // Verify the token and get user information
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized: Invalid token' }),
        {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }
    
    // Validate jobId
    if (!jobId) {
      return new Response(
        JSON.stringify({ error: 'Job ID is required' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }
    
    // Verify the job belongs to the user
    const { data: job, error: jobError } = await supabase
      .from('classification_jobs')
      .select('id, domain, status, progress, total_batches, created_at, error')
      .eq('id', jobId)
      .eq('user_id', user.id)
      .single();
      
    if (jobError || !job) {
      return new Response(
        JSON.stringify({ error: 'Job not found or access denied' }),
        {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }
    
    // Build query for results
    let query = supabase
      .from('classification_results')
      .select('id, created_at, batch_data')
      .eq('job_id', jobId);
    
    // Apply filters if provided
    if (relevantOnly) {
      query = query.filter('batch_data->relevant', 'eq', 'Yes');
    }
    
    if (keyword) {
      query = query.ilike('batch_data->keyword', `%${keyword}%`);
    }
    
    if (category) {
      query = query.or(`batch_data->primary.ilike.%${category}%,batch_data->secondary.ilike.%${category}%,batch_data->tertiary.ilike.%${category}%`);
    }
    
    if (businessModel) {
      query = query.ilike('batch_data->business_relationship_model', `%${businessModel}%`);
    }
    
    // Add pagination
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;
    
    // Execute the query
    const { data: results, error: resultsError, count } = await query
      .range(from, to)
      .order('created_at', { ascending: true })
      .select('batch_data')
      .count('exact');
      
    if (resultsError) {
      console.error('Error fetching results:', resultsError);
      await logError(FUNCTION_NAME, jobId, new Error(`Error fetching results: ${resultsError.message}`));
      
      return new Response(
        JSON.stringify({ error: `Error fetching results: ${resultsError.message}` }),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }
    
    // Format results based on requested output format
    if (format === 'csv') {
      // Generate CSV
      const csvHeader = 'Keyword,Primary,Secondary,Tertiary,Relevant,Reasoning,BusinessRelationshipModel\n';
      const csvRows = results.map(row => {
        const data = row.batch_data;
        return [
          `"${data.keyword?.replace(/"/g, '""') || ''}"`,
          `"${data.primary?.replace(/"/g, '""') || ''}"`,
          `"${data.secondary?.replace(/"/g, '""') || ''}"`,
          `"${data.tertiary?.replace(/"/g, '""') || ''}"`,
          `"${data.relevant || ''}"`,
          `"${data.reasoning?.replace(/"/g, '""') || ''}"`,
          `"${data.business_relationship_model?.replace(/"/g, '""') || ''}"`
        ].join(',');
      }).join('\n');
      
      const csvContent = csvHeader + csvRows;
      
      return new Response(csvContent, {
        status: 200,
        headers: { 
          ...corsHeaders, 
          'Content-Type': 'text/csv',
          'Content-Disposition': `attachment; filename="classification-results-${jobId}.csv"`
        },
      });
    } else {
      // Return JSON response
      const processedResults = results.map(row => row.batch_data);
      
      return new Response(
        JSON.stringify({
          job: {
            id: job.id,
            domain: job.domain,
            status: job.status,
            progress: job.progress,
            totalBatches: job.total_batches,
            createdAt: job.created_at,
            error: job.error
          },
          results: processedResults,
          pagination: {
            page,
            pageSize,
            totalCount: count || 0,
            totalPages: count ? Math.ceil(count / pageSize) : 0
          },
          filters: {
            relevantOnly: relevantOnly || false,
            keyword: keyword || null,
            category: category || null,
            businessModel: businessModel || null
          }
        }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }
  } catch (error) {
    console.error('Error retrieving classification results:', error);
    await logError(FUNCTION_NAME, null, error instanceof Error ? error : new Error(String(error)));
    
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});