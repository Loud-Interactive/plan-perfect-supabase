import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { corsHeaders } from '../helpers/index.ts';

// Constants
const SUPABASE_URL = 'https://jsypctdhynsdqrfifvdh.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpzeXBjdGRoeW5zZHFyZmlmdmRoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDA2OTIwMzIsImV4cCI6MjA1NjI2ODAzMn0.2QxOFFLzmp6VByWImiw6zDz3rWy-5hsvEHw3EMemIKY';

// Helper function to normalize domain
function normalizeDomain(domain: string): string {
  return domain.toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/$/, '');
}

// Helper function to convert string to boolean if applicable
function stringToBool(value: string): any {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value;
}

// Router function to handle different endpoints
function router(req: Request) {
  const url = new URL(req.url);
  const path = url.pathname;
  const method = req.method;

  console.log(`Handling ${method} request to ${path}`);

  // Handle CORS preflight requests
  if (method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // Route requests based on path and method
  if (path.match(/^\/pairs$/) && method === 'POST') {
    return handleCreatePairs(req);
  } else if (path.match(/^\/pairs\/guid\/.*$/) && method === 'GET') {
    return handleGetGuidByDomain(req);
  } else if (path.match(/^\/pairs\/all\/.*$/) && method === 'GET') {
    return handleGetAllPairs(req);
  } else if (path.match(/^\/pairs\/.*\/specific$/) && method === 'POST') {
    return handleGetSpecificPairs(req);
  } else if (path.match(/^\/pairs\/.*$/) && method === 'PATCH') {
    return handlePatchPairs(req);
  } else if (path.match(/^\/pairs\/.*$/) && method === 'GET') {
    return handleGetPairsByDomain(req);
  } else if (path === '/') {
    return new Response(JSON.stringify({
      message: 'Preferences Perfect API Wrapper',
      endpoints: [
        { method: 'POST', path: '/pairs', description: 'Create or update pairs' },
        { method: 'GET', path: '/pairs/{domain}', description: 'Get pairs by domain' },
        { method: 'GET', path: '/pairs/guid/{domain}', description: 'Get guid by domain' },
        { method: 'GET', path: '/pairs/all/{domain}', description: 'Get all pairs for domain' },
        { method: 'POST', path: '/pairs/{domain}/specific', description: 'Get specific pairs' },
        { method: 'PATCH', path: '/pairs/{domain}', description: 'Update pairs' },
      ]
    }), { 
      status: 200, 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } else {
    return new Response(JSON.stringify({ error: 'Not found' }), { 
      status: 404, 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}

// Handler functions for each endpoint
async function handleCreatePairs(req: Request) {
  try {
    const body = await req.json();
    const { domain, key_value_pairs, guid } = body;

    if (!domain || !key_value_pairs) {
      return new Response(
        JSON.stringify({ error: 'Domain and key_value_pairs are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Call Supabase function
    const response = await fetch(`${SUPABASE_URL}/functions/v1/pp-create-pairs`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ domain, key_value_pairs, guid }),
    });

    const data = await response.json();
    return new Response(JSON.stringify(data), { 
      status: response.status, 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Error in handleCreatePairs:', error);
    return new Response(
      JSON.stringify({ error: 'An error occurred while processing the request' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
}

async function handleGetGuidByDomain(req: Request) {
  try {
    const url = new URL(req.url);
    const path = url.pathname;
    const domainParam = path.split('/').pop();
    
    if (!domainParam) {
      return new Response(
        JSON.stringify({ error: 'Domain parameter is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const domain = normalizeDomain(domainParam);
    
    // Call Supabase function
    const response = await fetch(`${SUPABASE_URL}/functions/v1/pp-get-guid?domain=${encodeURIComponent(domain)}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      },
    });

    const data = await response.json();
    return new Response(JSON.stringify(data), { 
      status: response.status, 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Error in handleGetGuidByDomain:', error);
    return new Response(
      JSON.stringify({ error: 'An error occurred while processing the request' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
}

async function handleGetPairsByDomain(req: Request) {
  try {
    const url = new URL(req.url);
    const path = url.pathname;
    
    // Skip /pairs/ to get domain
    const domainParam = path.replace(/^\/pairs\//, '');
    
    // Special case: if it's /pairs/all/domain, let the other handler deal with it
    if (domainParam.startsWith('all/')) {
      throw new Error('Route should be handled by handleGetAllPairs');
    }
    
    // Special case: if it's /pairs/guid/domain, let the other handler deal with it
    if (domainParam.startsWith('guid/')) {
      throw new Error('Route should be handled by handleGetGuidByDomain');
    }
    
    // Special case: if it ends with /specific, it's a different endpoint
    if (domainParam.endsWith('/specific')) {
      throw new Error('Route should be handled by handleGetSpecificPairs');
    }
    
    if (!domainParam) {
      return new Response(
        JSON.stringify({ error: 'Domain parameter is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const domain = normalizeDomain(domainParam);
    
    // Call Supabase function
    const response = await fetch(`${SUPABASE_URL}/functions/v1/pp-get-pairs?domain=${encodeURIComponent(domain)}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      },
    });

    const data = await response.json();
    return new Response(JSON.stringify(data), { 
      status: response.status, 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Error in handleGetPairsByDomain:', error);
    return new Response(
      JSON.stringify({ error: 'An error occurred while processing the request' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
}

async function handleGetAllPairs(req: Request) {
  try {
    const url = new URL(req.url);
    const path = url.pathname;
    
    // Extract domain from /pairs/all/{domain}
    const domainParam = path.replace(/^\/pairs\/all\//, '');
    
    if (!domainParam) {
      return new Response(
        JSON.stringify({ error: 'Domain parameter is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const domain = normalizeDomain(domainParam);
    
    // Call Supabase function
    const response = await fetch(`${SUPABASE_URL}/functions/v1/pp-get-all-pairs?domain=${encodeURIComponent(domain)}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      },
    });

    const data = await response.json();
    
    // Transform boolean strings to actual booleans if needed
    if (data && data.data && Array.isArray(data.data)) {
      data.data = data.data.map(item => ({
        ...item,
        value: stringToBool(item.value)
      }));
    }
    
    return new Response(JSON.stringify(data), { 
      status: response.status, 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Error in handleGetAllPairs:', error);
    return new Response(
      JSON.stringify({ error: 'An error occurred while processing the request' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
}

async function handleGetSpecificPairs(req: Request) {
  try {
    const url = new URL(req.url);
    const path = url.pathname;
    
    // Extract domain from /pairs/{domain}/specific
    const domainParam = path.replace(/^\/pairs\//, '').replace(/\/specific$/, '');
    
    if (!domainParam) {
      return new Response(
        JSON.stringify({ error: 'Domain parameter is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get the keys from the request body
    const body = await req.json();
    const { keys } = body;
    
    if (!keys || !Array.isArray(keys)) {
      return new Response(
        JSON.stringify({ error: 'Keys must be provided as an array' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const domain = normalizeDomain(domainParam);
    
    // Call Supabase function
    const response = await fetch(`${SUPABASE_URL}/functions/v1/pp-get-specific-pairs?domain=${encodeURIComponent(domain)}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ keys }),
    });

    const data = await response.json();
    return new Response(JSON.stringify(data), { 
      status: response.status, 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Error in handleGetSpecificPairs:', error);
    return new Response(
      JSON.stringify({ error: 'An error occurred while processing the request' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
}

async function handlePatchPairs(req: Request) {
  try {
    const url = new URL(req.url);
    const path = url.pathname;
    
    // Extract domain from /pairs/{domain}
    const domainParam = path.replace(/^\/pairs\//, '');
    
    if (!domainParam) {
      return new Response(
        JSON.stringify({ error: 'Domain parameter is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get the updates from the request body
    const updates = await req.json();
    
    if (!updates || typeof updates !== 'object') {
      return new Response(
        JSON.stringify({ error: 'Updates must be provided as an object' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const domain = normalizeDomain(domainParam);
    
    // Call Supabase function
    const response = await fetch(`${SUPABASE_URL}/functions/v1/pp-patch-pairs?domain=${encodeURIComponent(domain)}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(updates),
    });

    const data = await response.json();
    return new Response(JSON.stringify(data), { 
      status: response.status, 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Error in handlePatchPairs:', error);
    return new Response(
      JSON.stringify({ error: 'An error occurred while processing the request' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
}

// Serve the router function
serve(router);