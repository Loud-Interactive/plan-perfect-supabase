// supabase/functions/fast-analyze-outline-content/index.ts
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Groq from 'npm:groq-sdk';

serve(async (req) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  };

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  let job_id;

  try {
    const requestData = await req.json();
    job_id = requestData.job_id;

    if (!job_id) {
      return new Response(
        JSON.stringify({ error: 'job_id is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Fast analyze outline content started for job_id: ${job_id}`);

    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    const validationClient = createClient(supabaseUrl, supabaseServiceKey);

    // Validate job exists
    const { data: job, error: jobError } = await validationClient
      .from('outline_generation_jobs')
      .select('id, status')
      .eq('id', job_id)
      .single();

    if (jobError || !job) {
      return new Response(
        JSON.stringify({ error: `Job not found: ${jobError?.message || 'Unknown error'}` }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Verify job is in the correct state
    if (job.status !== 'search_completed') {
      return new Response(
        JSON.stringify({
          error: `Job is not ready for analysis. Current status: ${job.status}`,
          expected: 'search_completed'
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Start background processing
    (async () => {
      try {
        await new Promise(resolve => setTimeout(resolve, 200));

        console.log(`Beginning fast analysis for job_id: ${job_id}`);

        const supabase = createClient(supabaseUrl, supabaseServiceKey);

        // Step 1: Fetch job details
        const { data: jobDetails, error: jobDetailsError } = await supabase
          .from('outline_generation_jobs')
          .select('*')
          .eq('id', job_id)
          .single();

        if (jobDetailsError || !jobDetails) {
          throw new Error(`Job details not found: ${jobDetailsError?.message || 'Unknown error'}`);
        }

        // Update job status
        await supabase
          .from('outline_generation_jobs')
          .update({
            status: 'fast_analyzing_results',
            updated_at: new Date().toISOString()
          })
          .eq('id', job_id);

        await supabase
          .from('content_plan_outline_statuses')
          .insert({
            outline_guid: job_id,
            status: 'preparing_to_fetch_article_data'
          });

        // Step 2: Fetch content plan data
        console.log(`Fetching content plan for guid: ${jobDetails.content_plan_guid}`);
        const { data: contentPlan, error: contentPlanError } = await supabase
          .from('content_plans')
          .select('*')
          .eq('guid', jobDetails.content_plan_guid)
          .single();

        if (contentPlanError) {
          console.error(`Error fetching content plan: ${contentPlanError.message}`);
        }

        // Step 3: Fetch brand profile from pairs API
        console.log(`Fetching pairs data for domain: ${jobDetails.domain}`);
        let pairsData: Record<string, any> = {};

        try {
          const pairsResponse = await fetch(`https://pp-api.replit.app/pairs/all/${jobDetails.domain}`);
          if (pairsResponse.ok) {
            pairsData = await pairsResponse.json();
            console.log(`Retrieved pairs data for ${jobDetails.domain}`);
          } else {
            console.log(`Pairs API returned ${pairsResponse.status}, using defaults`);
          }
        } catch (pairsError) {
          console.error(`Error fetching pairs data: ${pairsError.message}`);
        }

        // Build brand profile
        const brandProfile = {
          domain: pairsData.domain || jobDetails.domain,
          anchor_text: pairsData.anchor_text || "",
          avoid_topics: pairsData.avoid_topics || "",
          brand_name: pairsData.brand_name || "",
          brand_personality: pairsData.brand_personality || "",
          brand_story: pairsData.brand_story || "",
          brand_values: pairsData.brand_values || "",
          business_goals: pairsData.business_goals || "",
          client_persona: pairsData.client_persona || "",
          competitor_domains: pairsData.competitor_domains || "",
          competitor_names: pairsData.competitor_names || "",
          elevator_pitch: pairsData.elevator_pitch || "",
          industry: pairsData.industry || "",
          key_differentiators: pairsData.key_differentiators || "",
          market_focus: pairsData.market_focus || "",
          mission: pairsData.mission || "",
          synopsis: pairsData.synopsis || "",
          usp: pairsData.usp || "",
          voice_traits: pairsData.voice_traits || "",
          tone: pairsData.tone || "",
        };

        // Step 4: Fetch search results
        const { data: searchResults, error: resultsError } = await supabase
          .from('outline_search_results')
          .select('*')
          .eq('job_id', job_id);

        if (resultsError) {
          throw new Error(`Failed to fetch search results: ${resultsError.message}`);
        }

        console.log(`Retrieved ${searchResults?.length || 0} search results`);

        if (!searchResults || searchResults.length === 0) {
          throw new Error('No search results found for analysis');
        }

        await supabase
          .from('content_plan_outline_statuses')
          .insert({
            outline_guid: job_id,
            status: 'analyzing_article_data'
          });

        // Step 5: Build comprehensive prompt for Groq
        const researchContext = searchResults.map((result, index) => {
          let context = `\n## Result ${index + 1}\n`;
          context += `**Title**: ${result.title}\n`;
          context += `**URL**: ${result.url}\n`;
          context += `**Description**: ${result.description || 'N/A'}\n`;

          if (result.headings_array && result.headings_array.length > 0) {
            context += `**Headings**:\n${result.headings_array.join('\n')}\n`;
          }

          if (result.quotes_array && result.quotes_array.length > 0) {
            context += `**Key Quotes**:\n`;
            result.quotes_array.forEach((quote: any) => {
              context += `- "${quote.text}" (Source: ${quote.citation})\n`;
            });
          }

          if (result.content) {
            const maxContentLength = 1500;
            const truncatedContent = result.content.length > maxContentLength
              ? result.content.substring(0, maxContentLength) + '...'
              : result.content;
            context += `**Content Preview**:\n${truncatedContent}\n`;
          }

          return context;
        }).join('\n---\n');

        // Build restriction notes
        let restrictionNotes = '';
        if (brandProfile.avoid_topics) {
          restrictionNotes += `\n\n**TOPICS TO AVOID**: ${brandProfile.avoid_topics}`;
        }
        if (brandProfile.competitor_names) {
          restrictionNotes += `\n\n**DO NOT MENTION THESE COMPETITORS**: ${brandProfile.competitor_names}`;
        }
        if (brandProfile.competitor_domains) {
          restrictionNotes += `\n\n**DO NOT CITE THESE DOMAINS**: ${brandProfile.competitor_domains}`;
        }

        const prompt = `You are creating a content outline for a brand article. Your task is to generate a structured, SEO-optimized outline based on the research provided.

**Article Information**:
- Title: "${jobDetails.post_title}"
- SEO Keyword: "${jobDetails.post_keyword}"
- Content Plan Keyword: "${jobDetails.content_plan_keyword}"
- Domain: "${jobDetails.domain}"

**Brand Profile**:
${JSON.stringify(brandProfile, null, 2)}

**Content Plan Context**:
${contentPlan ? JSON.stringify(contentPlan, null, 2) : 'No content plan data available'}

**Research Results**:
${researchContext}

**REQUIREMENTS**:
1. Create 4-5 main sections (H2 headings)
2. Each section should have 3-4 subsections (H3 headings)
3. **DO NOT** include Introduction or Conclusion sections
4. Focus on actionable, valuable content for the target audience
5. Incorporate the SEO keyword "${jobDetails.post_keyword}" naturally
6. Match the brand voice: ${brandProfile.voice_traits || 'professional and authoritative'}
7. Align with brand values: ${brandProfile.brand_values}
8. Structure should be logical and flow naturally${restrictionNotes}

**OUTPUT FORMAT**:
Return a JSON object with this exact structure wrapped in <answer> tags:
{
  "title": "${jobDetails.post_title}",
  "sections": [
    {
      "title": "Section 1 Title (H2)",
      "subheadings": ["Subsection 1.1 (H3)", "Subsection 1.2 (H3)", "Subsection 1.3 (H3)"]
    },
    {
      "title": "Section 2 Title (H2)",
      "subheadings": ["Subsection 2.1 (H3)", "Subsection 2.2 (H3)", "Subsection 2.3 (H3)", "Subsection 2.4 (H3)"]
    }
  ]
}

Return JSON only with no extra commentary wrapped in <answer> tags.`;

        // Step 6: Call Groq API
        console.log('Calling Groq API for outline generation');

        await supabase
          .from('content_plan_outline_statuses')
          .insert({
            outline_guid: job_id,
            status: 'generating_outline_with_groq'
          });

        const groq = new Groq({
          apiKey: Deno.env.get('GROQ_API_KEY') || '',
        });

        const completion = await groq.chat.completions.create({
          model: "openai/gpt-oss-120b",
          messages: [
            {
              role: "user",
              content: prompt
            }
          ],
          temperature: 1,
          max_completion_tokens: 16384,
          top_p: 1,
          reasoning_effort: "medium",
          stream: false,
        });

        console.log('Groq API call completed');

        await supabase
          .from('content_plan_outline_statuses')
          .insert({
            outline_guid: job_id,
            status: 'parsing_outline_response'
          });

        // Step 7: Parse response
        const responseText = completion.choices[0].message.content;
        console.log(`Received response of length: ${responseText?.length || 0}`);

        if (!responseText) {
          throw new Error('Empty response from Groq API');
        }

        const jsonMatch = responseText.match(/<answer>([\s\S]*?)<\/answer>/);
        if (!jsonMatch) {
          throw new Error('No <answer> tags found in Groq response');
        }

        const outlineJson = JSON.parse(jsonMatch[1]);
        console.log(`Parsed outline with ${outlineJson.sections?.length || 0} sections`);

        // Step 8: Save outline to database
        console.log('Saving outline to database');

        await supabase
          .from('content_plan_outline_statuses')
          .insert({
            outline_guid: job_id,
            status: 'saving_outline'
          });

        // Insert into content_plan_outlines_ai
        await supabase
          .from('content_plan_outlines_ai')
          .insert({
            job_id,
            outline: outlineJson
          });

        // Update content_plan_outlines
        await supabase
          .from('content_plan_outlines')
          .update({
            outline: JSON.stringify(outlineJson),
            status: 'completed',
            updated_at: new Date().toISOString()
          })
          .eq('guid', job_id);

        // Update job status to completed
        await supabase
          .from('outline_generation_jobs')
          .update({
            status: 'completed',
            updated_at: new Date().toISOString()
          })
          .eq('id', job_id);

        await supabase
          .from('content_plan_outline_statuses')
          .insert({
            outline_guid: job_id,
            status: 'completed'
          });

        console.log('Fast outline analysis completed successfully');

      } catch (backgroundError) {
        console.error('Error in fast analysis processing:', backgroundError);

        try {
          if (job_id) {
            const supabase = createClient(supabaseUrl, supabaseServiceKey);
            await supabase
              .from('outline_generation_jobs')
              .update({
                status: 'fast_analysis_failed',
                updated_at: new Date().toISOString()
              })
              .eq('id', job_id);

            await supabase
              .from('content_plan_outline_statuses')
              .insert({
                outline_guid: job_id,
                status: `fast_analysis_error: ${backgroundError.message.substring(0, 100)}`
              });
          }
        } catch (updateError) {
          console.error('Error updating job status:', updateError);
        }
      }
    })();

    // Return immediate response
    return new Response(
      JSON.stringify({
        success: true,
        message: 'Fast outline analysis started',
        job_id
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error processing fast analysis request:', error);

    if (job_id) {
      try {
        const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
        const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
        const supabase = createClient(supabaseUrl, supabaseServiceKey);

        await supabase
          .from('outline_generation_jobs')
          .update({
            status: 'fast_analysis_failed',
            updated_at: new Date().toISOString()
          })
          .eq('id', job_id);
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
