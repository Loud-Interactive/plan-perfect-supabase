// PagePerfect: export-all-rankings
// Function to export all GSC rankings data for analysis
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface RequestBody {
  domainFilter?: string;
  startDate?: string;
  endDate?: string;
  minImpressions?: number;
  format?: 'json' | 'csv';
  limit?: number;
  offset?: number;
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

    // Parse request body or URL parameters
    let params: RequestBody = {};
    
    if (req.method === 'POST') {
      params = await req.json() as RequestBody;
    } else {
      // Handle GET requests with URL parameters
      const url = new URL(req.url);
      params = {
        domainFilter: url.searchParams.get('domainFilter') || undefined,
        startDate: url.searchParams.get('startDate') || undefined,
        endDate: url.searchParams.get('endDate') || undefined,
        minImpressions: url.searchParams.get('minImpressions') ? 
          parseInt(url.searchParams.get('minImpressions')!) : undefined,
        format: (url.searchParams.get('format') as 'json' | 'csv' | null) || 'json',
        limit: url.searchParams.get('limit') ? 
          parseInt(url.searchParams.get('limit')!) : 1000,
        offset: url.searchParams.get('offset') ? 
          parseInt(url.searchParams.get('offset')!) : 0,
      };
    }

    const { 
      domainFilter, 
      startDate, 
      endDate, 
      minImpressions = 10, 
      format = 'json',
      limit = 1000,
      offset = 0 
    } = params;

    console.log(`Exporting rankings data with filters:`, params);

    // Build query for GSC data
    let query = supabaseClient
      .from('gsc_page_query_daily')
      .select('*')
      .gte('impressions', minImpressions)
      .order('impressions', { ascending: false })
      .limit(limit)
      .range(offset, offset + limit - 1);
    
    // Apply date filters if provided
    if (startDate) {
      query = query.gte('fetched_date', startDate);
    }
    
    if (endDate) {
      query = query.lte('fetched_date', endDate);
    }

    // Apply domain filter if provided
    if (domainFilter) {
      // Filter by domain - in a real implementation, we would use a more sophisticated approach
      // For this demo, we'll use a simple LIKE query
      query = query.ilike('page_url', `%${domainFilter}%`);
    }
    
    // Execute the query
    const { data, error, count } = await query;

    if (error) {
      throw new Error(`Database query error: ${error.message}`);
    }

    // Get total count for pagination
    const { count: totalCount, error: countError } = await supabaseClient
      .from('gsc_page_query_daily')
      .select('*', { count: 'exact', head: true })
      .gte('impressions', minImpressions);

    if (countError) {
      console.error(`Error getting total count: ${countError.message}`);
    }

    // Format the response based on the requested format
    if (format === 'csv') {
      // Generate CSV
      const csv = generateCsv(data);
      
      return new Response(csv, {
        headers: {
          ...corsHeaders,
          'Content-Type': 'text/csv',
          'Content-Disposition': 'attachment; filename="gsc_rankings_export.csv"'
        },
      });
    } else {
      // JSON format (default)
      return new Response(
        JSON.stringify({
          success: true,
          message: 'Rankings data exported successfully',
          count: data.length,
          totalCount: totalCount || 'unknown',
          pagination: {
            limit,
            offset,
            hasMore: (data.length === limit)
          },
          filters: {
            domainFilter,
            startDate,
            endDate,
            minImpressions
          },
          data
        }),
        {
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
          },
        }
      );
    }
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

// Function to generate CSV from data
function generateCsv(data: any[]): string {
  if (!data || data.length === 0) {
    return '';
  }
  
  // Get column headers from the first row
  const headers = Object.keys(data[0]);
  
  // Create header row
  let csv = headers.join(',') + '\n';
  
  // Add data rows
  for (const row of data) {
    const values = headers.map(header => {
      const value = row[header];
      
      // Handle special cases (null, undefined, strings with commas)
      if (value === null || value === undefined) {
        return '';
      } else if (typeof value === 'string' && (value.includes(',') || value.includes('"') || value.includes('\n'))) {
        // Escape quotes and wrap in quotes if the value contains comma, quote, or newline
        return `"${value.replace(/"/g, '""')}"`;
      } else {
        return String(value);
      }
    });
    
    csv += values.join(',') + '\n';
  }
  
  return csv;
}