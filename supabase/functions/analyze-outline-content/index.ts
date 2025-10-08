// supabase/functions/analyze-outline-content/index.ts
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
    
    console.log(`Analyze outline content started for job_id: ${job_id}`);
    
    // Initialize Supabase client for validation
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    const validationClient = createClient(supabaseUrl, supabaseServiceKey);

    // Validate that the job exists before returning response
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
    
    // Start the processing in the background
    (async () => {
      try {
        // Small delay to ensure the response is sent
        await new Promise(resolve => setTimeout(resolve, 200));
        
        console.log(`Beginning background analysis for job_id: ${job_id}`);
        
        // Create a new Supabase client for the background process
        const supabase = createClient(supabaseUrl, supabaseServiceKey);

        // Initialize Anthropic client
        const anthropic = new Anthropic({
          apiKey: Deno.env.get('ANTHROPIC_API_KEY') || '',
        });

        // Step 1: Fetch job details
        const { data: jobDetails, error: jobDetailsError } = await supabase
          .from('outline_generation_jobs')
          .select('*')
          .eq('id', job_id)
          .single();

        if (jobDetailsError || !jobDetails) {
          throw new Error(`Job details not found: ${jobDetailsError?.message || 'Unknown error'}`);
        }

        // Step 2: Update job status to analyzing
        await supabase
          .from('outline_generation_jobs')
          .update({ 
            status: 'analyzing_results',
            updated_at: new Date().toISOString()
          })
          .eq('id', job_id);
          
        // Update status for the Next.js app using job_id as the outline guid
        const outlineGuid = job_id;
        await supabase
          .from('content_plan_outline_statuses')
          .insert({
            outline_guid: outlineGuid,
            status: 'preparing_to_fetch_article_data'
          });

        // Step 3: Get search results from the database
        const { data: dbSearchResults, error: resultsError } = await supabase
          .from('outline_search_results')
          .select('*')
          .eq('job_id', job_id);

        if (resultsError) {
          throw new Error(`Failed to fetch search results: ${resultsError.message}`);
        }
        
        // Create a mutable copy of the search results
        let searchResults = dbSearchResults ? [...dbSearchResults] : [];
        
        console.log(`Retrieved ${searchResults.length} search results from database`);
        
        // Limit the number of search results to analyze (to avoid exceeding context limits)
        const MAX_RESULTS_TO_ANALYZE = 20;
        if (searchResults.length > MAX_RESULTS_TO_ANALYZE) {
          console.log(`Limiting analysis to ${MAX_RESULTS_TO_ANALYZE} results out of ${searchResults.length} total results`);
          
          // Filter search results by priority and limit per category
          // First, group by search_category
          const resultsByCategory = {};
          for (const result of searchResults) {
            const category = result.search_category || 'unknown';
            if (!resultsByCategory[category]) {
              resultsByCategory[category] = [];
            }
            resultsByCategory[category].push(result);
          }
          
          // Then, sort each category by priority and take a balanced subset
          const selectedResults = [];
          const categories = Object.keys(resultsByCategory);
          
          // Calculate how many results to take from each category
          const resultsPerCategory = Math.max(1, Math.floor(MAX_RESULTS_TO_ANALYZE / categories.length));
          
          for (const category of categories) {
            // Sort by priority (lower number = higher priority)
            resultsByCategory[category].sort((a, b) => 
              (a.search_priority || 999) - (b.search_priority || 999)
            );
            
            // Take top N results from this category
            selectedResults.push(...resultsByCategory[category].slice(0, resultsPerCategory));
          }
          
          // If we still have room, add more from highest priority categories
          while (selectedResults.length < MAX_RESULTS_TO_ANALYZE && categories.length > 0) {
            // Find category with highest priority results remaining
            let bestCategory = null;
            let bestPriority = 999;
            
            for (const category of categories) {
              if (resultsByCategory[category].length > 0) {
                const topPriority = resultsByCategory[category][0].search_priority || 999;
                if (topPriority < bestPriority) {
                  bestPriority = topPriority;
                  bestCategory = category;
                }
              }
            }
            
            if (bestCategory) {
              // Take next result from this category
              selectedResults.push(resultsByCategory[bestCategory][0]);
              resultsByCategory[bestCategory].shift();
            } else {
              break; // No more results available
            }
          }
          
          // Replace the full results with our balanced selection
          searchResults = selectedResults;
          console.log(`Selected ${searchResults.length} results with balanced distribution across categories`);
        }

        // Handle case with no search results
        if (searchResults.length === 0) {
          console.log('No search results found, using fallback approach');
          // Create a simple outline directly based on the title and keywords
          const simpleOutline = {
            "title": jobDetails.post_title,
            "sections": [
              {
                "title": "Introduction",
                "subheadings": ["Overview of " + jobDetails.post_keyword, "Importance of " + jobDetails.post_keyword, "What This Article Covers"]
              },
              {
                "title": "Understanding " + jobDetails.post_keyword,
                "subheadings": ["Definition and Basic Concepts", "Key Components", "Common Misconceptions"]
              },
              {
                "title": jobDetails.post_title + ": Main Considerations",
                "subheadings": ["Important Factors to Consider", "Expert Recommendations", "Best Practices"]
              },
              {
                "title": "Practical Applications",
                "subheadings": ["Real-World Examples", "Step-by-Step Guide", "Tips for Success"]
              },
              {
                "title": "Conclusion",
                "subheadings": ["Summary of Key Points", "Final Recommendations", "Next Steps"]
              }
            ]
          };
          
          // Save the simple outline to content_plan_outlines_ai
          await supabase
            .from('content_plan_outlines_ai')
            .insert({
              job_id,
              outline: simpleOutline
            });
            
          // Update the existing record in content_plan_outlines using job_id as the guid
          const { error: updateError } = await supabase
            .from('content_plan_outlines')
            .update({
              outline: JSON.stringify(simpleOutline),
              status: 'completed',
              updated_at: new Date().toISOString()
            })
            .eq('guid', job_id);
            
          if (updateError) {
            console.error('Error updating content_plan_outlines:', updateError);
          } else {
            console.log(`Updated content_plan_outlines for guid (job_id): ${job_id}`);
          }
            
          // Add status updates for Next.js app
          const statusUpdates = [
            'analyzing_article_data',
            'extracting_article_outlines',
            'compiling_multiple_outlines',
            'analyzing_multiple_outlines',
            'determining_optimal_outline',
            'saving_outline',
            'completed'
          ];
          
          // Insert each status in sequence using job_id as the outline guid
          for (const status of statusUpdates) {
            await supabase
              .from('content_plan_outline_statuses')
              .insert({
                outline_guid: job_id,
                status
              });
          }
            
          // Update job status to completed
          await supabase
            .from('outline_generation_jobs')
            .update({ 
              status: 'completed',
              updated_at: new Date().toISOString()
            })
            .eq('id', job_id);
            
          console.log('Outline generation completed with fallback approach');
          return;
        }

        // Step 4: Analyze search results with Claude
        // Process results in batches if needed
        console.log(`Processing ${searchResults.length} search results for analysis`);
        
        // Update status for the Next.js app - fetching article data
        await supabase
          .from('content_plan_outline_statuses')
          .insert({
            outline_guid: outlineGuid,
            status: `fetching_article_data: 1/${Math.min(searchResults.length, 6)}`
          });
          
        // Add more status updates to simulate the fetching process
        for (let i = 2; i <= Math.min(searchResults.length, 6); i++) {
          await supabase
            .from('content_plan_outline_statuses')
            .insert({
              outline_guid: outlineGuid,
              status: `fetching_article_data: ${i}/${Math.min(searchResults.length, 6)}`
            });
        }
        
        // Update status for the Next.js app - finished fetching article data
        await supabase
          .from('content_plan_outline_statuses')
          .insert({
            outline_guid: outlineGuid,
            status: 'finished_fetching_article_data'
          });
        
        // Determine if we need batch processing
        const BATCH_SIZE = 20; // Max results to process in a single batch
        const needsBatchProcessing = searchResults.length > BATCH_SIZE;
        
        // Prepare all results with content truncation
        const processedResults = searchResults.map(result => {
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
        
        // Prepare final analysis input
        let analysisInput;
        let analysisJson = [];
        
        // Update status for the Next.js app - analyzing article data
        await supabase
          .from('content_plan_outline_statuses')
          .insert({
            outline_guid: outlineGuid,
            status: 'analyzing_article_data'
          });
        
        if (needsBatchProcessing) {
          // Process in batches
          console.log(`Using batch processing for ${processedResults.length} results`);
          
          // Split into batches
          const batches = [];
          for (let i = 0; i < processedResults.length; i += BATCH_SIZE) {
            batches.push(processedResults.slice(i, i + BATCH_SIZE));
          }
          
          console.log(`Split into ${batches.length} batches of up to ${BATCH_SIZE} results each`);
          
          // Process each batch
          for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
            const batch = batches[batchIndex];
            console.log(`Processing batch ${batchIndex + 1} of ${batches.length} with ${batch.length} results`);
            
            // Use this batch as input
            analysisInput = batch;
            
            // Create batch-specific prompt
            const batchPrompt = `Given the following search engine results (batch ${batchIndex + 1} of ${batches.length}), analyze each article. Extract the title, URL, and create a structured breakdown of the content's main headings and subheadings.

For articles that include their full content, please analyze the content to identify the actual heading structure. For articles without full content, use the title and snippet to make an educated guess about possible headings.

This should be a JSON object in the following structure:
[
  {
    "url": "https://example.com/post1",
    "title": "Example Post 1",
    "headings": {
      "h1": ["Main Title"],
      "h2": ["Section 1", "Section 2"],
      "h3": ["Subsection 1.1", "Subsection 1.2", "Subsection 2.1"]
    },
    "summary": "A brief 2-3 sentence summary of what this article covers"
  }
]

Here are the search results (batch ${batchIndex + 1} of ${batches.length}):
${JSON.stringify(analysisInput, null, 2)}

Please pay special attention to any articles that have full content included, as these will provide the most accurate heading structures.`;

            // Process batch
            console.log(`Starting streaming analysis for batch ${batchIndex + 1}`);
            let batchAnalysisText = '';
            const batchStream = await anthropic.beta.messages.stream({
              model: "claude-3-7-sonnet-20250219",
              max_tokens: 86000,
              temperature: 1,
              messages: [
                {
                  role: "user",
                  content: batchPrompt
                }
              ],
              thinking: {
                type: "enabled",
                budget_tokens: 23000
              },
              betas: ["output-128k-2025-02-19"]
            });

            // Collect streamed chunks
            for await (const chunk of batchStream) {
              if (chunk.type === 'content_block_delta' && chunk.delta.text) {
                batchAnalysisText += chunk.delta.text;
              }
            }
            
            console.log(`Completed streaming analysis for batch ${batchIndex + 1}, received ${batchAnalysisText.length} characters`);
            
            // Extract JSON from the batch response
            try {
              const jsonMatch = batchAnalysisText.match(/\[[\s\S]*\]/);
              if (jsonMatch) {
                const batchJson = JSON.parse(jsonMatch[0]);
                console.log(`Parsed batch ${batchIndex + 1} analysis for ${batchJson.length} URLs`);
                // Add to overall results
                analysisJson.push(...batchJson);
              } else {
                throw new Error(`No JSON array found in batch ${batchIndex + 1} response`);
              }
            } catch (jsonError) {
              console.error(`Error parsing batch ${batchIndex + 1} analysis JSON: ${jsonError.message}`);
              // Create a simplified analysis for this batch
              const simplifiedBatchJson = batch.slice(0, 5).map(result => ({
                url: result.url,
                title: result.title || 'Untitled',
                headings: {
                  h1: [result.title || 'Untitled'],
                  h2: [],
                  h3: []
                },
                summary: result.description || 'No summary available'
              }));
              console.log(`Created simplified analysis for ${simplifiedBatchJson.length} URLs in batch ${batchIndex + 1}`);
              analysisJson.push(...simplifiedBatchJson);
            }
          }
          
          console.log(`Completed batch processing with ${analysisJson.length} total URL analyses`);
        } else {
          // Process all results in one go
          analysisInput = processedResults;
          
          // Create standard analysis prompt
          const searchResultsAnalysisPrompt = `Given the following search engine results, I want you to give me a detailed analysis of each article. Extract the title, URL, and create a structured breakdown of the content's main headings and subheadings.

For articles that include their full content, please analyze the content to identify the actual heading structure. For articles without full content, use the title and snippet to make an educated guess about possible headings.

This should be a JSON object in the following structure:
[
  {
    "url": "https://example.com/post1",
    "title": "Example Post 1",
    "headings": {
      "h1": ["Main Title"],
      "h2": ["Section 1", "Section 2"],
      "h3": ["Subsection 1.1", "Subsection 1.2", "Subsection 2.1"]
    },
    "summary": "A brief 2-3 sentence summary of what this article covers"
  }
]

Here are the search results:
${JSON.stringify(analysisInput, null, 2)}

Please pay special attention to any articles that have full content included, as these will provide the most accurate heading structures.`;

          // Process with streaming
          console.log("Starting streaming analysis with Claude API");
          let analysisText = '';
          const stream = await anthropic.beta.messages.stream({
            model: "claude-3-7-sonnet-20250219",
            max_tokens: 86000,
            temperature: 1,
            messages: [
              {
                role: "user",
                content: searchResultsAnalysisPrompt
              }
            ],
            thinking: {
              type: "enabled",
              budget_tokens: 23000
            },
            betas: ["output-128k-2025-02-19"]
          });

          // Collect streamed chunks
          for await (const chunk of stream) {
            if (chunk.type === 'content_block_delta' && chunk.delta.text) {
              analysisText += chunk.delta.text;
            }
          }
          
          console.log(`Completed streaming analysis, received ${analysisText.length} characters`);

          // Extract JSON from the response
          try {
            const jsonMatch = analysisText.match(/\[[\s\S]*\]/);
            if (jsonMatch) {
              analysisJson = JSON.parse(jsonMatch[0]);
              console.log(`Parsed analysis for ${analysisJson.length} URLs`);
            } else {
              throw new Error('No JSON array found in the response');
            }
          } catch (jsonError) {
            console.error(`Error parsing analysis JSON: ${jsonError.message}`);
            // Create simplified analysis
            analysisJson = processedResults.slice(0, 10).map(result => ({
              url: result.url,
              title: result.title || 'Untitled',
              headings: {
                h1: [result.title || 'Untitled'],
                h2: [],
                h3: []
              },
              summary: result.description || 'No summary available'
            }));
            console.log(`Created simplified analysis for ${analysisJson.length} URLs`);
          }
        }

        // Save URL analyses
        console.log('Saving URL analyses to database');
        for (const analysis of analysisJson) {
          await supabase
            .from('outline_url_analyses')
            .insert({
              job_id,
              url: analysis.url,
              title: analysis.title,
              headings: analysis.headings,
              summary: analysis.summary || ''
            });
        }
        
        // Update status for the Next.js app - extracting outlines
        await supabase
          .from('content_plan_outline_statuses')
          .insert({
            outline_guid: outlineGuid,
            status: 'extracting_article_outlines'
          });

        // Step 5: Update job status
        await supabase
          .from('outline_generation_jobs')
          .update({ 
            status: 'generating_outline',
            updated_at: new Date().toISOString()
          })
          .eq('id', job_id);

        // Step 6: Generate outline with Claude
        console.log('Generating outline with Claude AI');
        
        // Update status for the Next.js app - compiling multiple outlines
        await supabase
          .from('content_plan_outline_statuses')
          .insert({
            outline_guid: outlineGuid,
            status: 'compiling_multiple_outlines'
          });
          
        // Update status for the Next.js app - analyzing outlines
        await supabase
          .from('content_plan_outline_statuses')
          .insert({
            outline_guid: outlineGuid,
            status: 'analyzing_multiple_outlines'
          });
        // Get distinct categories with count of articles per category
        const { data: searchCategories, error: categoriesError } = await supabase
          .from('outline_search_results')
          .select('search_category, search_priority')
          .eq('job_id', job_id)
          .order('search_priority', { ascending: true });
        
        if (categoriesError) {
          console.error(`Error fetching search categories: ${categoriesError.message}`);
        }

        // Format category information for the prompt
        const categoryInfo = searchCategories ? 
          Array.from(new Set(searchCategories.map(c => c.search_category)))
            .map(category => {
              const count = searchCategories.filter(c => c.search_category === category).length;
              const priority = searchCategories.find(c => c.search_category === category)?.search_priority || 5;
              return { category, count, priority };
            })
            .sort((a, b) => a.priority - b.priority) : 
          [];
        
        const categoryContext = categoryInfo.length > 0 ? 
          `I searched for information using different types of search terms:
${categoryInfo.map(c => `- ${c.category} terms (priority ${c.priority}): Found ${c.count} results`).join('\n')}

The search results from higher priority categories (lower numbers) should generally be given more weight, as they're more closely aligned with the core topic.` : '';

        const outlinePrompt = `Create a detailed content outline for an article with the title "${jobDetails.post_title}". 

The article should focus on the keyword "${jobDetails.post_keyword}" and be part of a content plan about "${jobDetails.content_plan_keyword}".

I've analyzed several relevant articles and want you to create an original, comprehensive outline based on the following research:
${JSON.stringify(analysisJson, null, 2)}

${categoryContext}

Please consider the publication dates of the articles when evaluating their relevance and accuracy. Focus more on recent information when there are conflicts, as this topic may have evolving standards or practices.

CONTENT STRATEGY GUIDANCE:
- The outline should thoroughly cover the specific focus of "${jobDetails.post_keyword}" 
- It should also connect to the broader topic/category of "${jobDetails.content_plan_keyword}"
- It should maintain the specific angle implied by the title "${jobDetails.post_title}"

The outline should:
1. Include an introduction and conclusion section
2. Have 5-6 main sections with 3-4 subsections each
3. Cover all important aspects of the topic
4. Be well-structured and logical
5. Be SEO-friendly and incorporate the keyword "${jobDetails.post_keyword}" naturally
6. Be original and not copy the structure of any single source
7. Match the style and tone of ${jobDetails.domain}
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

        // Use streaming API for outline generation to prevent timeout
        console.log("Starting streaming outline generation with Claude API");
        let outlineText = '';
        
        // Add a timeout to the streaming API call
        const MAX_STREAM_TIME_MS = 180000; // 3 minutes timeout
        const streamTimeoutPromise = new Promise((_, reject) => {
          setTimeout(() => reject(new Error('Outline generation timed out after 3 minutes')), MAX_STREAM_TIME_MS);
        });
        
        // Record the stream start time
        const streamStartTime = Date.now();
        await supabase
          .from('content_plan_outline_statuses')
          .insert({
            outline_guid: outlineGuid,
            status: 'starting_outline_stream_generation'
          });
        
        try {
          // Use Promise.race to implement timeout
          const outlineStream = await Promise.race([
            anthropic.beta.messages.stream({
              model: "claude-3-7-sonnet-20250219",
              max_tokens: 72000,
              temperature: 1,
              messages: [
                {
                  role: "user",
                  content: outlinePrompt
                }
              ],
              thinking: {
                type: "enabled",
                budget_tokens: 23000
              },
              betas: ["output-128k-2025-02-19"]
            }),
            streamTimeoutPromise
          ]);

          // Collect streamed chunks
          for await (const chunk of outlineStream) {
            if (chunk.type === 'content_block_delta' && chunk.delta.text) {
              outlineText += chunk.delta.text;
            }
          }
          
          const streamDuration = Date.now() - streamStartTime;
          console.log(`Completed streaming outline generation in ${streamDuration}ms, received ${outlineText.length} characters`);
          
          // Record successful completion
          await supabase
            .from('content_plan_outline_statuses')
            .insert({
              outline_guid: outlineGuid,
              status: `outline_generation_completed_in_${Math.round(streamDuration/1000)}s`
            });
        } catch (streamError) {
          console.error(`Error during outline streaming: ${streamError.message}`);
          
          // Record the error
          await supabase
            .from('content_plan_outline_statuses')
            .insert({
              outline_guid: outlineGuid,
              status: `outline_generation_error: ${streamError.message.substring(0, 100)}`
            });
            
          // Check if it's a timeout
          if (streamError.message.includes('timed out')) {
            console.log('Using fallback outline generation due to timeout');
            
            // Use a simplified fallback approach with shorter timeout
            try {
              const fallbackResponse = await anthropic.beta.messages.create({
                model: "claude-3-opus-20240229",
                max_tokens: 32000,
                temperature: 1,
                messages: [
                  {
                    role: "user",
                    content: `Create a simplified outline for an article titled "${jobDetails.post_title}" focused on the keyword "${jobDetails.post_keyword}". Return only a JSON object with title and sections.`
                  }
                ]
              });
              
              outlineText = fallbackResponse.content[0].text;
              console.log(`Generated fallback outline with ${outlineText.length} characters`);
              
              await supabase
                .from('content_plan_outline_statuses')
                .insert({
                  outline_guid: outlineGuid,
                  status: 'fallback_outline_generated'
                });
            } catch (fallbackError) {
              console.error(`Fallback outline generation failed: ${fallbackError.message}`);
              throw new Error(`Both primary and fallback outline generation failed: ${streamError.message}, then ${fallbackError.message}`);
            }
          } else {
            // For non-timeout errors, just rethrow
            throw streamError;
          }
        }

        // Extract the JSON from the response
        let outlineJson;
        try {
          // Update status for determining optimal outline
          await supabase
            .from('content_plan_outline_statuses')
            .insert({
              outline_guid: outlineGuid,
              status: 'determining_optimal_outline'
            });
            
          // Look for JSON object in the response
          const jsonMatch = outlineText.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            outlineJson = JSON.parse(jsonMatch[0]);
            console.log('Successfully parsed outline JSON');
          } else {
            throw new Error('No JSON object found in the response');
          }
        } catch (jsonError) {
          console.error(`Error parsing outline JSON: ${jsonError.message}`);
          // Create a simplified outline
          outlineJson = {
            "title": jobDetails.post_title,
            "sections": [
              {
                "title": "Introduction",
                "subheadings": ["Overview of " + jobDetails.post_keyword, "Importance of " + jobDetails.post_keyword, "What This Article Covers"]
              },
              {
                "title": "Understanding " + jobDetails.post_keyword,
                "subheadings": ["Definition and Basic Concepts", "Key Components", "Common Misconceptions"]
              },
              {
                "title": jobDetails.post_title + ": Main Considerations",
                "subheadings": ["Important Factors to Consider", "Expert Recommendations", "Best Practices"]
              },
              {
                "title": "Practical Applications",
                "subheadings": ["Real-World Examples", "Step-by-Step Guide", "Tips for Success"]
              },
              {
                "title": "Conclusion",
                "subheadings": ["Summary of Key Points", "Final Recommendations", "Next Steps"]
              }
            ]
          };
          console.log('Created simplified outline');
        }

        // Step 7: Create outline in database
        console.log('Saving outline to database');
        
        // Update status for saving outline
        await supabase
          .from('content_plan_outline_statuses')
          .insert({
            outline_guid: outlineGuid,
            status: 'saving_outline'
          });
        
        // Insert into content_plan_outlines_ai
        await supabase
          .from('content_plan_outlines_ai')
          .insert({
            job_id,
            outline: outlineJson
          });
          
        // Update the existing record in content_plan_outlines using job_id as the guid
        console.log('Updating outline in content_plan_outlines table');
        await supabase
          .from('content_plan_outlines')
          .update({
            outline: JSON.stringify(outlineJson),
            status: 'completed',
            updated_at: new Date().toISOString()
          })
          .eq('guid', job_id);

        // Step 8: Update job status to completed
        await supabase
          .from('outline_generation_jobs')
          .update({ 
            status: 'completed',
            updated_at: new Date().toISOString()
          })
          .eq('id', job_id);
          
        // Final status update - completed
        await supabase
          .from('content_plan_outline_statuses')
          .insert({
            outline_guid: outlineGuid,
            status: 'completed'
          });

        console.log('Outline generation process completed successfully');
      } catch (backgroundError) {
        console.error('Error in background analysis processing:', backgroundError);
        
        // Update job status to failed
        try {
          if (job_id) {
            const supabase = createClient(supabaseUrl, supabaseServiceKey);
            await supabase
              .from('outline_generation_jobs')
              .update({ 
                status: 'analysis_failed',
                updated_at: new Date().toISOString()
              })
              .eq('id', job_id);
              
            console.log(`Updated job ${job_id} status to analysis_failed due to background error`);
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
        message: 'Outline analysis process started', 
        job_id
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error processing outline analysis request:', error);
    
    // Update job status to failed if we have the job_id
    if (job_id) {
      try {
        const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
        const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
        const supabase = createClient(supabaseUrl, supabaseServiceKey);
        
        await supabase
          .from('outline_generation_jobs')
          .update({ 
            status: 'analysis_failed',
            updated_at: new Date().toISOString()
          })
          .eq('id', job_id);
          
        console.log(`Updated job ${job_id} status to analysis_failed due to request error`);
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