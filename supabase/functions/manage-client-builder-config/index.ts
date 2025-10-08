import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

interface ClientBuilderConfig {
  id?: string
  client_domain: string
  builder_api_key: string
  builder_model?: string
  builder_endpoint?: string
  featured_image_required?: boolean
  disable_hero_elements?: boolean
  url_prefix?: string
  default_hero_prompt?: string
  auto_publish_enabled?: boolean
  active?: boolean
}

serve(async (req) => {
  // Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const { action, config, client_domain } = await req.json()

    console.log(`Client Builder Config Management - Action: ${action}`)

    switch (action) {
      case 'create':
        return await createConfig(supabase, config)
      case 'read':
        return await readConfig(supabase, client_domain)
      case 'update':
        return await updateConfig(supabase, config)
      case 'delete':
        return await deleteConfig(supabase, client_domain)
      case 'list':
        return await listConfigs(supabase)
      case 'test':
        return await testConfig(supabase, client_domain)
      default:
        return new Response(
          JSON.stringify({ error: 'Invalid action. Use: create, read, update, delete, list, test' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
    }

  } catch (error) {
    console.error('Error in manage-client-builder-config:', error)
    
    return new Response(
      JSON.stringify({ 
        error: 'Failed to manage client builder config',
        details: error.message
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )
  }
})

async function createConfig(supabase: any, config: ClientBuilderConfig) {
  console.log(`Creating config for domain: ${config.client_domain}`)
  
  if (!config.client_domain || !config.builder_api_key) {
    return new Response(
      JSON.stringify({ error: 'client_domain and builder_api_key are required' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  const configData = {
    client_domain: config.client_domain,
    builder_api_key: config.builder_api_key,
    builder_model: config.builder_model || 'blog',
    builder_endpoint: config.builder_endpoint || '/api/v1/write/blog',
    featured_image_required: config.featured_image_required ?? true,
    disable_hero_elements: config.disable_hero_elements ?? true,
    url_prefix: config.url_prefix || '/blog',
    default_hero_prompt: config.default_hero_prompt || 'Create a professional, modern hero image for this content.',
    auto_publish_enabled: config.auto_publish_enabled ?? false,
    active: config.active ?? true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  }

  const { data, error } = await supabase
    .from('client_builder_configs')
    .insert(configData)
    .select()
    .single()

  if (error) {
    console.error('Error creating config:', error)
    return new Response(
      JSON.stringify({ error: 'Failed to create config', details: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  return new Response(
    JSON.stringify({ success: true, config: data }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

async function readConfig(supabase: any, client_domain: string) {
  if (!client_domain) {
    return new Response(
      JSON.stringify({ error: 'client_domain is required' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  const { data, error } = await supabase
    .from('client_builder_configs')
    .select('*')
    .eq('client_domain', client_domain)
    .single()

  if (error) {
    console.error('Error reading config:', error)
    return new Response(
      JSON.stringify({ error: 'Config not found', details: error.message }),
      { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Mask API key for security
  const safeConfig = {
    ...data,
    builder_api_key: data.builder_api_key.substring(0, 10) + '...' + data.builder_api_key.substring(data.builder_api_key.length - 4)
  }

  return new Response(
    JSON.stringify({ success: true, config: safeConfig }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

async function updateConfig(supabase: any, config: ClientBuilderConfig) {
  if (!config.client_domain) {
    return new Response(
      JSON.stringify({ error: 'client_domain is required for update' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  const updateData = {
    ...config,
    updated_at: new Date().toISOString()
  }
  
  // Remove client_domain from update data since it's the key
  delete updateData.client_domain

  const { data, error } = await supabase
    .from('client_builder_configs')
    .update(updateData)
    .eq('client_domain', config.client_domain)
    .select()
    .single()

  if (error) {
    console.error('Error updating config:', error)
    return new Response(
      JSON.stringify({ error: 'Failed to update config', details: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  return new Response(
    JSON.stringify({ success: true, config: data }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

async function deleteConfig(supabase: any, client_domain: string) {
  if (!client_domain) {
    return new Response(
      JSON.stringify({ error: 'client_domain is required' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  const { error } = await supabase
    .from('client_builder_configs')
    .delete()
    .eq('client_domain', client_domain)

  if (error) {
    console.error('Error deleting config:', error)
    return new Response(
      JSON.stringify({ error: 'Failed to delete config', details: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  return new Response(
    JSON.stringify({ success: true, message: 'Config deleted successfully' }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

async function listConfigs(supabase: any) {
  const { data, error } = await supabase
    .from('client_builder_configs')
    .select('client_domain, builder_model, builder_endpoint, url_prefix, active, created_at, updated_at')
    .order('created_at', { ascending: false })

  if (error) {
    console.error('Error listing configs:', error)
    return new Response(
      JSON.stringify({ error: 'Failed to list configs', details: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  return new Response(
    JSON.stringify({ success: true, configs: data }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

async function testConfig(supabase: any, client_domain: string) {
  if (!client_domain) {
    return new Response(
      JSON.stringify({ error: 'client_domain is required' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Get the config
  const { data: config, error: configError } = await supabase
    .from('client_builder_configs')
    .select('*')
    .eq('client_domain', client_domain)
    .single()

  if (configError || !config) {
    return new Response(
      JSON.stringify({ error: 'Config not found', details: configError?.message }),
      { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Test the Builder.io API connection
  try {
    const testPayload = {
      name: 'Test Connection - ' + new Date().toISOString(),
      published: 'draft',
      data: {
        title: 'Test Connection',
        summary: 'This is a test to verify API connectivity',
        url: '/test-connection-' + Date.now()
      }
    }

    const builderUrl = `https://builder.io${config.builder_endpoint}`
    console.log(`Testing Builder.io connection to: ${builderUrl}`)

    const response = await fetch(builderUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.builder_api_key}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(testPayload)
    })

    const responseData = await response.json()

    if (response.ok) {
      // Clean up - delete the test entry
      try {
        if (responseData.id) {
          await fetch(`https://builder.io/api/v1/content/${responseData.id}`, {
            method: 'DELETE',
            headers: {
              'Authorization': `Bearer ${config.builder_api_key}`
            }
          })
        }
      } catch (cleanupError) {
        console.log('Test cleanup failed (non-critical):', cleanupError.message)
      }

      return new Response(
        JSON.stringify({
          success: true,
          message: 'Builder.io API connection successful',
          client_domain: client_domain,
          test_response: {
            status: response.status,
            created_test_entry: !!responseData.id
          }
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    } else {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Builder.io API connection failed',
          details: {
            status: response.status,
            response: responseData
          }
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

  } catch (testError) {
    console.error('Error testing Builder.io connection:', testError)
    return new Response(
      JSON.stringify({
        success: false,
        error: 'Failed to test Builder.io connection',
        details: testError.message
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
}