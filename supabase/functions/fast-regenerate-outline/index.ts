// supabase/functions/fast-regenerate-outline/index.ts
// Fast outline regeneration using Groq instead of Anthropic
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

    console.log(`Fast regenerate outline started for job_id: ${job_id}`);

    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Check if job_id is a UUID (content_plan_outline_guid) or integer (job_id)
    const isUUID = typeof job_id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(job_id);
    let actualJobId = job_id;
    let contentPlanOutlineGuid = null;

    // If it's a UUID, look up the outline to get the job_id
    if (isUUID) {
      console.log(`Detected UUID (content_plan_outline_guid), looking up job_id...`);
      contentPlanOutlineGuid = job_id;
      
      const { data: outlineDataArray, error: outlineError } = await supabase
        .from('content_plan_outlines')
        .select('job_id, guid')
        .eq('guid', job_id)
        .limit(1);

      if (outlineError || !outlineDataArray || outlineDataArray.length === 0) {
        console.warn(`Outline not found for GUID: ${job_id}. Will continue without job_id lookup.`);
        // Continue without job_id - we'll try to get job info later
      } else {
        const outlineData = outlineDataArray[0];
        
        if (outlineData.job_id) {
          actualJobId = outlineData.job_id;
          console.log(`Found job_id: ${actualJobId} for GUID: ${job_id}`);
        } else {
          console.warn(`Outline found but no job_id associated with GUID: ${job_id}. Will continue without job_id.`);
        }
      }
    }

    // Try to get job - handle multiple or no rows gracefully
    let job = null;
    const { data: jobArray, error: jobError } = await supabase
      .from('outline_generation_jobs')
      .select('*')
      .eq('id', actualJobId)
      .order('created_at', { ascending: false })
      .limit(1);

    if (jobArray && jobArray.length > 0) {
      job = jobArray[0];
      console.log(`Found job record for job_id: ${actualJobId}`);
    } else {
      console.warn(`No job found in outline_generation_jobs for job_id: ${actualJobId}. Will try to get job info from content_plan_outlines.`);
      
      // Try to get job info from content_plan_outlines if we have a GUID
      if (contentPlanOutlineGuid) {
        const { data: outlineDataArray, error: outlineError } = await supabase
          .from('content_plan_outlines')
          .select('title, keyword, content_plan_keyword, domain')
          .eq('guid', contentPlanOutlineGuid)
          .limit(1);
        
        if (outlineDataArray && outlineDataArray.length > 0 && !outlineError) {
          const outlineData = outlineDataArray[0];
          // Create a mock job object from outline data
          job = {
            id: actualJobId,
            post_title: outlineData.title || '',
            post_keyword: outlineData.keyword || '',
            content_plan_keyword: outlineData.content_plan_keyword || '',
            domain: outlineData.domain || '',
            status: 'pending'
          };
          console.log(`Using job info from content_plan_outlines for GUID: ${contentPlanOutlineGuid}`);
        }
      }
    }

    // If still no job, we can't proceed - but let's try to continue anyway with minimal info
    if (!job) {
      console.warn(`No job found and couldn't get info from outline. Continuing with minimal job info.`);
      // Create a minimal job object to allow processing to continue
      job = {
        id: actualJobId,
        post_title: 'Untitled',
        post_keyword: '',
        content_plan_keyword: '',
        domain: '',
        status: 'pending'
      };
    }

    // Start background processing
    (async () => {
      try {
        await new Promise(resolve => setTimeout(resolve, 200));

        const outlineGuidForStatus = contentPlanOutlineGuid || actualJobId;
        console.log(`Beginning fast background regeneration for job_id: ${actualJobId}, outline_guid: ${outlineGuidForStatus}`);

        // Reset retry count when starting a new regeneration attempt (handle gracefully if columns don't exist)
        try {
          await supabase
            .from('outline_generation_jobs')
            .update({
              status: 'fast_regenerating',
              fast_regeneration_retry_count: 0, // Reset retry count on new attempt
              fast_regeneration_retry_at: null,
              updated_at: new Date().toISOString()
            })
            .eq('id', actualJobId);
        } catch (resetError) {
          // If retry columns don't exist, just update status
          console.warn('Could not reset retry columns (may not exist yet), updating status only:', resetError);
          await supabase
            .from('outline_generation_jobs')
            .update({
              status: 'fast_regenerating',
              updated_at: new Date().toISOString()
            })
            .eq('id', actualJobId);
        }

        await supabase
          .from('content_plan_outline_statuses')
          .insert({
            outline_guid: outlineGuidForStatus,
            status: 'fast_outline_regeneration_started'
          });

        // Get original outline (optional - may not exist)
        const { data: originalOutlineDataArray, error: originalOutlineError } = await supabase
          .from('content_plan_outlines_ai')
          .select('*')
          .eq('job_id', actualJobId)
          .order('created_at', { ascending: false })
          .limit(1);

        if (originalOutlineError) {
          console.warn(`Warning: Error fetching original outline: ${originalOutlineError.message}. Continuing without original outline.`);
        }

        const originalOutlineData = originalOutlineDataArray && originalOutlineDataArray.length > 0 
          ? originalOutlineDataArray[0] 
          : null;
        
        const hasOriginalOutline = originalOutlineData !== null;
        
        if (!hasOriginalOutline) {
          console.log(`No previous outline found for job_id ${actualJobId}. Will generate new outline from research results.`);
        }

        // Get search results
        const { data: searchResults, error: searchResultsError } = await supabase
          .from('outline_search_results')
          .select('*')
          .eq('job_id', actualJobId);

        if (searchResultsError) {
          console.error(`Error fetching search results: ${searchResultsError.message}`);
        }

        console.log(`Retrieved ${searchResults?.length || 0} search results`);

        // If no search results, log it but continue with generation
        const hasSearchResults = searchResults && searchResults.length > 0;
        if (!hasSearchResults) {
          console.log(`No search results found for job_id ${actualJobId}. Will generate outline using job information and brand profile.`);
        }

        await supabase
          .from('content_plan_outline_statuses')
          .insert({
            outline_guid: outlineGuidForStatus,
            status: 'preparing_research_context'
          });

        // Fetch brand profile from pairs (Phase 2 implementation)
        console.log(`Fetching pairs data for domain: ${job.domain}`);
        let pairsData: Record<string, any> = {};

        try {
          const pairsResponse = await fetch(`${supabaseUrl}/functions/v1/pp-get-all-pairs?domain=${encodeURIComponent(job.domain)}`, {
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${supabaseServiceKey}`,
            },
          });

          if (pairsResponse.ok) {
            const response = await pairsResponse.json();
            console.log(`Retrieved pairs response for ${job.domain}`);

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
          domain: pairsData.domain || job.domain,
          brand_values: pairsData.brand_values || "",
          voice_traits: pairsData.voice_traits || "",
          avoid_topics: pairsData.avoid_topics || "",
          competitor_names: pairsData.competitor_names || "",
          competitor_domains: pairsData.competitor_domains || "",
        };

        // Extract strategic brand elements for outline generation (Phase 2 implementation)
        const competitors = pairsData.competitors || [];
        const brand_positioning = pairsData.brand_positioning || "";
        const target_audience = pairsData.target_audience || "";

        // Build strategic guidance blocks
        let competitorGuidance = "";
        if (competitors && competitors.length > 0) {
          const competitorList = Array.isArray(competitors) ? competitors.join(", ") : competitors;
          competitorGuidance = `\n**IMPORTANT - COMPETITOR AWARENESS**:\nDo NOT structure sections that would primarily benefit or promote these competitors: ${competitorList}.\nFocus the outline on angles and information that align with ${brandProfile.domain}'s unique value proposition.\n`;
        }

        let brandPositioningGuidance = "";
        if (brand_positioning) {
          brandPositioningGuidance = `\n**BRAND POSITIONING**:\n${brand_positioning}\nStructure the outline to reinforce this positioning.\n`;
        }

        let targetAudienceGuidance = "";
        if (target_audience) {
          targetAudienceGuidance = `\n**TARGET AUDIENCE**:\n${target_audience}\nEnsure section topics are relevant and valuable to this audience.\n`;
        }

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

        // Build research context (empty if no search results)
        const researchContext = hasSearchResults
          ? searchResults.map((result, index) => {
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
            }).join('\n---\n')
          : `\n**NOTE**: No search results were available for this content. Generate the outline based on the title, keywords, and brand information provided below.\n`;

        // Get current date for prompt context
        const currentDate = new Date();
        const formattedDate = currentDate.toLocaleDateString('en-US', { 
          weekday: 'long', 
          year: 'numeric', 
          month: 'long', 
          day: 'numeric' 
        });

        // Build prompt based on whether original outline exists
        const originalOutlineSection = hasOriginalOutline
          ? `**ORIGINAL OUTLINE** (needs improvement):
${JSON.stringify(originalOutlineData.outline, null, 2)}

`
          : `**NOTE**: No previous outline was found for this content. Create a comprehensive new outline from scratch based on the research results and brand information provided below.

`;

        const taskDescription = hasOriginalOutline
          ? `You are improving an existing content outline for "${job.post_title}".`
          : `You are creating a comprehensive content outline for "${job.post_title}" from scratch.`;

        const improvementRequirements = hasOriginalOutline
          ? `2. Make it MORE comprehensive and better structured than the original
3. Address gaps and weaknesses in the original outline
4.`
          : `2. Create a comprehensive outline that covers all important aspects of the topic
3. Ensure the outline is well-structured and logically organized
4.`;

        const regenerationPrompt = `**CURRENT DATE**: ${formattedDate}
**IMPORTANT**: Ensure the outline structure reflects current trends and information as of this date. Avoid outdated approaches or time-sensitive content that may no longer be relevant.

${taskDescription}

**Article Information**:
- Title: "${job.post_title}"
- SEO Keyword: "${job.post_keyword}"
- Content Plan Keyword: "${job.content_plan_keyword}"
- Domain: "${job.domain}"

**Brand Profile**:
${JSON.stringify(brandProfile, null, 2)}
${competitorGuidance}${brandPositioningGuidance}${targetAudienceGuidance}
${originalOutlineSection}${hasSearchResults ? '**Research Results**:' : '**Research Results**: (No search results available - generate outline based on title, keywords, and brand information)'}
${researchContext}

**REQUIREMENTS**:
1. Create 5-7 main sections (H2 headings) with 3-4 subsections (H3 headings) each
${improvementRequirements} Incorporate the SEO keyword "${job.post_keyword}" naturally
5. Have a more logical flow and structure
6. Include stronger, more engaging section titles
7. Cover current best practices and recent developments
8. Be more SEO-friendly and user-focused
9. Match the brand voice: ${brandProfile.voice_traits || 'professional and authoritative'}
10. Align with brand values: ${brandProfile.brand_values}${restrictionNotes}
${!hasSearchResults ? '11. Since no research results are available, create a comprehensive outline based on the title, keywords, and brand information provided above.' : ''}

**OUTPUT FORMAT**:
Return ONLY a valid JSON object matching this exact structure:
{
  "title": "${job.post_title}",
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

CRITICAL: Do NOT include (H2), (H3), or any heading level markers in the titles. Just provide clean, descriptive titles.

IMPORTANT: Return ONLY the JSON object. No markdown code blocks, no commentary, no XML tags.`;

        await supabase
          .from('content_plan_outline_statuses')
          .insert({
            outline_guid: outlineGuidForStatus,
            status: 'generating_improved_outline_with_groq'
          });

        const groq = new Groq({
          apiKey: Deno.env.get('GROQ_API_KEY') || '',
        });

        // Retry logic with exponential backoff for Groq API calls
        let fullResponse = '';
        const maxGroqRetries = 5; // Increased from 3 to 5
        let groqAttempt = 0;
        let lastGroqError: any = null;

        while (groqAttempt < maxGroqRetries) {
          try {
            groqAttempt++;
            console.log(`Groq API call attempt ${groqAttempt}/${maxGroqRetries}...`);

            await supabase
              .from('content_plan_outline_statuses')
              .insert({
                outline_guid: outlineGuidForStatus,
                status: `groq_regeneration_attempt_${groqAttempt}`
              });

            let attemptPrompt = regenerationPrompt;
            if (groqAttempt > 1) {
              attemptPrompt = `${regenerationPrompt}\n\nATTEMPT ${groqAttempt}: You previously failed to return valid JSON. This time you MUST return ONLY valid JSON with NO explanatory text. Start with { and end with }.`;
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

            if (fullResponse && fullResponse.length > 100) {
              console.log('✅ Successfully received improved outline response from Groq');
              break;
            } else {
              throw new Error(`Received empty or too short response (${fullResponse.length} chars)`);
            }

          } catch (error) {
            lastGroqError = error;
            console.error(`Groq API attempt ${groqAttempt} failed:`, error.message);

            if (groqAttempt < maxGroqRetries) {
              // Exponential backoff: 1s, 2s, 4s, 8s, 16s (capped at 16s)
              const backoffMs = Math.min(1000 * Math.pow(2, groqAttempt - 1), 16000);
              console.log(`Retrying Groq API call in ${backoffMs}ms (exponential backoff)...`);
              await new Promise(resolve => setTimeout(resolve, backoffMs));
            }
          }
        }

        if (!fullResponse || fullResponse.length < 100) {
          throw new Error(`Groq API failed after ${maxGroqRetries} attempts. Last error: ${lastGroqError?.message || 'Unknown error'}`);
        }

        await supabase
          .from('content_plan_outline_statuses')
          .insert({
            outline_guid: outlineGuidForStatus,
            status: 'parsing_improved_outline_response'
          });

        // Parse response
        let outlineJson = null;
        let parseError = null;

        // Strategy 1: Parse entire response
        try {
          outlineJson = JSON.parse(fullResponse);
          console.log('✅ Parsed entire response as JSON');
        } catch (e) {
          parseError = e;
          console.log('Strategy 1 failed:', e.message);
        }

        // Strategy 2: Look for JSON code blocks
        if (!outlineJson) {
          const codeBlockMatch = fullResponse.match(/```(?:json)?\s*([\s\S]*?)```/);
          if (codeBlockMatch) {
            try {
              outlineJson = JSON.parse(codeBlockMatch[1].trim());
              console.log('✅ Found and parsed JSON from code block');
            } catch (e) {
              console.log('Strategy 2 failed:', e.message);
            }
          }
        }

        // Strategy 3: Look for raw JSON object
        if (!outlineJson) {
          const jsonObjectMatch = fullResponse.match(/\{[\s\S]*"sections"[\s\S]*\}/);
          if (jsonObjectMatch) {
            try {
              outlineJson = JSON.parse(jsonObjectMatch[0]);
              console.log('✅ Found and parsed raw JSON object');
            } catch (e) {
              console.log('Strategy 3 failed:', e.message);
            }
          }
        }

        if (!outlineJson) {
          console.error('❌ ALL JSON PARSING STRATEGIES FAILED');
          throw new Error(`Could not parse improved outline JSON. Parse error: ${parseError?.message}`);
        }

        // Validate structure
        if (!outlineJson.sections || !Array.isArray(outlineJson.sections)) {
          console.error('❌ Invalid JSON structure. Got:', Object.keys(outlineJson));
          throw new Error('Response does not contain valid "sections" array');
        }

        console.log(`✅ Successfully parsed improved outline with ${outlineJson.sections.length} sections`);

        await supabase
          .from('content_plan_outline_statuses')
          .insert({
            outline_guid: outlineGuidForStatus,
            status: 'saving_improved_outline'
          });

        // Save to content_plan_outlines_ai
        await supabase
          .from('content_plan_outlines_ai')
          .insert({
            job_id: actualJobId,
            outline: outlineJson
          });

        // Update content_plan_outlines (use GUID if available, otherwise use job_id)
        const updateGuid = contentPlanOutlineGuid || actualJobId;
        await supabase
          .from('content_plan_outlines')
          .update({
            outline: JSON.stringify(outlineJson),
            status: 'Completed'
          })
          .eq('guid', updateGuid);

        // Update job status to Completed (final status)
        await supabase
          .from('outline_generation_jobs')
          .update({
            status: 'Completed',
            updated_at: new Date().toISOString(),
            heartbeat_at: new Date().toISOString()
          })
          .eq('id', actualJobId);

        await supabase
          .from('content_plan_outline_statuses')
          .insert({
            outline_guid: outlineGuidForStatus,
            status: 'fast_regeneration_completed'
          });

        console.log('✅ Fast outline regeneration completed successfully');

      } catch (backgroundError) {
        console.error('Error in fast regeneration processing:', backgroundError);

        try {
          const supabase = createClient(supabaseUrl, supabaseServiceKey);
          const outlineGuidForStatus = contentPlanOutlineGuid || actualJobId;
          
          // Get current retry count from job (handle gracefully if column doesn't exist)
          let currentRetryCount = 0;
          try {
            const { data: currentJob } = await supabase
              .from('outline_generation_jobs')
              .select('fast_regeneration_retry_count')
              .eq('id', actualJobId)
              .single();
            
            currentRetryCount = currentJob?.fast_regeneration_retry_count || 0;
          } catch (selectError) {
            // Column might not exist yet - use 0 as default
            console.warn('Could not read retry count (column may not exist):', selectError);
            currentRetryCount = 0;
          }
          const maxRegenerationRetries = 3;
          
          if (currentRetryCount < maxRegenerationRetries) {
            // Retry the regeneration
            const newRetryCount = currentRetryCount + 1;
            const retryDelaySeconds = Math.min(60 * Math.pow(2, currentRetryCount), 300); // Exponential backoff: 60s, 120s, 240s (max 5min)
            
            console.log(`Fast regeneration failed (attempt ${currentRetryCount + 1}/${maxRegenerationRetries}). Scheduling retry in ${retryDelaySeconds}s...`);
            
            // Update job status with retry info (handle gracefully if columns don't exist)
            try {
              await supabase
                .from('outline_generation_jobs')
                .update({
                  status: 'fast_regeneration_failed',
                  fast_regeneration_retry_count: newRetryCount,
                  fast_regeneration_retry_at: new Date(Date.now() + retryDelaySeconds * 1000).toISOString(),
                  updated_at: new Date().toISOString(),
                  heartbeat_at: new Date().toISOString()
                })
                .eq('id', actualJobId);
            } catch (updateError) {
              // If columns don't exist, just update status
              console.warn('Could not update retry columns (may not exist yet), updating status only:', updateError);
              await supabase
                .from('outline_generation_jobs')
                .update({
                  status: 'fast_regeneration_failed',
                  updated_at: new Date().toISOString(),
                  heartbeat_at: new Date().toISOString()
                })
                .eq('id', actualJobId);
            }

            await supabase
              .from('content_plan_outline_statuses')
              .insert({
                outline_guid: outlineGuidForStatus,
                status: `fast_regeneration_failed_retry_${newRetryCount}_of_${maxRegenerationRetries}: ${backgroundError.message.substring(0, 100)}`
              });
            
            // Schedule retry by calling the function again after delay
            setTimeout(async () => {
              try {
                console.log(`Retrying fast regeneration (attempt ${newRetryCount}/${maxRegenerationRetries})...`);
                const retryResponse = await fetch(`${supabaseUrl}/functions/v1/fast-regenerate-outline`, {
                  method: 'POST',
                  headers: {
                    'Authorization': `Bearer ${supabaseServiceKey}`,
                    'Content-Type': 'application/json'
                  },
                  body: JSON.stringify({
                    job_id: actualJobId,
                    content_plan_outline_guid: contentPlanOutlineGuid
                  })
                });
                
                if (!retryResponse.ok) {
                  const errorText = await retryResponse.text();
                  console.error(`Retry attempt ${newRetryCount} failed to trigger:`, errorText);
                } else {
                  console.log(`Retry attempt ${newRetryCount} triggered successfully`);
                }
              } catch (retryError) {
                console.error(`Error triggering retry attempt ${newRetryCount}:`, retryError);
              }
            }, retryDelaySeconds * 1000);
            
          } else {
            // Max retries reached - mark as permanently failed
            console.error(`Fast regeneration failed after ${maxRegenerationRetries} attempts. Marking as permanently failed.`);
            
            // Update job status (handle gracefully if retry columns don't exist)
            try {
              await supabase
                .from('outline_generation_jobs')
                .update({
                  status: 'fast_regeneration_failed',
                  fast_regeneration_retry_count: maxRegenerationRetries,
                  updated_at: new Date().toISOString(),
                  heartbeat_at: new Date().toISOString()
                })
                .eq('id', actualJobId);
            } catch (updateError) {
              // If columns don't exist, just update status
              console.warn('Could not update retry columns (may not exist yet), updating status only:', updateError);
              await supabase
                .from('outline_generation_jobs')
                .update({
                  status: 'fast_regeneration_failed',
                  updated_at: new Date().toISOString(),
                  heartbeat_at: new Date().toISOString()
                })
                .eq('id', actualJobId);
            }

            await supabase
              .from('content_plan_outline_statuses')
              .insert({
                outline_guid: outlineGuidForStatus,
                status: `fast_regeneration_failed_max_retries_exceeded: ${backgroundError.message.substring(0, 100)}`
              });
          }
        } catch (updateError) {
          console.error('Error updating job status:', updateError);
        }
      }
    })();

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Fast outline regeneration started',
        job_id
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error processing fast regeneration request:', error);

    if (job_id) {
      try {
        const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
        const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
        const supabase = createClient(supabaseUrl, supabaseServiceKey);

        // Try to determine actual job_id if job_id is a UUID
        const isUUID = typeof job_id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(job_id);
        let actualJobIdForError = job_id;
        
        if (isUUID) {
          const { data: outlineData } = await supabase
            .from('content_plan_outlines')
            .select('job_id')
            .eq('guid', job_id)
            .single();
          
          if (outlineData?.job_id) {
            actualJobIdForError = outlineData.job_id;
          }
        }

        await supabase
          .from('outline_generation_jobs')
          .update({
            status: 'fast_regeneration_failed',
            updated_at: new Date().toISOString()
          })
          .eq('id', actualJobIdForError);
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
