// Supabase Edge Function: execute-section-queries
// Executes search queries for a section and stores the results

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../helpers.ts';
import { 
  handleError, 
  createResponse,
  updateHeartbeat
} from '../content-perfect/utils/index.ts';

const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

// Function to perform web search using Google Search API
async function performWebSearch(query: string, numResults: number = 5) {
  try {
    const apiKey = Deno.env.get('GOOGLE_SEARCH_API_KEY');
    const searchEngineId = Deno.env.get('GOOGLE_SEARCH_ENGINE_ID');
    
    if (!apiKey || !searchEngineId) {
      throw new Error('Google Search API configuration is missing');
    }

    const url = `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${searchEngineId}&q=${encodeURIComponent(query)}&num=${numResults}`;
    
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Google Search API error: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json();
    
    // Extract relevant info from search results
    return (data.items || []).map(item => ({
      title: item.title || '',
      url: item.link || '',
      snippet: item.snippet || '',
      relevance_score: 0.8 // Default score, will be refined in analysis
    }));
  } catch (error) {
    console.error('Error performing web search:', error);
    return [];
  }
}

// Function to fetch content from a URL
async function fetchContentFromUrl(url: string) {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });
    
    if (!response.ok) {
      return '';
    }
    
    const text = await response.text();
    
    // Basic extraction of content - in a production environment,
    // you would use a more sophisticated approach like Readability
    const contentMatch = text.match(/<body[^>]*>([\s\S]*)<\/body>/i);
    if (contentMatch) {
      // Strip HTML tags
      return contentMatch[1].replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .substring(0, 5000); // Limit content length
    }
    
    return '';
  } catch (error) {
    console.error(`Error fetching content from ${url}:`, error);
    return '';
  }
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Create Supabase client
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    // Parse request body
    const requestData = await req.json();
    const { section_id, job_id } = requestData;
    
    if (!section_id || !job_id) {
      return new Response(
        JSON.stringify(createResponse(false, 'Missing required parameters: section_id and job_id')),
        { headers: { ...corsHeaders }, status: 400 }
      );
    }

    // Update job heartbeat
    await updateHeartbeat(supabase, job_id);

    // Get pending search queries for this section
    const { data: queries, error: queriesError } = await supabase
      .from('section_search_queries')
      .select('*')
      .eq('section_id', section_id)
      .eq('status', 'pending')
      .eq('is_deleted', false)
      .order('created_at', { ascending: true })
      .limit(5); // Process 5 queries at a time to avoid timeouts
    
    if (queriesError) {
      await handleError(supabase, queriesError, { section_id, job_id });
      return new Response(
        JSON.stringify(createResponse(false, 'Failed to retrieve search queries')),
        { headers: { ...corsHeaders }, status: 500 }
      );
    }

    if (!queries || queries.length === 0) {
      // Check if all queries are completed
      const { data: allQueries, error: allQueriesError } = await supabase
        .from('section_search_queries')
        .select('status')
        .eq('section_id', section_id)
        .eq('is_deleted', false);
      
      if (allQueriesError) {
        await handleError(supabase, allQueriesError, { section_id, job_id });
        return new Response(
          JSON.stringify(createResponse(false, 'Failed to check query status')),
          { headers: { ...corsHeaders }, status: 500 }
        );
      }

      const pendingQueries = allQueries.filter(q => q.status === 'pending' || q.status === 'processing');
      
      if (pendingQueries.length === 0) {
        // All queries are completed, trigger the analyze step
        try {
          fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/analyze-section-references`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${Deno.env.get('SUPABASE_ANON_KEY')}`
            },
            body: JSON.stringify({ section_id, job_id })
          })
          .catch(error => {
            console.error('Error triggering analyze-section-references:', error);
          });
        } catch (error) {
          console.error('Exception when triggering analyze-section-references:', error);
        }
        
        return new Response(
          JSON.stringify(createResponse(true, 'All searches completed, analysis triggered', {
            section_id,
            job_id
          })),
          { headers: { ...corsHeaders } }
        );
      }

      return new Response(
        JSON.stringify(createResponse(true, 'No pending queries to process', {
          section_id,
          job_id,
          pending_queries: pendingQueries.length
        })),
        { headers: { ...corsHeaders } }
      );
    }

    // Process each query
    const results = [];
    for (const query of queries) {
      // Update query status to processing
      await supabase
        .from('section_search_queries')
        .update({ 
          status: 'processing',
          updated_at: new Date().toISOString()
        })
        .eq('id', query.id);
      
      // Perform search
      const searchResults = await performWebSearch(query.query_text);
      
      // Store results in database
      for (const result of searchResults) {
        // Fetch content from the URL (in a production environment with high volume,
        // this would be handled by a separate worker to avoid timeouts)
        const content = await fetchContentFromUrl(result.url);
        
        const { error: insertError } = await supabase
          .from('section_search_results')
          .insert({
            query_id: query.id,
            section_id: section_id,
            url: result.url,
            title: result.title,
            snippet: result.snippet,
            content: content,
            relevance_score: result.relevance_score,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          });
        
        if (insertError) {
          console.error('Failed to insert search result:', insertError.message);
          continue;
        }
        
        results.push({
          url: result.url,
          title: result.title
        });
      }
      
      // Update query status to completed
      await supabase
        .from('section_search_queries')
        .update({ 
          status: 'completed',
          updated_at: new Date().toISOString()
        })
        .eq('id', query.id);
      
      // Update job heartbeat after each query
      await updateHeartbeat(supabase, job_id);
    }

    // Check if there are more queries to process
    const { data: remainingQueries, error: remainingError } = await supabase
      .from('section_search_queries')
      .select('id')
      .eq('section_id', section_id)
      .eq('status', 'pending')
      .eq('is_deleted', false);
    
    if (remainingError) {
      console.error('Failed to check remaining queries:', remainingError.message);
    }

    const hasMoreQueries = remainingQueries && remainingQueries.length > 0;
    
    // If there are more queries, trigger this function again
    if (hasMoreQueries) {
      try {
        fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/execute-section-queries`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${Deno.env.get('SUPABASE_ANON_KEY')}`
          },
          body: JSON.stringify({ section_id, job_id })
        })
        .catch(error => {
          console.error('Error triggering execute-section-queries:', error);
        });
      } catch (error) {
        console.error('Exception when triggering execute-section-queries:', error);
      }
    } else {
      // All queries are completed, trigger the analyze step
      try {
        fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/analyze-section-references`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${Deno.env.get('SUPABASE_ANON_KEY')}`
          },
          body: JSON.stringify({ section_id, job_id })
        })
        .catch(error => {
          console.error('Error triggering analyze-section-references:', error);
        });
      } catch (error) {
        console.error('Exception when triggering analyze-section-references:', error);
      }
    }

    return new Response(
      JSON.stringify(createResponse(true, 'Search queries executed successfully', {
        section_id,
        job_id,
        queries_processed: queries.length,
        results_count: results.length,
        has_more_queries: hasMoreQueries
      })),
      { headers: { ...corsHeaders } }
    );

  } catch (error) {
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    await handleError(supabase, error, { path: 'execute-section-queries' });
    
    return new Response(
      JSON.stringify(createResponse(false, 'Internal server error')),
      { headers: { ...corsHeaders }, status: 500 }
    );
  }
});