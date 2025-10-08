// Content Perfect Hero Image Generator using Google Gemini 2.5
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { encode as base64Encode } from "https://deno.land/std@0.168.0/encoding/base64.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// Create Supabase client
const supabaseClient = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
);

// Google Gemini API configuration
const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY") ?? "";
const GEMINI_MODEL = "gemini-2.5-flash-image-preview";
const GEMINI_URL =
  `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

// Valid aspect ratios and their corresponding blank template files
const ASPECT_RATIO_TEMPLATES = {
  "1:1": "blank-1x1-aspect-ratio.png",
  "9:16": "blank-9x16-aspect-ratio.png",
  "16:9": "blank-16x9-aspect-ratio.png",
  "4:3": "blank-4x3-aspect-ratio.png",
  "3:4": "blank-3x4-aspect-ratio.png",
  "21:9": "blank-21x9-aspect-ratio.png",
  "2:1": "blank-2x1-aspect-ratio.png",
  "4:1": "blank-4x1-aspect-ratio.png",
  "3:2": "blank-3x2-aspect-ratio.png",
  "5:4": "blank-5x4-aspect-ratio.png",
  "16:10": "blank-16x10-aspect-ratio.png"
};

const VALID_ASPECT_RATIOS = Object.keys(ASPECT_RATIO_TEMPLATES);

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Parse request body
    const { guid, regenerate } = await req.json();

    if (!guid) {
      return new Response(
        JSON.stringify({ error: "Content plan outline GUID is required" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    console.log(
      `Received request to generate hero image for outline with GUID: ${guid}`,
    );

    // Step 1: Find the task and outline data for the given GUID
    const { data: taskData, error: taskError } = await supabaseClient
      .from("tasks")
      .select(
        "task_id, title, hero_image_prompt, hero_image_url, content_plan_outline_guid, client_domain",
      )
      .eq("content_plan_outline_guid", guid)
      .order("created_at", { ascending: false })
      .limit(1);

    if (taskError) {
      console.error("Error fetching task data:", taskError);
      return new Response(
        JSON.stringify({
          error: "Error fetching task data",
          details: taskError.message,
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    if (!taskData || taskData.length === 0) {
      return new Response(
        JSON.stringify({
          error: "No task found for this outline GUID",
          details: `No task found with content_plan_outline_guid: ${guid}`,
        }),
        {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Get the relevant data from the task
    const task = taskData[0];
    const outline = {
      guid: guid,
      title: task.title,
      hero_image_prompt: task.hero_image_prompt,
      hero_image_url: task.hero_image_url,
    };

    // Check if we already have an image generated and regeneration is not requested
    if (outline.hero_image_url && !regenerate) {
      return new Response(
        JSON.stringify({
          message: "Hero image already exists for this outline",
          hero_image_url: outline.hero_image_url,
          guid: outline.guid,
          title: outline.title,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Check if we have a prompt
    if (!outline.hero_image_prompt) {
      return new Response(
        JSON.stringify({
          error: "No hero image prompt found",
          details: "This outline does not have a hero_image_prompt field set",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    console.log(`Found hero image prompt: ${outline.hero_image_prompt}`);

    // Get aspect ratio for the domain
    let aspectRatio = "16:9"; // Default
    if (task.client_domain) {
      const { data: aspectRatioData } = await supabaseClient
        .from("pairs")
        .select("value")
        .eq("domain", task.client_domain)
        .eq("key", "hero_image_aspect_ratio")
        .limit(1);

      if (
        aspectRatioData && aspectRatioData.length > 0 && VALID_ASPECT_RATIOS.includes(aspectRatioData[0].value)
      ) {
        aspectRatio = aspectRatioData[0].value;
        console.log(
          `Using custom aspect ratio for ${task.client_domain}: ${aspectRatio}`,
        );
      }
    }

    // Try to fetch existing thinking and custom_base_prompt from hero_image_prompts table
    let existingThinking = null;
    let customBasePromptUsed = false;
    try {
      const { data: promptData } = await supabaseClient
        .from("hero_image_prompts")
        .select("thinking, custom_base_prompt")
        .eq("content_plan_outline_guid", guid)
        .order("created_at", { ascending: false })
        .limit(1);
      
      if (promptData && promptData.length > 0) {
        if (promptData[0].thinking) {
          existingThinking = promptData[0].thinking;
          console.log("Found existing thinking from prompt generation phase");
        }
        if (promptData[0].custom_base_prompt) {
          customBasePromptUsed = true;
          console.log("Custom base prompt was used in prompt generation");
        }
      }
    } catch (error) {
      console.log("Could not fetch existing prompt data:", error.message);
    }

    // Step 2: Generate the image using Google Gemini 2.5 Image preview with template
    let templateBase64 = null;
    let templateFileName = null;
    
    try {
      console.log("Calling Google Gemini 2.5 to generate image...");
      
      // Load the blank template image for the aspect ratio
      templateFileName = ASPECT_RATIO_TEMPLATES[aspectRatio];
      
      if (templateFileName) {
        console.log(`Loading blank template for aspect ratio ${aspectRatio}: ${templateFileName}`);
        
        try {
          // Try to fetch the blank template from storage
          const { data: templateData, error: templateError } = await supabaseClient
            .storage
            .from("aspect-ratio-templates")
            .download(templateFileName);
          
          if (templateData && !templateError) {
            // Convert blob to base64 for Gemini API using Deno's standard library
            const bytes = new Uint8Array(await templateData.arrayBuffer());
            
            // Use Deno's base64 encoding from standard library
            templateBase64 = base64Encode(bytes);
            console.log(`Successfully loaded blank template image (${templateBase64.length} base64 chars)`);
          } else {
            console.log("Template not found in storage, will generate without template");
          }
        } catch (error) {
          console.log("Could not load template, proceeding without it:", error.message);
        }
      }

      // Prepare the prompt and payload
      let payload;
      
      if (templateBase64) {
        // Use template-based generation with the blank image
        const enhancedPrompt = `Using the blank image template provided, fill it with an image based on this prompt: ${outline.hero_image_prompt}
        
