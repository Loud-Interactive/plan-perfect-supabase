// PagePerfect: generate-seo-elements
// Function to generate SEO-optimized elements using Claude with thinking
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';
import { cleanText, decodeHtmlEntities } from '../_shared/encoding-utils.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Regex pattern for filtering out invalid keywords
const INVALID_KEYWORD_PATTERN =
  /(?:o(?:r(?:i?e(?:i?nt(?:r?al|la)|ntal))|t(?:ient)?al|tc)\s*(?:trad(?:e|ing)?)?|tr(?:a+d|ard)ing(?:\s+company(?:\s+store)?)?|(?:ori?ent|rient)al\s+tr(?:a+d|ard)(?:e|ing)?|mind(?:\s*w(?:are|ear)|eare)|mine(?:\s*)?ware|fun365|terry'?s\s+village)/i;
// Function to validate a keyword
function isValidKeyword(keyword: string): boolean {
  return !INVALID_KEYWORD_PATTERN.test(keyword.toLowerCase());
}

interface RequestBody {
  url: string;
  pageId?: string;
  anthropicApiKey?: string;
  modelName?: string;
}

serve(async (req) => {
  // Handle CORS preflight request
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Create Supabase client
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Parse request body
    const { 
      url, 
      pageId, 
      anthropicApiKey,
      modelName = 'claude-3-7-sonnet-20250219'
    } = await req.json() as RequestBody;

    if (!url && !pageId) {
      throw new Error('Either url or pageId is required');
    }

    // Use API key from request or environment variable
    const apiKey = anthropicApiKey || Deno.env.get('ANTHROPIC_API_KEY');
    if (!apiKey) {
      throw new Error('Anthropic API key is required');
    }

    console.log(`Generating SEO elements for ${url || `pageId: ${pageId}`}`);

    // Get page data
    let pageData;
    let pageContent;
    let pageKeywords;

    if (pageId) {
      // Fetch page data from the database
      const { data, error } = await supabaseClient
        .from('pages')
        .select('url, html')
        .eq('id', pageId)
        .single();

      if (error || !data) {
        throw new Error(`Error fetching page: ${error?.message || 'Page not found'}`);
      }

      pageData = data;
      
      // Convert HTML to markdown for better processing
      pageContent = htmlToMarkdown(pageData.html);
      
      // First check page_seo_recommendations table for keywords
      try {
        const { data: recKeywords, error: recError } = await supabaseClient
          .from('page_seo_recommendations')
          .select('keywords')
          .eq('page_id', pageId)
          .single();
          
        if (!recError && recKeywords?.keywords && Array.isArray(recKeywords.keywords) && recKeywords.keywords.length > 0) {
          // Filter out invalid keywords
          pageKeywords = recKeywords.keywords.filter(k => isValidKeyword(k.keyword));
          console.log(`Found ${pageKeywords.length} valid keywords in page_seo_recommendations`);
        }
      } catch (keywordError) {
        console.error(`Error checking recommendations table: ${keywordError.message}`);
      }
      
      // If no keywords yet, try GSC keywords
      if (!pageKeywords || pageKeywords.length === 0) {
        const { data: keywordsData, error: keywordsError } = await supabaseClient
          .from('gsc_keywords')
          .select('keyword, clicks, impressions, position, ctr')
          .eq('page_id', pageId)
          .order('impressions', { ascending: false })
          .limit(20);
          
        if (!keywordsError && keywordsData && keywordsData.length > 0) {
          // Filter out invalid keywords
          pageKeywords = keywordsData.filter(k => isValidKeyword(k.keyword));
          console.log(`Found ${pageKeywords.length} valid keywords from gsc_keywords`);
        }
      }
      
      // If we still have fewer than 3 keywords, generate some using AI
      if (!pageKeywords || pageKeywords.length < 3) {
        console.log(`Found only ${pageKeywords?.length || 0} keywords, generating additional keywords with AI`);
        
        try {
          const keywordResponse = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/extract-content-keywords`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`
            },
            body: JSON.stringify({
              pageId: pageId,
              saveToDatabase: false // We'll merge them ourselves
            })
          });
          
          if (keywordResponse.ok) {
            const keywordResult = await keywordResponse.json();
            
            if (keywordResult.success && Array.isArray(keywordResult.gscCompatibleKeywords)) {
              if (!pageKeywords) pageKeywords = [];
              
              // Combine existing keywords with AI-generated ones
              const existingKeywordTexts = new Set(pageKeywords.map(k => k.keyword?.toLowerCase()));
              
              // Add AI keywords that don't duplicate existing ones and are valid
              for (const aiKeyword of keywordResult.gscCompatibleKeywords) {
                if (!existingKeywordTexts.has(aiKeyword.keyword?.toLowerCase()) && 
                    isValidKeyword(aiKeyword.keyword)) {
                  pageKeywords.push({
                    ...aiKeyword,
                    ai_generated: true,
                  });
                  existingKeywordTexts.add(aiKeyword.keyword?.toLowerCase());
                  
                  // Once we have at least 5 keywords total, we can stop
                  if (pageKeywords.length >= 5) break;
                }
              }
              
              console.log(`Added AI-generated keywords, now have ${pageKeywords.length} total`);
            }
          }
        } catch (aiError) {
          console.error(`Error generating AI keywords: ${aiError.message}`);
        }
      }
    } else {
      // For URL-only requests, we'll need to fetch the content
      pageData = { url };
      
      // Fetch page content using our crawl-page-html function
      const response = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/crawl-page-html`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`
        },
        body: JSON.stringify({ url })
      });
      
      if (!response.ok) {
        throw new Error(`Error fetching page content: ${response.status} ${response.statusText}`);
      }
      
      const htmlResult = await response.json();
      
      if (!htmlResult.success) {
        throw new Error(`Error crawling URL: ${htmlResult.error || 'Unknown error'}`);
      }
      
      // Convert HTML to markdown
      pageContent = htmlToMarkdown(htmlResult.html);
      
      // Generate keywords for URL-only requests
      try {
        const keywordResponse = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/extract-content-keywords`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`
          },
          body: JSON.stringify({
            url: url,
            htmlContent: htmlResult.html,
            saveToDatabase: false
          })
        });
        
        if (keywordResponse.ok) {
          const keywordResult = await keywordResponse.json();
          
          if (keywordResult.success && Array.isArray(keywordResult.gscCompatibleKeywords)) {
            // Filter out invalid keywords
            pageKeywords = keywordResult.gscCompatibleKeywords
              .filter(k => isValidKeyword(k.keyword))
              .slice(0, 10);
            console.log(`Generated ${pageKeywords.length} valid AI keywords for URL-only request`);
          }
        }
      } catch (aiError) {
        console.error(`Error generating AI keywords for URL: ${aiError.message}`);
      }
    }

    // Format keyword data if available
    let keywordsText = 'No keyword data available.';
    if (pageKeywords && pageKeywords.length > 0) {
      // STEP 1: First sort by AI vs GSC and impressions to get top keywords
      let sortedByImpressions = [...pageKeywords].sort((a, b) => {
        // If one is AI-generated and the other isn't, prefer GSC data
        if (a.ai_generated && !b.ai_generated) return 1;
        if (!a.ai_generated && b.ai_generated) return -1;
        
        // Otherwise sort by impressions or relevance for AI keywords
        if (a.impressions && b.impressions) {
          return b.impressions - a.impressions;
        } 
        if (a.relevance && b.relevance) {
          return b.relevance - a.relevance;
        }
        
        return 0;
      });
      
      // STEP 2: Take the top 10 keywords (or all if less than 10)
      const top10Keywords = sortedByImpressions.slice(0, Math.min(10, sortedByImpressions.length));
      
      // STEP 3: Resort the top 10 by clicks descending
      const prioritizedKeywords = top10Keywords.sort((a, b) => {
        // First by data source (GSC over AI)
        if (a.ai_generated && !b.ai_generated) return 1;
        if (!a.ai_generated && b.ai_generated) return -1;
        
        // Then by clicks for GSC data
        if (a.clicks && b.clicks) {
          return b.clicks - a.clicks;
        }
        
        // Fallback to impressions if clicks aren't available
        if (a.impressions && b.impressions) {
          return b.impressions - a.impressions;
        }
        
        // Fallback to relevance for AI keywords
        if (a.relevance && b.relevance) {
          return b.relevance - a.relevance;
        }
        
        return 0;
      });
      
      console.log(`Processed keywords: Started with ${pageKeywords.length}, selected top ${Math.min(10, pageKeywords.length)}, sorted by clicks`);
      
      keywordsText = "IMPORTANT KEYWORDS TO INCLUDE (ordered by clicks and importance):\n";
      keywordsText += prioritizedKeywords.map((kw, index) => {
        const source = kw.ai_generated ? 'AI prediction' : 'GSC data';
        const stats = kw.impressions ? 
          `clicks: ${kw.clicks}, impressions: ${kw.impressions}, position: ${typeof kw.position === 'number' ? kw.position.toFixed(1) : kw.position}` :
          kw.relevance ? `relevance: ${kw.relevance}/10, search intent: ${kw.search_intent || 'unknown'}` : 'no metrics available';
        
        return `${index + 1}. "${kw.keyword}" (${source}, ${stats})`;
      }).join('\n');
      
      // Add specific instructions for keyword usage
      keywordsText += "\n\nPlease ensure you:\n";
      keywordsText += "- Include the top 2-3 keywords in the title and H1\n";
      keywordsText += "- Include at least one primary keyword in the meta description\n"; 
      keywordsText += "- Use different keywords in the H2 than those used in the H1 (for more coverage)\n";
      keywordsText += "- Naturally integrate at least 3 keywords in the paragraph\n";
      keywordsText += "- Prioritize the keywords at the top of the list as they are most important\n";
    }

    // Build the prompt for Claude - simplified version
    const simplifiedPrompt = `You are an SEO expert tasked with creating optimized elements for a webpage based on its URL and available keywords.

URL: ${pageData.url}

${keywordsText}

First, select the 3 most important keywords to focus on:
1. Primary Keyword: Choose the most important keyword with high clicks that best represents the main topic
2. Secondary Keyword: Choose a different keyword that complements the primary keyword and adds context
3. Tertiary Keyword: Choose a third keyword that adds additional value or represents a subtopic

Then create the following SEO elements, making sure to incorporate these keywords appropriately:

1. Title: A concise (50-60 characters) SEO-optimized title that accurately represents the page content and includes the primary keyword.

2. Meta Description: A compelling meta description (150-160 characters) that summarizes the page content and includes the primary and possibly secondary keywords.

3. H1 Heading: A primary heading that clearly states the main topic of the page and incorporates the primary keyword.

4. H2 Heading: A secondary heading that acts as a page-level subheading. This should be a broader category or section level heading that complements the H1 and uses the secondary keyword.

5. H4 Heading: A sectional heading that directly relates to the paragraphs content below it. This should be specific and focused on the paragraph topic, possibly using the tertiary keyword.

6. Paragraph: 3-5 paragraphs (with 3-4 sentences each) that provide valuable information related to the H4 heading above it and naturally incorporate all three keywords throughout the text.

IMPORTANT: Format your response EXACTLY like this, You must include all the elements:
<seo_elements>
<primary_keyword>Selected primary keyword here</primary_keyword>
<secondary_keyword>Selected secondary keyword here</secondary_keyword>
<tertiary_keyword>Selected tertiary keyword here</tertiary_keyword>
<title>Your title here</title>
<meta_description>Your meta description here</meta_description>
<h1>Your H1 heading here</h1>
<h2>Your H2 heading here</h2>
<h4>Your H4 heading here</h4>
<paragraph>Your paragraph here</paragraph>
</seo_elements>`;


    const today = new Date().toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    }); // e.g. "May 16, 2025"

    // Full prompt with all details, used as a backup
    const fullPrompt = `You are tasked with creating SEO-optimized elements for a webpage based on its URL, content, and keyword data. Your goal is to improve the page's search engine visibility and user engagement.

    ⚠️ **Today’s date is ${today}.**  
- Every time you mention a date, treat ${today} as “now.”  
- If you encounter years such as 2022, 2023, 2024, or 2025 in the source material, **update** them so they make sense relative to today unless they are clearly historical facts.  
- Make sure all time references, examples, and ranges are anchored in today’s date.

    
Here is the URL of the page:
<url>
${pageData.url}
</url>

Here is the markdown content of the page:
<markdown>
${pageContent}
</markdown>

Here is the keyword data for the page:
<keywords>
${keywordsText}
</keywords>

Carefully analyze the provided URL, markdown content, and keyword data to understand the main topic and purpose of the page. Pay attention to key themes, important keywords, and the overall message the page is trying to convey.

Make sure to use the keywords in the title, meta description, H1, H2, H4, and paragraph. Analyze the keywords and make sure they are used in the correct context. See the keyword data for more information.

You must first make your selections from the keyword data. Select a primary, secondary, and tertiary keyword. Then you must create the SEO elements based on the selections. You must never select a branded term as a keyword.

You must be strict with the character limits for the title (50-60 characters) and meta description (150-160 characters) - do not exceed them.

Based on your analysis, create the following elements:

1. Title: Create an SEO-optimized title that is concise (50-60 characters) and accurately represents the page content. You MUST include at least one of the top 2-3 keywords from the provided keyword list. Choose the most relevant keywords prioritizing those at the top of the list (higher importance) Always end the title with a pipe and the brand name, never use a pipe anywhere else in the title.

2. Meta Description: Write a compelling meta description (150-160 characters) that summarizes the page content. You MUST include at least one primary keyword from the top 5. The description should entice users to click through to the page by highlighting a benefit or addressing a pain point.

3. H1 Heading: Craft a primary heading that clearly states the main topic of the page. You MUST include at least one of the top 3 keywords, preferably the most important one. The H1 should be similar to the title but can be slightly longer and more descriptive.

4. H2 Heading: Create a secondary heading that acts as a page-level subheading. This should be broader than the H1 and set up the category or section level context. You MUST use different keywords than those used in the H1 to expand keyword coverage. Choose from the keyword list provided, focusing on those that complement the primary keywords.

5. H4 Heading: Create a sectional heading that directly relates to the paragraphs content below it. This should be specific and focused on the paragraph topic. It should be more specific than the H2 and directly introduce the paragraphs content.

6. Paragraph: Write 3-5 paragraphs (with 3-4 sentences each) that provide valuable information related to the H4 heading above it. These paragraphs should naturally integrate the primary keyword and at least two additional keywords from the provided list. If no keywords are supplied, assume keywords and use accordingly. Ensure whichever keywords are used fit contextually and provide meaningful value to the reader. Do not keyword stuff. The content should be about 2250 characters in length.

When creating these elements, keep the following guidelines in mind:
- Ensure all elements are cohesive and relate to the main topic of the page
- Use important keywords naturally and avoid keyword stuffing
- Prioritize keywords with higher clicks, impressions, and CTR
- Make the content informative, engaging, and valuable to the reader
- Adhere to the specified character limits for the title and meta description
- Make sure the H2 and H4 have a clear hierarchical relationship
- Never use the URL in the title, meta description, H1, H2, or H4 
- Never select the URL as a keyword

Format your final output as follows, You must include all the elements:

<seo_elements>
<primary_keyword>Selected primary keyword here</primary_keyword>
<secondary_keyword>Selected secondary keyword here</secondary_keyword>
<tertiary_keyword>Selected tertiary keyword here</tertiary_keyword>
<title>Your SEO-optimized title here</title>
<meta_description>Your meta description here</meta_description>
<h1>Your H1 heading here</h1>
<h2>Your H2 heading here</h2>
<h4>Your H4 heading here</h4>
<paragraph>Your paragraph here</paragraph>
</seo_elements>

Your final output should contain only the SEO elements within the specified tags. Do not include any explanations, additional text, or the keyword data outside of these tags.`;

    // Use the simplified prompt first
    const prompt = fullPrompt;

    // Call Claude API with thinking turned on
    const seoElements = await generateWithClaudeThinking(prompt, apiKey, modelName);
    
    // Extract the SEO elements from Claude's response
    const seoData = extractSeoElements(seoElements);
    
    // Store the results in the database if pageId is provided
    if (pageId) {
      console.log(`Storing SEO elements for page ${pageId}`);
      
      // Prepare keywords data for storage
      let keywordsJson = null;
      if (pageKeywords && pageKeywords.length > 0) {
        keywordsJson = JSON.stringify(pageKeywords);
        console.log(`Storing ${pageKeywords.length} keywords for page ${pageId}`);
      }
      
      try {
        // First get the page URL
        const { data: pageData, error: pageError } = await supabaseClient
          .from('pages')
          .select('url')
          .eq('id', pageId)
          .single();
          
        if (pageError) {
          console.error(`Error getting page URL: ${pageError.message}`);
          return;
        }
        
        if (!pageData || !pageData.url) {
          console.error(`No URL found for page ${pageId}`);
          return;
        }
        
        const pageUrl = pageData.url;
        console.log(`Page URL: ${pageUrl}`);
        
        // Simple direct insert - no RPC, no upsert
        console.log(`Inserting SEO elements for ${pageId}`);
        
        // Check if any of the SEO elements were successfully extracted
        const hasValidElements = seoData.title || seoData.metaDescription || seoData.h1 || seoData.h2 || seoData.paragraph;
        
        if (!hasValidElements) {
          console.log("No valid SEO elements were extracted. Retrying with Claude...");
          
          // Use a more focused prompt for the retry
          const retryPrompt = fullPrompt;
        
          // Try up to 3 times with different model parameters
          console.log("First retry with different model parameters...");
          const firstRetry = await generateWithClaudeThinking(retryPrompt, apiKey, modelName);
          let retryData = extractSeoElements(firstRetry);
          
          if (!retryData.title || !retryData.h1 || !retryData.h4) {
            console.log("Second retry with simplified prompt...");
            const secondRetry = await generateWithClaudeThinking(retryPrompt, apiKey, modelName);
            retryData = extractSeoElements(secondRetry);
            
            if (!retryData.title || !retryData.h1 || !retryData.h4) {
              console.log("Final retry with more direct instructions...");
              const finalRetryPrompt = fullPrompt;
              const finalRetry = await generateWithClaudeThinking(finalRetryPrompt, apiKey, modelName);
              const finalRetryData = extractSeoElements(finalRetry);
              
              // Use any valid elements from the retries
              if (finalRetryData.title) retryData.title = finalRetryData.title;
              if (finalRetryData.metaDescription) retryData.metaDescription = finalRetryData.metaDescription;
              if (finalRetryData.h1) retryData.h1 = finalRetryData.h1;
              if (finalRetryData.h2) retryData.h2 = finalRetryData.h2;
              if (finalRetryData.h4) retryData.h4 = finalRetryData.h4;
              if (finalRetryData.paragraph) retryData.paragraph = finalRetryData.paragraph;
            }
          }
          
          // Merge any successful retry results with our data
          if (retryData.title) seoData.title = retryData.title;
          if (retryData.metaDescription) seoData.metaDescription = retryData.metaDescription;
          if (retryData.h1) seoData.h1 = retryData.h1;
          if (retryData.h2) seoData.h2 = retryData.h2;
          if (retryData.h4) seoData.h4 = retryData.h4;
          if (retryData.paragraph) seoData.paragraph = retryData.paragraph;
          
          // Check if we got valid elements after retries
          const hasValidElementsAfterRetry = seoData.title || seoData.metaDescription || seoData.h1 || seoData.h2 || seoData.h4 || seoData.paragraph;
          
          if (hasValidElementsAfterRetry) {
            console.log("Successfully generated elements after Claude retries");
          } else {
            console.error("Failed to generate valid elements even after multiple Claude retries");
            throw new Error("Failed to generate SEO elements after multiple retries");
          }
        }
        
        const title = seoData.title;
        const metaDescription = seoData.metaDescription;
        const h1 = seoData.h1;
        const h2 = seoData.h2;
        const h4 = seoData.h4;
        const paragraph = seoData.paragraph;
        
        console.log(`Data to insert: title=${title.substring(0, 20)}..., meta=${metaDescription.substring(0, 20)}...`);
        
        // First check if a record already exists using a more reliable query
        const { data: existingRecords, error: checkError } = await supabaseClient
          .from('page_seo_recommendations')
          .select('id')
          .eq('page_id', pageId);
        
        if (checkError) {
          console.error(`Error checking for existing record: ${checkError.message}`);
        }
        
        if (existingRecords && existingRecords.length > 0) {
          // Update the first record if multiple exist
          const recordId = existingRecords[0].id;
          console.log(`Updating existing record ${recordId} for page ${pageId}`);
          
          const { error: updateError } = await supabaseClient
            .from('page_seo_recommendations')
            .update({
              title,
              meta_description: metaDescription,
              h1,
              h2,
              h4,
              paragraph,
              primary_keyword: seoData.primaryKeyword || null,
              secondary_keyword: seoData.secondaryKeyword || null,
              tertiary_keyword: seoData.tertiaryKeyword || null,
              thinking_log: seoElements.thinking || '',
              keywords: keywordsJson ? JSON.parse(keywordsJson) : null,
              updated_at: new Date().toISOString()
            })
            .eq('id', recordId);
            
          if (updateError) {
            console.error(`Update error: ${updateError.message}`);
          } else {
            console.log(`Successfully updated record for ${pageId}`);
          }
        } else {
          // Insert new record
          console.log(`Creating new record for ${pageId}`);
          const { error: insertError } = await supabaseClient
            .from('page_seo_recommendations')
            .insert({
              page_id: pageId,
              url: pageUrl,
              title,
              meta_description: metaDescription,
              h1,
              h2,
              h4,
              paragraph,
              primary_keyword: seoData.primaryKeyword || null,
              secondary_keyword: seoData.secondaryKeyword || null,
              tertiary_keyword: seoData.tertiaryKeyword || null,
              thinking_log: seoElements.thinking || '',
              keywords: keywordsJson ? JSON.parse(keywordsJson) : null,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            });
            
          if (insertError) {
            console.error(`Insert error: ${insertError.message}`);
            
            // If insert fails, try a different approach - delete then insert
            if (insertError.message.includes('violates unique constraint')) {
              console.log('Insert failed due to constraint violation. Trying delete + insert approach...');
              
              // Delete any existing records
              const { error: deleteError } = await supabaseClient
                .from('page_seo_recommendations')
                .delete()
                .eq('page_id', pageId);
                
              if (deleteError) {
                console.error(`Delete error: ${deleteError.message}`);
              } else {
                // Try insert again
                const { error: reinsertError } = await supabaseClient
                  .from('page_seo_recommendations')
                  .insert({
                    page_id: pageId,
                    url: pageUrl,
                    title,
                    meta_description: metaDescription,
                    h1,
                    h2,
                    h4,
                    paragraph,
                    primary_keyword: seoData.primaryKeyword || null,
                    secondary_keyword: seoData.secondaryKeyword || null,
                    tertiary_keyword: seoData.tertiaryKeyword || null, 
                    thinking_log: seoElements.thinking || '',
                    keywords: keywordsJson ? JSON.parse(keywordsJson) : null,
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                  });
                  
                if (reinsertError) {
                  console.error(`Re-insert error: ${reinsertError.message}`);
                } else {
                  console.log(`Successfully inserted record for ${pageId} after delete`);
                }
              }
            }
          } else {
            console.log(`Successfully inserted record for ${pageId}`);
          }
        }
      } catch (err) {
        console.error(`Error in database operations: ${err.message}`);
      }
    }
    
    // Return success response
    return new Response(
      JSON.stringify({
        success: true,
        url: pageData.url,
        pageId,
        seoElements: seoData,
        priorityKeywords: {
          primary: seoData.primaryKeyword || null,
          secondary: seoData.secondaryKeyword || null,
          tertiary: seoData.tertiaryKeyword || null
        },
        thinking: seoElements.thinking
      }),
      {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      }
    );
  } catch (error) {
    // Return error response
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
      {
        status: 400,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      }
    );
  }
});

