// Resize hero image to specified aspect ratio
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Create Supabase client
const supabaseClient = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
);

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { imageUrl, domain, taskId } = await req.json();

    if (!imageUrl || !domain) {
      return new Response(
        JSON.stringify({ error: "imageUrl and domain are required" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    console.log(`Resizing image for domain: ${domain}, image: ${imageUrl}`);

    // Get aspect ratio from pairs table
    const { data: aspectRatioData, error: aspectError } = await supabaseClient
      .from("pairs")
      .select("value")
      .eq("domain", domain)
      .eq("key", "hero_image_aspect_ratio")
      .single();

    if (aspectError || !aspectRatioData) {
      console.log(`No aspect ratio found for domain ${domain}, using default 16:9`);
      // Default to 16:9 if no aspect ratio is specified
      return new Response(
        JSON.stringify({ 
          resizedUrl: imageUrl,
          aspectRatio: "16:9",
          message: "No custom aspect ratio found, using original image"
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const aspectRatio = aspectRatioData.value;
    console.log(`Found aspect ratio: ${aspectRatio}`);

    // Parse aspect ratio (e.g., "16:9" -> width: 16, height: 9)
    const [widthRatio, heightRatio] = aspectRatio.split(":").map(Number);
    if (!widthRatio || !heightRatio) {
      throw new Error(`Invalid aspect ratio format: ${aspectRatio}`);
    }

    // Calculate dimensions based on aspect ratio
    // Use 1200px as base width for high quality
    const targetWidth = 1200;
    const targetHeight = Math.round((targetWidth * heightRatio) / widthRatio);

    console.log(`Target dimensions: ${targetWidth}x${targetHeight}`);

    // Download the original image
    const imageResponse = await fetch(imageUrl);
    if (!imageResponse.ok) {
      throw new Error(`Failed to fetch image: ${imageResponse.statusText}`);
    }

    const imageBlob = await imageResponse.blob();
    const imageArrayBuffer = await imageBlob.arrayBuffer();
    const imageUint8Array = new Uint8Array(imageArrayBuffer);

    // Use Supabase Storage Transform API to resize
    // Extract bucket and path from the image URL
    const urlParts = new URL(imageUrl);
    const pathMatch = urlParts.pathname.match(/\/storage\/v1\/object\/public\/([^\/]+)\/(.+)/);
    
    if (!pathMatch) {
      throw new Error("Invalid Supabase storage URL format");
    }

    const bucketName = pathMatch[1];
    const originalPath = pathMatch[2];

    // Generate new filename for resized image
    const timestamp = Date.now();
    const resizedPath = originalPath.replace(/\.([^.]+)$/, `-${widthRatio}x${heightRatio}-${timestamp}.$1`);

    console.log(`Uploading resized image to: ${resizedPath}`);

    // Upload the resized image
    // Note: Since we can't resize server-side without additional libraries,
    // we'll use Supabase's transform feature via URL parameters
    const { data: uploadData, error: uploadError } = await supabaseClient
      .storage
      .from(bucketName)
      .upload(resizedPath, imageUint8Array, {
        contentType: "image/png",
        upsert: true
      });

    if (uploadError) {
      throw new Error(`Failed to upload resized image: ${uploadError.message}`);
    }

    // Get public URL with transformation parameters
    const { data: publicUrlData } = supabaseClient
      .storage
      .from(bucketName)
      .getPublicUrl(resizedPath, {
        transform: {
          width: targetWidth,
          height: targetHeight,
          resize: "cover", // This will crop to fit the exact aspect ratio
          quality: 90
        }
      });

    const resizedUrl = publicUrlData.publicUrl;
    console.log(`Resized image URL: ${resizedUrl}`);

    // Update the task with the resized image URL if taskId provided
    if (taskId) {
      const { error: updateError } = await supabaseClient
        .from("tasks")
        .update({
          hero_image_url: resizedUrl,
          hero_image_thinking: supabaseClient.sql`
            hero_image_thinking || jsonb_build_object(
              'resized', true,
              'aspect_ratio', ${aspectRatio},
              'dimensions', ${`${targetWidth}x${targetHeight}`},
              'resized_at', ${new Date().toISOString()}
            )
          `,
          updated_at: new Date().toISOString()
        })
        .eq("task_id", taskId);

      if (updateError) {
        console.error(`Failed to update task: ${updateError.message}`);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        originalUrl: imageUrl,
        resizedUrl: resizedUrl,
        aspectRatio: aspectRatio,
        dimensions: `${targetWidth}x${targetHeight}`,
        taskId: taskId
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );

  } catch (error) {
    console.error("Error resizing image:", error);
    
    return new Response(
      JSON.stringify({
        error: "Failed to resize image",
        details: error.message,
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});