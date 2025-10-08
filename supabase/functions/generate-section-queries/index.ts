// Supabase Edge Function: generate-section-queries
// Generates search queries for a specific section of content

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../helpers.ts';
import { 
  handleError, 
  createResponse,
  updateHeartbeat,
  getOutlineByGuid
} from '../content-perfect/utils/index.ts';

const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

// Function to generate queries for a section using Claude
async function generateQueriesWithClaude(sectionTitle: string, sectionSubheadings: string[], outlineTitle: string, keyword: string) {
  try {
    const apiKey = Deno.env.get('CLAUDE_API_KEY');
    if (!apiKey) {
      throw new Error('CLAUDE_API_KEY is not set');
    }

    const prompt = `
You are a search query generation assistant for a content research system. Your task is to create effective search queries that will help gather information for a specific section of an article.

Article Title: "${outlineTitle}"
Main Keyword: "${keyword}"
Section Title: "${sectionTitle}"
${sectionSubheadings && sectionSubheadings.length > 0 ? `Section Subheadings: "${sectionSubheadings.join('", "')}"` : ''}

Please generate 5-7 search queries that would yield relevant and comprehensive information for this section. The queries should:
1. Cover different aspects of the section topic
2. Include the main keyword when relevant
3. Be specific enough to yield focused results
4. Use different phrasings and approaches
5. Be formatted for web search (not complex Boolean queries)

Return only a JSON array of string queries with no additional text. Example:
["query 1", "query 2", "query 3", "query 4", "query 5"]
`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-3-haiku-20240307',
        max_tokens: 500,
        temperature: 0.2,
        system: 'You are a search query generation system that returns only JSON arrays of search queries. Format all responses as valid JSON arrays with no additional text.',
        messages: [
          { role: 'user', content: prompt }
        ]
      })
    });

    if (!response.ok) {
      throw new Error(`Claude API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    const content = data.content?.[0]?.text || '[]';
    
    // Try to parse the JSON array from the response
    try {
      // Find the JSON array in the response
      const match = content.match(/\[.*?\]/s);
      if (match) {
        return JSON.parse(match[0]);
      }
      throw new Error('No JSON array found in response');
    } catch (parseError) {
      console.error('Failed to parse Claude response:', parseError);
      console.error('Response content:', content);
      // Fallback to some default queries if parsing fails
      return [
        `${outlineTitle} ${sectionTitle}`,
        `${keyword} ${sectionTitle}`,
        `${sectionTitle} guide`,
        `${sectionTitle} explanation`,
        `${sectionTitle} best practices`
      ];
    }
  } catch (error) {
    console.error('Error generating queries with Claude:', error);
    // Fallback to some default queries
    return [
      `${outlineTitle} ${sectionTitle}`,
      `${keyword} ${sectionTitle}`,
      `${sectionTitle} guide`,
      `${sectionTitle} explanation`,
      `${sectionTitle} best practices`
    ];
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

    // Get section details
    const { data: section, error: sectionError } = await supabase
      .from('content_sections')
      .select('*')
      .eq('id', section_id)
      .eq('is_deleted', false)
      .single();
    
    if (sectionError) {
      await handleError(supabase, sectionError, { section_id, job_id });
      return new Response(
        JSON.stringify(createResponse(false, 'Section not found')),
        { headers: { ...corsHeaders }, status: 404 }
      );
    }

    // Get job details to retrieve outline GUID
    const { data: job, error: jobError } = await supabase
      .from('content_generation_jobs')
      .select('*')
      .eq('id', job_id)
      .eq('is_deleted', false)
      .single();
    
    if (jobError) {
      await handleError(supabase, jobError, { section_id, job_id });
      return new Response(
        JSON.stringify(createResponse(false, 'Job not found')),
        { headers: { ...corsHeaders }, status: 404 }
      );
    }

    // Get outline data
    const outline = await getOutlineByGuid(supabase, job.outline_guid);
    if (!outline) {
      await handleError(supabase, 'Outline not found', { section_id, job_id, outline_guid: job.outline_guid });
      return new Response(
        JSON.stringify(createResponse(false, 'Outline not found')),
        { headers: { ...corsHeaders }, status: 404 }
      );
    }

    // Parse outline to get section details
    let outlineData;
    try {
      outlineData = JSON.parse(outline.outline);
    } catch (error) {
      await handleError(supabase, 'Invalid outline format', { section_id, job_id, outline_guid: job.outline_guid });
      return new Response(
        JSON.stringify(createResponse(false, 'Invalid outline format')),
        { headers: { ...corsHeaders }, status: 400 }
      );
    }

    // Find this section in the outline to get subheadings
    const outlineSection = outlineData.sections[section.section_index];
    const subheadings = outlineSection?.subheadings || [];

    // Generate search queries for this section
    const queries = await generateQueriesWithClaude(
      section.section_title, 
      subheadings, 
      outlineData.title, 
      outline.keyword
    );

    // Save search queries to database
    const queryInserts = queries.map(query => ({
      section_id: section.id,
      query_text: query,
      status: 'pending',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }));

    const { error: insertError } = await supabase
      .from('section_search_queries')
      .insert(queryInserts);
    
    if (insertError) {
      await handleError(supabase, insertError, { section_id, job_id, queries });
      return new Response(
        JSON.stringify(createResponse(false, 'Failed to save search queries')),
        { headers: { ...corsHeaders }, status: 500 }
      );
    }

    // Update section status to research
    const { error: updateError } = await supabase
      .from('content_sections')
      .update({ 
        status: 'research',
        updated_at: new Date().toISOString()
      })
      .eq('id', section.id);
    
    if (updateError) {
      await handleError(supabase, updateError, { section_id, job_id });
      console.error('Failed to update section status:', updateError.message);
    }

    // Update job heartbeat again
    await updateHeartbeat(supabase, job_id);

    // Trigger execute-section-queries function asynchronously
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
      // The cron job will pick this up eventually
    }

    return new Response(
      JSON.stringify(createResponse(true, 'Search queries generated successfully', {
        section_id: section.id,
        job_id: job.id,
        query_count: queries.length,
        queries: queries
      })),
      { headers: { ...corsHeaders } }
    );

  } catch (error) {
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    await handleError(supabase, error, { path: 'generate-section-queries' });
    
    return new Response(
      JSON.stringify(createResponse(false, 'Internal server error')),
      { headers: { ...corsHeaders }, status: 500 }
    );
  }
});