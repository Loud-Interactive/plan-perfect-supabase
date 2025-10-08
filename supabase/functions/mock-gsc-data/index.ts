// PagePerfect: mock-gsc-data
// Mock function to simulate GSC data for testing without actual GSC API access
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface RequestBody {
  siteUrl?: string;
  startDate?: string;
  endDate?: string;
  domainFilter?: string;
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
    // Parse request body
    const body = await req.json() as RequestBody;
    const { 
      siteUrl,
      startDate, 
      endDate, 
      domainFilter, 
      minImpressions = 10,
      format = 'json',
      limit = 1000,
      offset = 0
    } = body;

    console.log(`Mock GSC data request for ${siteUrl || domainFilter || 'all domains'}`);

    // Generate mock GSC data
    const mockData = generateMockGSCData(
      siteUrl || domainFilter || 'example.com',
      startDate || '2025-04-01',
      endDate || '2025-04-30',
      limit,
      offset,
      minImpressions
    );

    // Format response based on requested format
    if (format === 'csv') {
      const csv = convertToCSV(mockData);
      return new Response(csv, {
        headers: {
          ...corsHeaders,
          'Content-Type': 'text/csv',
          'Content-Disposition': 'attachment; filename="gsc_data.csv"'
        }
      });
    }

    // Return JSON format (default)
    return new Response(
      JSON.stringify({
        success: true,
        message: 'Mock GSC data generated successfully',
        count: mockData.length,
        totalCount: 10000, // Simulated total
        pagination: {
          limit,
          offset,
          hasMore: mockData.length === limit
        },
        filters: {
          siteUrl,
          domainFilter,
          startDate,
          endDate,
          minImpressions
        },
        data: mockData
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

// Function to generate mock GSC data
function generateMockGSCData(
  domain: string,
  startDate: string,
  endDate: string,
  limit: number,
  offset: number,
  minImpressions: number
): any[] {
  // Common keywords for mock data
  const keywords = [
    'how to', 'best', 'top', 'review', 'vs', 'guide',
    'tutorial', 'example', 'definition', 'meaning',
    'what is', 'how does', 'why is', 'when to', 'where to',
    'can I', 'should I', 'will', 'does', 'are'
  ];

  // Topics relevant to the domain
  const topics = [
    'seo', 'marketing', 'content', 'website', 'blog',
    'social media', 'analytics', 'conversion', 'traffic',
    'ranking', 'keywords', 'backlinks', 'optimization',
    'algorithm', 'search engine', 'google', 'indexing',
    'mobile', 'responsive', 'performance'
  ];

  // Generate different mock page URLs
  const pages = [
    `https://${domain}/`,
    `https://${domain}/blog/`,
    `https://${domain}/about/`,
    `https://${domain}/contact/`,
    `https://${domain}/products/`,
    `https://${domain}/services/`,
    `https://${domain}/blog/seo-tips/`,
    `https://${domain}/blog/content-marketing/`,
    `https://${domain}/blog/social-media-strategy/`,
    `https://${domain}/case-studies/`
  ];

  // Generate mock data for each date in the range
  const result = [];
  
  // Parse dates
  const start = new Date(startDate);
  const end = new Date(endDate);
  const dateRange = (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
  
  // For each combination up to the limit
  for (let i = offset; i < offset + limit && i < 10000; i++) {
    // Pick random elements for this row
    const randomKeyword = keywords[Math.floor(Math.random() * keywords.length)];
    const randomTopic = topics[Math.floor(Math.random() * topics.length)];
    const randomPage = pages[Math.floor(Math.random() * pages.length)];
    
    // Create query based on keywords and topics
    let query = '';
    if (Math.random() > 0.5) {
      query = `${randomKeyword} ${randomTopic}`;
    } else {
      query = `${randomTopic} ${randomKeyword}`;
    }
    
    // Add additional terms sometimes
    if (Math.random() > 0.7) {
      query += ` ${domain.split('.')[0]}`;
    }
    
    // Generate random metrics (weighted to be realistic)
    const position = Math.max(1, Math.min(100, Math.floor(Math.random() * 20) + (i % 20)));
    const impressions = Math.max(minImpressions, Math.floor(500 * Math.exp(-position/10) + Math.random() * 50));
    const ctr = Math.max(0.001, Math.min(0.5, 0.7 * Math.exp(-position/5) + Math.random() * 0.05));
    const clicks = Math.round(impressions * ctr);
    
    // Random date within range
    const randomDayOffset = Math.floor(Math.random() * dateRange);
    const randomDate = new Date(start);
    randomDate.setDate(randomDate.getDate() + randomDayOffset);
    const fetchedDate = randomDate.toISOString().split('T')[0];
    
    // Create the data row
    result.push({
      page_url: randomPage,
      keyword: query,
      clicks: clicks,
      impressions: impressions,
      ctr: ctr,
      position: position,
      fetched_date: fetchedDate
    });
  }
  
  return result;
}

// Function to convert data to CSV format
function convertToCSV(data: any[]): string {
  if (data.length === 0) return '';
  
  // Get headers from first row
  const headers = Object.keys(data[0]);
  
  // Create header row
  let csv = headers.join(',') + '\r\n';
  
  // Add data rows
  for (const row of data) {
    const values = headers.map(header => {
      const value = row[header];
      
      // Handle special cases
      if (value === null || value === undefined) {
        return '';
      } else if (typeof value === 'string' && (value.includes(',') || value.includes('"') || value.includes('\n'))) {
        // Escape quotes and wrap in quotes
        return `"${value.replace(/"/g, '""')}"`;
      } else {
        return String(value);
      }
    });
    
    csv += values.join(',') + '\r\n';
  }
  
  return csv;
}