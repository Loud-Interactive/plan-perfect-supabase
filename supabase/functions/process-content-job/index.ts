// Supabase Edge Function: process-content-job
// Orchestrates the content generation process for a job

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../helpers.ts';
import { 
  handleError, 
  createResponse,
  updateHeartbeat,
  getOutlineByGuid,
  parseOutline
} from '../content-perfect/utils/index.ts';

const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

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

    // Process based on job status
    switch (job.status) {
      case 'pending':
        // Move job to research status and start the research process
        await supabase
          .from('content_generation_jobs')
          .update({ 
            status: 'research',
            updated_at: new Date().toISOString(),
            heartbeat: new Date().toISOString()
          })
          .eq('id', job_id);
        
        // Process continues to research phase
        
      case 'research':
        // Get outline data
        const outline = await getOutlineByGuid(supabase, job.outline_guid);
        if (!outline) {
          await handleError(supabase, 'Outline not found', { job_id, outline_guid: job.outline_guid });
          return new Response(
            JSON.stringify(createResponse(false, 'Outline not found')),
            { headers: { ...corsHeaders }, status: 404 }
          );
        }

        // Parse outline
        let outlineJSON;
        try {
          outlineJSON = parseOutline(outline.outline);
        } catch (error) {
          await handleError(supabase, error, { job_id, outline_guid: job.outline_guid });
          return new Response(
            JSON.stringify(createResponse(false, 'Invalid outline format')),
            { headers: { ...corsHeaders }, status: 400 }
          );
        }

        // Get all sections and check their status
        const { data: sections, error: sectionsError } = await supabase
          .from('content_sections')
          .select('*')
          .eq('job_id', job_id)
          .eq('is_deleted', false)
          .order('section_index', { ascending: true });
        
        if (sectionsError) {
          await handleError(supabase, sectionsError, { job_id });
          return new Response(
            JSON.stringify(createResponse(false, 'Failed to retrieve sections')),
            { headers: { ...corsHeaders }, status: 500 }
          );
        }

        // Check which sections need research
        const sectionsNeedingResearch = sections.filter(s => s.status === 'pending');
        
        if (sectionsNeedingResearch.length > 0) {
          // Start research for the first pending section
          const sectionToResearch = sectionsNeedingResearch[0];
          
          try {
            // Trigger generate-section-queries for this section
            fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/generate-section-queries`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${Deno.env.get('SUPABASE_ANON_KEY')}`
              },
              body: JSON.stringify({ 
                section_id: sectionToResearch.id, 
                job_id: job_id 
              })
            })
            .catch(error => {
              console.error('Error triggering generate-section-queries:', error);
            });
          } catch (error) {
            console.error('Exception when triggering generate-section-queries:', error);
          }
          
          return new Response(
            JSON.stringify(createResponse(true, 'Research started for section', {
              job_id,
              section_id: sectionToResearch.id,
              section_index: sectionToResearch.section_index,
              section_title: sectionToResearch.section_title,
              remaining_sections: sectionsNeedingResearch.length - 1
            })),
            { headers: { ...corsHeaders } }
          );
        }

        // If all sections are done with research, move to processing phase
        await supabase
          .from('content_generation_jobs')
          .update({ 
            status: 'processing',
            updated_at: new Date().toISOString(),
            heartbeat: new Date().toISOString()
          })
          .eq('id', job_id);
        
        // Process continues to processing phase
        
      case 'processing':
        // Get sections that need content generation
        const { data: processingSections, error: processingError } = await supabase
          .from('content_sections')
          .select('*')
          .eq('job_id', job_id)
          .in('status', ['research', 'processing'])
          .eq('is_deleted', false)
          .order('section_index', { ascending: true });
        
        if (processingError) {
          await handleError(supabase, processingError, { job_id });
          return new Response(
            JSON.stringify(createResponse(false, 'Failed to retrieve sections for processing')),
            { headers: { ...corsHeaders }, status: 500 }
          );
        }

        if (processingSections.length > 0) {
          // Process the first section in the queue
          const sectionToProcess = processingSections[0];
          
          // Check if this section has research data
          if (sectionToProcess.status === 'research') {
            try {
              // Trigger generate-content-section for this section
              fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/generate-content-section`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${Deno.env.get('SUPABASE_ANON_KEY')}`
                },
                body: JSON.stringify({ 
                  section_id: sectionToProcess.id, 
                  job_id: job_id 
                })
              })
              .catch(error => {
                console.error('Error triggering generate-content-section:', error);
              });
            } catch (error) {
              console.error('Exception when triggering generate-content-section:', error);
            }
            
            return new Response(
              JSON.stringify(createResponse(true, 'Content generation started for section', {
                job_id,
                section_id: sectionToProcess.id,
                section_index: sectionToProcess.section_index,
                section_title: sectionToProcess.section_title,
                remaining_sections: processingSections.length - 1
              })),
              { headers: { ...corsHeaders } }
            );
          }
        }

        // Check if all sections are completed
        const { data: allSections, error: allSectionsError } = await supabase
          .from('content_sections')
          .select('status')
          .eq('job_id', job_id)
          .eq('is_deleted', false);
        
        if (allSectionsError) {
          await handleError(supabase, allSectionsError, { job_id });
          return new Response(
            JSON.stringify(createResponse(false, 'Failed to check section status')),
            { headers: { ...corsHeaders }, status: 500 }
          );
        }

        const allCompleted = allSections.every(s => s.status === 'completed');
        
        if (allCompleted) {
          // Move to assembling phase
          await supabase
            .from('content_generation_jobs')
            .update({ 
              status: 'assembling',
              updated_at: new Date().toISOString(),
              heartbeat: new Date().toISOString()
            })
            .eq('id', job_id);
          
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
          
          return new Response(
            JSON.stringify(createResponse(true, 'All sections completed, starting content assembly', {
              job_id,
              sections_count: allSections.length
            })),
            { headers: { ...corsHeaders } }
          );
        }
        
        return new Response(
          JSON.stringify(createResponse(true, 'Processing job, waiting for section completion', {
            job_id,
            sections_total: allSections.length,
            sections_completed: allSections.filter(s => s.status === 'completed').length,
            sections_processing: allSections.filter(s => s.status === 'processing' || s.status === 'research').length,
            sections_pending: allSections.filter(s => s.status === 'pending').length
          })),
          { headers: { ...corsHeaders } }
        );
        
      case 'assembling':
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
        
        return new Response(
          JSON.stringify(createResponse(true, 'Assembling content', {
            job_id
          })),
          { headers: { ...corsHeaders } }
        );
        
      case 'converting':
        // Trigger HTML conversion
        try {
          fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/convert-to-html`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${Deno.env.get('SUPABASE_ANON_KEY')}`
            },
            body: JSON.stringify({ job_id })
          })
          .catch(error => {
            console.error('Error triggering convert-to-html:', error);
          });
        } catch (error) {
          console.error('Exception when triggering convert-to-html:', error);
        }
        
        return new Response(
          JSON.stringify(createResponse(true, 'Converting content to HTML', {
            job_id
          })),
          { headers: { ...corsHeaders } }
        );
        
      case 'completed':
        return new Response(
          JSON.stringify(createResponse(true, 'Job already completed', {
            job_id
          })),
          { headers: { ...corsHeaders } }
        );
        
      case 'failed':
        return new Response(
          JSON.stringify(createResponse(false, 'Job failed', {
            job_id,
            error: job.error
          })),
          { headers: { ...corsHeaders }, status: 400 }
        );
        
      default:
        return new Response(
          JSON.stringify(createResponse(false, `Unknown job status: ${job.status}`)),
          { headers: { ...corsHeaders }, status: 400 }
        );
    }

  } catch (error) {
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    await handleError(supabase, error, { path: 'process-content-job' });
    
    return new Response(
      JSON.stringify(createResponse(false, 'Internal server error')),
      { headers: { ...corsHeaders }, status: 500 }
    );
  }
});