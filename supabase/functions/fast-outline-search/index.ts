// supabase/functions/fast-outline-search/index.ts
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

    console.log(`Fast outline search started for job_id: ${job_id}`);

    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    const validationClient = createClient(supabaseUrl, supabaseServiceKey);

    // Validate job exists
    const { data: job, error: jobError } = await validationClient
      .from('outline_generation_jobs')
      .select('id')
      .eq('id', job_id)
      .single();

    if (jobError || !job) {
      return new Response(
        JSON.stringify({ error: `Job not found: ${jobError?.message || 'Unknown error'}` }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Start background processing
    (async () => {
      try {
        await new Promise(resolve => setTimeout(resolve, 200));

        console.log(`Beginning fast search processing for job_id: ${job_id}`);

        const supabase = createClient(supabaseUrl, supabaseServiceKey);

        // Fetch job details
        const { data: jobDetails, error: jobDetailsError } = await supabase
          .from('outline_generation_jobs')
          .select('*')
          .eq('id', job_id)
          .single();

        if (jobDetailsError || !jobDetails) {
          throw new Error(`Job details not found: ${jobDetailsError?.message || 'Unknown error'}`);
        }

        // Update status
        await supabase
          .from('outline_generation_jobs')
          .update({ status: 'fast_searching', updated_at: new Date().toISOString() })
          .eq('id', job_id);

        await supabase
          .from('content_plan_outline_statuses')
          .insert({
            outline_guid: job_id,
            status: 'fetching_brand_profile'
          });

        // Fetch pairs data with graceful error handling
        console.log(`Fetching pairs data for domain: ${jobDetails.domain}`);
        let pairsData: Record<string, any> = {};

        try {
          // Call our internal Supabase function instead of external pp-api
          const pairsResponse = await fetch(`${supabaseUrl}/functions/v1/pp-get-all-pairs?domain=${encodeURIComponent(jobDetails.domain)}`, {
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${supabaseServiceKey}`,
            },
          });

          if (pairsResponse.ok) {
            const response = await pairsResponse.json();
            console.log(`Retrieved pairs response for ${jobDetails.domain}`);

            // Transform array of key-value pairs into an object
            if (response.success && response.data && Array.isArray(response.data)) {
              pairsData = response.data.reduce((acc: Record<string, any>, pair: any) => {
                acc[pair.key] = pair.value;
                return acc;
              }, {});
              console.log(`Transformed ${response.data.length} pairs into object`);

              await supabase
                .from('content_plan_outline_statuses')
                .insert({
                  outline_guid: job_id,
                  status: 'brand_profile_retrieved'
                });
            } else {
              console.log(`No pairs data found, using defaults`);
              await supabase
                .from('content_plan_outline_statuses')
                .insert({
                  outline_guid: job_id,
                  status: 'using_default_brand_profile'
                });
            }
          } else {
            console.log(`Pairs function returned ${pairsResponse.status}, using defaults`);
            await supabase
              .from('content_plan_outline_statuses')
              .insert({
                outline_guid: job_id,
                status: 'using_default_brand_profile'
              });
          }
        } catch (pairsError) {
          console.error(`Error fetching pairs data: ${pairsError.message}`);
          await supabase
            .from('content_plan_outline_statuses')
            .insert({
              outline_guid: job_id,
              status: 'pairs_fetch_error_continuing'
            });
        }

        // Build comprehensive brand profile with safe defaults
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

        // Build Groq prompt
        await supabase
          .from('content_plan_outline_statuses')
          .insert({
            outline_guid: job_id,
            status: 'initiating_intelligent_search'
          });

        const prompt = `Use the browser_search tool to gather the top 10 authoritative results for "${jobDetails.post_keyword}" ensure that the article is actually about the topic and not just generic articles ensure that you keep in this brand information in mind when performing these searches

${JSON.stringify(brandProfile, null, 2)}

If the articles you find don't relate to the core of the brand you can determine other search terms and use those

For each result, capture the title, canonical link, full markdown content, all H1-H4 headings, a concise summary, and an array of quotes with citation URLs. After gathering the information, respond with a single JSON object that matches this schema: { "type": "object", "properties": { "result": { "type": "array", "items": { "type": "object", "properties": { "index": { "type": "integer" }, "title": { "type": "string" }, "link": { "type": "string" }, "markdown": { "type": "string" }, "headings": { "type": "array", "items": { "type": "string" }, "minItems": 1 }, "summary": { "type": "string" }, "quotes": { "type": "array", "items": { "type": "object", "properties": { "text": { "type": "string" }, "citation": { "type": "string" } }, "required": [ "text", "citation" ], "additionalProperties": false }, "minItems": 1 } }, "required": [ "index", "title", "link", "markdown", "headings", "summary", "quotes" ], "additionalProperties": false }, "minItems": 1 } }, "required": [ "result" ], "additionalProperties": false }

Return JSON only with no extra commentary wrapped in <answer> tags`;

        // Call Groq API
        console.log('Calling Groq API with browser_search tool');

        await supabase
          .from('content_plan_outline_statuses')
          .insert({
            outline_guid: job_id,
            status: 'groq_search_in_progress'
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
          max_completion_tokens: 65536,
          top_p: 1,
          reasoning_effort: "medium",
          stream: false,
          tools: [
            { type: "browser_search" }
          ]
        });

        console.log('Groq API call completed');

        await supabase
          .from('content_plan_outline_statuses')
          .insert({
            outline_guid: job_id,
            status: 'parsing_search_results'
          });

        // Extract JSON from response with robust parsing
        const responseText = completion.choices[0].message.content;
        console.log(`Received response of length: ${responseText?.length || 0}`);

        if (!responseText) {
          throw new Error('Empty response from Groq API');
        }

        // Try multiple extraction strategies
        let jsonText = null;
        let results = null;

        // Strategy 1: Look for <answer> tags
        const answerMatch = responseText.match(/<answer>([\s\S]*?)<\/answer>/);
        if (answerMatch) {
          jsonText = answerMatch[1].trim();
          console.log('Found JSON in <answer> tags');
        }

        // Strategy 2: Look for JSON code blocks
        if (!jsonText) {
          const codeBlockMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/);
          if (codeBlockMatch) {
            jsonText = codeBlockMatch[1].trim();
            console.log('Found JSON in code block');
          }
        }

        // Strategy 3: Look for raw JSON object in the response
        if (!jsonText) {
          const jsonObjectMatch = responseText.match(/\{[\s\S]*"result"[\s\S]*\}/);
          if (jsonObjectMatch) {
            jsonText = jsonObjectMatch[0];
            console.log('Found raw JSON object');
          }
        }

        // Strategy 4: Try to parse the entire response as JSON
        if (!jsonText) {
          try {
            results = JSON.parse(responseText);
            console.log('Parsed entire response as JSON');
          } catch (e) {
            console.error('Failed to parse response as JSON:', e.message);
          }
        }

        // Parse the extracted JSON text
        if (!results && jsonText) {
          try {
            results = JSON.parse(jsonText);
          } catch (parseError) {
            console.error('Failed to parse extracted JSON:', parseError.message);
            console.error('Extracted text:', jsonText.substring(0, 500));
            throw new Error(`Failed to parse JSON from Groq response: ${parseError.message}`);
          }
        }

        // Validate we got results
        if (!results) {
          console.error('Response text (first 1000 chars):', responseText.substring(0, 1000));
          throw new Error('Could not extract valid JSON from Groq response');
        }

        if (!results.result || !Array.isArray(results.result)) {
          throw new Error('Response does not contain valid "result" array');
        }

        console.log(`Parsed ${results.result.length} search results`);

        // Save results to database
        await supabase
          .from('content_plan_outline_statuses')
          .insert({
            outline_guid: job_id,
            status: `saving_${results.result.length}_search_results`
          });

        for (const result of results.result) {
          await supabase
            .from('outline_search_results')
            .insert({
              job_id,
              search_term: jobDetails.post_keyword,
              search_category: 'fast',
              search_priority: 1,
              url: result.link,
              title: result.title,
              description: result.summary,
              content: result.markdown,
              headings_array: result.headings,
              quotes_array: result.quotes
            });
        }

        console.log(`Saved ${results.result.length} results to database`);

        // Update job status to search completed
        await supabase
          .from('outline_generation_jobs')
          .update({
            status: 'search_completed',
            updated_at: new Date().toISOString()
          })
          .eq('id', job_id);

        await supabase
          .from('content_plan_outline_statuses')
          .insert({
            outline_guid: job_id,
            status: 'fast_search_completed'
          });

        // Trigger fast-analyze-outline-content (Groq-powered outline generation)
        console.log(`Triggering fast analysis for job_id: ${job_id}`);

        const analysisResponse = await fetch(`${supabaseUrl}/functions/v1/fast-analyze-outline-content`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${supabaseServiceKey}`
          },
          body: JSON.stringify({ job_id })
        });

        if (!analysisResponse.ok) {
          const errorText = await analysisResponse.text();
          console.error(`Failed to start fast analysis. Status: ${analysisResponse.status}, Error: ${errorText}`);
          throw new Error(`Failed to start fast analysis: ${errorText}`);
        }

        console.log(`Successfully triggered fast analysis for job_id: ${job_id}`);

      } catch (backgroundError) {
        console.error('Error in fast search processing:', backgroundError);

        try {
          if (job_id) {
            const supabase = createClient(supabaseUrl, supabaseServiceKey);
            await supabase
              .from('outline_generation_jobs')
              .update({
                status: 'fast_search_failed',
                updated_at: new Date().toISOString()
              })
              .eq('id', job_id);

            await supabase
              .from('content_plan_outline_statuses')
              .insert({
                outline_guid: job_id,
                status: `fast_search_error: ${backgroundError.message.substring(0, 100)}`
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
        message: 'Fast outline search started',
        job_id
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error processing fast search request:', error);

    if (job_id) {
      try {
        const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
        const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
        const supabase = createClient(supabaseUrl, supabaseServiceKey);

        await supabase
          .from('outline_generation_jobs')
          .update({
            status: 'fast_search_failed',
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
