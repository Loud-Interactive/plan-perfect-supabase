// PagePerfect: fetch-function-logs
// Function to fetch logs from Supabase Edge Functions
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { corsHeaders } from '../_shared/cors.ts';

interface RequestBody {
  functionName: string;
  limit?: number;
  batchId?: string;
  url?: string;
}

// List of valid function names for safer queries
const validFunctions = [
  'pageperfect-workflow',
  'analyze-content',
  'crawl-page-html',
  'protected-site-scraper',
  'scraper-api-fetch',
  'pageperfect-batch-processor'
];

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Get Supabase service role key from environment
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseServiceKey) {
      throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set');
    }

    // Parse request body
    const { functionName, limit = 100, batchId, url } = await req.json() as RequestBody;

    if (!functionName) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Function name is required',
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 400,
        }
      );
    }
    
    // Validate function name for security
    if (!validFunctions.includes(functionName)) {
      return new Response(
        JSON.stringify({
          success: false,
          error: `Invalid function name: ${functionName}. Valid functions are: ${validFunctions.join(', ')}`,
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 400,
        }
      );
    }

    // Construct log filtering query
    let logQuery = `function_id eq ${functionName}`;
    
    // Add additional filters if provided
    if (batchId) {
      logQuery += ` and request_body cs "${batchId}"`;
    }
    
    if (url) {
      // Escape quotes in URL
      const escapedUrl = url.replace(/"/g, '\\"');
      logQuery += ` and request_body cs "${escapedUrl}"`;
    }

    console.log(`Fetching logs with query: ${logQuery}`);

    // Fetch logs from Supabase
    const response = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/logs?limit=${limit}&query=${encodeURIComponent(logQuery)}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${supabaseServiceKey}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to fetch logs: ${response.status} ${response.statusText} - ${errorText}`);
    }

    const logs = await response.json();

    // Process logs to extract relevant information
    const processedLogs = logs.map(log => {
      // Try to parse request body and response body as JSON
      let requestBody = {};
      let responseBody = {};
      let error = null;

      try {
        if (log.request_body) {
          requestBody = JSON.parse(log.request_body);
        }
      } catch (e) {
        // Ignore parsing errors
      }

      try {
        if (log.response_body) {
          responseBody = JSON.parse(log.response_body);
          
          // Extract error information if present
          if (!responseBody.success && responseBody.error) {
            error = responseBody.error;
          }
        }
      } catch (e) {
        // Ignore parsing errors
      }

      return {
        id: log.id,
        functionName: log.function_id,
        timestamp: log.created_at,
        method: log.method,
        status: log.status_code,
        executionTime: log.execution_time_ms,
        requestBody,
        error,
        message: log.message || null,
        // Include full response details only if there was an error
        responseDetails: error ? responseBody : null
      };
    });

    return new Response(
      JSON.stringify({
        success: true,
        logs: processedLogs,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error(`Error: ${error.message}`);
    
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      }
    );
  }
});