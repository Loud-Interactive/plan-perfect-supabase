// PagePerfect: content-gap-analysis
// Function to analyze content gaps by comparing keyword clusters with page embeddings
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface RequestBody {
  pageId: string;
  clusterIds?: number[];
  similarityThreshold?: number;
  openaiApiKey?: string;
}

interface Cluster {
  clusterId: number;
  representative: string;
  keywords: string[];
  topKeywords: string[];
  avgImpressions: number;
  avgPosition: number;
  totalImpressions: number;
  embedding?: number[];
}

interface ContentSegment {
  id: string;
  paraIndex: number;
  content: string;
  embedding: number[];
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
      clusterIds,
      similarityThreshold = 0.65, 
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

    console.log(`Analyzing content gaps for page ID: ${pageId}`);

    // Get page data to verify existence
    const { data: pageData, error: pageError } = await supabaseClient
      .from('pages')
      .select('id, url, title')
      .eq('id', pageId)
      .single();

    if (pageError || !pageData) {
      throw new Error(`Error fetching page: ${pageError?.message || 'Page not found'}`);
    }

    // Get content segments (paragraph embeddings) for the page
    const { data: segmentsData, error: segmentsError } = await supabaseClient
      .from('page_embeddings')
      .select('id, para_index, content, embedding')
      .eq('page_id', pageId)
      .order('para_index');

    if (segmentsError) {
      throw new Error(`Error fetching page segments: ${segmentsError.message}`);
    }

    if (!segmentsData || segmentsData.length === 0) {
      throw new Error('No embedded content segments found for this page');
    }

    // We need to get the clusters - in a real implementation, these would be stored
    // For this demo, we'll generate representative embeddings for the clusters
    
    // For now, let's simulate having cluster data
    // In a real implementation, this would come from a clusters table or the previous step
    const { data: keywordsData, error: keywordsError } = await supabaseClient
      .from('gsc_keywords')
      .select('keyword, impressions, position')
      .eq('page_id', pageId)
      .order('impressions', { ascending: false });

    if (keywordsError) {
      throw new Error(`Error fetching keywords: ${keywordsError.message}`);
    }

    // Simulate clusters by taking top keywords
    // In a real implementation, these would be actual DBSCAN clusters
    const simulatedClusters: Cluster[] = [];
    
    // Group keywords by their first word to simulate clusters
    const keywordGroups: Record<string, Array<{ keyword: string; impressions: number; position: number }>> = {};
    
    for (const kw of keywordsData) {
      const firstWord = kw.keyword.split(' ')[0].toLowerCase();
      if (!keywordGroups[firstWord]) {
        keywordGroups[firstWord] = [];
      }
      keywordGroups[firstWord].push(kw);
    }
    
    // Convert groups to simulated clusters
    let clusterId = 0;
    for (const [key, keywords] of Object.entries(keywordGroups)) {
      if (keywords.length < 2) continue; // Skip small clusters
      
      // Sort by impressions
      const sortedKeywords = [...keywords].sort((a, b) => b.impressions - a.impressions);
      
      simulatedClusters.push({
        clusterId: clusterId++,
        representative: sortedKeywords[0].keyword,
        keywords: sortedKeywords.map(k => k.keyword),
        topKeywords: sortedKeywords.slice(0, 5).map(k => k.keyword),
        avgImpressions: sortedKeywords.reduce((sum, k) => sum + k.impressions, 0) / sortedKeywords.length,
        avgPosition: sortedKeywords.reduce((sum, k) => sum + k.position, 0) / sortedKeywords.length,
        totalImpressions: sortedKeywords.reduce((sum, k) => sum + k.impressions, 0)
      });
    }
    
    // Filter to specific clusters if provided
    const clusters = clusterIds 
      ? simulatedClusters.filter(c => clusterIds.includes(c.clusterId))
      : simulatedClusters;
    
    if (clusters.length === 0) {
      throw new Error('No valid clusters found for analysis');
    }

    console.log(`Analyzing ${clusters.length} keyword clusters against ${segmentsData.length} content segments`);

    // Generate embeddings for cluster representatives
    for (const cluster of clusters) {
      try {
        // Use the representative keyword for the cluster embedding
        cluster.embedding = await generateEmbedding(cluster.representative, apiKey);
      } catch (error) {
        console.error(`Error generating embedding for cluster "${cluster.representative}":`, error);
      }
    }

    // Filter out clusters without embeddings
    const validClusters = clusters.filter(c => c.embedding);
    
    // Calculate similarity scores between each cluster and content segments
    const contentSegments: ContentSegment[] = segmentsData;
    
    // Validate contentSegments - ensure all have valid embeddings
    const validContentSegments = contentSegments.filter(segment => 
      segment.embedding && Array.isArray(segment.embedding) && segment.embedding.length > 0
    );
    
