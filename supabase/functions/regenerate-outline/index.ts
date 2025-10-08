// supabase/functions/regenerate-outline/index.ts
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Anthropic from 'npm:@anthropic-ai/sdk';

serve(async (req) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  };

  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  let job_id: number | string;
  
  try {
    const requestData = await req.json();
    job_id = requestData.content_plan_outline_guid || requestData.job_id;
    
    if (!job_id) {
      return new Response(
        JSON.stringify({ error: 'content_plan_outline_guid or job_id is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    console.log(`Regenerate outline started for job_id: ${job_id}`);
    
    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Validate that the job exists
    const { data: job, error: jobError } = await supabase
      .from('outline_generation_jobs')
      .select('*')
      .eq('id', job_id)
      .single();

    if (jobError || !job) {
      return new Response(
        JSON.stringify({ error: `Job not found: ${jobError?.message || 'Unknown error'}` }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get the original outline
    const { data: originalOutlineData, error: originalOutlineError } = await supabase
      .from('content_plan_outlines_ai')
      .select('*')
      .eq('job_id', job_id)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (originalOutlineError || !originalOutlineData) {
      return new Response(
        JSON.stringify({ error: `Original outline not found: ${originalOutlineError?.message || 'Unknown error'}` }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get search results
    const { data: searchResults, error: searchResultsError } = await supabase
      .from('outline_search_results')
      .select('*')
      .eq('job_id', job_id);

    if (searchResultsError) {
      console.error(`Error fetching search results: ${searchResultsError.message}`);
    }

    // Get the analyses of search results
    const { data: urlAnalyses, error: urlAnalysesError } = await supabase
      .from('outline_url_analyses')
      .select('*')
      .eq('job_id', job_id);

    if (urlAnalysesError) {
      console.error(`Error fetching URL analyses: ${urlAnalysesError.message}`);
    }

    // Prepare for background processing
    (async () => {
      try {
        // Small delay to ensure the response is sent
        await new Promise(resolve => setTimeout(resolve, 200));
        
        console.log(`Beginning background regeneration for job_id: ${job_id}`);
        
        // Update job status to regenerating
        await supabase
          .from('outline_generation_jobs')
          .update({ 
            status: 'regenerating',
            updated_at: new Date().toISOString()
          })
          .eq('id', job_id);
          
        // Add status update
        await supabase
          .from('content_plan_outline_statuses')
          .insert({
            outline_guid: job_id,
            status: 'outline_regeneration_started'
          });

        // Initialize Anthropic client
        const anthropic = new Anthropic({
          apiKey: Deno.env.get('ANTHROPIC_API_KEY') || '',
        });

        // Prepare search results with content truncation
        let processedResults = [];
        if (searchResults && searchResults.length > 0) {
          processedResults = searchResults.map(result => {
            // Truncate long content to keep context size manageable
            const MAX_CONTENT_LENGTH = 2000; // Characters
            let truncatedContent = result.content || '';
            if (truncatedContent.length > MAX_CONTENT_LENGTH) {
              // Take first and last parts to preserve important info
              const firstPart = truncatedContent.substring(0, MAX_CONTENT_LENGTH / 2);
              const lastPart = truncatedContent.substring(truncatedContent.length - MAX_CONTENT_LENGTH / 2);
              truncatedContent = `${firstPart}\n\n[...content truncated...]\n\n${lastPart}`;
            }
            
            return {
              url: result.url,
              title: result.title || '',
              description: result.description || '',
              content: truncatedContent,
              date: result.date,
              publishedTime: result.publishedTime,
              search_category: result.search_category,
              search_priority: result.search_priority
            };
          });
        }

        // Add status update
        await supabase
          .from('content_plan_outline_statuses')
          .insert({
            outline_guid: job_id,
            status: 'analyzing_original_outline'
          });

        // Create the regeneration prompt
        const originalOutline = originalOutlineData.outline;
        
        // Get distinct categories with count of articles per category
        const categoryInfo = searchResults ? 
          Array.from(new Set(searchResults.map(c => c.search_category)))
            .map(category => {
              const count = searchResults.filter(c => c.search_category === category).length;
              const priority = searchResults.find(c => c.search_category === category)?.search_priority || 5;
              return { category, count, priority };
            })
            .sort((a, b) => a.priority - b.priority) : 
          [];
        
        const categoryContext = categoryInfo.length > 0 ? 
          `I searched for information using different types of search terms:
${categoryInfo.map(c => `- ${c.category} terms (priority ${c.priority}): Found ${c.count} results`).join('\n')}

The search results from higher priority categories (lower numbers) should generally be given more weight, as they're more closely aligned with the core topic.` : '';

        const regenerationPrompt = `You are tasked with improving an existing content outline for an article with the title "${job.post_title}".

The article focuses on the keyword "${job.post_keyword}" and is part of a content plan about "${job.content_plan_keyword}".

Here is the ORIGINAL OUTLINE that needs improvement:
${JSON.stringify(originalOutline, null, 2)}

I've analyzed several relevant articles as part of my research:
${JSON.stringify(urlAnalyses && urlAnalyses.length > 0 ? urlAnalyses : processedResults.slice(0, 10), null, 2)}

${categoryContext}

CONTENT STRATEGY GUIDANCE:
- The improved outline should thoroughly cover the specific focus of "${job.post_keyword}" 
- It should also connect to the broader topic/category of "${job.content_plan_keyword}"
- It should maintain the specific angle implied by the title "${job.post_title}"
- Ensure it's MORE comprehensive, better structured, and more user-friendly than the original

The improved outline should:
1. Address any gaps or weaknesses in the original outline
2. Have 5-7 main sections with 3-4 subsections each
3. Cover all important aspects of the topic more thoroughly
4. Have a more logical flow and structure
5. Be MORE SEO-friendly and incorporate the keyword "${job.post_keyword}" naturally
6. Include stronger, more engaging section titles and subheadings
7. Match the style and tone of ${job.domain}
8. Emphasize current best practices and information
9. Address any significant changes or developments in this field (if applicable)
10. Balance information from all search categories, but prioritize the most relevant ones

Format your response as a JSON object with this structure:
{
  "title": "Article Title",
  "sections": [
    {
      "title": "Introduction",
      "subheadings": ["Hook", "Background", "Thesis statement"]
    },
    {
      "title": "Main Section 1",
      "subheadings": ["Subheading 1.1", "Subheading 1.2", "Subheading 1.3"]
    },
    // More sections...
    {
      "title": "Conclusion",
      "subheadings": ["Summary", "Final thoughts", "Call to action"]
    }
  ]
}`;

        // Add status update
        await supabase
          .from('content_plan_outline_statuses')
          .insert({
            outline_guid: job_id,
            status: 'generating_improved_outline'
          });

        // Use streaming API for outline generation
        console.log("Starting streaming improved outline generation with Claude API");
        let outlineText = '';
        const outlineStream = await anthropic.beta.messages.stream({
          model: "claude-3-7-sonnet-20250219",
          max_tokens: 72000,
          temperature: 1,
          messages: [
            {
              role: "user",
              content: regenerationPrompt
            }
          ],
          thinking: {
            type: "enabled",
            budget_tokens: 23000
          },
          betas: ["output-128k-2025-02-19"]
        });

        // Collect streamed chunks
        for await (const chunk of outlineStream) {
          if (chunk.type === 'content_block_delta' && chunk.delta.text) {
            outlineText += chunk.delta.text;
          }
        }
        
        console.log(`Completed streaming improved outline generation, received ${outlineText.length} characters`);

        // Extract the JSON from the response
        let outlineJson;
        try {
          // Look for JSON object in the response
          const jsonMatch = outlineText.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            outlineJson = JSON.parse(jsonMatch[0]);
            console.log('Successfully parsed improved outline JSON');
          } else {
            throw new Error('No JSON object found in the response');
          }
        } catch (jsonError) {
          console.error(`Error parsing improved outline JSON: ${jsonError.message}`);
          // Just use the original outline plus a note
          outlineJson = originalOutline;
          if (outlineJson.sections && outlineJson.sections[0]) {
            outlineJson.sections[0].subheadings = [...(outlineJson.sections[0].subheadings || []), "Regenerated version with improvements"];
          }
        }

        // Add status update
        await supabase
          .from('content_plan_outline_statuses')
          .insert({
            outline_guid: job_id,
            status: 'saving_improved_outline'
          });

        // Save the improved outline to content_plan_outlines_ai as a new version
        await supabase
          .from('content_plan_outlines_ai')
          .insert({
            job_id,
            outline: outlineJson
          });
          
        // Update the content_plan_outlines table with the improved outline
        await supabase
          .from('content_plan_outlines')
          .update({
            outline: JSON.stringify(outlineJson),
            status: 'regenerated'
          })
          .eq('guid', job_id);

        // Update job status to completed
        await supabase
          .from('outline_generation_jobs')
          .update({ 
            status: 'regenerated',
            updated_at: new Date().toISOString()
          })
          .eq('id', job_id);
          
        // Final status update
        await supabase
          .from('content_plan_outline_statuses')
          .insert({
            outline_guid: job_id,
            status: 'regeneration_completed'
          });

        console.log('Outline regeneration process completed successfully');
      } catch (backgroundError) {
        console.error('Error in background regeneration processing:', backgroundError);
        
        // Update job status to failed
        try {
          const supabase = createClient(supabaseUrl, supabaseServiceKey);
          await supabase
            .from('outline_generation_jobs')
            .update({ 
              status: 'regeneration_failed',
              updated_at: new Date().toISOString()
            })
            .eq('id', job_id);
            
          // Add error status
          await supabase
            .from('content_plan_outline_statuses')
            .insert({
              outline_guid: job_id,
              status: `regeneration_failed: ${backgroundError.message.substring(0, 100)}`
            });
            
          console.log(`Updated job ${job_id} status to regeneration_failed due to background error`);
        } catch (updateError) {
          console.error('Error updating job status:', updateError);
        }
      }
    })();
    
    // Return immediate response
    return new Response(
      JSON.stringify({ 
        success: true, 
        message: 'Outline regeneration process started', 
        job_id
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error processing outline regeneration request:', error);
    
    // Update job status to failed if we have the job_id
    if (job_id) {
      try {
        const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
        const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
        const supabase = createClient(supabaseUrl, supabaseServiceKey);
        
        await supabase
          .from('outline_generation_jobs')
          .update({ 
            status: 'regeneration_failed',
            updated_at: new Date().toISOString()
          })
          .eq('id', job_id);
          
        console.log(`Updated job ${job_id} status to regeneration_failed due to request error`);
      } catch (updateError) {
        console.error('Error updating job status:', updateError);
      }
    }
    
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});