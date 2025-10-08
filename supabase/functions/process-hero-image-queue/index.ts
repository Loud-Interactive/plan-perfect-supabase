import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    )

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? ""
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""

    // Get batch size from request
    const { batchSize = 5 } = await req.json().catch(() => ({}))

    console.log(`Processing up to ${batchSize} hero images from queue...`)

    // Get pending items from queue
    const { data: queueItems, error: queueError } = await supabaseClient
      .from("hero_image_queue")
      .select(`
        id,
        task_id,
        content_plan_outline_guid,
        tasks!inner(
          title,
          client_domain,
          hero_image_prompt
        )
      `)
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(batchSize)

    if (queueError) {
      throw new Error(`Error fetching queue items: ${queueError.message}`)
    }

    if (!queueItems || queueItems.length === 0) {
      return new Response(
        JSON.stringify({ 
          message: "No pending hero images in queue",
          processed: 0,
          failed: 0
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    console.log(`Found ${queueItems.length} items to process`)

    const results = {
      processed: 0,
      failed: 0,
      details: []
    }

    // Process each item
    for (const item of queueItems) {
      const { id: queueId, content_plan_outline_guid, tasks } = item

      try {
        // Mark as processing
        await supabaseClient
          .from("hero_image_queue")
          .update({ 
            status: "processing",
            processed_at: new Date().toISOString()
          })
          .eq("id", queueId)

        console.log(`Processing: ${tasks.title} (${tasks.client_domain})`)

        // Call the hero image generation function
        const response = await fetch(`${supabaseUrl}/functions/v1/generate-hero-image`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${supabaseKey}`
          },
          body: JSON.stringify({ guid: content_plan_outline_guid })
        })

        const result = await response.json()

        if (response.ok && result.hero_image_url) {
          // Mark as completed
          await supabaseClient
            .from("hero_image_queue")
            .update({ 
              status: "completed",
              processed_at: new Date().toISOString()
            })
            .eq("id", queueId)

          results.processed++
          results.details.push({
            title: tasks.title,
            status: "success",
            image_url: result.hero_image_url
          })

          console.log(`✓ Generated image for: ${tasks.title}`)
        } else {
          throw new Error(result.error || "Failed to generate image")
        }

      } catch (error) {
        console.error(`Failed to process queue item ${queueId}:`, error)

        // Update queue item with error
        await supabaseClient
          .from("hero_image_queue")
          .update({ 
            status: "failed",
            error_message: error.message,
            retries: item.retries + 1,
            processed_at: new Date().toISOString()
          })
          .eq("id", queueId)

        results.failed++
        results.details.push({
          title: tasks?.title || "Unknown",
          status: "failed",
          error: error.message
        })
      }

      // Small delay between requests
      await new Promise(resolve => setTimeout(resolve, 1000))
    }

    return new Response(
      JSON.stringify(results),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    )

  } catch (error) {
    console.error("Error processing hero image queue:", error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { 
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      }
    )
  }
})