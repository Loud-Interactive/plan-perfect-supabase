import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const supabaseClient = createClient(supabaseUrl, serviceRoleKey);

async function callGenerateHeroImage(guid: string) {
  const response = await fetch(
    `${supabaseUrl}/functions/v1/generate-hero-image`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${serviceRoleKey}`,
      },
      body: JSON.stringify({ guid }),
    },
  );

  const data = await response.json();
  if (!response.ok) {
    throw new Error(
      data?.error || data?.details || "Failed to generate hero image",
    );
  }

  return data;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    let body: Record<string, unknown> = {};
    try {
      body = await req.json();
    } catch (_err) {
      body = {};
    }

    const guids = Array.isArray(body.guids) ? (body.guids as string[]) : [];
    const requestedLimit = typeof body.limit === "number"
      ? body.limit
      : undefined;
    const maxOutlines = requestedLimit && requestedLimit > 0
      ? requestedLimit
      : 10;

    let query = supabaseClient
      .from("tasks")
      .select(
        "task_id, title, hero_image_prompt, hero_image_status, hero_image_url, content_plan_outline_guid",
      )
      .not("hero_image_prompt", "is", null)
      .not("content_plan_outline_guid", "is", null)
      .is("hero_image_url", null);

    if (guids.length > 0) {
      query = query.in("content_plan_outline_guid", guids);
    } else {
      query = query
        .in(
          "hero_image_status",
          [
            "Prompt_Ready",
            "Prompt Ready",
            "Prompt Generated",
            "Prompt_Generated",
            "Requested",
          ],
        )
        .order("updated_at", { ascending: true })
        .limit(maxOutlines);
    }

    const { data: tasks, error: taskError } = await query;
    if (taskError) {
      throw taskError;
    }

    if (!tasks || tasks.length === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          message: "No tasks require hero image generation",
          processed: 0,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const promptReadyIds = tasks
      .filter((task) =>
        [
          "Prompt_Ready",
          "Prompt Ready",
          "Prompt Generated",
          "Prompt_Generated",
        ].includes(task.hero_image_status as string | null ?? "")
      )
      .map((task) => task.task_id);

    if (promptReadyIds.length > 0) {
      await supabaseClient
        .from("tasks")
        .update({
          hero_image_status: "Requested",
          updated_at: new Date().toISOString(),
        })
        .in("task_id", promptReadyIds);
    }

    const results: Array<Record<string, unknown>> = [];
    let successCount = 0;
    let errorCount = 0;

    for (const task of tasks) {
      const guid = task.content_plan_outline_guid as string;

      try {
        await supabaseClient
          .from("tasks")
          .update({
            hero_image_status: "Processing",
            updated_at: new Date().toISOString(),
          })
          .eq("task_id", task.task_id);

        const generation = await callGenerateHeroImage(guid);

        successCount++;
        results.push({
          guid,
          title: task.title,
          status: "success",
          hero_image_url: generation?.hero_image_url ?? null,
        });

        console.log(`✅ Generated hero image for ${guid}`);
      } catch (error) {
        errorCount++;
        const message = error instanceof Error ? error.message : String(error);

        await supabaseClient
          .from("tasks")
          .update({
            hero_image_status: "Failed",
            updated_at: new Date().toISOString(),
          })
          .eq("task_id", task.task_id);

        results.push({
          guid,
          title: task.title,
          status: "error",
          error: message,
        });

        console.error(`❌ Failed generating hero image for ${guid}:`, message);
      }

      await sleep(1000);
    }

    return new Response(
      JSON.stringify({
        success: true,
        processed: tasks.length,
        success_count: successCount,
        error_count: errorCount,
        results,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (error) {
    console.error("Error processing hero image batch:", error);

    return new Response(
      JSON.stringify({
        error: "Internal server error",
        details: error instanceof Error ? error.message : String(error),
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
