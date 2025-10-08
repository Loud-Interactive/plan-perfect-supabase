// Supabase Edge Function: convert-to-html
// Converts markdown content to HTML and generates schema.org structured data

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { marked } from 'https://esm.sh/marked@5.0.2';
import { corsHeaders } from '../helpers.ts';
import { 
  handleError, 
  createResponse,
  updateHeartbeat,
  getOutlineByGuid,
  markdownToHtml,
  createHtmlDocument,
  addCitationsToHtml,
  addStylesToHtml,
  getDomainPreferences,
  getStyleSettings,
  getSchemaSettings,
  createClientSynopsis,
  generateSchemaWithPreferences,
  injectSchemaData
} from '../content-perfect/utils/index.ts';

const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

// Function to generate schema.org structured data
function generateSchema(title: string, content: string, domain: string) {
  // Extract the first paragraph for description
  const firstParagraphMatch = content.match(/<p>(.*?)<\/p>/);
  const description = firstParagraphMatch ? 
    firstParagraphMatch[1].replace(/<[^>]*>/g, '') : 
    title;

  // Generate current date for datePublished
  const publishedDate = new Date().toISOString();

  // Create the schema object
  return {
    "@context": "https://schema.org",
    "@type": "Article",
    "headline": title,
    "description": description,
    "author": {
      "@type": "Organization",
      "name": domain,
      "url": `https://${domain}`
    },
    "publisher": {
      "@type": "Organization",
      "name": domain,
      "url": `https://${domain}`
    },
    "datePublished": publishedDate,
    "dateModified": publishedDate,
    "mainEntityOfPage": {
      "@type": "WebPage",
      "@id": `https://${domain}`
    }
  };
}

