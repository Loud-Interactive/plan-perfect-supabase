To implement your outline generation system with Supabase Edge Functions, I'll design a complete solution that handles the entire workflow. Let's break this down into the necessary components:

  1. Database tables
  2. Edge functions
  3. API integrations

  1. Database Schema

  First, let's create the database tables to track the outline generation process:

  -- Table to track outline generation processes
  CREATE TABLE outline_generation_jobs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    content_plan_guid UUID REFERENCES content_plans(guid),
    post_title TEXT NOT NULL,
    content_plan_keyword TEXT NOT NULL,
    post_keyword TEXT NOT NULL,
    domain TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
  );

  -- Table to track search terms used
  CREATE TABLE outline_search_terms (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    job_id UUID REFERENCES outline_generation_jobs(id) ON DELETE CASCADE,
    search_term TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
  );

  -- Table to track search results
  CREATE TABLE outline_search_results (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    job_id UUID REFERENCES outline_generation_jobs(id) ON DELETE CASCADE,
    search_term TEXT NOT NULL,
    url TEXT NOT NULL,
    title TEXT,
    snippet TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
  );

  -- Table to store URL content analysis
  CREATE TABLE outline_url_analyses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    job_id UUID REFERENCES outline_generation_jobs(id) ON DELETE CASCADE,
    url TEXT NOT NULL,
    title TEXT,
    headings JSONB,
    content TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
  );

  -- Table to store the final outlines
  CREATE TABLE content_plan_outlines_ai (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    job_id UUID REFERENCES outline_generation_jobs(id) ON DELETE CASCADE,
    content_plan_outline_guid UUID REFERENCES content_plan_outlines(guid),
    outline JSONB NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
  );

  2. Edge Functions

  Now, let's create the edge functions to handle each step of the process:

  2.1. Main Orchestrator Function

  // /supabase/functions/generate-outline/index.ts
  import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
  import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

  serve(async (req) => {
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    };

    // Handle CORS preflight requests
    if (req.method === 'OPTIONS') {
      return new Response('ok', { headers: corsHeaders });
    }

    try {
      const { content_plan_guid, post_title, content_plan_keyword, post_keyword, domain } = await req.json();

      if (!post_title || !content_plan_keyword || !post_keyword || !domain) {
        return new Response(
          JSON.stringify({ error: 'Missing required fields' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Initialize Supabase client
      const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
      const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
      const supabase = createClient(supabaseUrl, supabaseServiceKey);

      // Create a new job in outline_generation_jobs
      const { data: job, error: jobError } = await supabase
        .from('outline_generation_jobs')
        .insert({
          content_plan_guid,
          post_title,
          content_plan_keyword,
          post_keyword,
          domain,
          status: 'started'
        })
        .select()
        .single();

      if (jobError) {
        throw new Error(`Failed to create job: ${jobError.message}`);
      }

      // Start the async generation process
      fetch(`${supabaseUrl}/functions/v1/process-outline-job`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${supabaseServiceKey}`
        },
        body: JSON.stringify({ job_id: job.id })
      }).catch(error => console.error('Error starting job process:', error));

      return new Response(
        JSON.stringify({
          success: true,
          message: 'Outline generation started',
          job_id: job.id
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    } catch (error) {
      return new Response(
        JSON.stringify({ error: error.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
  });

  2.2. Process Outline Job Function

  // /supabase/functions/process-outline-job/index.ts
  import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
  import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
  import Anthropic from 'npm:@anthropic-ai/sdk';

  serve(async (req) => {
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    };

    // Handle CORS preflight requests
    if (req.method === 'OPTIONS') {
      return new Response('ok', { headers: corsHeaders });
    }

    try {
      const { job_id } = await req.json();

      if (!job_id) {
        return new Response(
          JSON.stringify({ error: 'job_id is required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Initialize Supabase client
      const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
      const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
      const supabase = createClient(supabaseUrl, supabaseServiceKey);

      // Step 1: Fetch job details
      const { data: job, error: jobError } = await supabase
        .from('outline_generation_jobs')
        .select('*')
        .eq('id', job_id)
        .single();

      if (jobError || !job) {
        throw new Error(`Job not found: ${jobError?.message || 'Unknown error'}`);
      }

      // Step 2: Update job status
      await supabase
        .from('outline_generation_jobs')
        .update({ status: 'determining_search_terms' })
        .eq('id', job_id);

      // Step 3: Determine search terms with Claude AI
      const anthropic = new Anthropic({
        apiKey: Deno.env.get('ANTHROPIC_API_KEY') || '',
      });

      // Fetch client profile
      const clientProfileResponse = await fetch(`https://pp-api.replit.app/pairs/all/${job.domain}`);
      const clientProfile = await clientProfileResponse.json();
      const clientSynopsis = clientProfile.synopsis || '';

      // Generate search terms
      const searchTermsPrompt = `You are a world-class journalist. Generate a list of 5 search terms to search for to research and write an article about the given topic. You should only provide 
  the search terms in a Python-parseable list, without any comments.

  Please provide a list of 5 search terms related to '${job.post_keyword}' that are on brand and topically relevant for ${job.domain}, I have included their style, brand voice, guidelines and over
   all information about the brand here ${clientSynopsis} for researching and writing an article. Respond only with the search terms in a Python-parseable list, separated by commas and enclosed in
   square brackets.`;

      const searchTermsResponse = await anthropic.beta.messages.create({
        model: "claude-3-7-sonnet-20250219",
        max_tokens: 1000,
        temperature: 1,
        messages: [
          {
            role: "user",
            content: searchTermsPrompt
          }
        ]
      });

      // Parse search terms
      const searchTermsText = searchTermsResponse.content[0].text;
      const searchTerms = JSON.parse(searchTermsText.replace(/```python|```/g, ''));

      // Step 4: Update job status and save search terms
      await supabase
        .from('outline_generation_jobs')
        .update({ status: 'running_searches' })
        .eq('id', job_id);

      // Save search terms
      for (const term of searchTerms) {
        await supabase
          .from('outline_search_terms')
          .insert({
            job_id,
            search_term: term
          });
      }

      // Step 5: Run searches using Jina API
      for (const term of searchTerms) {
        const encodedTerm = encodeURIComponent(term);
        const searchUrl = `https://s.jina.ai/?q=${encodedTerm}&num=20`;

        try {
          const searchResponse = await fetch(searchUrl, {
            headers: {
              'Accept': 'application/json',
              'Authorization': 'Bearer jina_18e30bccaa5144e2a0d7c22c3d54d19cP3IGowUUyEPIEI5N-SWTNlQJJNB2',
              'X-Engine': 'browser'
            }
          });

          const searchData = await searchResponse.json();

          // Save search results
          for (const result of searchData.results) {
            await supabase
              .from('outline_search_results')
              .insert({
                job_id,
                search_term: term,
                url: result.url,
                title: result.title,
                snippet: result.snippet
              });
          }
        } catch (searchError) {
          console.error(`Error searching for "${term}":`, searchError);
        }
      }

      // Step 6: Update job status
      await supabase
        .from('outline_generation_jobs')
        .update({ status: 'analyzing_results' })
        .eq('id', job_id);

      // Step 7: Get all search results
      const { data: searchResults, error: resultsError } = await supabase
        .from('outline_search_results')
        .select('*')
        .eq('job_id', job_id);

      if (resultsError) {
        throw new Error(`Failed to fetch search results: ${resultsError.message}`);
      }

      // Step 8: Analyze search results with Claude
      const searchResultsAnalysisPrompt = `Given the following search engine results, I want you to give me a full run down of each post in the results, give me it's url, it's title, and a 
  breakdown of all it's h tags #, ##, ###. This should be a JSON object in the following structure:
      [
        {
          "url": "https://example.com/post1",
          "title": "Example Post 1",
          "headings": {
            "h1": ["Main Title"],
            "h2": ["Section 1", "Section 2"],
            "h3": ["Subsection 1.1", "Subsection 1.2", "Subsection 2.1"]
          }
        }
      ]

      Here are the search results:
      ${JSON.stringify(searchResults, null, 2)}`;

      const analysisResponse = await anthropic.beta.messages.create({
        model: "claude-3-7-sonnet-20250219",
        max_tokens: 64000,
        temperature: 1,
        messages: [
          {
            role: "user",
            content: searchResultsAnalysisPrompt
          }
        ]
      });

      // Parse URL analysis
      const analysisText = analysisResponse.content[0].text;
      const analysisJson = JSON.parse(analysisText.match(/\[[\s\S]*\]/)[0]);

      // Save URL analyses
      for (const analysis of analysisJson) {
        await supabase
          .from('outline_url_analyses')
          .insert({
            job_id,
            url: analysis.url,
            title: analysis.title,
            headings: analysis.headings
          });
      }

      // Step 9: Update job status
      await supabase
        .from('outline_generation_jobs')
        .update({ status: 'generating_outline' })
        .eq('id', job_id);

      // Step 10: Generate outline with Claude
      const outlinePrompt = `Create a detailed content outline for an article with the title "${job.post_title}". 

  The article should focus on the keyword "${job.post_keyword}" and be part of a content plan about "${job.content_plan_keyword}".

  I've analyzed several relevant articles and want you to create an original, comprehensive outline based on the following research:
  ${JSON.stringify(analysisJson, null, 2)}

  The outline should:
  1. Include an introduction and conclusion section
  2. Have 5-6 main sections with 3-4 subsections each
  3. Cover all important aspects of the topic
  4. Be well-structured and logical
  5. Be SEO-friendly and incorporate the keyword "${job.post_keyword}" naturally
  6. Be original and not copy the structure of any single source
  7. Match the style and tone of ${job.domain}

  Format your response as a JSON object with this structure:
  {
    "title": "Article Title",
    "sections": [
      {
        "title": "Introduction",
        "subheadings": ["Hook", "Background", "Thesis statement"]
      },
      {
        "title": "Main Section 1",
        "subheadings": ["Subheading 1.1", "Subheading 1.2", "Subheading 1.3"]
      },
      // More sections...
      {
        "title": "Conclusion",
        "subheadings": ["Summary", "Final thoughts", "Call to action"]
      }
    ]
  }`;

      const outlineResponse = await anthropic.beta.messages.create({
        model: "claude-3-7-sonnet-20250219",
        max_tokens: 68129,
        temperature: 1,
        messages: [
          {
            role: "user",
            content: outlinePrompt
          }
        ],
        thinking: {
          type: "enabled",
          budget_tokens: 57548
        }
      });

      // Parse outline
      const outlineText = outlineResponse.content[0].text;
      const outlineJson = JSON.parse(outlineText.match(/\{[\s\S]*\}/)[0]);

      // Step 11: Create outline in database
      await supabase
        .from('content_plan_outlines_ai')
        .insert({
          job_id,
          outline: outlineJson
        });

      // Step 12: Update job status to completed
      await supabase
        .from('outline_generation_jobs')
        .update({ status: 'completed' })
        .eq('id', job_id);

      return new Response(
        JSON.stringify({
          success: true,
          message: 'Outline generation completed',
          job_id,
          outline: outlineJson
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    } catch (error) {
      console.error('Error processing outline job:', error);

      // Update job status to failed
      const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
      const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
      const supabase = createClient(supabaseUrl, supabaseServiceKey);

      const { job_id } = await req.json();
      if (job_id) {
        await supabase
          .from('outline_generation_jobs')
          .update({
            status: 'failed',
            updated_at: new Date().toISOString()
          })
          .eq('id', job_id);
      }

      return new Response(
        JSON.stringify({ error: error.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
  });

  2.3. Get Outline Status Function

  // /supabase/functions/get-outline-status/index.ts
  import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
  import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

  serve(async (req) => {
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    };

    // Handle CORS preflight requests
    if (req.method === 'OPTIONS') {
      return new Response('ok', { headers: corsHeaders });
    }

    try {
      const url = new URL(req.url);
      const jobId = url.searchParams.get('job_id');

      if (!jobId) {
        return new Response(
          JSON.stringify({ error: 'job_id is required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Initialize Supabase client
      const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
      const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
      const supabase = createClient(supabaseUrl, supabaseServiceKey);

      // Get job status
      const { data: job, error: jobError } = await supabase
        .from('outline_generation_jobs')
        .select('*')
        .eq('id', jobId)
        .single();

      if (jobError) {
        throw new Error(`Job not found: ${jobError.message}`);
      }

      // Get outline if job is completed
      let outline = null;
      if (job.status === 'completed') {
        const { data: outlineData, error: outlineError } = await supabase
          .from('content_plan_outlines_ai')
          .select('outline')
          .eq('job_id', jobId)
          .single();

        if (!outlineError && outlineData) {
          outline = outlineData.outline;
        }
      }

      // Get progress details
      let progressDetails = {};

      const { data: searchTerms } = await supabase
        .from('outline_search_terms')
        .select('search_term')
        .eq('job_id', jobId);

      const { data: searchResults } = await supabase
        .from('outline_search_results')
        .select('search_term, url')
        .eq('job_id', jobId);

      const { data: urlAnalyses } = await supabase
        .from('outline_url_analyses')
        .select('url, title')
        .eq('job_id', jobId);

      progressDetails = {
        searchTerms: searchTerms || [],
        searchResults: searchResults || [],
        urlAnalyses: urlAnalyses || []
      };

      return new Response(
        JSON.stringify({
          job_id: jobId,
          status: job.status,
          progress: getProgressPercentage(job.status),
          progressDetails,
          outline,
          created_at: job.created_at,
          updated_at: job.updated_at
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    } catch (error) {
      return new Response(
        JSON.stringify({ error: error.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
  });

  function getProgressPercentage(status: string): number {
    const statusMap: Record<string, number> = {
      'started': 10,
      'determining_search_terms': 20,
      'running_searches': 40,
      'analyzing_results': 60,
      'generating_outline': 80,
      'completed': 100,
      'failed': 0
    };

    return statusMap[status] || 0;
  }

  2.4. Generate Report Function

  // /supabase/functions/generate-outline-report/index.ts
  import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
  import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

  serve(async (req) => {
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    };

    // Handle CORS preflight requests
    if (req.method === 'OPTIONS') {
      return new Response('ok', { headers: corsHeaders });
    }

    try {
      const url = new URL(req.url);
      const jobId = url.searchParams.get('job_id');

      if (!jobId) {
        return new Response(
          JSON.stringify({ error: 'job_id is required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Initialize Supabase client
      const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
      const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
      const supabase = createClient(supabaseUrl, supabaseServiceKey);

      // Get all data related to the job
      const { data: job, error: jobError } = await supabase
        .from('outline_generation_jobs')
        .select('*')
        .eq('id', jobId)
        .single();

      if (jobError) {
        throw new Error(`Job not found: ${jobError.message}`);
      }

      const { data: searchTerms } = await supabase
        .from('outline_search_terms')
        .select('*')
        .eq('job_id', jobId);

      const { data: searchResults } = await supabase
        .from('outline_search_results')
        .select('*')
        .eq('job_id', jobId);

      const { data: urlAnalyses } = await supabase
        .from('outline_url_analyses')
        .select('*')
        .eq('job_id', jobId);

      const { data: outline } = await supabase
        .from('content_plan_outlines_ai')
        .select('*')
        .eq('job_id', jobId)
        .single();

      // Generate HTML report
      const html = `
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Outline Generation Report - ${job.post_title}</title>
    <style>
      body {
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        line-height: 1.6;
        color: #333;
        max-width: 1200px;
        margin: 0 auto;
        padding: 20px;
      }
      h1, h2, h3, h4 {
        color: #2c3e50;
      }
      .header {
        background-color: #f8f9fa;
        padding: 20px;
        border-radius: 5px;
        margin-bottom: 30px;
        border-left: 5px solid #3498db;
      }
      .section {
        margin-bottom: 30px;
        padding: 20px;
        background-color: #fff;
        border-radius: 5px;
        box-shadow: 0 2px 5px rgba(0,0,0,0.1);
      }
      .search-term {
        display: inline-block;
        background-color: #e9f7fe;
        color: #3498db;
        padding: 5px 10px;
        margin: 5px;
        border-radius: 20px;
        font-size: 14px;
      }
      .result-card {
        border: 1px solid #eee;
        padding: 15px;
        margin-bottom: 15px;
        border-radius: 5px;
      }
      .result-card h4 {
        margin-top: 0;
      }
      .url {
        word-break: break-all;
        color: #3498db;
      }
      .outline-section {
        margin-bottom: 20px;
      }
      .subheading-list {
        list-style-type: disc;
        padding-left: 20px;
      }
      .status {
        display: inline-block;
        padding: 5px 10px;
        border-radius: 20px;
        font-weight: bold;
      }
      .status-completed {
        background-color: #d4edda;
        color: #155724;
      }
      .status-failed {
        background-color: #f8d7da;
        color: #721c24;
      }
      table {
        width: 100%;
        border-collapse: collapse;
      }
      table, th, td {
        border: 1px solid #ddd;
      }
      th, td {
        padding: 12px;
        text-align: left;
      }
      th {
        background-color: #f2f2f2;
      }
    </style>
  </head>
  <body>
    <div class="header">
      <h1>Outline Generation Report</h1>
      <p><strong>Post Title:</strong> ${job.post_title}</p>
      <p><strong>Content Plan Keyword:</strong> ${job.content_plan_keyword}</p>
      <p><strong>Post Keyword:</strong> ${job.post_keyword}</p>
      <p><strong>Domain:</strong> ${job.domain}</p>
      <p><strong>Status:</strong> <span class="status status-${job.status === 'completed' ? 'completed' : 'failed'}">${job.status}</span></p>
      <p><strong>Created:</strong> ${new Date(job.created_at).toLocaleString()}</p>
      <p><strong>Updated:</strong> ${new Date(job.updated_at).toLocaleString()}</p>
    </div>

    <div class="section">
      <h2>Search Terms Used</h2>
      <div>
        ${searchTerms?.map(term => `<span class="search-term">${term.search_term}</span>`).join('') || 'No search terms found'}
      </div>
    </div>

    <div class="section">
      <h2>Search Results</h2>
      <p>Total Results: ${searchResults?.length || 0}</p>
      
      <table>
        <tr>
          <th>Search Term</th>
          <th>URL</th>
          <th>Title</th>
        </tr>
        ${searchResults?.map(result => `
          <tr>
            <td>${result.search_term}</td>
            <td><a href="${result.url}" target="_blank" class="url">${result.url}</a></td>
            <td>${result.title || 'N/A'}</td>
          </tr>
        `).join('') || '<tr><td colspan="3">No search results found</td></tr>'}
      </table>
    </div>

    <div class="section">
      <h2>URL Content Analysis</h2>
      <p>Total URLs Analyzed: ${urlAnalyses?.length || 0}</p>
      
      ${urlAnalyses?.map(analysis => `
        <div class="result-card">
          <h4>${analysis.title || 'Untitled'}</h4>
          <p><a href="${analysis.url}" target="_blank" class="url">${analysis.url}</a></p>
          
          <h5>Headings Structure:</h5>
          ${analysis.headings?.h1 ? `<p><strong>H1:</strong> ${analysis.headings.h1.join(', ')}</p>` : ''}
          ${analysis.headings?.h2 ? `<p><strong>H2:</strong> ${analysis.headings.h2.join(', ')}</p>` : ''}
          ${analysis.headings?.h3 ? `<p><strong>H3:</strong> ${analysis.headings.h3.join(', ')}</p>` : ''}
        </div>
      `).join('') || '<p>No URL analyses found</p>'}
    </div>

    <div class="section">
      <h2>Generated Outline</h2>
      
      ${outline?.outline ? `
        <h3>${outline.outline.title || job.post_title}</h3>
        
        ${outline.outline.sections?.map((section, index) => `
          <div class="outline-section">
            <h4>${index + 1}. ${section.title}</h4>
            <ul class="subheading-list">
              ${section.subheadings?.map(subheading => `
                <li>${subheading}</li>
              `).join('') || '<li>No subheadings</li>'}
            </ul>
          </div>
        `).join('') || '<p>No sections found</p>'}
      ` : '<p>No outline generated</p>'}
    </div>
  </body>
  </html>
      `;

      return new Response(
        html,
        {
          status: 200,
          headers: {
            ...corsHeaders,
            'Content-Type': 'text/html; charset=utf-8'
          }
        }
      );
    } catch (error) {
      return new Response(
        JSON.stringify({ error: error.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
  });

  Deployment Instructions

  1. First, create the database tables using the SQL script provided.
  2. Deploy the edge functions:

  cd /Users/martinbowling/Projects/planperfect-supabase

  # Deploy main function
  supabase functions deploy generate-outline

  # Deploy processing function
  supabase functions deploy process-outline-job

  # Deploy status function
  supabase functions deploy get-outline-status

  # Deploy report function
  supabase functions deploy generate-outline-report

  3. Set the environment variables in the Supabase dashboard:

  - ANTHROPIC_API_KEY: Your Claude API key
  - SUPABASE_URL: Your Supabase project URL
  - SUPABASE_SERVICE_ROLE_KEY: Your Supabase service role key

  Usage

  Generate Outline

  // Example call to generate an outline
  const response = await fetch('https://jsypctdhynsdqrfifvdh.supabase.co/functions/v1/generate-outline', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
    },
    body: JSON.stringify({
      content_plan_guid: '8f76de4b-1ca3-4b1a-bf01-f060b784885a', // Optional
      post_title: 'How to Choose the Best Kitchen Knives',
      content_plan_keyword: 'kitchen knives',
      post_keyword: 'best kitchen knives',
      domain: 'misen.com'
    })
  });

  const data = await response.json();
  console.log('Job ID:', data.job_id);

  Check Status

  // Check the status of an outline generation job
  const statusResponse = await fetch(`https://jsypctdhynsdqrfifvdh.supabase.co/functions/v1/get-outline-status?job_id=${job_id}`, {
    headers: {
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
    }
  });

  const statusData = await statusResponse.json();
  console.log('Status:', statusData.status, 'Progress:', statusData.progress);

  Generate Report

  // Generate a report for an outline generation job
  const reportUrl = `https://jsypctdhynsdqrfifvdh.supabase.co/functions/v1/generate-outline-report?job_id=${job_id}`;
  window.open(reportUrl, '_blank');

  This system provides a complete solution for generating outlines using AI and search data, with robust tracking and reporting capabilities, all built on Supabase Edge Functions.