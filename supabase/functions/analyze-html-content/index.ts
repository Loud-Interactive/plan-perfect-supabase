import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { corsHeaders } from '../_shared/cors.ts'

interface RequestBody {
  html: string;
  url: string;
  model?: string;
  anthropicKey?: string; // Optional override, will use secret if not provided
}

interface ResponseData {
  success: boolean;
  analysis?: any;
  error?: string;
  processingTimeMs?: number;
}

// Get Anthropic API key from environment
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY') || '';

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Parse request body
    const requestBody: RequestBody = await req.json()
    const { html, url, anthropicKey, model = 'claude-3-7-sonnet-20250219' } = requestBody

    // Use provided key or fall back to secret
    const apiKey = anthropicKey || ANTHROPIC_API_KEY

    if (!html || !url) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'HTML content and URL are required',
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 400,
        }
      )
    }
    
    if (!apiKey) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Anthropic API key not found. Set ANTHROPIC_API_KEY secret or provide it in the request.',
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 400,
        }
      )
    }

    // Start the timer for performance tracking
    const startTime = Date.now()
    
    // Prepare prompt for Claude
    const prompt = `You are an expert web content analyst. Analyze the following HTML content from the URL: ${url}
    
1. Provide a brief overview of the page content (50 words max)
2. Extract the main headline/title
3. Identify the main topics covered
4. List any products or services mentioned
5. Extract 5-10 important keywords
6. Evaluate the content quality (structure, readability)
7. Provide 2-3 specific recommendations for improvement

HTML content:
\`\`\`html
${html.length > 100000 ? html.substring(0, 100000) + "... (truncated)" : html}
\`\`\`

Format your response with clear headings and bullet points where appropriate.`;

    // Call Anthropic API
    console.log(`Analyzing HTML content with ${model}...`);
    
    const anthropicResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: model,
        max_tokens: 4000,
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ]
      })
    });
    
    if (!anthropicResponse.ok) {
      const errorData = await anthropicResponse.text();
      throw new Error(`Anthropic API error (${anthropicResponse.status}): ${errorData}`);
    }
    
    const anthropicData = await anthropicResponse.json();
    
    if (!anthropicData.content || !anthropicData.content[0] || !anthropicData.content[0].text) {
      throw new Error('Invalid response from Anthropic API');
    }
    
    const analysis = anthropicData.content[0].text;
    
    // Calculate processing time
    const endTime = Date.now();
    const processingTimeMs = endTime - startTime;
    
    // Return success with analysis
    const responseData: ResponseData = {
      success: true,
      analysis,
      processingTimeMs
    };
    
    return new Response(JSON.stringify(responseData), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
    
  } catch (error) {
    console.error(`Error: ${error.message}`);
    
    const responseData: ResponseData = {
      success: false,
      error: error.message
    };
    
    return new Response(JSON.stringify(responseData), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500
    });
  }
})