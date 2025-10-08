import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';

interface ApplyEditsParams {
  job_id: string;
  edit_ids: string[];
  version_name?: string;
}

serve(async (req) => {
  try {
    // Create a Supabase client with the Auth context of the logged in user
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
    );

    // Parse request body
    const { job_id, edit_ids, version_name } = await req.json() as ApplyEditsParams;

    // Validate required parameters
    if (!job_id) {
      return new Response(
        JSON.stringify({ error: 'job_id is required' }),
        { headers: { 'Content-Type': 'application/json' }, status: 400 }
      );
    }

    if (!edit_ids || !Array.isArray(edit_ids) || edit_ids.length === 0) {
      return new Response(
        JSON.stringify({ error: 'At least one edit_id is required' }),
        { headers: { 'Content-Type': 'application/json' }, status: 400 }
      );
    }

    // Fetch the job information
    const { data: job, error: jobError } = await supabaseClient
      .from('edit_jobs')
      .select('document_id, original_content')
      .eq('id', job_id)
      .single();

    if (jobError || !job) {
      return new Response(
        JSON.stringify({ error: jobError?.message || 'Job not found' }),
        { headers: { 'Content-Type': 'application/json' }, status: 404 }
      );
    }

    // Fetch the edits to apply
    const { data: edits, error: editsError } = await supabaseClient
      .from('content_edits')
      .select('*')
      .in('id', edit_ids)
      .eq('is_deleted', false);

    if (editsError || !edits) {
      return new Response(
        JSON.stringify({ error: editsError?.message || 'Error fetching edits' }),
        { headers: { 'Content-Type': 'application/json' }, status: 500 }
      );
    }

    if (edits.length === 0) {
      return new Response(
        JSON.stringify({ error: 'No valid edits found' }),
        { headers: { 'Content-Type': 'application/json' }, status: 404 }
      );
    }

    // Sort edits by paragraph number (null paragraph numbers at the end)
    const sortedEdits = [...edits].sort((a, b) => {
      if (a.paragraph_number === null) return 1;
      if (b.paragraph_number === null) return -1;
      return a.paragraph_number - b.paragraph_number;
    });

    // Apply the edits to the content
    let updatedContent = job.original_content;
    const appliedEditIds: string[] = [];

    for (const edit of sortedEdits) {
      // Check if the original text is still present
      if (updatedContent.includes(edit.original_text)) {
        // Replace the content
        updatedContent = updatedContent.replace(edit.original_text, edit.edited_text);
        appliedEditIds.push(edit.id);
      } else {
        console.log(`Original text not found for edit ${edit.id}`);
      }
    }

    if (appliedEditIds.length === 0) {
      return new Response(
        JSON.stringify({ error: 'Could not apply any edits - original text not found' }),
        { headers: { 'Content-Type': 'application/json' }, status: 400 }
      );
    }

    // Create a new document version
    const versionData = {
      document_id: job.document_id,
      job_id: job_id,
      content: updatedContent,
      version_type: 'selective_edits',
      name: version_name || `Selective edits (${appliedEditIds.length} edits)`
    };

    const { data: newVersion, error: versionError } = await supabaseClient
      .from('document_versions')
      .insert(versionData)
      .select()
      .single();

    if (versionError || !newVersion) {
      return new Response(
        JSON.stringify({ error: versionError?.message || 'Error creating version' }),
        { headers: { 'Content-Type': 'application/json' }, status: 500 }
      );
    }

    // Record which edits were applied to this version
    const appliedEditsData = appliedEditIds.map(edit_id => ({
      version_id: newVersion.id,
      edit_id: edit_id
    }));
    
    const { error: appliedEditsError } = await supabaseClient
      .from('applied_edits')
      .insert(appliedEditsData);

    if (appliedEditsError) {
      console.error('Error recording applied edits:', appliedEditsError);
      // We'll continue even if there's an error here, as the version was created
    }

    // Update the job with the latest edited content
    const { error: updateJobError } = await supabaseClient
      .from('edit_jobs')
      .update({ edited_content: updatedContent })
      .eq('id', job_id);

    if (updateJobError) {
      console.error('Error updating job with edited content:', updateJobError);
      // We'll continue even if there's an error here
    }

    // Return success response
    return new Response(
      JSON.stringify({
        success: true,
        version_id: newVersion.id,
        applied_count: appliedEditIds.length,
        total_edits: edits.length,
        content: updatedContent
      }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Unexpected error:', error);
    return new Response(
      JSON.stringify({ error: 'An unexpected error occurred' }),
      { headers: { 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});