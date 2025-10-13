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

        // Step 3: Fetch brand profile from pairs (using internal Supabase function)
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
            } else {
              console.log(`No pairs data found, using defaults`);
            }
          } else {
            console.log(`Pairs function returned ${pairsResponse.status}, using defaults`);
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
Return ONLY a valid JSON object matching this exact structure:
{
  "title": "${jobDetails.post_title}",
  "sections": [
    {
      "title": "Section 1 Title",
      "subheadings": ["Subsection 1.1", "Subsection 1.2", "Subsection 1.3"]
    },
    {
      "title": "Section 2 Title",
      "subheadings": ["Subsection 2.1", "Subsection 2.2", "Subsection 2.3", "Subsection 2.4"]
    }
  ]
}

CRITICAL: Do NOT include (H2), (H3), or any heading level markers in the title or subheadings text. We handle heading levels automatically. Just provide clean, descriptive titles.

IMPORTANT: Return ONLY the JSON object. Do not wrap in markdown code blocks, do not add commentary, do not use XML tags.`;

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

        // Retry logic with exponential backoff
        let fullResponse = '';
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
                status: `groq_outline_attempt_${attempt}`
              });

            // Use streaming with JSON mode and retry improvements
            let attemptPrompt = prompt;
            if (attempt > 1) {
              attemptPrompt = `${prompt}\n\nATTEMPT ${attempt}: You previously failed to return valid JSON. This time you MUST return ONLY valid JSON with NO explanatory text. Start with { and end with }.`;
            }

            const stream = await groq.chat.completions.create({
              model: "openai/gpt-oss-120b",
              messages: [
                {
                  role: "system",
                  content: "You are a JSON-only API. Respond ONLY with valid JSON. Never add explanatory text."
                },
                {
                  role: "user",
                  content: attemptPrompt
                }
              ],
              temperature: 0.7,
              max_completion_tokens: 16384,
              top_p: 1,
              reasoning_effort: "medium",
              stream: true,
              response_format: { type: "json_object" }
            });

            console.log('Groq streaming started...');

            fullResponse = '';
            let chunkCount = 0;

            for await (const chunk of stream) {
              chunkCount++;

              if (chunk.choices && chunk.choices.length > 0) {
                const delta = chunk.choices[0].delta;

                if (delta?.content) {
                  fullResponse += delta.content;
                }
              }
            }

            console.log(`Streaming completed. Chunks: ${chunkCount}, Content length: ${fullResponse.length}`);

            // If we got content, break out of retry loop
            if (fullResponse && fullResponse.length > 100) {
              console.log('✅ Successfully received outline response from Groq');
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
            status: 'parsing_outline_response'
          });

        // Step 7: Parse response with robust extraction
        const responseText = fullResponse;
        console.log(`Processing response of length: ${responseText.length}`);

        // Try multiple extraction strategies with smart error detection
        let jsonText = null;
        let outlineJson = null;
        let parseError = null;

        // Check for refusal patterns
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
              status: 'groq_refused_outline_retrying'
            });
          throw new Error('Model refused to generate outline. Will retry with stronger instructions.');
        }

        // Strategy 1: Parse entire response (should work with json_object mode)
        try {
          outlineJson = JSON.parse(responseText);
          console.log('✅ Parsed entire response as JSON');
        } catch (e) {
          parseError = e;
          console.log('Strategy 1 failed:', e.message);
        }

        // Strategy 2: Look for JSON code blocks
        if (!outlineJson) {
          const codeBlockMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/);
          if (codeBlockMatch) {
            try {
              jsonText = codeBlockMatch[1].trim();
              outlineJson = JSON.parse(jsonText);
              console.log('✅ Found and parsed JSON from code block');
            } catch (e) {
              console.log('Strategy 2 failed:', e.message);
            }
          }
        }

        // Strategy 3: Look for raw JSON object
        if (!outlineJson) {
          const jsonObjectMatch = responseText.match(/\{[\s\S]*"sections"[\s\S]*\}/);
          if (jsonObjectMatch) {
            try {
              jsonText = jsonObjectMatch[0];
              outlineJson = JSON.parse(jsonText);
              console.log('✅ Found and parsed raw JSON object');
            } catch (e) {
              console.log('Strategy 3 failed:', e.message);
            }
          }
        }

        // If all strategies failed
        if (!outlineJson) {
          console.error('❌ ALL JSON PARSING STRATEGIES FAILED');
          console.error('Parse error:', parseError?.message || 'No parse error captured');
          console.error('Response preview:', responseText.substring(0, 500));

          await supabase
            .from('content_plan_outline_statuses')
            .insert({
              outline_guid: job_id,
              status: `outline_json_parse_failed_retrying`
            });

          throw new Error(`Could not parse outline JSON. Parse error: ${parseError?.message}. Response starts with: ${responseText.substring(0, 100)}`);
        }

        // Validate structure
        if (!outlineJson.sections || !Array.isArray(outlineJson.sections)) {
          console.error('❌ Invalid JSON structure. Got:', Object.keys(outlineJson));
          throw new Error('Response does not contain valid "sections" array');
        }

        console.log(`✅ Successfully parsed outline with ${outlineJson.sections.length} sections`);

        console.log(`Parsed outline with ${outlineJson.sections.length} sections`);

        // Step 8: Save outline to database (proper flow with both tables)
        console.log('Saving outline to database');

        await supabase
          .from('content_plan_outline_statuses')
          .insert({
            outline_guid: job_id,
            status: 'saving_outline'
          });

        // Step 8a: Update content_plan_outlines with the outline (this record should already exist)
        const { data: updateResult, error: updateOutlineError } = await supabase
          .from('content_plan_outlines')
          .update({
            outline: JSON.stringify(outlineJson),
            status: 'completed',
            updated_at: new Date().toISOString()
          })
          .eq('guid', job_id)
          .select();

        if (updateOutlineError) {
          console.error('Error updating content_plan_outlines:', updateOutlineError);
          throw new Error(`Failed to update content_plan_outlines: ${updateOutlineError.message}`);
        }

        console.log('✅ Updated content_plan_outlines with outline', updateResult ? `(${updateResult.length} rows)` : '(no rows returned)');

        // Step 8b: Try to insert into content_plan_outlines_ai (optional - for history)
        try {
          const { error: insertError } = await supabase
            .from('content_plan_outlines_ai')
            .insert({
              job_id,
              outline: outlineJson
            });

          if (insertError) {
            console.warn('Warning: Could not insert into content_plan_outlines_ai (non-critical):', insertError.message);
            // Don't throw - this table is just for history, content_plan_outlines is the main table
          } else {
            console.log('✅ Saved outline to content_plan_outlines_ai');
          }
        } catch (aiInsertError) {
          console.warn('Warning: Exception inserting into content_plan_outlines_ai (non-critical):', aiInsertError.message);
          // Continue - content_plan_outlines is already updated
        }

        // Step 8c: Update job status to completed
        const { error: updateError } = await supabase
          .from('outline_generation_jobs')
          .update({
            status: 'completed',
            updated_at: new Date().toISOString(),
            heartbeat_at: new Date().toISOString()
          })
          .eq('id', job_id);

        if (updateError) {
          console.error('Error updating outline_generation_jobs:', updateError);
          throw new Error(`Failed to update job status: ${updateError.message}`);
        }

        console.log('✅ Updated outline_generation_jobs status to completed');

        await supabase
          .from('content_plan_outline_statuses')
          .insert({
            outline_guid: job_id,
            status: 'completed'
          });

        console.log('✅ Fast outline analysis completed successfully');

      } catch (backgroundError) {
        console.error('Error in fast analysis processing:', backgroundError);

        try {
          if (job_id) {
            const supabase = createClient(supabaseUrl, supabaseServiceKey);
            await supabase
              .from('outline_generation_jobs')
              .update({
                status: 'failed',
                updated_at: new Date().toISOString(),
                heartbeat_at: new Date().toISOString()
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
            status: 'failed',
            updated_at: new Date().toISOString(),
            heartbeat_at: new Date().toISOString()
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
