// supabase/functions/generate-outline-report/index.ts
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

    const { data: searchTerms, error: searchTermsError } = await supabase
      .from('outline_search_terms')
      .select('*')
      .eq('job_id', jobId);

    const { data: searchResults, error: searchResultsError } = await supabase
      .from('outline_search_results')
      .select('*')
      .eq('job_id', jobId)
      .limit(50);  // Limit to 50 for performance

    const { data: urlAnalyses, error: urlAnalysesError } = await supabase
      .from('outline_url_analyses')
      .select('*')
      .eq('job_id', jobId)
      .limit(20);  // Limit to 20 for performance

    const { data: outline, error: outlineError } = await supabase
      .from('content_plan_outlines_ai')
      .select('*')
      .eq('job_id', jobId)
      .maybeSingle();

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
    /* Category styles for search terms */
    tr td:nth-child(2):contains('base') {
      background-color: #d4edda;
      color: #155724;
    }
    tr td:nth-child(2):contains('combined') {
      background-color: #e9f7fe;
      color: #3498db;
    }
    tr td:nth-child(2):contains('titleAngle') {
      background-color: #d1ecf1;
      color: #0c5460;
    }
    tr td:nth-child(2):contains('relatedConcept') {
      background-color: #f8d7da;
      color: #721c24;
    }
    /* Priority styles */
    tr td:nth-child(3):contains('1') {
      font-weight: bold;
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
    .status-processing {
      background-color: #fff3cd;
      color: #856404;
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
    .logo {
      max-width: 200px;
      margin-bottom: 20px;
    }
    .footer {
      margin-top: 50px;
      text-align: center;
      color: #7f8c8d;
      font-size: 14px;
    }
    @media print {
      .section {
        break-inside: avoid;
      }
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
    <p><strong>Status:</strong> <span class="status ${job.status === 'completed' ? 'status-completed' : job.status === 'failed' ? 'status-failed' : 'status-processing'}">${job.status}</span></p>
    <p><strong>Created:</strong> ${new Date(job.created_at).toLocaleString()}</p>
    <p><strong>Updated:</strong> ${new Date(job.updated_at).toLocaleString()}</p>
  </div>

  <div class="section">
    <h2>Search Terms Used</h2>
    
    <div>
      ${searchTerms && searchTerms.length > 0 
        ? `
          <table>
            <tr>
              <th>Search Term</th>
              <th>Category</th>
              <th>Priority</th>
            </tr>
            ${searchTerms.map(term => `
              <tr>
                <td><span class="search-term">${term.search_term}</span></td>
                <td>${term.category || 'generic'}</td>
                <td>${term.priority || 'N/A'}</td>
              </tr>
            `).join('')}
          </table>
        `
        : 'No search terms found'}
    </div>
  </div>

  <div class="section">
    <h2>Search Results</h2>
    <p>Total Results: ${searchResults?.length || 0}${searchResults && searchResults.length === 50 ? ' (showing first 50)' : ''}</p>
    
    ${searchResults && searchResults.length > 0 ? `
    <table>
      <tr>
        <th>Search Term</th>
        <th>Category</th>
        <th>Priority</th>
        <th>URL</th>
        <th>Title</th>
        <th>Date</th>
      </tr>
      ${searchResults.map(result => `
        <tr>
          <td>${result.search_term}</td>
          <td>${result.search_category || 'N/A'}</td>
          <td>${result.search_priority || 'N/A'}</td>
          <td><a href="${result.url}" target="_blank" class="url">${result.url}</a></td>
          <td>${result.title || 'N/A'}</td>
          <td>${result.date || result.publishedTime || 'N/A'}</td>
        </tr>
      `).join('')}
    </table>
    ` : '<p>No search results found</p>'}
  </div>

  <div class="section">
    <h2>URL Content Analysis</h2>
    <p>Total URLs Analyzed: ${urlAnalyses?.length || 0}${urlAnalyses && urlAnalyses.length === 20 ? ' (showing first 20)' : ''}</p>
    
    ${urlAnalyses && urlAnalyses.length > 0 ? `
      ${urlAnalyses.map(analysis => `
        <div class="result-card">
          <h4>${analysis.title || 'Untitled'}</h4>
          <p><a href="${analysis.url}" target="_blank" class="url">${analysis.url}</a></p>
          
          ${analysis.summary ? `
            <h5>Summary:</h5>
            <p>${analysis.summary}</p>
          ` : ''}
          
          <h5>Headings Structure:</h5>
          ${analysis.headings?.h1 ? `<p><strong>H1:</strong> ${analysis.headings.h1.join(', ')}</p>` : ''}
          ${analysis.headings?.h2 ? `<p><strong>H2:</strong> ${analysis.headings.h2.join(', ')}</p>` : ''}
          ${analysis.headings?.h3 ? `<p><strong>H3:</strong> ${analysis.headings.h3.join(', ')}</p>` : ''}
        </div>
      `).join('')}
    ` : '<p>No URL analyses found</p>'}
  </div>

  <div class="section">
    <h2>Generated Outline</h2>
    
    ${outline?.outline ? `
      <h3>${outline.outline.title || job.post_title}</h3>
      
      ${outline.outline.sections && outline.outline.sections.length > 0 ? `
        ${outline.outline.sections.map((section, index) => `
          <div class="outline-section">
            <h4>${index + 1}. ${section.title}</h4>
            ${section.subheadings && section.subheadings.length > 0 ? `
              <ul class="subheading-list">
                ${section.subheadings.map(subheading => `
                  <li>${subheading}</li>
                `).join('')}
              </ul>
            ` : '<p>No subheadings</p>'}
          </div>
        `).join('')}
      ` : '<p>No sections found in outline</p>'}
    ` : '<p>No outline generated yet</p>'}
  </div>

  <div class="footer">
    <p>Generated by AI Outline Generator on ${new Date().toLocaleString()}</p>
    <p>Content Plan ID: ${job.content_plan_guid || 'N/A'}</p>
    <p>Job ID: ${job.id}</p>
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
    console.error('Error in generate-outline-report function:', error);
    const errorHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Error - Outline Report</title>
        <style>
          body { font-family: sans-serif; padding: 20px; }
          .error { color: red; background: #ffeeee; padding: 15px; border-radius: 5px; }
        </style>
      </head>
      <body>
        <h1>Error Generating Report</h1>
        <div class="error">
          <p>${error.message}</p>
          <p>Please check the job ID and try again.</p>
        </div>
        <p><a href="javascript:history.back()">Go Back</a></p>
      </body>
      </html>
    `;
    return new Response(
      errorHtml,
      { 
        status: 500, 
        headers: { 
          ...corsHeaders, 
          'Content-Type': 'text/html; charset=utf-8' 
        } 
      }
    );
  }
});