// Function to convert markdown to HTML
function convertMarkdownToHtml(markdown: string) {
  try {
    // Configure marked options
    marked.setOptions({
      gfm: true,
      breaks: true,
      headerIds: true,
      mangle: false
    });

    // Convert markdown to HTML
    const html = marked.parse(markdown);
    
    // Add any custom formatting if needed
    return html;
  } catch (error) {
    console.error('Error converting markdown to HTML:', error);
    throw error;
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
    const { job_id } = requestData;
    
    if (!job_id) {
      return new Response(
        JSON.stringify(createResponse(false, 'Missing required parameter: job_id')),
        { headers: { ...corsHeaders }, status: 400 }
      );
    }

    // Update job heartbeat
    await updateHeartbeat(supabase, job_id);

    // Get job details
    const { data: job, error: jobError } = await supabase
      .from('content_generation_jobs')
      .select('*')
      .eq('id', job_id)
      .eq('is_deleted', false)
      .single();
    
    if (jobError) {
      await handleError(supabase, jobError, { job_id });
      return new Response(
        JSON.stringify(createResponse(false, 'Job not found')),
        { headers: { ...corsHeaders }, status: 404 }
      );
    }

    // Verify job status is 'converting'
    if (job.status !== 'converting') {
      return new Response(
        JSON.stringify(createResponse(false, `Invalid job status: ${job.status}. Expected 'converting'`)),
        { headers: { ...corsHeaders }, status: 400 }
      );
    }

    // Get outline data
    const outline = await getOutlineByGuid(supabase, job.outline_guid);
    if (!outline) {
      await handleError(supabase, 'Outline not found', { job_id, outline_guid: job.outline_guid });
      return new Response(
        JSON.stringify(createResponse(false, 'Outline not found')),
        { headers: { ...corsHeaders }, status: 404 }
      );
    }
    
    // Get domain preferences
    const domain = outline.domain;
    const domainPreferences = await getDomainPreferences(supabase, domain);
    const clientSynopsis = createClientSynopsis(domainPreferences);
    const styleSettings = getStyleSettings(domainPreferences);
    const schemaSettings = getSchemaSettings(domainPreferences);

    // Get generated content
    const { data: generatedContent, error: contentError } = await supabase
      .from('generated_content')
      .select('*')
      .eq('job_id', job_id)
      .eq('is_deleted', false)
      .single();
    
    if (contentError) {
      await handleError(supabase, contentError, { job_id });
      return new Response(
        JSON.stringify(createResponse(false, 'Generated content not found')),
        { headers: { ...corsHeaders }, status: 404 }
      );
    }

    if (!generatedContent.markdown_content) {
      await handleError(supabase, 'Markdown content is empty', { job_id, content_id: generatedContent.id });
      return new Response(
        JSON.stringify(createResponse(false, 'Markdown content is empty')),
        { headers: { ...corsHeaders }, status: 400 }
      );
    }

    // Parse outline
    let outlineJSON;
    try {
      outlineJSON = JSON.parse(outline.outline);
    } catch (error) {
      await handleError(supabase, error, { job_id, outline_guid: job.outline_guid });
      return new Response(
        JSON.stringify(createResponse(false, 'Invalid outline format')),
        { headers: { ...corsHeaders }, status: 400 }
      );
    }
    
    // Get all sections to extract references
    const { data: sections, error: sectionsError } = await supabase
      .from('content_sections')
      .select('references_data')
      .eq('job_id', job_id)
      .eq('is_deleted', false);
    
    if (sectionsError) {
      console.error('Error fetching section references:', sectionsError.message);
    }
    
    // Extract references from sections for citations
    const references = [];
    if (sections) {
      for (const section of sections) {
        if (section.references_data && section.references_data.sources) {
          references.push(...section.references_data.sources);
        }
      }
    }

    // Convert markdown to HTML with Claude
    let htmlContent;
    try {
      if (clientSynopsis.use_claude_for_html_conversion === true) {
        // Use Claude for HTML conversion
        htmlContent = await markdownToHtml(generatedContent.markdown_content, clientSynopsis);
      } else {
        // Use standard marked library for HTML conversion
        htmlContent = convertMarkdownToHtml(generatedContent.markdown_content);
      }
      
      // Add citations if needed
      if (clientSynopsis.include_citations !== false && references.length > 0) {
        htmlContent = addCitationsToHtml(htmlContent, references);
      }
      
      // Add custom styles
      htmlContent = addStylesToHtml(htmlContent, styleSettings);
    } catch (error) {
      await handleError(supabase, error, { job_id, content_id: generatedContent.id });
      return new Response(
        JSON.stringify(createResponse(false, 'Failed to convert markdown to HTML')),
        { headers: { ...corsHeaders }, status: 500 }
      );
    }

    // Generate schema.org structured data
    let schemaData;
    try {
      if (Object.keys(schemaSettings).length > 0) {
        // Use preferences-based schema generation
        schemaData = generateSchemaWithPreferences(
          outlineJSON.title,
          htmlContent,
          outline.domain,
          schemaSettings
        );
      } else {
        // Use basic schema generation
        schemaData = generateBasicArticleSchema(
          outlineJSON.title,
          extractFirstParagraph(htmlContent),
          outline.domain
        );
      }
      
      // Inject schema into HTML
      htmlContent = injectSchemaData(htmlContent, schemaData);
    } catch (error) {
      await handleError(supabase, error, { job_id, content_id: generatedContent.id });
      return new Response(
        JSON.stringify(createResponse(false, 'Failed to generate schema.org data')),
        { headers: { ...corsHeaders }, status: 500 }
      );
    }

    // Update generated content with HTML and schema
    const { error: updateError } = await supabase
      .from('generated_content')
      .update({
        html_content: htmlContent,
        schema_data: schemaData,
        updated_at: new Date().toISOString()
      })
      .eq('id', generatedContent.id);
    
    if (updateError) {
      await handleError(supabase, updateError, { job_id, content_id: generatedContent.id });
      return new Response(
        JSON.stringify(createResponse(false, 'Failed to update generated content with HTML and schema')),
        { headers: { ...corsHeaders }, status: 500 }
      );
    }

    // Update job status to completed
    const { error: jobUpdateError } = await supabase
      .from('content_generation_jobs')
      .update({ 
        status: 'completed',
        updated_at: new Date().toISOString(),
        heartbeat: new Date().toISOString()
      })
      .eq('id', job_id);
    
    if (jobUpdateError) {
      await handleError(supabase, jobUpdateError, { job_id });
      return new Response(
        JSON.stringify(createResponse(false, 'Failed to update job status')),
        { headers: { ...corsHeaders }, status: 500 }
      );
    }

    return new Response(
      JSON.stringify(createResponse(true, 'Content converted to HTML and schema generated successfully', {
        job_id,
        content_id: generatedContent.id,
        outline_guid: job.outline_guid,
        html_length: htmlContent.length,
        schema_generated: true
      })),
      { headers: { ...corsHeaders } }
    );

  } catch (error) {
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    await handleError(supabase, error, { path: 'convert-to-html' });
    
    return new Response(
      JSON.stringify(createResponse(false, 'Internal server error')),
      { headers: { ...corsHeaders }, status: 500 }
    );
  }
});