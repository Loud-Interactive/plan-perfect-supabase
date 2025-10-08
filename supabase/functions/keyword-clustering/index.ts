// PagePerfect: keyword-clustering
// Function to cluster keywords by semantic similarity using DBSCAN
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface RequestBody {
  pageId: string;
  minSamples?: number;
  epsilon?: number;
  minImpressions?: number;
  openaiApiKey?: string;
}

interface Keyword {
  id: string;
  keyword: string;
  impressions: number;
  position: number;
  embedding?: number[];
  clusterId?: number;
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

    // Parse request body
    const { 
      pageId, 
      minSamples = 3, 
      epsilon = 0.15,
      minImpressions = 10, 
      openaiApiKey 
    } = await req.json() as RequestBody;

    if (!pageId) {
      throw new Error('pageId is required');
    }

    // Use API key from request or environment variable
    const apiKey = openaiApiKey || Deno.env.get('OPENAI_API_KEY');
    if (!apiKey) {
      throw new Error('OpenAI API key is required');
    }

    console.log(`Clustering keywords for page ID: ${pageId}`);

    // Get page data to verify existence
    const { data: pageData, error: pageError } = await supabaseClient
      .from('pages')
      .select('id, url')
      .eq('id', pageId)
      .single();

    if (pageError || !pageData) {
      throw new Error(`Error fetching page: ${pageError?.message || 'Page not found'}`);
    }

    // Get keywords for the page with minimum impressions
    const { data: keywordsData, error: keywordsError } = await supabaseClient
      .from('gsc_keywords')
      .select('id, keyword, impressions, position')
      .eq('page_id', pageId)
      .gte('impressions', minImpressions)
      .order('impressions', { ascending: false });

    if (keywordsError) {
      throw new Error(`Error fetching keywords: ${keywordsError.message}`);
    }

    if (!keywordsData || keywordsData.length === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          message: 'No keywords found with the specified criteria',
          pageId,
          keywordCount: 0,
          clusters: [],
        }),
        {
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
          },
        }
      );
    }

    console.log(`Found ${keywordsData.length} keywords for clustering`);

    // Generate embeddings for all keywords
    const keywords: Keyword[] = keywordsData;
    const keywordsWithEmbeddings = await Promise.all(
      keywords.map(async (keyword) => {
        try {
          const embedding = await generateEmbedding(keyword.keyword, apiKey);
          return {
            ...keyword,
            embedding
          };
        } catch (error) {
          console.error(`Error generating embedding for keyword "${keyword.keyword}":`, error);
          return null;
        }
      })
    );

    // Filter out keywords that failed to get embeddings
    const validKeywords = keywordsWithEmbeddings.filter(Boolean) as Keyword[];
    console.log(`Generated embeddings for ${validKeywords.length} keywords`);

    // Perform DBSCAN clustering
    const clusters = dbscan(validKeywords, epsilon, minSamples);
    console.log(`Created ${Object.keys(clusters).length} clusters`);

    // Process cluster data for response
    const clusterResults = Object.entries(clusters).map(([clusterId, members]) => {
      // Calculate average impressions and position
      const avgImpressions = members.reduce((sum, k) => sum + k.impressions, 0) / members.length;
      const avgPosition = members.reduce((sum, k) => sum + k.position, 0) / members.length;
      
      // Sort by impressions to find top keywords
      const sortedMembers = [...members].sort((a, b) => b.impressions - a.impressions);
      const topKeywords = sortedMembers.slice(0, 5).map(k => k.keyword);
      
      // Find the keyword with highest impressions as the cluster representative
      const representative = sortedMembers[0].keyword;
      
      return {
        clusterId: parseInt(clusterId),
        size: members.length,
        representative,
        topKeywords,
        keywords: members.map(k => k.keyword),
        avgImpressions,
        avgPosition,
        totalImpressions: members.reduce((sum, k) => sum + k.impressions, 0)
      };
    });

    // Store clustering results (this would be expanded in a real implementation)
    // For now, we're just returning the results

    // Return success response
    return new Response(
      JSON.stringify({
        success: true,
        message: 'Keywords clustered successfully',
        pageId,
        keywordCount: validKeywords.length,
        clusterCount: Object.keys(clusters).length,
        clusters: clusterResults,
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

// Function to generate embedding using OpenAI API
async function generateEmbedding(text: string, apiKey: string): Promise<number[]> {
  const url = 'https://api.openai.com/v1/embeddings';
  
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'text-embedding-ada-002',
      input: text,
    }),
  });
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(`OpenAI API error: ${error.error?.message || response.statusText}`);
  }
  
  const result = await response.json();
  return result.data[0].embedding;
}

// Function to calculate Euclidean distance between two vectors
function euclideanDistance(a: number[], b: number[]): number {
  return Math.sqrt(
    a.reduce((sum, val, i) => sum + Math.pow(val - b[i], 2), 0)
  );
}

// DBSCAN clustering algorithm implementation
function dbscan(
  keywords: Keyword[], 
  epsilon: number, 
  minSamples: number
): Record<number, Keyword[]> {
  // Initialize all points as unvisited
  const visited: Record<string, boolean> = {};
  const clusters: Record<number, Keyword[]> = {};
  let clusterId = 0;

  // Process each point
  for (const point of keywords) {
    const pointId = point.id;
    
    // Skip if already visited
    if (visited[pointId]) continue;
    
    // Mark as visited
    visited[pointId] = true;
    
    // Find neighbors
    const neighbors = regionQuery(keywords, point, epsilon);
    
    // Check if this is a core point
    if (neighbors.length < minSamples) {
      // This is a noise point
      point.clusterId = -1;
      continue;
    }
    
    // Start a new cluster
    const currentClusterId = clusterId++;
    point.clusterId = currentClusterId;
    
    // Add to cluster
    clusters[currentClusterId] = [point];
    
    // Process neighbors
    let neighborIndex = 0;
    while (neighborIndex < neighbors.length) {
      const neighbor = neighbors[neighborIndex++];
      const neighborId = neighbor.id;
      
      // If not visited, mark as visited and find its neighbors
      if (!visited[neighborId]) {
        visited[neighborId] = true;
        const newNeighbors = regionQuery(keywords, neighbor, epsilon);
        
        // If core point, add its neighbors to the processing queue
        if (newNeighbors.length >= minSamples) {
          neighbors.push(...newNeighbors.filter(n => 
            !neighbors.some(existing => existing.id === n.id)
          ));
        }
      }
      
      // If not yet in any cluster, add to current cluster
      if (neighbor.clusterId === undefined || neighbor.clusterId === -1) {
        neighbor.clusterId = currentClusterId;
        clusters[currentClusterId].push(neighbor);
      }
    }
  }
  
  // Return the clusters
  return clusters;
}

// Helper function to find all points within epsilon distance
function regionQuery(keywords: Keyword[], point: Keyword, epsilon: number): Keyword[] {
  if (!point.embedding) return [];
  
  return keywords.filter(other => {
    if (!other.embedding) return false;
    return point.id !== other.id && 
           euclideanDistance(point.embedding, other.embedding) <= epsilon;
  });
}