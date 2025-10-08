// PagePerfect: pageperfect-workflow
// Function to orchestrate the entire PagePerfect workflow
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface RequestBody {
  url?: string;
  pageId?: string;
  skipSteps?: string[];
  forceUpdate?: boolean;
  openaiApiKey?: string;
  
  // Additional ScraperAPI parameters
  premium?: boolean;
  ultraPremium?: boolean;
  render?: boolean;
  timeout?: number;
}

interface WorkflowStep {
  name: string;
  function: string;
  depends: string[];
  params: (data: any) => any;
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
      url, 
      pageId, 
      skipSteps = [], 
      forceUpdate = false, 
      openaiApiKey,
      premium = false,
      ultraPremium = false,
      render = true,
      timeout = 60000
    } = await req.json() as RequestBody;

    // Use API key from request or environment variable
    const apiKey = openaiApiKey || Deno.env.get('OPENAI_API_KEY');
    if (!apiKey) {
      throw new Error('OpenAI API key is required');
    }

    // Require either URL or pageId
    if (!url && !pageId) {
      throw new Error('Either url or pageId is required');
    }

    console.log(`Starting PagePerfect workflow for ${url ? 'URL: ' + url : 'pageId: ' + pageId}`);

    // Find or create the page
    let page;
    
    if (pageId) {
      // Use existing page
      const { data, error } = await supabaseClient
        .from('pages')
        .select('id, url, last_crawled')
        .eq('id', pageId)
        .single();
        
      if (error || !data) {
        throw new Error(`Page not found: ${error?.message || 'No data returned'}`);
      }
      
      page = data;
    } else if (url) {
      // Find or create page for the URL
      const { data, error } = await supabaseClient
        .from('pages')
        .select('id, url, last_crawled')
        .eq('url', url)
        .maybeSingle();
        
      if (error) {
        throw new Error(`Error checking for existing page: ${error.message}`);
      }
      
      if (data) {
        page = data;
      } else {
        // Create new page
        const { data: newPage, error: createError } = await supabaseClient
          .from('pages')
          .insert({ url })
          .select()
          .single();
          
        if (createError || !newPage) {
          throw new Error(`Error creating page: ${createError?.message || 'No data returned'}`);
        }
        
        page = newPage;
      }
    }

    // Define workflow steps
    const workflowSteps: WorkflowStep[] = [
      {
        name: 'crawl',
        function: 'submit-crawl-job',
        depends: [],
        params: () => ({ 
          url: page.url,
          pageId: page.id,
          premium,
          ultraPremium,
          render
        })
      },
      {
        name: 'waitForCrawl',
        function: 'wait-for-crawl-job',
        depends: ['crawl'],
        params: (data) => ({ 
          jobId: data.crawl.jobId,
          maxWaitTimeMs: 300000 // 5 minute maximum wait time
        })
      },
      {
        name: 'embed',
        function: 'segment-and-embed-page',
        depends: ['waitForCrawl'],
        params: () => ({ pageId: page.id, openaiApiKey: apiKey })
      },
      {
        name: 'cluster',
        function: 'keyword-clustering',
        depends: ['embed'],
        params: () => ({ pageId: page.id, openaiApiKey: apiKey })
      },
      {
        name: 'analyze',
        function: 'content-gap-analysis',
        depends: ['embed', 'cluster'],
        params: (data) => ({ pageId: page.id, openaiApiKey: apiKey })
      },
      {
        name: 'rewrite',
        function: 'generate-rewrite-draft',
        depends: ['analyze'],
        params: (data) => {
          // Find top gap from analysis
          const topGap = data.analyze?.gapAnalysis?.[0];
          return { 
            pageId: page.id, 
            clusterId: topGap?.clusterId, 
            openaiApiKey: apiKey 
          };
        }
      }
    ];

    // Create record of workflow execution
    const { data: workflowRecord, error: workflowError } = await supabaseClient
      .from('pageperfect_processing_events')
      .insert({
        page_id: page.id,
        event_type: 'workflow_start',
        details: {
          url: page.url,
          skipSteps,
          forceUpdate
        }
      })
      .select()
      .single();

    if (workflowError) {
      console.error(`Error recording workflow start: ${workflowError.message}`);
    }

    // Execute workflow steps
    const results: Record<string, any> = {};
    let success = true;

    for (const step of workflowSteps) {
      // Skip if in skipSteps
      if (skipSteps.includes(step.name)) {
        console.log(`Skipping step: ${step.name}`);
        continue;
      }
      
      // Check dependencies
      let dependenciesMet = true;
      for (const dep of step.depends) {
        if (!results[dep] && !skipSteps.includes(dep)) {
          dependenciesMet = false;
          console.error(`Dependency not met: ${dep} for step ${step.name}`);
        }
      }
      
      if (!dependenciesMet) {
        success = false;
        break;
      }
      
      // Check if step needs to be executed
      let shouldExecute = forceUpdate;
      
      if (!shouldExecute) {
        // Check if step was recently executed
        const { data: recentExecution } = await supabaseClient
          .from('pageperfect_processing_events')
          .select('created_at')
          .eq('page_id', page.id)
          .eq('event_type', `${step.name}_complete`)
          .gt('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()) // Last 24 hours
          .order('created_at', { ascending: false })
          .limit(1);
          
        shouldExecute = !recentExecution || recentExecution.length === 0;
      }
      
      if (!shouldExecute) {
        console.log(`Skipping step (recently executed): ${step.name}`);
        
        // Get previous results
        const { data: prevResult } = await supabaseClient
          .from('pageperfect_processing_events')
          .select('details')
          .eq('page_id', page.id)
          .eq('event_type', `${step.name}_complete`)
          .order('created_at', { ascending: false })
          .limit(1);
          
        if (prevResult && prevResult.length > 0) {
          results[step.name] = prevResult[0].details.result;
        }
        
        continue;
      }
      
      try {
        console.log(`Executing step: ${step.name}`);
        
        // Record step start
        await supabaseClient
          .from('pageperfect_processing_events')
          .insert({
            page_id: page.id,
            event_type: `${step.name}_start`,
            details: { params: step.params(results) }
          });
        
        // Execute step with timeout
        let stepTimeout = 180000; // Default: 3 minutes
        
        // Set timeouts based on step type
        if (step.name === 'analyze') {
          stepTimeout = 240000; // 4 minutes for analyze step
        } else if (step.name === 'crawl') {
          stepTimeout = 300000; // 5 minutes for crawl step (ScraperAPI)
        }
        
        // Create fetch promise
        const fetchPromise = fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/${step.function}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`
          },
          body: JSON.stringify(step.params(results))
        });
        
        // Create timeout promise
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => {
            reject(new Error(`Step ${step.name} timed out after ${stepTimeout/1000} seconds`));
          }, stepTimeout);
        });
        
        // Race the promises
        const response = await Promise.race([fetchPromise, timeoutPromise]) as Response;
        
        // Get response text
        const responseText = await response.text();
        
        if (!response.ok) {
          throw new Error(`Step ${step.name} failed with status ${response.status}: ${responseText}`);
        }
        
        // Try to parse the response as JSON
        const result = JSON.parse(responseText);
        results[step.name] = result;
        
        // Record step completion
        await supabaseClient
          .from('pageperfect_processing_events')
          .insert({
            page_id: page.id,
            event_type: `${step.name}_complete`,
            details: { result }
          });
        
      } catch (error) {
        console.error(`Error in step ${step.name}:`, error);
        
        // Record step failure
        await supabaseClient
          .from('pageperfect_processing_events')
          .insert({
            page_id: page.id,
            event_type: `${step.name}_error`,
            details: { error: error instanceof Error ? error.message : 'Unknown error' }
          });
        
        success = false;
        break;
      }
    }

    // Record workflow completion
    await supabaseClient
      .from('pageperfect_processing_events')
      .insert({
        page_id: page.id,
        event_type: success ? 'workflow_complete' : 'workflow_error',
        details: { results }
      });

    // Return success response
    return new Response(
      JSON.stringify({
        success,
        message: success ? 'Workflow completed successfully' : 'Workflow completed with errors',
        pageId: page.id,
        url: page.url,
        results
      }),
      {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      }
    );
  } catch (error) {
    // Log the error for debugging
    console.error(`PagePerfect workflow error:`, error);
    
    // Format a more detailed error message
    let errorMessage = error instanceof Error ? error.message : 'Unknown error';
    let errorDetails = null;
    
    // Attempt to extract more details if it's an API response error
    if (error instanceof Error && 'cause' in error) {
      try {
        // @ts-ignore
        errorDetails = error.cause;
      } catch (e) {
        // Ignore parsing errors
      }
    }
    
    // Return error response with more details
    return new Response(
      JSON.stringify({
        success: false,
        error: errorMessage,
        errorDetails: errorDetails,
        errorType: error.constructor.name,
        // Include stack trace in development only
        stack: Deno.env.get('ENVIRONMENT') === 'development' ? error.stack : undefined
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