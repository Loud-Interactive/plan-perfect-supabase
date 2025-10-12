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

        const prompt = `Use web search to find the top 10 authoritative articles about "${jobDetails.post_keyword}".

Brand Context:
${JSON.stringify(brandProfile, null, 2)}

Search for high-quality articles specifically about "${jobDetails.post_keyword}". Ensure articles are relevant to the brand context above.

For each search result, extract and return the following in JSON format:
- index (0-9)
- title
- link (URL)
- markdown (full article content)
- headings (array of H1-H4 headings)
- summary (2-3 sentences)
- quotes (array of notable quotes with citations)

CRITICAL: Return ONLY valid JSON in this EXACT structure:
{
  "result": [
    {
      "index": 0,
      "title": "Article Title",
      "link": "https://example.com/article",
      "markdown": "Full article content in markdown",
      "headings": ["Heading 1", "Heading 2"],
      "summary": "Article summary",
      "quotes": [{"text": "Quote text", "citation": "https://source.com"}]
    }
  ]
}

Return all 10 results (index 0-9). Response must be valid JSON only - no explanatory text, no apologies, no markdown code blocks.`;

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

        // Retry logic with exponential backoff
        let fullResponse = '';
        let collectedToolCalls: any[] = [];
        const maxRetries = 3;
        let attempt = 0;
        let lastError: any = null;

        while (attempt < maxRetries) {
          try {
            attempt++;
            console.log(`Groq API call attempt ${attempt}/${maxRetries}...`);

            await supabase
              .from('content_plan_outline_statuses')
              .insert({
                outline_guid: job_id,
                status: `groq_attempt_${attempt}`
              });

            // Use streaming with browser_search tool
            // Add stronger instructions on retries
            let attemptPrompt = prompt;
            let useJsonMode = false; // Can't use json_object mode with tools

            if (attempt > 1) {
              attemptPrompt = `${prompt}\n\nATTENPT ${attempt}/3: Previous attempt failed. You MUST use web search and return valid JSON. Do not apologize, do not explain why you can't - just search and return the JSON structure requested.`;
            }

            const requestConfig: any = {
              model: "openai/gpt-oss-120b",
              messages: [
                {
                  role: "system",
                  content: "You have web search capabilities. Use them to find articles, then return results as valid JSON only. Never refuse the task."
                },
                {
                  role: "user",
                  content: attemptPrompt
                }
              ],
              temperature: 0.7,
              max_completion_tokens: 65536,
              top_p: 1,
              reasoning_effort: "medium",
              stream: true,
              tools: [
                { type: "browser_search" }
              ]
            };

            // Only use json_object mode if not using tools (can't combine them)
            // if (useJsonMode) {
            //   requestConfig.response_format = { type: "json_object" };
            // }

            console.log(`Attempt ${attempt}: Calling Groq with browser_search tool...`);
            const stream = await groq.chat.completions.create(requestConfig);

            console.log('Groq streaming started...');

            fullResponse = '';
            collectedToolCalls = [];
            let chunkCount = 0;
            let toolCallsDetected = false;

            for await (const chunk of stream) {
              chunkCount++;

              if (chunk.choices && chunk.choices.length > 0) {
                const delta = chunk.choices[0].delta;

                // Collect content
                if (delta?.content) {
                  fullResponse += delta.content;
                }

                // Collect tool calls (browser_search results might come via tool_calls)
                if (delta?.tool_calls) {
                  toolCallsDetected = true;
                  for (const toolCall of delta.tool_calls) {
                    const index = toolCall.index || 0;
                    if (!collectedToolCalls[index]) {
                      collectedToolCalls[index] = {
                        id: toolCall.id || '',
                        type: toolCall.type || 'function',
                        function: { name: '', arguments: '' }
                      };
                    }
                    if (toolCall.function?.name) {
                      collectedToolCalls[index].function.name += toolCall.function.name;
                    }
                    if (toolCall.function?.arguments) {
                      collectedToolCalls[index].function.arguments += toolCall.function.arguments;
                    }
                  }
                }
              }
            }

            console.log(`Streaming completed. Chunks: ${chunkCount}, Content: ${fullResponse.length} chars, Tool calls: ${collectedToolCalls.length}`);

            // If we got tool_calls but no content, extract from tool_calls
            if (toolCallsDetected && !fullResponse && collectedToolCalls.length > 0) {
              console.log('Response came via tool_calls, extracting...');
              const toolCall = collectedToolCalls[0];
              if (toolCall?.function?.arguments) {
                fullResponse = toolCall.function.arguments;
                console.log(`Extracted ${fullResponse.length} chars from tool_calls`);
              }
            }

            // If we got content, break out of retry loop
            if (fullResponse && fullResponse.length > 100) {
              console.log('✅ Successfully received response from Groq');
              break;
            } else {
              throw new Error(`Received empty or too short response (${fullResponse.length} chars)`);
            }

          } catch (error) {
            lastError = error;
            console.error(`Attempt ${attempt} failed:`, error.message);

            if (attempt < maxRetries) {
              const backoffMs = Math.min(1000 * Math.pow(2, attempt), 10000);
              console.log(`Retrying in ${backoffMs}ms...`);
              await new Promise(resolve => setTimeout(resolve, backoffMs));
            }
          }
        }

        // If all retries failed, throw the last error
        if (!fullResponse || fullResponse.length < 100) {
          throw new Error(`Failed after ${maxRetries} attempts. Last error: ${lastError?.message || 'Unknown error'}`);
        }

        await supabase
          .from('content_plan_outline_statuses')
          .insert({
            outline_guid: job_id,
            status: 'parsing_search_results'
          });

        // Use the fullResponse directly
        const responseText = fullResponse;
        console.log(`Processing response of length: ${responseText.length}`);

        // Try multiple extraction strategies with smart error detection
        let jsonText = null;
        let results = null;
        let parseError = null;

        // Check for refusal patterns first
        const refusalPatterns = [
          "I'm unable",
          "I cannot",
          "I can't",
          "I do not have",
          "I don't have",
          "As an AI"
        ];

        const hasRefusal = refusalPatterns.some(pattern =>
          responseText.toLowerCase().includes(pattern.toLowerCase())
        );

        if (hasRefusal) {
          console.error('❌ Model refused the task. Response:', responseText.substring(0, 200));
          await supabase
            .from('content_plan_outline_statuses')
            .insert({
              outline_guid: job_id,
              status: 'groq_refused_task_retrying'
            });
          throw new Error('Model refused to generate results. Will retry with stronger instructions.');
        }

        // Strategy 1: Try to parse entire response (should work with json_object mode)
        try {
          results = JSON.parse(responseText);
          console.log('✅ Parsed entire response as JSON');
        } catch (e) {
          parseError = e;
          console.log('Strategy 1 failed:', e.message);
        }

        // Strategy 2: Look for JSON code blocks (in case model wrapped it)
        if (!results) {
          const codeBlockMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/);
          if (codeBlockMatch) {
            try {
              jsonText = codeBlockMatch[1].trim();
              results = JSON.parse(jsonText);
              console.log('✅ Found and parsed JSON from code block');
            } catch (e) {
              console.log('Strategy 2 failed:', e.message);
            }
          }
        }

        // Strategy 3: Look for raw JSON object
        if (!results) {
          const jsonObjectMatch = responseText.match(/\{[\s\S]*"result"[\s\S]*\}/);
          if (jsonObjectMatch) {
            try {
              jsonText = jsonObjectMatch[0];
              results = JSON.parse(jsonText);
              console.log('✅ Found and parsed raw JSON object');
            } catch (e) {
              console.log('Strategy 3 failed:', e.message);
            }
          }
        }

        // If all strategies failed, log detailed error and throw
        if (!results) {
          console.error('❌ ALL JSON PARSING STRATEGIES FAILED');
          console.error('Parse error:', parseError?.message || 'No parse error captured');
          console.error('Response preview:', responseText.substring(0, 500));
          console.error('Response ends with:', responseText.substring(responseText.length - 100));

          await supabase
            .from('content_plan_outline_statuses')
            .insert({
              outline_guid: job_id,
              status: `json_parse_failed_retrying`
            });

          throw new Error(`Could not parse JSON from Groq response. Parse error: ${parseError?.message}. Response starts with: ${responseText.substring(0, 100)}`);
        }

        // Validate structure
        if (!results.result || !Array.isArray(results.result)) {
          console.error('❌ Invalid JSON structure. Got:', Object.keys(results));
          throw new Error('Response does not contain valid "result" array');
        }

        console.log(`✅ Successfully parsed ${results.result.length} search results`);

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
                status: 'failed',
                updated_at: new Date().toISOString(),
                heartbeat: new Date().toISOString()
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
            status: 'failed',
            updated_at: new Date().toISOString(),
            heartbeat: new Date().toISOString()
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
