// PagePerfect: generate-rewrite-draft
// Function to generate content rewrites addressing identified gaps
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';
import * as diff from 'https://esm.sh/diff@5.1.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface RequestBody {
  pageId: string;
  clusterId?: number;
  jobId?: string;
  modelName?: string;
  openaiApiKey?: string;
}

interface ContentGap {
  clusterId: number;
  representative: string;
  topKeywords: string[];
  opportunityScore: number;
  bestMatchSegment: {
    paraIndex: number;
    content: string;
    similarity: number;
  };
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
      clusterId, 
      jobId, 
      modelName = 'gpt-4-turbo',
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

    // Check if jobId was provided, otherwise create a new job
    let rewriteJobId = jobId;
    if (!rewriteJobId) {
      // Create a new rewrite job
      const { data: jobData, error: jobError } = await supabaseClient
        .from('rewrite_jobs')
        .insert({
          page_id: pageId,
          status: 'queued',
          opportunity_score: 0 // Will be updated later
        })
        .select()
        .single();

      if (jobError) {
        throw new Error(`Error creating rewrite job: ${jobError.message}`);
      }

      rewriteJobId = jobData.id;
    }

    console.log(`Generating rewrite draft for page ID: ${pageId}, job ID: ${rewriteJobId}`);

    // Update job status to processing
    await supabaseClient
      .from('rewrite_jobs')
      .update({
        status: 'processing',
        processed_at: new Date().toISOString()
      })
      .eq('id', rewriteJobId);

    // Get page data
    const { data: pageData, error: pageError } = await supabaseClient
      .from('pages')
      .select('id, url, html, title')
      .eq('id', pageId)
      .single();

    if (pageError || !pageData) {
      throw new Error(`Error fetching page: ${pageError?.message || 'Page not found'}`);
    }

    // Get content gap data - in a real implementation, this would come from a previous step
    // If clusterId is provided, only get that specific gap, otherwise get the top gap
    
    // For this demo, we'll simulate a content gap analysis result
    let contentGap: ContentGap;
    
    // Get page embeddings to identify the target paragraph
    const { data: embeddingsData, error: embeddingsError } = await supabaseClient
      .from('page_embeddings')
      .select('para_index, content')
      .eq('page_id', pageId)
      .order('para_index');

    if (embeddingsError) {
      throw new Error(`Error fetching page embeddings: ${embeddingsError.message}`);
    }

    if (!embeddingsData || embeddingsData.length === 0) {
      throw new Error('No embedded content segments found for this page');
    }
    
    // Get keywords for this page to identify potential gaps
    const { data: keywordsData, error: keywordsError } = await supabaseClient
      .from('gsc_keywords')
      .select('keyword, impressions, position')
      .eq('page_id', pageId)
      .order('impressions', { ascending: false })
      .limit(20);

    if (keywordsError) {
      throw new Error(`Error fetching keywords: ${keywordsError.message}`);
    }

    if (!keywordsData || keywordsData.length === 0) {
      throw new Error('No keywords found for this page');
    }
    
    // Simulate a content gap for the demo
    // In a real implementation, this would be the result of the content-gap-analysis function
    contentGap = {
      clusterId: 1,
      representative: keywordsData[0].keyword,
      topKeywords: keywordsData.slice(0, 5).map(k => k.keyword),
      opportunityScore: 75,
      bestMatchSegment: {
        paraIndex: Math.floor(embeddingsData.length / 2), // middle paragraph for demo
        content: embeddingsData[Math.floor(embeddingsData.length / 2)].content,
        similarity: 0.45 // Low similarity indicates a gap
      }
    };
    
    // If clusterId was specified, adjust our simulated gap
    if (clusterId) {
      contentGap.clusterId = clusterId;
      // We'd use the real cluster data in a production implementation
    }

    // Get the context around the target paragraph
    const targetIndex = contentGap.bestMatchSegment.paraIndex;
    const contextStart = Math.max(0, targetIndex - 2);
    const contextEnd = Math.min(embeddingsData.length - 1, targetIndex + 2);
    
    const contextParagraphs = embeddingsData.slice(contextStart, contextEnd + 1);
    const originalContent = contextParagraphs.map(p => p.content).join('\n\n');
    const targetParagraphPosition = targetIndex - contextStart;

    // Update the job with opportunity score
    await supabaseClient
      .from('rewrite_jobs')
      .update({
        opportunity_score: contentGap.opportunityScore
      })
      .eq('id', rewriteJobId);

