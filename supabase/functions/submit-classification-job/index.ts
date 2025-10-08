import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { logError } from '../utils/error-handling.ts';
import { normalizeDomain } from '../helpers.ts';

const FUNCTION_NAME = 'submit-classification-job';

serve(async (req) => {
  // Handle preflight OPTIONS request
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: corsHeaders,
    });
  }

  // Validate request method
  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({ error: 'Method not allowed' }),
      {
        status: 405,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }

  try {
    // Get environment variables
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    
    // Create Supabase client with admin privileges for database access
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    // Get user authentication from request
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Missing authorization header' }),
        {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // Extract JWT token
    const token = authHeader.replace('Bearer ', '');
    
    // Verify the token and get user information
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized: Invalid token' }),
        {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // Parse request body
    const { domain, keywords, suggestedCategories, preferencesPerfect, batchSize = 50, metadata } = await req.json();
    
    // Validate input
    if (!domain) {
      return new Response(
        JSON.stringify({ error: 'Domain is required' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }
    
    if (!keywords || !Array.isArray(keywords) || keywords.length === 0) {
      return new Response(
        JSON.stringify({ error: 'Keywords array is required and cannot be empty' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }
    
    // Clean and validate keywords (remove duplicates, empty strings, etc.)
    const cleanedKeywords = [...new Set(
      keywords
        .map((k: string) => k.trim())
        .filter((k: string) => k && k.length > 0)
    )];
    
    if (cleanedKeywords.length === 0) {
      return new Response(
        JSON.stringify({ error: 'No valid keywords provided after cleaning' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }
    
    console.log(`[DEBUG] Creating classification job for ${cleanedKeywords.length} keywords`);
    
    // Normalize domain
    const normalizedDomain = normalizeDomain(domain);
    
    // Create a new classification job
    const { data: job, error: jobError } = await supabase
      .from('classification_jobs')
      .insert({
        domain: normalizedDomain,
        keywords: cleanedKeywords,
        suggested_categories: suggestedCategories || [],
        preferences_data: preferencesPerfect || null,
        user_id: user.id,
        batch_size: batchSize,
        metadata: metadata || {},
        status: 'pending',
        current_batch: 0
      })
      .select()
      .single();
    
    if (jobError) {
      console.error('Error creating classification job:', jobError);
      return new Response(
        JSON.stringify({ error: `Error creating job: ${jobError.message}` }),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }
    
    // Return job information
    return new Response(
      JSON.stringify({
        message: `Classification job created successfully with ${cleanedKeywords.length} keywords`,
        job: {
          id: job.id,
          status: job.status,
          totalKeywords: cleanedKeywords.length,
          totalBatches: job.total_batches,
          batchSize: job.batch_size,
          created: job.created_at
        }
      }),
      {
        status: 201,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('Error submitting classification job:', error);
    await logError(FUNCTION_NAME, null, error instanceof Error ? error : new Error(String(error)));
    
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});