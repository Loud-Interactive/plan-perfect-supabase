import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';

interface ContentEditsParams {
  job_id: string;
  edit_type?: string;
  is_applied?: boolean;
  page?: number;
  limit?: number;
  sort_by?: string;
  sort_direction?: 'asc' | 'desc';
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
    const { 
      job_id, 
      edit_type, 
      is_applied, 
      page = 1, 
      limit = 10, 
      sort_by = 'created_at',
      sort_direction = 'desc' 
    } = await req.json() as ContentEditsParams;

    // Validate required parameters
    if (!job_id) {
      return new Response(
        JSON.stringify({ error: 'job_id is required' }),
        { headers: { 'Content-Type': 'application/json' }, status: 400 }
      );
    }

    // Build query with filters
    let query = supabaseClient
      .from('content_edits')
      .select('*', { count: 'exact' })
      .eq('job_id', job_id)
      .eq('is_deleted', false);

    // Apply optional filters
    if (edit_type) {
      query = query.eq('edit_type', edit_type);
    }

    if (is_applied !== undefined) {
      query = query.eq('is_applied', is_applied);
    }

    // Apply sorting
    const validSortColumns = ['created_at', 'paragraph_number', 'edit_type', 'is_applied'];
    const sortColumn = validSortColumns.includes(sort_by) ? sort_by : 'created_at';
    const sortDir = sort_direction === 'asc' ? 'asc' : 'desc';
    
    query = query.order(sortColumn, { ascending: sortDir === 'asc' });

    // Apply pagination
    const pageNum = Math.max(1, page);
    const pageSize = Math.min(100, Math.max(1, limit)); // Limit to max 100 items per page
    const offset = (pageNum - 1) * pageSize;
    
    query = query.range(offset, offset + pageSize - 1);

    // Execute query
    const { data: edits, error, count } = await query;

    if (error) {
      console.error('Error fetching edits:', error);
      return new Response(
        JSON.stringify({ error: error.message }),
        { headers: { 'Content-Type': 'application/json' }, status: 500 }
      );
    }

    // Return results with pagination info
    return new Response(
      JSON.stringify({
        edits,
        total: count || 0,
        page: pageNum,
        limit: pageSize,
        total_pages: count ? Math.ceil(count / pageSize) : 0
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