    if (validContentSegments.length === 0) {
      throw new Error('No valid content segments with embeddings found for analysis');
    }
    
    console.log(`Using ${validContentSegments.length} valid segments out of ${contentSegments.length} total segments`);
    
    const gapAnalysis = validClusters.map(cluster => {
      // For each cluster, find the most similar content segment
      const similarities = validContentSegments.map(segment => {
        try {
          const similarity = cosineSimilarity(cluster.embedding!, segment.embedding);
          return {
            segmentId: segment.id,
            paraIndex: segment.paraIndex,
            content: segment.content,
            similarity
          };
        } catch (error) {
          console.error(`Error calculating similarity for cluster ${cluster.clusterId} and segment ${segment.id}:`, error);
          return {
            segmentId: segment.id,
            paraIndex: segment.paraIndex,
            content: segment.content,
            similarity: 0 // Default to zero similarity on error
          };
        }
      });
      
      // Sort by similarity (highest first)
      similarities.sort((a, b) => b.similarity - a.similarity);
      
      // Check if we have any similarities
      if (similarities.length === 0) {
        console.error(`No similarities calculated for cluster ${cluster.clusterId}`);
        return null; // Skip this cluster
      }
      
      // Determine if there's a content gap (no segment with similarity above threshold)
      const bestMatch = similarities[0];
      const hasContentGap = bestMatch.similarity < similarityThreshold;
      
      return {
        clusterId: cluster.clusterId,
        representative: cluster.representative,
        topKeywords: cluster.topKeywords,
        totalImpressions: cluster.totalImpressions,
        avgPosition: cluster.avgPosition,
        hasContentGap,
        opportunityScore: hasContentGap 
          ? calculateOpportunityScore(cluster.totalImpressions, cluster.avgPosition) 
          : 0,
        bestMatchSegment: {
          paraIndex: bestMatch.paraIndex,
          content: bestMatch.content,
          similarity: bestMatch.similarity
        },
        allSegmentSimilarities: similarities.slice(0, 3) // Top 3 matches
      };
    }).filter(item => item !== null); // Filter out any null items
    
    // Sort gaps by opportunity score (highest first)
    gapAnalysis.sort((a, b) => b.opportunityScore - a.opportunityScore);
    
    // Calculate overall page statistics
    const gapCount = gapAnalysis.filter(gap => gap.hasContentGap).length;
    const totalOpportunityScore = gapAnalysis.reduce((sum, gap) => sum + gap.opportunityScore, 0);
    
    // Return success response
    return new Response(
      JSON.stringify({
        success: true,
        message: 'Content gap analysis completed successfully',
        pageId,
        pageUrl: pageData.url,
        pageTitle: pageData.title,
        clusterCount: validClusters.length,
        segmentCount: contentSegments.length,
        gapCount,
        totalOpportunityScore,
        gapAnalysis
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

// Function to calculate cosine similarity between two vectors
function cosineSimilarity(a: number[], b: number[]): number {
  // Validate inputs are arrays
  if (!Array.isArray(a) || !Array.isArray(b)) {
    console.error(`Invalid input to cosineSimilarity: a is ${Array.isArray(a) ? 'array' : typeof a}, b is ${Array.isArray(b) ? 'array' : typeof b}`);
    return 0; // Return 0 similarity for invalid inputs
  }
  
  // Validate arrays have length
  if (a.length === 0 || b.length === 0) {
    console.error(`Empty array input to cosineSimilarity: a length = ${a.length}, b length = ${b.length}`);
    return 0;
  }
  
  try {
    const dotProduct = a.reduce((sum, val, i) => sum + val * b[i], 0);
    const magnitudeA = Math.sqrt(a.reduce((sum, val) => sum + val * val, 0));
    const magnitudeB = Math.sqrt(b.reduce((sum, val) => sum + val * val, 0));
    
    // Check for division by zero
    if (magnitudeA === 0 || magnitudeB === 0) {
      return 0;
    }
    
    return dotProduct / (magnitudeA * magnitudeB);
  } catch (error) {
    console.error('Error calculating cosine similarity:', error);
    return 0; // Fallback similarity
  }
}

// Function to calculate opportunity score based on impressions and position
function calculateOpportunityScore(impressions: number, position: number): number {
  // Simple logistic function for position score (higher positions = lower score)
  const positionScore = 1 / (1 + Math.exp(0.5 * (position - 10)));
  
  // Log scale for impressions to prevent domination by very high-impression keywords
  const impressionScore = Math.log10(impressions + 1) / 10;
  
  // Combined score with position weighted more heavily
  return Math.round((0.7 * positionScore + 0.3 * impressionScore) * 100);
}