    // Generate improved content using OpenAI
    const prompt = `You are an expert SEO content writer. You need to improve a section of content to better target these keywords: ${contentGap.topKeywords.join(', ')}

The main keyword to target is: "${contentGap.representative}"

Here is the current content section from the page titled "${pageData.title}":

----
${originalContent}
----

The paragraph that needs the most improvement is paragraph #${targetParagraphPosition + 1} in this section.

Instructions:
1. Rewrite this section to better incorporate the target keywords naturally
2. Maintain the same tone and style as the original content
3. Do not change the core information or make up new facts
4. Keep approximately the same length
5. Focus especially on improving paragraph #${targetParagraphPosition + 1}
6. Return ONLY the improved content section, no explanations

Improved content:`;

    // Call OpenAI API to generate the rewrite
    const improvedContent = await generateRewrite(prompt, modelName, apiKey);
    
    // Calculate the diff between original and improved content
    const diffPatch = createDiffPatch(originalContent, improvedContent);
    
    // Store the rewrite in the database
    const { error: rewriteError } = await supabaseClient
      .from('rewrites')
      .insert({
        job_id: rewriteJobId,
        patch: diffPatch,
        llm_model: modelName,
        confidence: 0.85 // Simulated confidence score
      });

    if (rewriteError) {
      throw new Error(`Error saving rewrite: ${rewriteError.message}`);
    }

    // Update job status to drafted
    await supabaseClient
      .from('rewrite_jobs')
      .update({
        status: 'drafted'
      })
      .eq('id', rewriteJobId);

    // Return success response
    return new Response(
      JSON.stringify({
        success: true,
        message: 'Rewrite draft generated successfully',
        pageId,
        jobId: rewriteJobId,
        targetKeywords: contentGap.topKeywords,
        representativeKeyword: contentGap.representative,
        opportunityScore: contentGap.opportunityScore,
        originalContent,
        improvedContent,
        diffPatch
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

// Function to generate rewrite using Claude with thinking
async function generateRewrite(prompt: string, model: string, apiKey: string): Promise<string> {
  // Check if we should use OpenAI or Claude
  if (model.startsWith('gpt')) {
    // Use OpenAI for GPT models
    const url = 'https://api.openai.com/v1/chat/completions';
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'system',
            content: 'You are an expert SEO content writer who specializes in improving content to better target specific keywords while maintaining the original style, tone, and factual accuracy.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.7,
        max_tokens: 2000
      }),
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(`OpenAI API error: ${error.error?.message || response.statusText}`);
    }
    
    const result = await response.json();
    return result.choices[0].message.content.trim();
  } else {
    // Use Claude with thinking enabled for Claude models
    const anthropicApiKey = Deno.env.get('ANTHROPIC_API_KEY') || apiKey;
    
    // Default to Claude 3.5 Sonnet if an unrecognized model is provided
    const claudeModel = model.startsWith('claude') ? model : 'claude-3-5-sonnet-20240620';
    
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': anthropicApiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
        'anthropic-beta': 'thinking=true' // Enable thinking
      },
      body: JSON.stringify({
        model: claudeModel,
        max_tokens: 4000,
        temperature: 0.7,
        messages: [
          {
            role: "user",
            content: prompt
          }
        ]
      })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(`Claude API error: ${response.status} - ${JSON.stringify(errorData)}`);
    }

    const result = await response.json();
    
    // Store the thinking log in the database for reference
    try {
      const supabaseClient = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
      );
      
      await supabaseClient
        .from('rewrite_thinking_logs')
        .insert({
          model: claudeModel,
          prompt: prompt,
          thinking: result.thinking?.thinking || '',
          created_at: new Date().toISOString()
        });
    } catch (error) {
      console.error('Error storing thinking log:', error);
    }
    
    return result.content[0].text.trim();
  }
}

// Function to create a diff patch between original and new content
function createDiffPatch(original: string, improved: string): any {
  // Split content into lines
  const originalLines = original.split('\n');
  const improvedLines = improved.split('\n');
  
  // Create a patch using the diff library
  const patches = diff.structuredPatch(
    'original',
    'improved',
    original,
    improved,
    '',
    ''
  );
  
  // Also store a simplified word-level diff for better visualization
  const wordDiff = diff.diffWords(original, improved);
  
  return {
    structuredPatch: patches,
    wordDiff: wordDiff.map(part => ({
      value: part.value,
      added: part.added,
      removed: part.removed
    }))
  };
}