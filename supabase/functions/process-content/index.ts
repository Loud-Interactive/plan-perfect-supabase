// supabase/functions/process-content/index.ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../helpers.ts';
import { logError, retryWithBackoff, setupHeartbeat } from '../utils/error-handling.ts';
import { getSearchResults, selectRelevantUrls, getArticleTextAndCitation } from '../content-perfect/utils/search.ts';
import { cleanText } from '../_shared/encoding-utils.ts';

const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

// Constants
const MAX_SOURCES_PER_SUBSECTION = 3;
const DEFAULT_HTML_TEMPLATE = '<div class="content-wrapper">{{content}}</div>';
const COMPETITORS = ['competitor1.com', 'competitor2.com']; // Add actual competitors

/**
 * Process a content generation request
 */
async function processContent(outlineGuid: string) {
  // Initialize Supabase client
  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  
  try {
    console.log(`Starting content generation for outline GUID: ${outlineGuid}`);
    
    // Setup heartbeat for this job
    const stopHeartbeat = setupHeartbeat(outlineGuid);
    
    try {
      // Get outline data
      const { data: outline, error: outlineError } = await supabase
        .from('content_plan_outlines')
        .select('*')
        .eq('guid', outlineGuid)
        .single();
      
      if (outlineError || !outline) {
        throw new Error(`Failed to get outline: ${outlineError?.message || 'No outline found'}`);
      }
      
      // Parse outline JSON
      const outlineJson = JSON.parse(outline.outline);
      const topic = outlineJson.title;
      const sections = outlineJson.sections || [];
      
      console.log(`Outline title: ${topic}, sections: ${sections.length}`);
      
      // Get domain data/preferences
      const clientDomain = outline.domain;
      let clientSynopsis = {};
      
      if (clientDomain) {
        // Fetch domain preferences from PP API or database
        try {
          const ppApiUrl = `https://pp-api.replit.app/pairs/all/${clientDomain}`;
          const domainResponse = await fetch(ppApiUrl);
          
          if (domainResponse.ok) {
            clientSynopsis = await domainResponse.json();
            console.log(`Retrieved domain data for ${clientDomain}`);
          } else {
            console.warn(`Failed to get domain data for ${clientDomain}`);
          }
        } catch (error) {
          console.error(`Error fetching domain data for ${clientDomain}:`, error);
        }
      }
      
      // Get HTML template from client synopsis if available
      let htmlTemplate = null;
      if (typeof clientSynopsis === 'object' && clientSynopsis !== null) {
        // @ts-ignore: clientSynopsis is dynamically typed
        htmlTemplate = clientSynopsis.html_template;
      }
      if (!htmlTemplate) {
        htmlTemplate = DEFAULT_HTML_TEMPLATE;
        console.log("Using default HTML template as none provided in client synopsis");
      } else {
        console.log("Using HTML template from client synopsis");
      }
      
      // Initialize the article with the title
      let article = `# ${topic}`;
      
      // Initialize citation tracking
      const footnotesMap: Record<string, any> = {};
      let nextFootnoteIndex = 1;
      
      // Update status to indicate processing has started
      await updateOutlineStatus(supabase, outlineGuid, {
        status: "Processing",
        progress: 5
      });
      
      // Process each section
      for (let sectionIndex = 0; sectionIndex < sections.length; sectionIndex++) {
        const section = sections[sectionIndex];
        const sectionTitle = section.title;
        
        // Update status for current section
        await updateOutlineStatus(supabase, outlineGuid, {
          status: `Processing section ${sectionIndex + 1} of ${sections.length}`,
          progress: Math.round(((sectionIndex) / sections.length) * 95) + 5
        });
        
        // Skip conclusion sections if include_conclusion_bool is false
        // @ts-ignore: clientSynopsis is dynamically typed
        const includeConclusion = clientSynopsis.include_conclusion !== false;
        if (!includeConclusion && isConclusionSection(sectionTitle)) {
          console.log(`Skipping conclusion section '${sectionTitle}' as include_conclusion is False`);
          continue;
        }
        
        // Add section title to the article
        if (sectionTitle !== 'Untitled Section') {
          article += `\n\n## ${sectionTitle}\n`;
        }
        
        // Process each subsection
        for (let subsectionIndex = 0; subsectionIndex < section.subheadings.length; subsectionIndex++) {
          const subsection = section.subheadings[subsectionIndex];
          
          // Update status for current subsection
          await updateOutlineStatus(supabase, outlineGuid, {
            status: `Processing subsection ${subsectionIndex + 1} of ${section.subheadings.length} in section ${sectionIndex + 1}`,
            progress: Math.round(((sectionIndex + (subsectionIndex / section.subheadings.length)) / sections.length) * 95) + 5
          });
          
          try {
            console.log(`Processing subsection ${subsectionIndex + 1} of ${section.subheadings.length} in section ${sectionIndex + 1}`);
            
            // Generate search query for this subsection
            const subsectionSearchQuery = getSubsectionSearchQuery(
              topic, 
              outlineJson, 
              sectionTitle, 
              subsection,
              clientSynopsis
            );
            console.log(`Generated search query: ${subsectionSearchQuery}`);
            
            // Get search results
            const subsectionSearchResults = await getSearchResults(subsectionSearchQuery);
            console.log(`Search results count: ${subsectionSearchResults ? subsectionSearchResults.length : 0}`);
            
            // Select relevant URLs
            const subsectionRelevantUrls = await selectRelevantUrls(
              subsectionSearchResults || [],
              `${topic} ${sectionTitle} ${subsection}`,
              3,
              clientSynopsis
            );
            console.log(`Selected relevant URLs count: ${subsectionRelevantUrls.length}`);
            console.log(`Selected URLs: ${subsectionRelevantUrls.map(url => url.link)}`);
            
            // Process relevant URLs and get content
            let currentSourcesCount = 0;
            const subsectionArticleTexts: string[] = [];
            const subsectionCitations: any[] = [];
            
            for (let urlIndex = 0; urlIndex < subsectionRelevantUrls.length; urlIndex++) {
              try {
                const url = subsectionRelevantUrls[urlIndex];
                console.log(`Processing URL ${urlIndex + 1}/${subsectionRelevantUrls.length}: ${url.link}`);
                
                // Skip competitor URLs
                if (!isCompetitor(url.link, clientDomain, COMPETITORS)) {
                  const { text, citation } = await getArticleTextAndCitation(url.link);
                  
                  if (currentSourcesCount >= MAX_SOURCES_PER_SUBSECTION) {
                    console.log(`Reached max sources per subsection (${MAX_SOURCES_PER_SUBSECTION})`);
                    break;
                  }
                  
                  if (text && text.length > 500) {
                    console.log(`Got valid text (${text.length} chars) from ${url.link}`);
                    subsectionArticleTexts.push(text);
                    
                    if (currentSourcesCount < MAX_SOURCES_PER_SUBSECTION) {
                      subsectionCitations.push({
                        text,
                        url: url.link,
                        citation
                      });
                      currentSourcesCount++;
                      console.log(`Added citation ${currentSourcesCount}/${MAX_SOURCES_PER_SUBSECTION}`);
                    }
                  } else {
                    console.log(`Skipping URL ${url.link}: text too short or empty`);
                  }
                } else {
                  console.log(`Skipping competitor URL: ${url.link}`);
                }
              } catch (error) {
                console.error(`Error processing URL ${subsectionRelevantUrls[urlIndex].link}:`, error);
                continue;
              }
            }
            
            console.log(`Final citations count: ${subsectionCitations.length}`);
            
            // Write article section with sources
            const subsectionResult = await writeArticleSectionWithSources(
              `${topic} ${subsection}`,
              article,
              subsection,
              subsectionRelevantUrls,
              subsectionCitations,
              outlineJson,
              clientSynopsis
            );
            
            try {
              // Parse the result
              let sectionResultDict;
              if (typeof subsectionResult === 'object') {
                sectionResultDict = subsectionResult;
              } else {
                sectionResultDict = JSON.parse(subsectionResult);
                // If still a string, parse again
                if (typeof sectionResultDict === 'string') {
                  sectionResultDict = JSON.parse(sectionResultDict);
                }
              }
              
              // Extract content and citations
              const subsectionContent = sectionResultDict.section_text || '';
              const subsectionNewCitations = sectionResultDict.citations || [];
              
              console.log(`Parsed content length: ${subsectionContent.length}`);
              console.log(`Number of citations: ${subsectionNewCitations.length}`);
              
              // Insert footnotes into the subsection content
              const { updatedContent, nextIndex } = insertFootnotesForSubsection(
                subsectionContent,
                subsectionNewCitations,
                footnotesMap,
                nextFootnoteIndex
              );
              nextFootnoteIndex = nextIndex;
              
              // Add the subsection content to the article
              if (subsection) {
                article += `\n\n### ${subsection}\n${updatedContent}\n`;
              } else {
                article += `\n${updatedContent}\n`;
              }
            } catch (error) {
              console.error(`Error processing subsection content:`, error);
              if (subsection) {
                article += `\n\n### ${subsection}\nError processing section content.\n`;
              } else {
                article += "\nError processing section content.\n";
              }
            }
            
            // Reset source count for next subsection
            currentSourcesCount = 0;
            
          } catch (error) {
            console.error(`Error processing subsection:`, error);
            continue;
          }
        }
      }
      
      // After all sections are done, build and add references section
      if (Object.keys(footnotesMap).length > 0) {
        const referencesMd = buildReferencesSection(footnotesMap);
        article += "\n\n## References\n" + referencesMd;
      }
      
      // Save unedited article
      const uneditedArticle = article;
      
      // Process with content editing pipeline based on client preferences
      if (clientSynopsis) {
        article = editContentForClient(article, clientSynopsis);
        article = editContentForAvoidWords(article, clientSynopsis);
      }
      
      // Convert markdown to HTML template
      const finalHtml = markdownToHtmlTemplate(article, clientSynopsis);
      
      // Update status to indicate processing is complete
      await updateOutlineStatus(supabase, outlineGuid, {
        status: "Complete",
        progress: 100,
        unedited_content: uneditedArticle,
        content: finalHtml
      });
      
      console.log(`Content generation completed for outline GUID: ${outlineGuid}`);
      
      return {
        success: true,
        outline_guid: outlineGuid,
        content: finalHtml,
        unedited_content: uneditedArticle
      };
      
    } finally {
      // Always stop the heartbeat when done
      stopHeartbeat();
    }
    
  } catch (error) {
    // Log the error
    await logError('process-content', outlineGuid, error as Error, { 
      outline_guid: outlineGuid
    });
    
    // Update outline status to indicate failure
    await updateOutlineStatus(supabase, outlineGuid, {
      status: "Failed",
      error: (error as Error).message
    });
    
    return {
      success: false,
      outline_guid: outlineGuid,
      error: (error as Error).message
    };
  }
}

