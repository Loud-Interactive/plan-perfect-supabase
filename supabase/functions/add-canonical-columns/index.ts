import { serve } from "https://deno.land/std@0.177.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

serve(async (req) => {
  try {
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    console.log('🔧 Adding canonical tracking columns to pages table...')

    // Execute the ALTER TABLE statements
    const sql = `
      ALTER TABLE pages 
      ADD COLUMN IF NOT EXISTS canonical_url TEXT,
      ADD COLUMN IF NOT EXISTS http_status INTEGER,
      ADD COLUMN IF NOT EXISTS original_url TEXT,
      ADD COLUMN IF NOT EXISTS redirect_chain TEXT[];
    `

    const { data, error } = await supabaseAdmin.rpc('exec', { 
      sql: sql 
    })

    if (error) {
      console.error('Error executing SQL:', error)
      
      // Alternative approach - try using pg_advisory_lock for direct SQL
      const { data: result, error: execError } = await supabaseAdmin
        .rpc('exec', { sql: 'SELECT version()' })
        
      if (execError) {
        return new Response(JSON.stringify({ 
          error: 'Database schema update failed',
          details: error.message,
          fallback: 'Execute manually in Supabase Studio',
          sql: sql
        }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        })
      }
    }

    // Add indexes for performance
    const indexSql = `
      CREATE INDEX IF NOT EXISTS idx_pages_canonical_url ON pages(canonical_url);
      CREATE INDEX IF NOT EXISTS idx_pages_http_status ON pages(http_status);
      CREATE INDEX IF NOT EXISTS idx_pages_original_url ON pages(original_url);
    `

    const { error: indexError } = await supabaseAdmin.rpc('exec', { 
      sql: indexSql 
    })

    if (indexError) {
      console.log('Index creation may have failed:', indexError.message)
    }

    return new Response(JSON.stringify({ 
      success: true,
      message: 'Canonical tracking columns added successfully',
      columns: ['canonical_url', 'http_status', 'original_url', 'redirect_chain'],
      indexes: ['idx_pages_canonical_url', 'idx_pages_http_status', 'idx_pages_original_url']
    }), {
      headers: { 'Content-Type': 'application/json' }
    })

  } catch (error) {
    console.error('Exception:', error)
    return new Response(JSON.stringify({ 
      error: 'Schema update failed',
      message: error.message 
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    })
  }
})