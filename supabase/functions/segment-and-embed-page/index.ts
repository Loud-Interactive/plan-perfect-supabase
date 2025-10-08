// PagePerfect: segment-and-embed-page
// Function to segment page content and generate embeddings via OpenAI
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';
import { load } from 'https://esm.sh/cheerio@1.0.0-rc.12';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface RequestBody {
  pageId: string;
  openaiApiKey?: string;
}

interface Paragraph {
  paraIndex: number;
  content: string;
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
    const { pageId, openaiApiKey } = await req.json() as RequestBody;

    if (!pageId) {
      throw new Error('pageId is required');
    }

    // Use API key from request or environment variable
    const apiKey = openaiApiKey || Deno.env.get('OPENAI_API_KEY');
    if (!apiKey) {
      throw new Error('OpenAI API key is required');
    }

    console.log(`Processing embeddings for page ID: ${pageId}`);

    // Get page data from database
    const { data: pageData, error: pageError } = await supabaseClient
      .from('pages')
      .select('id, url, html')
      .eq('id', pageId)
      .single();

    if (pageError || !pageData) {
      throw new Error(`Error fetching page: ${pageError?.message || 'Page not found'}`);
    }

    if (!pageData.html) {
      throw new Error('No HTML content available for the page');
    }

    // Segment the HTML content into paragraphs
    const paragraphs = segmentPageContent(pageData.html);
    console.log(`Segmented page into ${paragraphs.length} paragraphs`);

    // Generate embeddings for each paragraph using OpenAI
    const embedResults = await Promise.all(
      paragraphs.map(async (para) => {
        try {
          const embedding = await generateEmbedding(para.content, apiKey);
          return {
            pageId: pageData.id,
            paraIndex: para.paraIndex,
            content: para.content,
            embedding
          };
        } catch (error) {
          console.error(`Error generating embedding for paragraph ${para.paraIndex}:`, error);
          return null;
        }
      })
    );

    // Filter out failed embeddings
    const validEmbeddings = embedResults.filter(Boolean);
    console.log(`Generated ${validEmbeddings.length} embeddings`);

    // Insert embeddings into database
    if (validEmbeddings.length > 0) {
      // First, delete existing embeddings for this page to avoid duplicates
      await supabaseClient
        .from('page_embeddings')
        .delete()
        .eq('page_id', pageId);

      // Insert the new embeddings
      const { error: insertError } = await supabaseClient
        .from('page_embeddings')
        .insert(
          validEmbeddings.map(e => ({
            page_id: e.pageId,
            para_index: e.paraIndex,
            content: e.content,
            embedding: e.embedding
          }))
        );

      if (insertError) {
        throw new Error(`Error inserting embeddings: ${insertError.message}`);
      }
    }

    // Return success response
    return new Response(
      JSON.stringify({
        success: true,
        message: 'Page segmented and embeddings generated successfully',
        pageId,
        paragraphCount: paragraphs.length,
        embeddingsCount: validEmbeddings.length,
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

// Function to segment HTML content into paragraphs
function segmentPageContent(html: string): Paragraph[] {
  const $ = load(html);
  const paragraphs: Paragraph[] = [];
  let paraIndex = 0;

  // Remove script, style, and nav elements
  $('script, style, nav, footer, header, .sidebar, .menu, .navigation, .comments, .ads').remove();

  // Extract main content area if it exists
  const mainContent = $('main, #main, .main, article, .article, .content, #content, .post, #post');
  const contentElement = mainContent.length > 0 ? mainContent : $('body');

  // Find all paragraph-like elements
  contentElement.find('p, h1, h2, h3, h4, h5, h6, li, blockquote, pre, td').each((_, element) => {
    const text = $(element).text().trim();
    
    // Skip empty paragraphs
    if (text.length > 0) {
      // Identify heading elements and add special formatting
      let content = text;
      const tagName = element.tagName.toLowerCase();
      
      if (tagName.match(/^h[1-6]$/)) {
        content = `[${tagName.toUpperCase()}] ${text}`;
      }
      
      paragraphs.push({
        paraIndex: paraIndex++,
        content
      });
    }
  });

  return paragraphs;
}

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