/**
 * Update outline status in the database
 */
async function updateOutlineStatus(supabase: any, outlineGuid: string, updates: Record<string, any>) {
  try {
    const { error } = await supabase
      .from('content_plan_outlines')
      .update(updates)
      .eq('guid', outlineGuid);
    
    if (error) {
      console.error(`Failed to update outline status: ${error.message}`);
    }
  } catch (error) {
    console.error(`Error updating outline status: ${error}`);
  }
}

/**
 * Check if a section title appears to be a conclusion
 */
function isConclusionSection(title: string): boolean {
  const conclusionKeywords = ['conclusion', 'summary', 'final thoughts', 'wrap up', 'concluding'];
  title = title.toLowerCase();
  return conclusionKeywords.some(keyword => title.includes(keyword));
}

/**
 * Generate a search query for a subsection
 */
function getSubsectionSearchQuery(
  topic: string,
  outlineJson: any,
  sectionTitle: string,
  subsection: string,
  clientSynopsis: any
): string {
  // Basic query combining topic and subsection
  return `${topic} ${subsection}`;
}

/**
 * Check if a URL is from a competitor domain
 */
function isCompetitor(url: string, clientDomain: string, competitors: string[]): boolean {
  try {
    if (!url || !clientDomain) return false;
    
    // Extract domain from URL
    const urlObj = new URL(url);
    const domain = urlObj.hostname.replace(/^www\./, '');
    
    // Extract client domain without www
    const client = clientDomain.replace(/^www\./, '').trim();
    
    // Check if the domain is in the competitors list
    const isInCompetitorsList = competitors.some(comp => 
      domain.includes(comp.replace(/^www\./, '').trim())
    );
    
    // Check if it's the same domain or a direct competitor
    return domain === client || isInCompetitorsList;
  } catch (error) {
    console.error(`Error in isCompetitor for ${url}:`, error);
    return false;
  }
}