// Function to convert HTML to Markdown
function htmlToMarkdown(html: string): string {
  // First clean the HTML content to fix encoding issues
  let markdown = cleanText(html)
    // Remove scripts and styles
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
    
    // Convert headings
    .replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, '# $1\n\n')
    .replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, '## $1\n\n')
    .replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, '### $1\n\n')
    .replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, '#### $1\n\n')
    .replace(/<h5[^>]*>([\s\S]*?)<\/h5>/gi, '##### $1\n\n')
    .replace(/<h6[^>]*>([\s\S]*?)<\/h6>/gi, '###### $1\n\n')
    
    // Convert paragraphs and line breaks
    .replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, '$1\n\n')
    .replace(/<br\s*\/?>/gi, '\n')
    
    // Convert lists
    .replace(/<ul[^>]*>([\s\S]*?)<\/ul>/gi, '$1\n')
    .replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi, '$1\n')
    .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '- $1\n')
    
    // Convert links
    .replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)')
    
    // Convert images
    .replace(/<img[^>]*src="([^"]*)"[^>]*alt="([^"]*)"[^>]*>/gi, '![$2]($1)')
    .replace(/<img[^>]*alt="([^"]*)"[^>]*src="([^"]*)"[^>]*>/gi, '![$1]($2)')
    .replace(/<img[^>]*src="([^"]*)"[^>]*>/gi, '![]($1)')
    
    // Convert strong/bold and em/italic text
    .replace(/<strong[^>]*>([\s\S]*?)<\/strong>/gi, '**$1**')
    .replace(/<b[^>]*>([\s\S]*?)<\/b>/gi, '**$1**')
    .replace(/<em[^>]*>([\s\S]*?)<\/em>/gi, '*$1*')
    .replace(/<i[^>]*>([\s\S]*?)<\/i>/gi, '*$1*')
    
    // Remove all other HTML tags
    .replace(/<[^>]*>/g, '')
    
    // Fix multiple consecutive line breaks
    .replace(/\n\s*\n\s*\n/g, '\n\n');
    
  // HTML entities are already decoded by cleanText, but decode any remaining ones
  markdown = decodeHtmlEntities(markdown);
  
  // Truncate if too long (keep under 50K characters)
  if (markdown.length > 50000) {
    markdown = markdown.substring(0, 50000) + "\n\n[Content truncated due to length...]";
  }
  
  return markdown;
}