IMPORTANT: 
- Use the exact dimensions and aspect ratio of the template image
- Do not include any text, lettering, numbers, or typography in the image
- Produce a clean, high-quality visual that fills the entire template
- Maintain the aspect ratio: ${aspectRatio}`;

        payload = {
          contents: [
            {
              role: "user",
              parts: [
                { text: enhancedPrompt },
                {
                  inlineData: {
                    mimeType: "image/png",
                    data: templateBase64
                  }
                }
              ],
            },
          ],
          generationConfig: {
            responseModalities: ["IMAGE", "TEXT"],
          },
        };
      } else {
        // Fallback to text-only generation
        const textGuidance =
          "IMPORTANT: Do not include any text, lettering, numbers, or typography in the image. Produce a clean visual only.";
        const enhancedPrompt =
          `${outline.hero_image_prompt}\n\n${textGuidance}\n\nRequired aspect ratio: ${aspectRatio}`;

        payload = {
          contents: [
            {
              role: "user",
              parts: [{ text: enhancedPrompt }],
            },
          ],
          generationConfig: {
            responseModalities: ["IMAGE", "TEXT"],
          },
        };
      }

      const geminiResponse = await fetch(
        `${GEMINI_URL}?key=${GEMINI_API_KEY}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        },
      );

      if (!geminiResponse.ok) {
        const errorText = await geminiResponse.text();
        console.error("Gemini API error response:", errorText);
        throw new Error(
          `Gemini API error: ${geminiResponse.status} - ${errorText}`,
        );
      }

      const geminiData = await geminiResponse.json();
      const candidate = geminiData?.candidates?.[0];
      const inlinePart = candidate?.content?.parts?.find((
        part: Record<string, unknown>,
      ) => part.inlineData);
      if (!inlinePart?.inlineData?.data) {
        throw new Error("No image data returned by Gemini");
      }

      const imageBase64 = inlinePart.inlineData.data as string;
      console.log("Gemini image generated successfully");

      // Step 3: Save the image to Supabase Storage
      // Generate a filename based on the outline GUID
      const fileName = `${guid}-${Date.now()}.jpg`;
      const bucketName = "hero-images";

      // Convert base64 to Uint8Array
      const imageBuffer = Uint8Array.from(
        atob(imageBase64),
        (c) => c.charCodeAt(0),
      );

      // Upload to storage
      const { data: uploadData, error: uploadError } = await supabaseClient
        .storage
        .from(bucketName)
        .upload(fileName, imageBuffer, {
          contentType: "image/jpeg",
          upsert: true,
        });

      if (uploadError) {
        throw new Error(`Error uploading image: ${uploadError.message}`);
      }

      console.log(`Image uploaded to storage: ${fileName}`);

      // Step 4: Get the public URL for the image
      const { data: publicUrlData } = supabaseClient
        .storage
        .from(bucketName)
        .getPublicUrl(fileName);

      const publicUrl = publicUrlData.publicUrl;
      console.log(`Public URL generated: ${publicUrl}`);

      // Step 5: Update the tasks table with the hero_image_url
      // Structure hero_image_thinking to include both metadata and any thinking logs
      const heroImageThinkingData = {
        metadata: {
          generator: "gemini-2.5-flash-image-preview",
          aspect_ratio: aspectRatio,
          generated_at: new Date().toISOString(),
          prompt_used: outline.hero_image_prompt,
          custom_base_prompt_used: customBasePromptUsed,
          template_used: !!templateBase64,
          template_file: templateFileName || null,
          storage_path: fileName,
          public_url: publicUrl
        }
      };

      // Include thinking from prompt generation phase if available
      if (existingThinking) {
        // Parse if it's a string containing JSON
        try {
          const thinkingParsed = typeof existingThinking === 'string' 
            ? JSON.parse(existingThinking) 
            : existingThinking;
          heroImageThinkingData['thinking'] = thinkingParsed;
        } catch (e) {
          // If parsing fails, store as plain text
          heroImageThinkingData['thinking'] = existingThinking;
        }
      }

      const { error: updateError } = await supabaseClient
        .from("tasks")
        .update({
          hero_image_url: publicUrl,
          hero_image_status: "Generated",
          hero_image_thinking: JSON.stringify(heroImageThinkingData),
          updated_at: new Date().toISOString(),
        })
        .eq("task_id", task.task_id);

      if (updateError) {
        throw new Error(
          `Error updating task with hero image URL: ${updateError.message}`,
        );
      }

      console.log("Task updated with hero image URL");

      // Return the result
      return new Response(
        JSON.stringify({
          success: true,
          guid: outline.guid,
          title: outline.title,
          hero_image_url: publicUrl,
          prompt: outline.hero_image_prompt,
          aspect_ratio: aspectRatio,
          generator: "gemini-2.5-flash-image-preview",
          thinking_included: existingThinking ? true : false,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    } catch (error) {
      console.error("Error generating or storing image:", error);

      return new Response(
        JSON.stringify({
          error: "Error generating or storing hero image",
          details: error.message,
          guid: outline.guid,
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }
  } catch (error) {
    console.error("Error processing request:", error);

    return new Response(
      JSON.stringify({
        error: "Internal server error",
        details: error.message,
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