/**
 * Insert footnotes for a subsection
 */
function insertFootnotesForSubsection(
  content: string,
  citations: any[],
  footnotesMap: Record<string, any>,
  nextFootnoteIndex: number
): { updatedContent: string; nextIndex: number } {
  let updatedContent = content;
  let currentIndex = nextFootnoteIndex;
  
  // For each citation, add a footnote
  for (const citation of citations) {
    if (citation.url && !footnotesMap[citation.url]) {
      // Add the citation to the map
      footnotesMap[citation.url] = {
        index: currentIndex,
        title: citation.citation?.title || '',
        url: citation.url,
        domain: citation.citation?.domain || new URL(citation.url).hostname
      };
      
      // Add footnote reference in the content
      if (citation.context && updatedContent.includes(citation.context)) {
        updatedContent = updatedContent.replace(
          citation.context,
          `${citation.context}[^${currentIndex}]`
        );
      } else {
        // If no specific context, add at the end of a relevant sentence
        const sentences = updatedContent.split(/(?<=[.!?])\s+/);
        for (let i = 0; i < sentences.length; i++) {
          if (sentences[i].includes(citation.keyword || '')) {
            sentences[i] = `${sentences[i].trim()}[^${currentIndex}] `;
            break;
          }
        }
        updatedContent = sentences.join(' ');
      }
      
      currentIndex++;
    }
  }
  
  return { 
    updatedContent, 
    nextIndex: currentIndex 
  };
}