// Function to generate content with Claude thinking and streaming
async function generateWithClaudeThinking(prompt: string, apiKey: string, model: string) {
  
  const max_tokens = 64000;
  const system_prompt = `
    You are an SEO expert tasked with creating optimized title, meta description, h1, h2, h4, and paragraph elements for a webpage. You must consider the on page content and the keywords that are provided. 
    VERY IMPORTANT: Format your response exactly with <seo_elements>, <title>, <meta_description>, <h1>, <h2>, <h4>, and <paragraph> tags. 
      
    Format your final output as follows, You must include all the elements:

    <seo_elements>
    <title>Your SEO-optimized title here</title>
    <meta_description>Your meta description here</meta_description>
    <h1>Your H1 heading here</h1>
    <h2>Your H2 heading here</h2>
    <h4>Your H4 heading here</h4>
    <paragraph>Your paragraph here</paragraph>
    </seo_elements>`;
  

  console.log(`Generating content with Claude thinking (${model}) }`);
  
  try {
    const anthropicResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model,
        max_tokens,
        stream: true, // Enable streaming
        system: system_prompt,
        thinking: {
          type: "enabled",
          budget_tokens: 16000
        },
        messages: [
          {
            role: "user",
            content: prompt
          }
        ]
      })
    });

    if (!anthropicResponse.ok) {
      const errorText = await anthropicResponse.text();
      throw new Error(`Claude API error: ${anthropicResponse.status} - ${errorText}`);
    }

    if (!anthropicResponse.body) {
      throw new Error('Response body stream is null');
    }

    console.log('Starting to process streaming response...');
    const reader = anthropicResponse.body.getReader();
    const decoder = new TextDecoder();
    
    // Objects to collect data from the stream
    let fullContent = '';
    let thinkingContent = '';
    let collectedResponse = {
      message: null,
      contentBlocks: {},
      rawEvents: []
    };
    
    while (true) {
      const { done, value } = await reader.read();
      
      if (done) {
        console.log('Stream complete');
        break;
      }

      const chunk = decoder.decode(value);
      
      // Log the raw chunk for debugging
      /*if (chunk.length > 500) {
        console.log(`Received chunk (${chunk.length} chars): ${chunk.substring(0, 200)}...`);
      } else {
        console.log(`Received chunk: ${chunk}`);
      }*/
      
      // Store the raw chunk for debugging
      collectedResponse.rawEvents.push(chunk);
      
      // Split the chunk into SSE events
      const events = chunk.split('\n\n').filter(line => line.trim() !== '');
      
      for (const event of events) {
        // Skip ping events
        if (event.startsWith('event: ping')) {
          continue;
        }
        
        // Parse the event
        const eventType = event.match(/^event: (.+)$/m)?.[1] || null;
        const dataMatch = event.match(/^data: (.+)$/m);
        
        if (!dataMatch) continue;
        
        try {
          const data = JSON.parse(dataMatch[1]);
          
          // Handle different event types according to the documentation
          switch (eventType) {
            case 'message_start':
              collectedResponse.message = data.message;
              //console.log(`Message started: ${data.message?.id}`);
              break;
              
            case 'content_block_start':
              const blockIndex = data.index;
              const blockType = data.content_block?.type;
              collectedResponse.contentBlocks[blockIndex] = {
                type: blockType,
                content: ''
              };
              //console.log(`Content block ${blockIndex} (${blockType}) started`);
              break;
              
            case 'content_block_delta':
              const deltaIndex = data.index;
              const deltaType = data.delta?.type;
              
              if (deltaType === 'text_delta' && data.delta.text) {
                if (!collectedResponse.contentBlocks[deltaIndex]) {
                  collectedResponse.contentBlocks[deltaIndex] = { type: 'text', content: '' };
                }
                collectedResponse.contentBlocks[deltaIndex].content += data.delta.text;
                fullContent += data.delta.text;
                //console.log(`Received text delta for block ${deltaIndex}: "${data.delta.text.slice(0, 50)}${data.delta.text.length > 50 ? '...' : ''}"`);
              } 
              else if (deltaType === 'thinking_delta' && data.delta.thinking) {
                if (!collectedResponse.contentBlocks[deltaIndex]) {
                  collectedResponse.contentBlocks[deltaIndex] = { type: 'thinking', content: '' };
                }
                thinkingContent += data.delta.thinking;
                //console.log(`Received thinking delta for block ${deltaIndex}: "${data.delta.thinking.slice(0, 50)}${data.delta.thinking.length > 50 ? '...' : ''}"`);
              }
              break;
              
            case 'content_block_stop':
              const stopIndex = data.index;
              //console.log(`Content block ${stopIndex} stopped`);
              break;
              
            case 'message_delta':
              // Update message with delta
              if (data.delta) {
                collectedResponse.message = {
                  ...collectedResponse.message,
                  ...data.delta
                };
              }
              break;
              
            case 'message_stop':
              //console.log('Message complete');
              break;
              
            case 'error':
              console.error(`Stream error: ${data.error?.message || 'Unknown error'}`);
              break;
              
            default:
              console.log(`Unknown event type: ${eventType}`);
          }
        } catch (e) {
          console.error(`Error parsing event data: ${e.message}`);
        }
      }
    }
    
    // Log overview of collected data
    console.log(`Content blocks collected: ${Object.keys(collectedResponse.contentBlocks).length}`);
    console.log(`Full content length: ${fullContent.length} characters`);
    console.log(`Thinking content length: ${thinkingContent.length} characters`);
    
    // Find text content from the content blocks
    let finalContent = '';
    Object.values(collectedResponse.contentBlocks).forEach(block => {
      if (block.type === 'text') {
        finalContent += block.content;
      }
    });
    
    // Log final content for debugging
    if (finalContent.length > 0) {
      console.log(`Final content (${finalContent.length} chars): ${finalContent.substring(0, 200)}...`);
    } else {
      console.log('No final content collected from stream');
      
      // If no final content was collected but we have raw events,
      // try to extract content directly from them
      const combinedRaw = collectedResponse.rawEvents.join('');
      const seoMatch = combinedRaw.match(/<seo_elements>[\s\S]*?<\/seo_elements>/);
      
      if (seoMatch) {
        console.log(`Found <seo_elements> tags in raw events: ${seoMatch[0].substring(0, 100)}...`);
        finalContent = seoMatch[0];
      } else {
        // Look for text_delta content in the raw response
        const textMatches = [...combinedRaw.matchAll(/"text_delta","text":"([^"]*)"/g)];
        if (textMatches.length > 0) {
          const extractedContent = textMatches.map(match => match[1]).join('');
          console.log(`Extracted content from text_delta matches: ${extractedContent.substring(0, 100)}...`);
          finalContent = extractedContent;
        }
      }
    }
    
    // Create final result, preferring collected content but falling back to raw events if needed
    const result = {
      content: finalContent || fullContent,
      thinking: thinkingContent
    };
    
    // If we still have no usable content, try the non-streaming backup approach
    if (!result.content || result.content.length < 10) {
      console.log('Content still missing or too short, trying backup approach');
      return await tryBackupApproach(prompt, apiKey, model);
    }
    
    return result;
  } catch (e) {
    console.error(`Error in streaming request: ${e.message}`);
    return await tryBackupApproach(prompt, apiKey, model);
  }
}

