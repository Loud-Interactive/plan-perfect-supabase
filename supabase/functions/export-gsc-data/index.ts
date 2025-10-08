// export-gsc-data
// Function to export GSC data in various formats (CSV, JSON)

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight request
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Parse request parameters
    const url = new URL(req.url);
    
    // Required parameters
    const format = url.searchParams.get('format') || 'csv';
    const date = url.searchParams.get('date');
    
    // Optional filters
    const domain = url.searchParams.get('domain');
    const page = url.searchParams.get('page');
    const keyword = url.searchParams.get('keyword');
    const minPosition = url.searchParams.get('minPosition');
    const maxPosition = url.searchParams.get('maxPosition');
    const minImpressions = url.searchParams.get('minImpressions');
    const minClicks = url.searchParams.get('minClicks');
    const sortBy = url.searchParams.get('sortBy') || 'impressions';
    const sortOrder = url.searchParams.get('sortOrder') || 'desc';
    const limit = parseInt(url.searchParams.get('limit') || '10000');
    
    // Validate required parameters
    if (!date) {
      throw new Error('date parameter is required (YYYY-MM-DD)');
    }
    
    // Create Supabase client
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );
    
    // Build the query
    let query = supabaseClient
      .from('gsc_keywords')
      .select(`
        id,
        keyword,
        clicks,
        impressions,
        ctr,
        position,
        fetched_at,
        pages(url, title, domain)
      `)
      .eq('fetched_at', date);
    
    // Apply filters if provided
    if (domain) {
      query = query.eq('pages.domain', domain);
    }
    
    if (page) {
      query = query.ilike('pages.url', `%${page}%`);
    }
    
    if (keyword) {
      query = query.ilike('keyword', `%${keyword}%`);
    }
    
    if (minPosition) {
      query = query.gte('position', minPosition);
    }
    
    if (maxPosition) {
      query = query.lte('position', maxPosition);
    }
    
    if (minImpressions) {
      query = query.gte('impressions', minImpressions);
    }
    
    if (minClicks) {
      query = query.gte('clicks', minClicks);
    }
    
    // Apply sorting
    query = query.order(sortBy, { ascending: sortOrder === 'asc' });
    
    // Apply limit
    query = query.limit(limit);
    
    // Execute query
    const { data, error } = await query;
    
    if (error) {
      throw new Error(`Database query error: ${error.message}`);
    }
    
    if (!data || data.length === 0) {
      return new Response(
        JSON.stringify({
          success: false,
          message: 'No data found for the specified criteria',
        }),
        {
          status: 404,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
          },
        }
      );
    }
    
    // Format data
    const formattedData = data.map(item => ({
      url: item.pages?.url || '',
      domain: item.pages?.domain || '',
      title: item.pages?.title || '',
      keyword: item.keyword,
      position: item.position,
      impressions: item.impressions,
      clicks: item.clicks,
      ctr: item.ctr,
      fetched_date: new Date(item.fetched_at).toISOString().split('T')[0]
    }));
    
    // Return data in requested format
    if (format === 'json') {
      return new Response(
        JSON.stringify({
          success: true,
          count: formattedData.length,
          data: formattedData
        }),
        {
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
          },
        }
      );
    } else if (format === 'csv') {
      // Generate CSV
      const csvHeader = Object.keys(formattedData[0]).join(',');
      const csvRows = formattedData.map(row => 
        Object.values(row).map(value => 
          typeof value === 'string' && value.includes(',') ? 
            `"${value.replace(/"/g, '""')}"` : 
            value
        ).join(',')
      );
      const csvContent = [csvHeader, ...csvRows].join('\n');
      
      // Create filename
      const dateStr = date.replace(/-/g, '');
      const domainStr = domain ? `-${domain.replace(/\./g, '_')}` : '';
      const filename = `gsc-data${domainStr}-${dateStr}.csv`;
      
      return new Response(csvContent, {
        headers: {
          ...corsHeaders,
          'Content-Type': 'text/csv',
          'Content-Disposition': `attachment; filename="${filename}"`
        },
      });
    } else {
      throw new Error(`Unsupported format: ${format}`);
    }
  } catch (error) {
    console.error('Error:', error);
    
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