/**
 * Build references section from footnotes map
 */
function buildReferencesSection(footnotesMap: Record<string, any>): string {
  let references = '';
  
  // Sort by index
  const sortedFootnotes = Object.values(footnotesMap)
    .sort((a, b) => a.index - b.index);
  
  for (const footnote of sortedFootnotes) {
    references += `[^${footnote.index}]: ${footnote.title}. ${footnote.domain}. [${footnote.url}](${footnote.url})\n\n`;
  }
  
  return references;
}

/**
 * Write an article section with sources
 */
async function writeArticleSectionWithSources(
  topic: string,
  currentArticle: string,
  subsection: string,
  relevantUrls: any[],
  citations: any[],
  outlineJson: any,
  clientSynopsis: any
): Promise<any> {
  try {
    const aiKey = Deno.env.get('CLAUDE_API_KEY');
    if (!aiKey) {
      throw new Error('CLAUDE_API_KEY is not set');
    }
    
    // Format citations for the prompt
    const citationsText = citations.map((citation, index) => {
      return `
Source ${index + 1}: ${citation.citation?.title || 'Untitled'}
URL: ${citation.url}
Content: ${citation.text.substring(0, 500)}...
`;
    }).join('\n');
    
    // Format client info for the prompt
    let clientInfo = '';
    if (clientSynopsis) {
      clientInfo = `
CLIENT INFORMATION:
${clientSynopsis.synopsis ? `Client synopsis: ${clientSynopsis.synopsis}` : ''}
${clientSynopsis.writing_style ? `Writing style: ${clientSynopsis.writing_style}` : ''}
${clientSynopsis.tone ? `Tone: ${clientSynopsis.tone}` : ''}
${clientSynopsis.audience ? `Target audience: ${clientSynopsis.audience}` : ''}
${clientSynopsis.content_writing_prompt ? `Content writing prompt: ${clientSynopsis.content_writing_prompt}` : ''}
${clientSynopsis.brand_voice ? `Brand voice: ${clientSynopsis.brand_voice}` : ''}
`;
    }
    
    // Get the specific subsection writing prompt if available
    let subsectionPrompt = clientSynopsis?.subsection_writing_prompt || '';
    if (!subsectionPrompt) {
      subsectionPrompt = clientSynopsis?.section_writing_prompt || '';
    }
    
    // If neither specific prompts are available, use a default
    if (!subsectionPrompt) {
      subsectionPrompt = `
Write a subsection for an article about "${topic}".

I need you to write the content for the subsection titled "${subsection}". Make it informative, well-structured, and engaging.
Include information from the provided sources, adding citations where appropriate.

Return your response as a JSON object with the following structure:
{
  "section_text": "The actual content you've written",
  "citations": [
    {
      "url": "the URL of the source",
      "context": "the specific context where you added the citation",
      "keyword": "a keyword to help locate where to place the citation"
    }
  ]
}

Write approximately 300-500 words for this section. Include 1-3 citations if the sources contain relevant information.
`;
    } else {
      // Add placeholders to customize the prompt
      subsectionPrompt = subsectionPrompt
        .replace('{topic}', topic)
        .replace('{subsection}', subsection)
        .replace('{section}', subsection);
    }
    
    // Include instructions for JSON formatting regardless of custom prompt
    if (!subsectionPrompt.includes('"section_text"')) {
      subsectionPrompt += `\n\nReturn your response as a JSON object with the following structure:
{
  "section_text": "The actual content you've written",
  "citations": [
    {
      "url": "the URL of the source",
      "context": "the specific context where you added the citation",
      "keyword": "a keyword to help locate where to place the citation"
    }
  ]
}`;
    }
    
    const prompt = `
${clientInfo}

Here are sources you can reference:

${citationsText}

${subsectionPrompt}
`;

    // Call Claude API
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': aiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-3-haiku-20240307',
        max_tokens: 2000,
        temperature: 0.7,
        system: "You are an expert content writer creating an article section. Return only valid JSON with the section_text and citations.",
        messages: [
          { role: 'user', content: prompt }
        ]
      })
    });

    if (!response.ok) {
      throw new Error(`Claude API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    let content = data.content?.[0]?.text || '{}';
    
    // Clean the content to fix any encoding issues
    content = cleanText(content);
    
    // Parse JSON from response
    try {
      // Find the JSON in the response
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
      throw new Error('No JSON found in response');
    } catch (parseError) {
      console.error('Failed to parse Claude response:', parseError);
      return {
        section_text: `Unable to generate content for ${subsection}.`,
        citations: []
      };
    }
  } catch (error) {
    console.error('Error writing article section:', error);
    return {
      section_text: `Unable to generate content for ${subsection}.`,
      citations: []
    };
  }
}

/**
 * Edit content based on client preferences
 */
function editContentForClient(content: string, clientSynopsis: any): string {
  try {
    // If no client synopsis or no content, return as is
    if (!clientSynopsis || !content) {
      return content;
    }
    
    let editedContent = content;
    
    // Apply content style transformation if specified
    if (clientSynopsis.content_style_prompt) {
      // This would typically call an AI model with the style prompt
      // For now, we'll just log that we would transform it
      console.log(`Would transform content using style prompt: ${clientSynopsis.content_style_prompt.substring(0, 50)}...`);
    }
    
    // Apply content_style_transformation_template if available
    if (clientSynopsis.content_style_transformation_template) {
      // This would typically be used to structure an AI prompt
      console.log(`Would use transformation template: ${clientSynopsis.content_style_transformation_template.substring(0, 50)}...`);
    }
    
    // Apply entity voice if specified
    if (clientSynopsis.entity_voice) {
      console.log(`Would apply entity voice: ${clientSynopsis.entity_voice}`);
    }
    
    return editedContent;
  } catch (error) {
    console.error(`Error in editContentForClient: ${error}`);
    return content; // Return original content if edit fails
  }
}

/**
 * Edit content to avoid specific words
 */
function editContentForAvoidWords(content: string, clientSynopsis: any): string {
  try {
    // If no client synopsis or no content, return as is
    if (!clientSynopsis || !content) {
      return content;
    }
    
    let editedContent = content;
    
    // Get avoid words list
    const avoidWords = clientSynopsis.avoid_words || clientSynopsis.words_to_avoid || [];
    
    if (avoidWords.length > 0) {
      console.log(`Found ${avoidWords.length} words to avoid`);
      
      // In a real implementation, this would use a more sophisticated approach,
      // possibly with an AI model to replace words contextually
      for (const word of avoidWords) {
        if (typeof word === 'string' && word.trim()) {
          const regex = new RegExp(`\\b${word}\\b`, 'gi');
          // For now, just add a comment about replacement
          editedContent = editedContent.replace(regex, `[REPLACED: "${word}"]`);
        }
      }
    }
    
    return editedContent;
  } catch (error) {
    console.error(`Error in editContentForAvoidWords: ${error}`);
    return content; // Return original content if edit fails
  }
}

/**
 * Convert markdown to HTML using client template
 */
function markdownToHtmlTemplate(markdown: string, clientSynopsis: any): string {
  try {
    // Clean the markdown text first to fix encoding issues
    const cleanedMarkdown = cleanText(markdown);
    
    // In a real implementation, you'd use a proper markdown parser
    // This is a simplified conversion
    let html = cleanedMarkdown
      .replace(/^#\s+(.*?)$/gm, '<h1>$1</h1>')
      .replace(/^##\s+(.*?)$/gm, '<h2>$1</h2>')
      .replace(/^###\s+(.*?)$/gm, '<h3>$1</h3>')
      .replace(/\n\n/g, '</p><p>')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*]+)\*/g, '<em>$1</em>');
    
    // Wrap in paragraphs
    html = `<p>${html}</p>`;
    
    // Fix multiple paragraph tags
    html = html.replace(/<\/p><p><\/p><p>/g, '</p><p>');
    
    // Get the appropriate HTML template from the client synopsis
    // Try all possible keys that might contain the template
    let template = null;
    if (clientSynopsis) {
      template = clientSynopsis.html_template || 
                clientSynopsis.post_template || 
                clientSynopsis.Post_Template || 
                clientSynopsis.HTML_Template;
    }
    
    // If no template was found, use the default
    if (!template) {
      template = DEFAULT_HTML_TEMPLATE;
      console.log("Using default HTML template as none provided in client synopsis");
    } else {
      console.log("Using HTML template from client synopsis");
    }
    
    // Add style tag if provided
    let styleContent = null;
    if (clientSynopsis) {
      styleContent = clientSynopsis.post_style_tag_main || 
                    clientSynopsis.Post_Style ||
                    clientSynopsis.post_style;
    }
    
    if (styleContent) {
      const styleTag = `<style>${styleContent}</style>`;
      
      // Check if there's a <head> tag to place the style in
      if (template.includes('<head>')) {
        template = template.replace('<head>', `<head>${styleTag}`);
      } else {
        // Otherwise add to the beginning
        template = `${styleTag}${template}`;
      }
    }
    
    // Insert content into the template
    let result = template.replace('{{content}}', html);
    
    // Add any additional elements from client synopsis
    if (clientSynopsis) {
      // Add CSS class to body if specified
      if (clientSynopsis.body_class) {
        result = result.replace('<body>', `<body class="${clientSynopsis.body_class}">`);
      }
      
      // Add meta data if specified
      if (clientSynopsis.meta_description) {
        const metaTag = `<meta name="description" content="${clientSynopsis.meta_description}">`;
        if (result.includes('<head>')) {
          result = result.replace('<head>', `<head>${metaTag}`);
        }
      }
    }
    
    return result;
  } catch (error) {
    console.error(`Error in markdownToHtmlTemplate: ${error}`);
    // Fallback to simple HTML wrap if template processing fails
    return `<html><body><div>${markdown}</div></body></html>`;
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
    const { outline_guid } = requestData;
    
    if (!outline_guid) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Missing required parameter: outline_guid'
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Process the content (this could be moved to a background task)
    const result = await processContent(outline_guid);
    
    return new Response(
      JSON.stringify(result),
      { 
        status: result.success ? 200 : 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );

  } catch (error) {
    await logError('process-content', null, error as Error);
    
    return new Response(
      JSON.stringify({
        success: false,
        error: (error as Error).message
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});