// Backup approach with normal request (non-streaming)
async function tryBackupApproach(prompt: string, apiKey: string, model: string) {
  console.log('Attempting backup approach with normal request');
  
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model,
        max_tokens: 64000,
        system: "You are an SEO expert. Format your output EXACTLY with <seo_elements>, <title>, <meta_description>, <h1>, <h2>, and <paragraph> tags. This is extremely important.",
        messages: [
          {
            role: "user",
            content: prompt
          }
        ]
      })
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Backup request failed: ${response.status} - ${errorText}`);
    }
    
    const data = await response.json();
    console.log('Received backup approach response');
    
    if (data.content && data.content.length > 0) {
      const content = data.content[0].text;
      console.log(`Backup content length: ${content.length} characters`);
      
      if (content.length > 0) {
        console.log(`Backup content preview: ${content.substring(0, 100)}...`);
      }
      
      return {
        content: content,
        thinking: ''
      };
    } else {
      console.error('No content in backup response');
      return { content: '', thinking: '' };
    }
  } catch (e) {
    console.error(`Error in backup approach: ${e.message}`);
    return { content: '', thinking: '' };
  }
}

// Non-streaming fallback function
async function generateWithClaudeThinkingNonStreaming(prompt: string, apiKey: string, model: string) {
  console.log(`Generating content with Claude thinking (${model}) - Non-streaming mode`);
  
  try {
    // Disable thinking for non-streaming mode since it seems to be causing issues
    const anthropicResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model,
        max_tokens: 4000, // Using a smaller value for faster response
        stream: false,    // Disable streaming
        system: "You are an SEO expert tasked with creating optimized title, meta description, h1, h2, and paragraph elements for a webpage. VERY IMPORTANT: Format your response exactly with <seo_elements>, <title>, <meta_description>, <h1>, <h2>, and <paragraph> tags.",
        messages: [
          {
            role: "user",
            content: prompt
          }
        ]
      })
    });

    // For debugging: Log the raw response
    const responseText = await anthropicResponse.text();
    console.log(`Raw response preview (first 500 chars): ${responseText.substring(0, 500)}`);
    console.log(`Raw response length: ${responseText.length} characters`);
    
    // Try to parse it as JSON
    let data;
    try {
      data = JSON.parse(responseText);
      console.log('Successfully parsed response as JSON');
    } catch (parseError) {
      console.error(`Error parsing response as JSON: ${parseError.message}`);
      // Try to extract content from the raw text if it contains seo_elements
      if (responseText.includes('<seo_elements>')) {
        console.log('Response contains seo_elements tag, using raw extraction');
        return {
          content: responseText,
          thinking: ''
        };
      } else {
        throw new Error(`Failed to parse Claude response: ${parseError.message}`);
      }
    }
    
    console.log('Successfully received non-streaming response');
    
    // Improve debugging for the content structure
    if (data.content) {
      console.log(`Content array length: ${data.content.length}`);
      console.log(`First content item type: ${data.content[0] ? data.content[0].type : 'undefined'}`);
    } else {
      console.log('No content array in response');
    }
    
    const content = data.content && data.content[0] && data.content[0].text 
      ? data.content[0].text 
      : '';
      
    const thinking = data.thinking ? data.thinking : '';
    
    console.log(`Content length: ${content.length} characters`);
    if (content.length > 0) {
      console.log(`Content preview: ${content.substring(0, 200)}`);
    }
    console.log(`Thinking length: ${thinking.length} characters`);
    
    return {
      content: content,
      thinking: thinking
    };
  } catch (e) {
    console.error(`Error in non-streaming request: ${e.message}`);
    
    // Last resort - direct API call with minimal parameters
    console.log('Attempting last-resort basic API call');
    try {
      const basicResponse = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          model,
          max_tokens: 2000,
          system: "You are an SEO expert. Create title, meta description, h1, h2, and paragraph elements for a webpage. Format with tags.",
          messages: [
            {
              role: "user",
              content: "Create SEO elements for this URL: " + prompt.split('\n')[2] + "\nUse these tags: <seo_elements>, <title>, <meta_description>, <h1>, <h2>, <paragraph>"
            }
          ]
        })
      });
      
      if (!basicResponse.ok) {
        throw new Error(`Basic Claude API error: ${basicResponse.status}`);
      }
      
      const basicData = await basicResponse.json();
      console.log('Successfully received basic API response');
      
      const basicContent = basicData.content && basicData.content[0] && basicData.content[0].text 
        ? basicData.content[0].text 
        : '';
        
      console.log(`Basic content length: ${basicContent.length} characters`);
      return {
        content: basicContent,
        thinking: ''
      };
    } catch (basicError) {
      console.error(`Error in basic request: ${basicError.message}`);
      throw basicError;
    }
  }
}

// Function to extract SEO elements from Claude's response
function extractSeoElements(claudeResponse: { content: string, thinking?: string }) {
  console.log('Extracting SEO elements from Claude response');

  // Log content information to help with debugging
  const contentStr = claudeResponse.content;
  console.log(`Content string length: ${contentStr.length}`);
  if (contentStr.length > 0) {
    console.log(`Content preview: ${contentStr.substring(0, 100)}...`);
  }
  
  // First try to extract from seo_elements block
  let seoBlock = '';
  const seoElementsRegex = /<seo_elements>([\s\S]*?)<\/seo_elements>/s;
  const seoElementsMatch = contentStr.match(seoElementsRegex);
  
  if (seoElementsMatch && seoElementsMatch[1]) {
    seoBlock = seoElementsMatch[1];
    console.log('Found seo_elements block');
  } else {
    // Try again with the entire content as some responses might have the tags
    // but not be properly nested due to streaming collection
    const fullMatch = contentStr.match(seoElementsRegex);
    if (fullMatch && fullMatch[1]) {
      seoBlock = fullMatch[1];
      console.log('Found seo_elements block in full content');
    } else {
      seoBlock = contentStr;
      console.log('No seo_elements block found, using full content');
    }
  }
  
  // Define regular expressions for extracting the SEO elements
  const titleRegex = /<title>([\s\S]*?)<\/title>/s;
  const metaDescriptionRegex = /<meta_description>([\s\S]*?)<\/meta_description>/s;
  const h1Regex = /<h1>([\s\S]*?)<\/h1>/s;
  const h2Regex = /<h2>([\s\S]*?)<\/h2>/s;
  const h4Regex = /<h4>([\s\S]*?)<\/h4>/s;
  const paragraphRegex = /<paragraph>([\s\S]*?)<\/paragraph>/s;
  
  // Define regex for priority keywords
  const primaryKeywordRegex = /<primary_keyword>([\s\S]*?)<\/primary_keyword>/s;
  const secondaryKeywordRegex = /<secondary_keyword>([\s\S]*?)<\/secondary_keyword>/s;
  const tertiaryKeywordRegex = /<tertiary_keyword>([\s\S]*?)<\/tertiary_keyword>/s;
  
  // First try to extract from the seo block
  let titleMatch = seoBlock.match(titleRegex);
  let metaDescriptionMatch = seoBlock.match(metaDescriptionRegex);
  let h1Match = seoBlock.match(h1Regex);
  let h2Match = seoBlock.match(h2Regex);
  let h4Match = seoBlock.match(h4Regex);
  let paragraphMatch = seoBlock.match(paragraphRegex);
  let primaryKeywordMatch = seoBlock.match(primaryKeywordRegex);
  let secondaryKeywordMatch = seoBlock.match(secondaryKeywordRegex);
  let tertiaryKeywordMatch = seoBlock.match(tertiaryKeywordRegex);
  
  // If not found in seo block, try the entire content string
  if (!titleMatch) titleMatch = contentStr.match(titleRegex);
  if (!metaDescriptionMatch) metaDescriptionMatch = contentStr.match(metaDescriptionRegex);
  if (!h1Match) h1Match = contentStr.match(h1Regex);
  if (!h2Match) h2Match = contentStr.match(h2Regex);
  if (!h4Match) h4Match = contentStr.match(h4Regex);
  if (!paragraphMatch) paragraphMatch = contentStr.match(paragraphRegex);
  if (!primaryKeywordMatch) primaryKeywordMatch = contentStr.match(primaryKeywordRegex);
  if (!secondaryKeywordMatch) secondaryKeywordMatch = contentStr.match(secondaryKeywordRegex);
  if (!tertiaryKeywordMatch) tertiaryKeywordMatch = contentStr.match(tertiaryKeywordRegex);
  
  // Log extraction results
  console.log(`Title found: ${titleMatch !== null}`);
  console.log(`Meta description found: ${metaDescriptionMatch !== null}`);
  console.log(`H1 found: ${h1Match !== null}`);
  console.log(`H2 found: ${h2Match !== null}`);
  console.log(`H4 found: ${h4Match !== null}`);
  console.log(`Paragraph found: ${paragraphMatch !== null}`);
  console.log(`Primary keyword found: ${primaryKeywordMatch !== null}`);
  console.log(`Secondary keyword found: ${secondaryKeywordMatch !== null}`);
  console.log(`Tertiary keyword found: ${tertiaryKeywordMatch !== null}`);
  
  // Construct result object and clean all extracted text
  const result = {
    title: titleMatch ? cleanText(titleMatch[1].trim()) : '',
    metaDescription: metaDescriptionMatch ? cleanText(metaDescriptionMatch[1].trim()) : '',
    h1: h1Match ? cleanText(h1Match[1].trim()) : '',
    h2: h2Match ? cleanText(h2Match[1].trim()) : '',
    h4: h4Match ? cleanText(h4Match[1].trim()) : '',
    paragraph: paragraphMatch ? cleanText(paragraphMatch[1].trim()) : '',
    primaryKeyword: primaryKeywordMatch ? cleanText(primaryKeywordMatch[1].trim()) : '',
    secondaryKeyword: secondaryKeywordMatch ? cleanText(secondaryKeywordMatch[1].trim()) : '',
    tertiaryKeyword: tertiaryKeywordMatch ? cleanText(tertiaryKeywordMatch[1].trim()) : ''
  };
  
  // Check for empty fields and log warnings
  const emptyFields = Object.entries(result)
    .filter(([_, value]) => !value)
    .map(([key, _]) => key);
    
  if (emptyFields.length > 0) {
    console.warn(`Warning: Empty fields detected: ${emptyFields.join(', ')}`);
    
    // As a fallback for really bad cases where no tags are found,
    // try to extract based on structural clues in the text
    if (emptyFields.length >= 5 && contentStr.length > 100) {
      console.log("Attempting last-resort extraction based on content structure...");
      
      const lines = contentStr.split('\n').filter(line => line.trim().length > 0);
      if (lines.length >= 6) {
        // Simple heuristic: first 6 non-empty lines might be the elements we want
        result.title = result.title || lines[0].trim();
        result.metaDescription = result.metaDescription || lines[1].trim();
        result.h1 = result.h1 || lines[2].trim();
        result.h2 = result.h2 || lines[3].trim();
        result.h4 = result.h4 || lines[4].trim();
        result.paragraph = result.paragraph || lines[5].trim();
        
        console.log("Applied fallback extraction based on line structure");
      } else if (lines.length >= 5) {
        // Handle case when only 5 lines are available
        result.title = result.title || lines[0].trim();
        result.metaDescription = result.metaDescription || lines[1].trim();
        result.h1 = result.h1 || lines[2].trim();
        result.h2 = result.h2 || lines[3].trim();
        result.h4 = "Key Information"; // Default value
        result.paragraph = result.paragraph || lines[4].trim();
        
        console.log("Applied fallback extraction based on 5-line structure with default H4");
      }
    }
  }
  
  return result;
}