// Supabase Edge Function: analyze-section-references
// Analyzes search results for a section and prepares references data for content generation

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

// Function to analyze search results with Claude
async function analyzeSearchResultsWithClaude(sectionTitle: string, results: any[]) {
  try {
    const apiKey = Deno.env.get('CLAUDE_API_KEY');
    if (!apiKey) {
      throw new Error('CLAUDE_API_KEY is not set');
    }

    // Prepare the input for Claude
    const resultsText = results.map((result, index) => {
      return `
Source ${index + 1}: ${result.title}
URL: ${result.url}
Snippet: ${result.snippet}
${result.content ? `Content excerpt: ${result.content.substring(0, 500)}...` : ''}
`;
    }).join('\n');

    const prompt = `
You are a research analysis assistant. I need you to analyze search results for a section of an article titled "${sectionTitle}".

Please carefully review the following search results:

${resultsText}

For each source, I need you to:
1. Assess its relevance to the topic "${sectionTitle}" on a scale of 0.0 to 1.0
2. Extract key facts and information that would be useful for writing this section
3. Note any conflicting information between sources
4. Identify the most authoritative sources

Return a JSON object with this format:
{
  "relevance_scores": [
    {"source_index": 0, "url": "source1_url", "relevance": 0.9, "key_points": ["point 1", "point 2"]},
    {"source_index": 1, "url": "source2_url", "relevance": 0.7, "key_points": ["point 1", "point 2"]}
  ],
  "suggested_references": [0, 1], // indices of the most important sources to reference
  "key_findings": ["finding 1", "finding 2"], // 3-5 key findings from all sources
  "conflicting_information": ["conflict description"] // any conflicts found or empty array
}

Analyze only the information provided. If the sources are low quality or irrelevant, accurately reflect that in your analysis.
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
        max_tokens: 1000,
        temperature: 0.2,
        system: 'You are a research analysis assistant that returns only JSON. Format your entire response as a single valid JSON object with no additional text.',
        messages: [
          { role: 'user', content: prompt }
        ]
      })
    });

    if (!response.ok) {
      throw new Error(`Claude API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    const content = data.content?.[0]?.text || '{}';
    
    // Try to parse the JSON object from the response
    try {
      // Find the JSON object in the response
      const match = content.match(/\{.*\}/s);
      if (match) {
        return JSON.parse(match[0]);
      }
      throw new Error('No JSON object found in response');
    } catch (parseError) {
      console.error('Failed to parse Claude response:', parseError);
      console.error('Response content:', content);
      
      // Fallback to a basic analysis
      return {
        relevance_scores: results.map((result, index) => ({
          source_index: index,
          url: result.url,
          relevance: 0.5,
          key_points: [`Information from ${result.title}`]
        })),
        suggested_references: results.map((_, index) => index),
        key_findings: ["Analysis could not be completed automatically"],
        conflicting_information: []
      };
    }
  } catch (error) {
    console.error('Error analyzing search results with Claude:', error);
    
    // Fallback to a basic analysis
    return {
      relevance_scores: results.map((result, index) => ({
        source_index: index,
        url: result.url,
        relevance: 0.5,
        key_points: [`Information from ${result.title}`]
      })),
      suggested_references: results.map((_, index) => index),
      key_findings: ["Analysis could not be completed automatically"],
      conflicting_information: []
    };
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

    // Get search results for this section
    const { data: results, error: resultsError } = await supabase
      .from('section_search_results')
      .select('*')
      .eq('section_id', section_id)
      .eq('is_deleted', false)
      .order('relevance_score', { ascending: false });
    
    if (resultsError) {
      await handleError(supabase, resultsError, { section_id, job_id });
      return new Response(
        JSON.stringify(createResponse(false, 'Failed to retrieve search results')),
        { headers: { ...corsHeaders }, status: 500 }
      );
    }

    if (!results || results.length === 0) {
      // No results to analyze, move to content generation with a warning
      const { error: updateError } = await supabase
        .from('content_sections')
        .update({ 
          status: 'processing',
          updated_at: new Date().toISOString(),
          references_data: JSON.stringify([{
            warning: 'No search results found for this section'
          }])
        })
        .eq('id', section_id);
      
      if (updateError) {
        await handleError(supabase, updateError, { section_id, job_id });
        return new Response(
          JSON.stringify(createResponse(false, 'Failed to update section status')),
          { headers: { ...corsHeaders }, status: 500 }
        );
      }

      // Trigger content generation
      try {
        fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/generate-content-section`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${Deno.env.get('SUPABASE_ANON_KEY')}`
          },
          body: JSON.stringify({ section_id, job_id })
        })
        .catch(error => {
          console.error('Error triggering generate-content-section:', error);
        });
      } catch (error) {
        console.error('Exception when triggering generate-content-section:', error);
      }

      return new Response(
        JSON.stringify(createResponse(true, 'No search results to analyze, moving to content generation', {
          section_id,
          job_id,
          message: 'No search results found for this section'
        })),
        { headers: { ...corsHeaders } }
      );
    }

    // Analyze search results
    const analysis = await analyzeSearchResultsWithClaude(section.section_title, results);

    // Update relevance scores in the database
    for (const item of analysis.relevance_scores) {
      const result = results.find(r => r.url === item.url);
      if (result) {
        await supabase
          .from('section_search_results')
          .update({ 
            relevance_score: item.relevance,
            is_used: analysis.suggested_references.includes(item.source_index),
            updated_at: new Date().toISOString()
          })
          .eq('id', result.id);
      }
    }

    // Create references data for content generation
    const referencesData = {
      sources: analysis.relevance_scores
        .filter(item => item.relevance >= 0.6)
        .map(item => {
          const result = results.find(r => r.url === item.url);
          return {
            url: item.url,
            title: result?.title || '',
            relevance: item.relevance,
            key_points: item.key_points,
            snippet: result?.snippet || '',
            content_excerpt: result?.content ? result.content.substring(0, 1000) : ''
          };
        }),
      key_findings: analysis.key_findings,
      conflicting_information: analysis.conflicting_information
    };

    // Update section with references data and change status to processing
    const { error: updateError } = await supabase
      .from('content_sections')
      .update({ 
        status: 'processing',
        updated_at: new Date().toISOString(),
        references_data: referencesData
      })
      .eq('id', section_id);
    
    if (updateError) {
      await handleError(supabase, updateError, { section_id, job_id });
      return new Response(
        JSON.stringify(createResponse(false, 'Failed to update section with references data')),
        { headers: { ...corsHeaders }, status: 500 }
      );
    }

    // Update job heartbeat
    await updateHeartbeat(supabase, job_id);

    // Trigger content generation
    try {
      fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/generate-content-section`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${Deno.env.get('SUPABASE_ANON_KEY')}`
        },
        body: JSON.stringify({ section_id, job_id })
      })
      .catch(error => {
        console.error('Error triggering generate-content-section:', error);
      });
    } catch (error) {
      console.error('Exception when triggering generate-content-section:', error);
    }

    return new Response(
      JSON.stringify(createResponse(true, 'Search results analyzed successfully', {
        section_id,
        job_id,
        results_count: results.length,
        useful_sources: referencesData.sources.length,
        key_findings_count: referencesData.key_findings.length
      })),
      { headers: { ...corsHeaders } }
    );

  } catch (error) {
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    await handleError(supabase, error, { path: 'analyze-section-references' });
    
    return new Response(
      JSON.stringify(createResponse(false, 'Internal server error')),
      { headers: { ...corsHeaders }, status: 500 }
    );
  }
});