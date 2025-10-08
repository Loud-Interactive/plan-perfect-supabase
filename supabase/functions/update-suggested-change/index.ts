// supabase/functions/update-suggested-change/index.ts
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.4.0'

serve(async (req) => {
  // Set CORS headers for all responses
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  }

  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders, status: 204 })
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
  
  try {
    // Parse the request body
    const { change_id, status } = await req.json()
    
    if (!change_id) {
      return new Response(JSON.stringify({ error: 'Change ID is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
    
    if (!status || !['accepted', 'rejected', 'pending'].includes(status)) {
      return new Response(JSON.stringify({ error: 'Valid status is required (accepted, rejected, or pending)' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
    
    console.log(`Updating suggested change ${change_id} to status: ${status}`)
    
    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    // Get the suggested change first
    const { data: change, error: getError } = await supabase
      .from('suggested_changes')
      .select('*, document_versions(job_id)')
      .eq('id', change_id)
      .eq('is_deleted', false)
      .single();
    
    if (getError) {
      console.error('Error fetching suggested change:', getError);
      return new Response(JSON.stringify({ 
        error: `Failed to fetch suggested change: ${getError.message}` 
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    
    if (!change) {
      return new Response(JSON.stringify({ error: 'Suggested change not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    
    // Update the suggested change status
    const { data: updatedChange, error: updateError } = await supabase
      .from('suggested_changes')
      .update({ status })
      .eq('id', change_id)
      .select()
      .single();
    
    if (updateError) {
      console.error('Error updating suggested change:', updateError);
      return new Response(JSON.stringify({ 
        error: `Failed to update suggested change: ${updateError.message}` 
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    
    // If change was accepted, apply it to the document
    if (status === 'accepted' && change.document_versions && change.document_versions.job_id) {
      // Get the current version's content
      const { data: versionData, error: versionError } = await supabase
        .from('document_versions')
        .select('content')
        .eq('id', change.version_id)
        .single();
      
      if (versionError || !versionData) {
        console.error('Error fetching version content:', versionError);
      } else {
        // Apply the change if we have original text
        const content = versionData.content;
        let updatedContent = content;
        let contentEdited = false;
        
        if (change.original && content.includes(change.original)) {
          updatedContent = content.replace(change.original, change.suggested);
          contentEdited = true;
          
          // Create a new version with the applied change
          const { data: newVersionData, error: newVersionError } = await supabase
            .from('document_versions')
            .insert({
              job_id: change.document_versions.job_id,
              content: updatedContent,
              feedback: `Applied suggested change: "${change.original}" → "${change.suggested}"`,
              description: 'Applied suggested change'
            })
            .select()
            .single();
          
          if (newVersionError) {
            console.error('Error creating new version:', newVersionError);
          } else {
            console.log(`Created new version with ID: ${newVersionData.id}`);
            
            // Find the corresponding content_edit for this suggested change
            const { data: contentEdits, error: contentEditError } = await supabase
              .from('content_edits')
              .select('id')
              .eq('version_id', change.version_id)
              .eq('is_deleted', false)
              .eq('original_text', change.original)
              .eq('edited_text', change.suggested);
            
            if (contentEditError) {
              console.error('Error finding content edit:', contentEditError);
            } else if (contentEdits && contentEdits.length > 0) {
              // Mark the edit as applied in the applied_edits junction table
              const { data: appliedEdit, error: appliedEditError } = await supabase
                .from('applied_edits')
                .insert({
                  version_id: newVersionData.id,
                  edit_id: contentEdits[0].id
                })
                .select();
              
              if (appliedEditError) {
                console.error('Error recording applied edit:', appliedEditError);
              } else {
                console.log(`Recorded applied edit for version ${newVersionData.id}`);
              }
            } else {
              // If no content_edit found, create one for backward compatibility
              const { data: newContentEdit, error: newContentEditError } = await supabase
                .from('content_edits')
                .insert({
                  job_id: change.document_versions.job_id,
                  document_id: change.document_versions.job_id, // We don't have document_id directly, so use job_id as placeholder
                  version_id: newVersionData.id,
                  edit_type: 'feedback',
                  original_text: change.original,
                  edited_text: change.suggested,
                  reasoning: change.reasoning || 'Applied from suggested change',
                  is_applied: true,
                  applied_at: new Date().toISOString()
                })
                .select();
              
              if (newContentEditError) {
                console.error('Error creating content edit:', newContentEditError);
              } else {
                console.log(`Created new content edit for suggested change`);
                
                // Create the applied_edits entry
                await supabase
                  .from('applied_edits')
                  .insert({
                    version_id: newVersionData.id,
                    edit_id: newContentEdit[0].id
                  });
              }
            }
            
            // Update the edit job with the new content
            await supabase
              .from('edit_jobs')
              .update({ 
                edited_content: updatedContent
              })
              .eq('id', change.document_versions.job_id);
          }
        } else if (!change.original) {
          // If there's no original text (e.g., for general suggestions), just log this
          console.log('Accepted change has no specific original text to replace');
        } else {
          console.log('Original text not found in content');
        }
      }
    }
    
    // Return success response
    return new Response(JSON.stringify({ 
      success: true,
      change: updatedChange
    }), { 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200
    });
  } catch (error) {
    console.error('Error in update-suggested-change function:', error);
    
    return new Response(
      JSON.stringify({ 
        error: `Failed to update suggested change: ${error.message}` 
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500
      }
    );
  }
})