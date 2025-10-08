// Supabase Edge Function: generate-content-section
// Generates content for a specific section using Claude

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../helpers.ts';
import { 
  handleError, 
  createResponse,
  updateHeartbeat,
  getOutlineByGuid
} from '../content-perfect/utils/index.ts';

const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

// Function to generate content for a section using Claude
async function generateSectionContentWithClaude(
  section: any, 
  outline: any,
  outlineJSON: any,
  keyword: string,
  referenceData: any,
  clientSynopsis: Record<string, any> = {}
) {
  try {
    const apiKey = Deno.env.get('CLAUDE_API_KEY');
    if (!apiKey) {
      throw new Error('CLAUDE_API_KEY is not set');
    }

    // Find the section in the outline to get subheadings
    const outlineSection = outlineJSON.sections[section.section_index];
    const subheadings = outlineSection?.subheadings || [];

    // Format reference data for the prompt
    const referencesText = referenceData.sources.map((source: any, index: number) => {
      return `
Source ${index + 1}: ${source.title}
URL: ${source.url}
Relevance: ${source.relevance}
Key points: ${source.key_points.join(', ')}
Excerpt: ${source.content_excerpt}
`;
    }).join('\n');

    const keyFindings = referenceData.key_findings.map((finding: string) => `- ${finding}`).join('\n');
    
    let conflictingInfo = '';
    if (referenceData.conflicting_information && referenceData.conflicting_information.length > 0) {
      conflictingInfo = 'Conflicting Information:\n' + 
        referenceData.conflicting_information.map((conflict: string) => `- ${conflict}`).join('\n');
    }

    // Determine section format based on type
    let sectionFormat = '';
    if (section.section_type === 'introduction') {
      sectionFormat = 'This is the introduction section. Write an engaging introduction that hooks the reader and sets up the article.';
    } else if (section.section_type === 'conclusion') {
      sectionFormat = 'This is the conclusion section. Summarize the main points and provide clear takeaways for the reader.';
    } else if (section.section_type === 'heading') {
      sectionFormat = 'This is a main section of the article. Include subsections that address each of the subheadings.';
    } else if (section.section_type === 'subheading') {
      sectionFormat = 'This is a subsection of the article. Focus specifically on this topic within the context of the parent section.';
    }

    // Get client information from synopsis
    const clientInfo = `
CLIENT INFORMATION:
${clientSynopsis.synopsis ? `- Client synopsis: ${clientSynopsis.synopsis}` : ''}
${clientSynopsis.writing_style ? `- Writing style: ${clientSynopsis.writing_style}` : ''}
${clientSynopsis.tone ? `- Tone: ${clientSynopsis.tone}` : ''}
${clientSynopsis.audience ? `- Target audience: ${clientSynopsis.audience}` : ''}
`.trim();

    // Determine if citations should be included
    const includeCitations = clientSynopsis.include_citations !== false;

    // Craft the prompt
    const prompt = `
You are a professional content writer creating a section of an article. Your task is to write the "${section.section_title}" section.

ARTICLE TITLE: ${outlineJSON.title}
MAIN KEYWORD: ${keyword}
SECTION: ${section.section_title}
${subheadings.length > 0 ? `SUBHEADINGS: ${subheadings.join(', ')}` : ''}

${clientInfo}

${sectionFormat}

I have compiled research information for you to use in creating this section. Use this information to write an informative, accurate, and engaging section.

RESEARCH FINDINGS:
${keyFindings}

${conflictingInfo}

REFERENCE SOURCES:
${referencesText}

GUIDELINES:
1. Write in a clear, ${clientSynopsis.writing_style || 'professional'} style with proper grammar and punctuation
2. Use markdown formatting for headings (use ### for subheadings)
3. Include relevant statistics and information from the provided sources
${includeCitations ? '4. Cite your sources appropriately within the text (e.g., [Source 1])' : '4. Incorporate source information naturally without explicit citations'}
5. Write approximately ${clientSynopsis.content_length || '300-600'} words for this section, depending on its importance
6. Ensure the content flows naturally and engages the reader with a ${clientSynopsis.tone || 'professional'} tone
7. Focus on providing practical, useful information for the ${clientSynopsis.audience || 'general'} audience
8. Include your expert perspective and insights

Please write only the content for this section, starting immediately below. Do not include the section title, as I will add it separately.
`;

    // Select the appropriate Claude model based on the section complexity
    const model = (section.section_type === 'introduction' || section.section_type === 'conclusion' || subheadings.length > 2) 
      ? 'claude-3-opus-20240229'  // Use Opus for more complex sections
      : 'claude-3-sonnet-20240229'; // Use Sonnet for simpler sections

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: model,
        max_tokens: 4000,
        temperature: 0.7,
        system: `You are an expert content writer known for creating informative, engaging, and well-researched content with a ${clientSynopsis.tone || 'professional'} tone for a ${clientSynopsis.audience || 'general'} audience. Write the requested section of an article using the provided research information.`,
        messages: [
          { role: 'user', content: prompt }
        ]
      })
    });

    if (!response.ok) {
      throw new Error(`Claude API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    return data.content?.[0]?.text || '';
  } catch (error) {
    console.error('Error generating content with Claude:', error);
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
    const { section_id, job_id } = requestData;
    
    if (!section_id || !job_id) {
      return new Response(
        JSON.stringify(createResponse(false, 'Missing required parameters: section_id and job_id')),
        { headers: { ...corsHeaders }, status: 400 }
      );
    }

    // Update job heartbeat
    await updateHeartbeat(supabase, job_id);

    // Get section details
    const { data: section, error: sectionError } = await supabase
      .from('content_sections')
      .select('*')
      .eq('id', section_id)
      .eq('is_deleted', false)
      .single();
    
    if (sectionError) {
      await handleError(supabase, sectionError, { section_id, job_id });
      return new Response(
        JSON.stringify(createResponse(false, 'Section not found')),
        { headers: { ...corsHeaders }, status: 404 }
      );
    }

    // Get job details to retrieve outline GUID
    const { data: job, error: jobError } = await supabase
      .from('content_generation_jobs')
      .select('*')
      .eq('id', job_id)
      .eq('is_deleted', false)
      .single();
    
    if (jobError) {
      await handleError(supabase, jobError, { section_id, job_id });
      return new Response(
        JSON.stringify(createResponse(false, 'Job not found')),
        { headers: { ...corsHeaders }, status: 404 }
      );
    }

    // Get outline data
    const outline = await getOutlineByGuid(supabase, job.outline_guid);
    if (!outline) {
      await handleError(supabase, 'Outline not found', { section_id, job_id, outline_guid: job.outline_guid });
      return new Response(
        JSON.stringify(createResponse(false, 'Outline not found')),
        { headers: { ...corsHeaders }, status: 404 }
      );
    }
    
    // Get domain preferences
    const domain = outline.domain;
    const domainPreferences = await getDomainPreferences(supabase, domain);
    const clientSynopsis = createClientSynopsis(domainPreferences);

    // Parse outline
    let outlineJSON;
    try {
      outlineJSON = JSON.parse(outline.outline);
    } catch (error) {
      await handleError(supabase, 'Invalid outline format', { section_id, job_id, outline_guid: job.outline_guid });
      return new Response(
        JSON.stringify(createResponse(false, 'Invalid outline format')),
        { headers: { ...corsHeaders }, status: 400 }
      );
    }

    // Parse references data
    let referencesData = section.references_data;
    if (typeof referencesData === 'string') {
      try {
        referencesData = JSON.parse(referencesData);
      } catch (error) {
        console.error('Error parsing references data:', error);
        referencesData = { 
          sources: [], 
          key_findings: ["No valid reference data available"],
          conflicting_information: [] 
        };
      }
    }

    if (!referencesData) {
      referencesData = { 
        sources: [], 
        key_findings: ["No reference data available"],
        conflicting_information: [] 
      };
    }

    // Generate content for the section
    let sectionContent;
    try {
      sectionContent = await generateSectionContentWithClaude(
        section,
        outline,
        outlineJSON,
        outline.keyword,
        referencesData,
        clientSynopsis
      );
    } catch (error) {
      await handleError(supabase, error, { section_id, job_id });
      return new Response(
        JSON.stringify(createResponse(false, 'Failed to generate section content')),
        { headers: { ...corsHeaders }, status: 500 }
      );
    }

    // Update the section with generated content
    const { error: updateError } = await supabase
      .from('content_sections')
      .update({ 
        section_content: sectionContent,
        status: 'completed',
        updated_at: new Date().toISOString()
      })
      .eq('id', section_id);
    
    if (updateError) {
      await handleError(supabase, updateError, { section_id, job_id });
      return new Response(
        JSON.stringify(createResponse(false, 'Failed to update section with generated content')),
        { headers: { ...corsHeaders }, status: 500 }
      );
    }

    // Update the queue entry to completed
    const { error: queueError } = await supabase
      .from('content_section_queue')
      .update({ 
        status: 'completed',
        updated_at: new Date().toISOString()
      })
      .eq('job_id', job_id)
      .eq('section_index', section.section_index);
    
    if (queueError) {
      console.error('Failed to update queue entry:', queueError.message);
      // Non-critical, don't fail the request
    }

    // Update job heartbeat
    await updateHeartbeat(supabase, job_id);

    // Check if all sections are completed
    const { data: sections, error: sectionsError } = await supabase
      .from('content_sections')
      .select('status')
      .eq('job_id', job_id)
      .eq('is_deleted', false);
    
    if (sectionsError) {
      await handleError(supabase, sectionsError, { job_id });
      console.error('Failed to check section completion status:', sectionsError.message);
      // Non-critical, don't fail the request
    } else {
      const allCompleted = sections.every(s => s.status === 'completed');
      
      if (allCompleted) {
        // Update job status to assembling
        const { error: jobUpdateError } = await supabase
          .from('content_generation_jobs')
          .update({ 
            status: 'assembling',
            updated_at: new Date().toISOString(),
            heartbeat: new Date().toISOString()
          })
          .eq('id', job_id);
        
        if (jobUpdateError) {
          await handleError(supabase, jobUpdateError, { job_id });
          console.error('Failed to update job status:', jobUpdateError.message);
        } else {
          // Trigger content assembly
          try {
            fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/assemble-content`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${Deno.env.get('SUPABASE_ANON_KEY')}`
              },
              body: JSON.stringify({ job_id })
            })
            .catch(error => {
              console.error('Error triggering assemble-content:', error);
            });
          } catch (error) {
            console.error('Exception when triggering assemble-content:', error);
          }
        }
      }
    }

    return new Response(
      JSON.stringify(createResponse(true, 'Section content generated successfully', {
        section_id,
        job_id,
        section_index: section.section_index,
        section_title: section.section_title,
        content_length: sectionContent.length,
        all_sections_completed: sections && sections.every(s => s.status === 'completed')
      })),
      { headers: { ...corsHeaders } }
    );

  } catch (error) {
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    await handleError(supabase, error, { path: 'generate-content-section' });
    
    return new Response(
      JSON.stringify(createResponse(false, 'Internal server error')),
      { headers: { ...corsHeaders }, status: 500 }
    );
  }
});