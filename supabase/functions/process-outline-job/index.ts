// supabase/functions/process-outline-job/index.ts
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
    
    console.log(`Process outline job started for job_id: ${job_id}`);
    
    // Initialize Supabase client for validation
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    const validationClient = createClient(supabaseUrl, supabaseServiceKey);

    // Validate that the job exists before returning response
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
    
    // Start the processing in the background
    (async () => {
      try {
        // Small delay to ensure the response is sent
        await new Promise(resolve => setTimeout(resolve, 200));
        
        console.log(`Beginning background processing for job_id: ${job_id}`);
        
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

        // Step 2: Update job status with heartbeat
        await supabase
          .from('outline_generation_jobs')
          .update({ 
            status: 'determining_search_terms', 
            updated_at: new Date().toISOString(),
            heartbeat: new Date().toISOString()
          })
          .eq('id', job_id);

        // Step 3: Fetch client profile for domain-specific guidance
        console.log(`Fetching client profile for domain: ${jobDetails.domain}`);
        let clientSynopsis = '';
        try {
          const clientProfileResponse = await fetch(`https://pp-api.replit.app/pairs/all/${jobDetails.domain}`);
          if (clientProfileResponse.ok) {
            const clientProfile = await clientProfileResponse.json();
            clientSynopsis = clientProfile.synopsis || '';
            console.log(`Retrieved client profile with synopsis of length: ${clientSynopsis.length}`);
          } else {
            console.log(`Error fetching client profile: ${clientProfileResponse.status}`);
          }
        } catch (profileError) {
          console.error(`Error fetching client profile: ${profileError.message}`);
          // Continue even if this fails
        }

        // Step 4: Generate search terms with Claude AI
        console.log('Generating search terms with Claude AI');
        const searchTermsPrompt = `You are a world-class SEO content researcher. Your task is to generate optimal search terms for researching and writing a comprehensive article. 

I need you to analyze three key inputs and generate search terms that will yield the most valuable research material:

1. Content Plan Keyword: "${jobDetails.content_plan_keyword}" (the broader topic/category)
2. Post Keyword: "${jobDetails.post_keyword}" (the specific focus of this article)
3. Post Title: "${jobDetails.post_title}" (the angle and context)

Brand Context: This content is for ${jobDetails.domain}. ${clientSynopsis}

Based on these inputs, generate THREE DISTINCT SETS of search terms:

SET 1: 3 search terms that combine the content plan keyword with the post keyword
SET 2: 3 search terms based specifically on the post title's angle
SET 3: 3 search terms that explore related concepts, common questions, or typical pain points

Respond with a JSON structure containing these three sets of search terms. Format your response ONLY as valid JSON that can be parsed directly:

{
  "combinedTerms": ["term1", "term2", "term3"],
  "titleAngleTerms": ["term4", "term5", "term6"],
  "relatedConceptTerms": ["term7", "term8", "term9"]
}`;

        const searchTermsResponse = await anthropic.beta.messages.create({
          model: "claude-3-7-sonnet-20250219",
          max_tokens: 1000,
          temperature: 1,
          messages: [
            {
              role: "user",
              content: searchTermsPrompt
            }
          ]
        });

        // Parse search terms - handle different response structures
        let searchTermsText = '';
        if (Array.isArray(searchTermsResponse.content)) {
          searchTermsText = searchTermsResponse.content[0].text;
        } else if (typeof searchTermsResponse.content === 'string') {
          searchTermsText = searchTermsResponse.content;
        }
        
        // Clean the string and parse as JSON
        searchTermsText = searchTermsText.replace(/```json|```/g, '').trim();
        console.log(`Raw search terms response: ${searchTermsText}`);
        
        let searchTermsStructure;
        try {
          searchTermsStructure = JSON.parse(searchTermsText);
          console.log('Successfully parsed search terms JSON structure');
        } catch (parseError) {
          console.error(`Error parsing search terms JSON: ${parseError.message}`);
          // Create a default structure if parsing fails
          searchTermsStructure = {
            combinedTerms: [`${jobDetails.content_plan_keyword} ${jobDetails.post_keyword}`],
            titleAngleTerms: [jobDetails.post_title],
            relatedConceptTerms: [jobDetails.post_keyword]
          };
          console.log('Using fallback search terms structure');
        }

        // Always include the main keywords directly
        const basePriorityTerms = [
          jobDetails.post_keyword,                      // Top priority - the specific focus
          jobDetails.content_plan_keyword,              // Second priority - the broader topic
          `${jobDetails.post_keyword} ${jobDetails.domain}`,   // Domain-specific focus
          jobDetails.post_title                         // The exact title as a search term
        ];
        
        // Combine all search terms with priority information
        const allSearchTerms = [
          // Base terms - highest priority
          ...basePriorityTerms.map(term => ({ term, category: 'base', priority: 1 })),
          
          // Combined terms - second priority
          ...(searchTermsStructure.combinedTerms || []).map(term => ({ term, category: 'combined', priority: 2 })),
          
          // Title angle terms - third priority
          ...(searchTermsStructure.titleAngleTerms || []).map(term => ({ term, category: 'titleAngle', priority: 3 })),
          
          // Related concept terms - fourth priority
          ...(searchTermsStructure.relatedConceptTerms || []).map(term => ({ term, category: 'relatedConcept', priority: 4 }))
        ];
        
        // Remove any duplicates
        const uniqueTerms = [];
        const termSet = new Set();
        
        for (const termObj of allSearchTerms) {
          const normalizedTerm = termObj.term.toLowerCase().trim();
          if (!termSet.has(normalizedTerm) && normalizedTerm.length > 0) {
            termSet.add(normalizedTerm);
            uniqueTerms.push(termObj);
          }
        }
        
        console.log(`Created ${uniqueTerms.length} unique search terms across different categories`);
        
        // Fallback check
        if (uniqueTerms.length === 0) {
          uniqueTerms.push({ 
            term: jobDetails.post_keyword, 
            category: 'fallback', 
            priority: 1 
          });
          console.log(`Using fallback search term: ${jobDetails.post_keyword}`);
        }

        // Step 5: Update job status and save search terms with heartbeat
        await supabase
          .from('outline_generation_jobs')
          .update({ 
            status: 'running_searches',
            updated_at: new Date().toISOString(),
            heartbeat: new Date().toISOString()
          })
          .eq('id', job_id);

        // Save search terms with category and priority information
        console.log('Saving search terms to database');
        for (const { term, category, priority } of uniqueTerms) {
          await supabase
            .from('outline_search_terms')
            .insert({
              job_id,
              search_term: term,
              category,
              priority
            });
        }

        // Step 6: Run searches using Jina API
        console.log('Running searches with Jina API');
        const searchResults = [];
        for (const { term, category, priority } of uniqueTerms) {
          const encodedTerm = encodeURIComponent(term);
          // Using the proper Jina.ai search API endpoint
          const searchUrl = `https://s.jina.ai/?q=${encodedTerm}&num=10`; // Limiting to 10 results per term for efficiency
          
          try {
            console.log(`Searching for term: ${term}`);
            const searchResponse = await fetch(searchUrl, {
              headers: {
                'Accept': 'application/json',
                'Authorization': 'Bearer jina_18e30bccaa5144e2a0d7c22c3d54d19cP3IGowUUyEPIEI5N-SWTNlQJJNB2',
                'X-Engine': 'browser'
              }
            });
            
            if (searchResponse.ok) {
              const searchData = await searchResponse.json();
              
              // Process the Jina.ai API response format
              if (searchData.code === 200 && searchData.status === 20000 && searchData.data && Array.isArray(searchData.data)) {
                console.log(`Received ${searchData.data.length} results for term: ${term}`);
                
                // Save search results - data is in the 'data' array in the response
                for (const result of searchData.data) {
                  // Skip results without a URL
                  if (!result.url) continue;
                  
                  // Add result to the collection with full content for analysis
                  searchResults.push({
                    url: result.url,
                    title: result.title || '',
                    description: result.description || '',
                    content: result.content || '',  // Keep content in memory for analysis
                    publishedTime: result.publishedTime || null,
                    date: result.date || null
                  });
                  
                  // Save all fields including full content to database
                  await supabase
                    .from('outline_search_results')
                    .insert({
                      job_id,
                      search_term: term,
                      search_category: category,
                      search_priority: priority,
                      url: result.url,
                      title: result.title || '',
                      description: result.description || '',
                      publishedTime: result.publishedTime || null,
                      date: result.date || null,
                      content: result.content || '' // Store the full content
                    });
                }
              } else {
                // Handle case where response structure doesn't match expected format
                console.log(`Received unexpected response structure from Jina API:`, searchData);
                
                // Check for fallback response formats
                if (searchData.results && Array.isArray(searchData.results) && searchData.results.length > 0) {
                  console.log(`Falling back to 'results' array with ${searchData.results.length} items`);
                  for (const result of searchData.results) {
                    if (!result.url) continue;
                    
                    // Store in memory with full data
                    searchResults.push({
                      ...result,
                      // Ensure we capture date information if available
                      publishedTime: result.publishedTime || null,
                      date: result.date || null
                    });
                    
                    // Save all fields including full content to database
                    await supabase
                      .from('outline_search_results')
                      .insert({
                        job_id,
                        search_term: term,
                        search_category: category,
                        search_priority: priority,
                        url: result.url,
                        title: result.title || '',
                        description: result.snippet || '',
                        publishedTime: result.publishedTime || null,
                        date: result.date || null,
                        content: result.content || '' // Store any content that might be available
                      });
                  }
                }
              }
            } else {
              console.error(`Error searching for "${term}": ${searchResponse.status}`);
            }
          } catch (searchError) {
            console.error(`Error searching for "${term}":`, searchError);
          }
        }

        // Step 7: Update job status with heartbeat
        await supabase
          .from('outline_generation_jobs')
          .update({ 
            status: 'analyzing_results',
            updated_at: new Date().toISOString(),
            heartbeat: new Date().toISOString()
          })
          .eq('id', job_id);

        // Step 8: Get all search results
        if (searchResults.length === 0) {
          console.log('No search results found, fetching from database');
          const { data: dbSearchResults, error: resultsError } = await supabase
            .from('outline_search_results')
            .select('*')
            .eq('job_id', job_id);

          if (resultsError) {
            throw new Error(`Failed to fetch search results: ${resultsError.message}`);
          }
          
          if (dbSearchResults && dbSearchResults.length > 0) {
            searchResults.push(...dbSearchResults);
          }
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
          
          // Save the simple outline
          await supabase
            .from('content_plan_outlines_ai')
            .insert({
              job_id,
              outline: simpleOutline
            });
            
          // Update job status to completed with heartbeat
          await supabase
            .from('outline_generation_jobs')
            .update({ 
              status: 'completed',
              updated_at: new Date().toISOString(),
              heartbeat: new Date().toISOString()
            })
            .eq('id', job_id);
            
          console.log('Outline generation completed with fallback approach');
          return;
        }

        // Step 9: Analyze search results with Claude
        console.log(`Analyzing ${searchResults.length} search results with Claude`);
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

        Here are the search results (limited to first 20 for brevity if there are more):
        ${JSON.stringify(searchResults.slice(0, 20), null, 2)}
        
        Please pay special attention to any articles that have full content included, as these will provide the most accurate heading structures.`;

        const analysisResponse = await anthropic.beta.messages.create({
          model: "claude-3-7-sonnet-20250219",
          max_tokens: 64000,
          temperature: 1,
          messages: [
            {
              role: "user",
              content: searchResultsAnalysisPrompt
            }
          ]
        });

        // Parse URL analysis - handle different response structures
        let analysisText = '';
        if (Array.isArray(analysisResponse.content)) {
          analysisText = analysisResponse.content[0].text;
        } else if (typeof analysisResponse.content === 'string') {
          analysisText = analysisResponse.content;
        }

        // Extract the JSON from the response
        let analysisJson;
        try {
          // Look for JSON array in the response
          const jsonMatch = analysisText.match(/\[[\s\S]*\]/);
          if (jsonMatch) {
            analysisJson = JSON.parse(jsonMatch[0]);
            console.log(`Parsed analysis for ${analysisJson.length} URLs`);
          } else {
            throw new Error('No JSON array found in the response');
          }
        } catch (jsonError) {
          console.error(`Error parsing analysis JSON: ${jsonError.message}`);
          // Create a simplified analysis from the search results
          analysisJson = searchResults.slice(0, 10).map(result => ({
            url: result.url,
            title: result.title || 'Untitled',
            headings: {
              h1: [result.title || 'Untitled'],
              h2: [],
              h3: []
            },
            summary: result.snippet || result.description || 'No summary available'
          }));
          console.log(`Created simplified analysis for ${analysisJson.length} URLs`);
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

        // Step 10: Update job status with heartbeat
        await supabase
          .from('outline_generation_jobs')
          .update({ 
            status: 'generating_outline',
            updated_at: new Date().toISOString(),
            heartbeat: new Date().toISOString()
          })
          .eq('id', job_id);

        // Step 11: Generate outline with Claude
        console.log('Generating outline with Claude AI');
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
1. Never include an introduction and conclusion section
2. Have 4-5 main sections with 3-4 subsections each
3. Cover all important aspects of the topic
4. Be well-structured and logical
5. Be SEO-friendly and incorporate the keyword "${jobDetails.post_keyword}" naturally
6. Be original and not copy the structure of any single source
7. Match the style and tone of ${jobDetails.domain}
8. Emphasize current best practices and information
9. Address any significant changes or developments in this field (if applicable)
10. Balance information from all search categories, but prioritize the most relevant ones

Restrictions:
  - Never make a category title or subcategory title similar to the following:
    - Purpose of the article
    - Recap of something mentioned in the outline previously
    - Request for the reader to engage
    - Case study examples

  - NEVER use Intro, Introduction, or Conclusion as headings or subheadings in an outline

Format your response as a JSON object with this structure:
{
  "title": "Article Title",
  "sections": [
    {
      "title": "Main Section 1",
      "subheadings": ["Subheading 1.1", "Subheading 1.2", "Subheading 1.3"]
    },
    {
      "title": "Main Section 2",
      "subheadings": ["Subheading 2.1", "Subheading 2.2", "Subheading 2.3"]
    },
    // More sections...
  ]
}`;

        const outlineResponse = await anthropic.beta.messages.create({
          model: "claude-3-7-sonnet-20250219",
          max_tokens: 32000,
          temperature: 1,
          messages: [
            {
              role: "user",
              content: outlinePrompt
            }
          ]
        });

        // Parse outline - handle different response structures
        let outlineText = '';
        if (Array.isArray(outlineResponse.content)) {
          outlineText = outlineResponse.content[0].text;
        } else if (typeof outlineResponse.content === 'string') {
          outlineText = outlineResponse.content;
        }

        // Extract the JSON from the response
        let outlineJson;
        try {
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

        // Step 12: Create outline in database
        console.log('Saving outline to database');
        await supabase
          .from('content_plan_outlines_ai')
          .insert({
            job_id,
            content_plan_outline_guid: job_id,
            outline: outlineJson
          });

        // Step 13: Update job status to completed with heartbeat
        await supabase
          .from('outline_generation_jobs')
          .update({ 
            status: 'completed',
            updated_at: new Date().toISOString(),
            heartbeat: new Date().toISOString()
          })
          .eq('id', job_id);

        console.log('Outline generation process completed successfully');
      } catch (backgroundError) {
        console.error('Error in background processing:', backgroundError);
        
        // Update job status to failed with detailed error
        try {
          if (job_id) {
            const supabase = createClient(supabaseUrl, supabaseServiceKey);
            await supabase
              .from('outline_generation_jobs')
              .update({ 
                status: 'failed',
                error: backgroundError.message,
                updated_at: new Date().toISOString(),
                heartbeat: new Date().toISOString()
              })
              .eq('id', job_id);
              
            console.log(`Updated job ${job_id} status to failed due to background error: ${backgroundError.message}`);
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
        message: 'Outline generation process started', 
        job_id
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error processing outline job request:', error);
    
    // Update job status to failed if we have the job_id
    if (job_id) {
      try {
        const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
        const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
        const supabase = createClient(supabaseUrl, supabaseServiceKey);
        
        await supabase
          .from('outline_generation_jobs')
          .update({ 
            status: 'failed',
            error: error.message,
            updated_at: new Date().toISOString(),
            heartbeat: new Date().toISOString()
          })
          .eq('id', job_id);
          
        console.log(`Updated job ${job_id} status to failed due to request error: ${error.message}`);
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