import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  console.log("🔵 Starting insert-content-plan function");
  
  try {
    // Get request body
    const requestBody = await req.json();
    const { 
      guid,
      domain_name,
      keyword,
      content_plan_table,
      content_plan,
      brand_name,
      email 
    } = requestBody;

    console.log(`🔵 Received request with guid: ${guid || "new"}, domain: ${domain_name}, keyword: ${keyword}`);
    console.log(`🔵 Content plan table size: ${content_plan_table ? content_plan_table.length : 0} characters`);
    console.log(`🔵 Content plan JSON provided: ${content_plan ? "yes" : "no"}`);
    console.log(`🔵 Brand name: ${brand_name || "not provided"}, Email: ${email || "not provided"}`);

    // Create Supabase client
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    
    if (!supabaseUrl || !supabaseServiceKey) {
      console.error("❌ Missing Supabase URL or service key");
      throw new Error("Server configuration error: Missing Supabase credentials");
    }
    
    console.log(`🔵 Initializing Supabase client with URL: ${supabaseUrl}`);
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Validate input
    if (!domain_name) {
      console.error("❌ Missing domain_name in request");
      throw new Error("Missing required field: domain_name");
    }
    
    if (!content_plan && !content_plan_table) {
      console.error("❌ Missing both content_plan and content_plan_table in request");
      throw new Error("Missing required field: either content_plan or content_plan_table must be provided");
    }

    let contentPlanItems: any[] = [];
    let contentPlanJson: string;
    
    // Option 1: Direct JSON provided (from LLM)
    if (content_plan) {
      console.log("🔵 Using provided content_plan JSON");
      try {
        // If content_plan is a string, try to parse it as JSON
        if (typeof content_plan === 'string') {
          contentPlanItems = JSON.parse(content_plan);
          console.log(`🔵 Successfully parsed content_plan string into JSON with ${contentPlanItems.length} items`);
        } 
        // If content_plan is already an array, use it directly
        else if (Array.isArray(content_plan)) {
          contentPlanItems = content_plan;
          console.log(`🔵 Using provided content_plan array with ${contentPlanItems.length} items`);
        } 
        else {
          console.error("❌ content_plan is neither a JSON string nor an array");
          throw new Error("Invalid content_plan format: must be a JSON string or array");
        }
        
        // Verify the required fields in each item
        for (let i = 0; i < contentPlanItems.length; i++) {
          const item = contentPlanItems[i];
          if (!item["Hub Number"] || !item["Post Title"] || !item["Keyword"]) {
            console.warn(`⚠️ Item ${i} is missing required fields: ${JSON.stringify(item)}`);
          }
          
          // Ensure guid field exists (set to null if missing)
          if (!item.hasOwnProperty("guid")) {
            item.guid = null;
          }
        }
      } catch (jsonError) {
        console.error(`❌ Error parsing content_plan JSON: ${jsonError.message}`);
        throw new Error(`Invalid JSON in content_plan: ${jsonError.message}`);
      }
    }
    // Option 2: Markdown table provided
    else if (content_plan_table) {
      console.log("🔵 Parsing content plan table into JSON array");
      const rows = content_plan_table.trim().split('\n');
      
      // Find header row and separator row
      let headerRowIndex = -1;
      let separatorRowIndex = -1;
      
      for (let i = 0; i < Math.min(5, rows.length); i++) {
        if (rows[i].includes("Hub Number") && rows[i].includes("Spoke Number") && rows[i].includes("Post Title")) {
          headerRowIndex = i;
        } else if (rows[i].includes("---") && rows[i].includes("|")) {
          separatorRowIndex = i;
        }
      }
      
      if (headerRowIndex === -1) {
        console.error("❌ Could not find header row in content plan table");
        throw new Error("Invalid content plan table format: Missing header row");
      }
      
      // Determine start index - either after separator row, or 2 rows after header
      const startIndex = (separatorRowIndex !== -1) ? separatorRowIndex + 1 : headerRowIndex + 2;
      console.log(`🔵 Starting to parse from row ${startIndex} (header at ${headerRowIndex}, separator at ${separatorRowIndex})`);
      
      let parsedRows = 0;

      for (let i = startIndex; i < rows.length; i++) {
        const row = rows[i].trim();
        if (!row || row.length < 10) continue; // Skip empty or very short rows
        
        const cells = row.split('|').map(cell => cell.trim());
        console.log(`🔵 Parsing row ${i}, found ${cells.length} cells`);
        
        if (cells.length >= 9) {
          try {
            const item = {
              "Hub Number": cells[1],
              "Spoke Number": cells[2],
              "Post Title": cells[3],
              "Keyword": cells[4],
              "URL Slug": cells[5],
              "CPC": cells[6],
              "Difficulty": cells[7],
              "Volume": cells[8],
              "guid": null
            };
            
            contentPlanItems.push(item);
            parsedRows++;
          } catch (parseError) {
            console.error(`❌ Error parsing row ${i}: ${parseError.message}`);
            console.error(`Row content: ${row}`);
          }
        } else {
          console.warn(`⚠️ Row ${i} has insufficient cells (${cells.length}): ${row}`);
        }
      }

      console.log(`🔵 Successfully parsed ${parsedRows} content plan items from table`);
    }
    
    if (contentPlanItems.length === 0) {
      console.error("❌ Failed to parse any content plan items");
      throw new Error("Failed to parse content plan, no valid items found");
    }

    // Convert contentPlanItems to JSON string
    contentPlanJson = JSON.stringify(contentPlanItems);
    console.log(`🔵 Final content_plan JSON of size ${contentPlanJson.length} characters with ${contentPlanItems.length} items`);

    // Store the content plan
    let result;
    console.log(`🔵 ${guid ? "Updating" : "Inserting"} content plan in database`);
    
    if (guid) {
      // First check if record exists
      console.log(`🔵 Checking if content plan with guid: ${guid} exists`);
      const { data: existingData, error: checkError } = await supabase
        .from("content_plans")
        .select("guid")
        .eq("guid", guid)
        .maybeSingle();
      
      if (checkError) {
        console.error(`❌ Error checking if content plan exists: ${checkError.message}`, checkError);
      }
      
      console.log(`🔵 Check result:`, existingData);
      
      if (!existingData) {
        // Record doesn't exist, so we'll insert it with the provided guid
        console.log(`🔵 Content plan with guid ${guid} doesn't exist, inserting new record`);
        
        // Use upsert to either insert or update
        const { data, error } = await supabase
          .from("content_plans")
          .upsert({
            guid,
            domain_name,
            keyword,
            content_plan: contentPlanJson,
            content_plan_table,
            timestamp: new Date().toISOString(),
            email
          }, { onConflict: 'guid' })
          .select();
        
        if (error) {
          console.error(`❌ Error upserting content plan: ${error.message}`, error);
          throw new Error(`Database error: ${error.message}`);
        }
        
        console.log(`🔵 Upsert successful, returned data:`, data);
        result = { data, error };
      } else {
        // Record exists, update it
        console.log(`🔵 Updating existing content plan with guid: ${guid}`);
        const { data, error } = await supabase
          .from("content_plans")
          .update({
            domain_name,
            keyword,
            content_plan: contentPlanJson,
            content_plan_table,
            timestamp: new Date().toISOString()
          })
          .eq("guid", guid)
          .select();
        
        if (error) {
          console.error(`❌ Error updating content plan: ${error.message}`, error);
          throw new Error(`Database error: ${error.message}`);
        }
        
        console.log(`🔵 Update successful, returned data:`, data);
        result = { data, error };
      }
    } else {
      // Insert new content plan
      console.log(`🔵 Inserting new content plan`);
      const { data, error } = await supabase
        .from("content_plans")
        .insert({
          domain_name,
          keyword,
          content_plan: contentPlanJson,
          content_plan_table,
          timestamp: new Date().toISOString(),
          email
        })
        .select();
      
      if (error) {
        console.error(`❌ Error inserting content plan: ${error.message}`, error);
        throw new Error(`Database error: ${error.message}`);
      }
      
      console.log(`🔵 Insert successful, returned data:`, data);
      result = { data, error };
    }

    // Also store in incoming_plan_items if brand_name is provided
    if (brand_name && result.data && result.data[0]) {
      const planGuid = result.data[0].guid;
      console.log(`🔵 Adding to incoming_plan_items with guid: ${planGuid}`);
      
      const { data: incomingPlanData, error: incomingPlanError } = await supabase
        .from("incoming_plan_items")
        .upsert({
          guid: planGuid,
          domain_name,
          brand_name,
          target_keyword: keyword,
          email,
          status: "Finished",
          timestamp: new Date().toISOString()
        })
        .select();
      
      if (incomingPlanError) {
        console.error(`❌ Error inserting incoming_plan_items: ${incomingPlanError.message}`, incomingPlanError);
      } else {
        console.log("🔵 Successfully added to incoming_plan_items");
      }
    }
    
    // Insert content plan items into content_plan_items table
    if (result.data && result.data[0]) {
      const contentPlanId = result.data[0].guid;
      console.log(`🔵 Inserting ${contentPlanItems.length} items into content_plan_items table for plan ${contentPlanId}`);
      
      // Create a batch of inserts for all content plan items
      const contentPlanItemsInserts = contentPlanItems.map(item => {
        // Clean up values to ensure they're in the correct format
        const cleanCpc = typeof item.CPC === 'string' ? item.CPC.replace(/^\$/, '') : item.CPC;
        const cleanSlug = typeof item["URL Slug"] === 'string' ? item["URL Slug"].replace(/^\//, '') : item["URL Slug"];
        
        return {
          // No need to include id - PostgreSQL will generate one automatically
          content_plan_id: contentPlanId,
          hub_number: item["Hub Number"],
          spoke_number: item["Spoke Number"] || null, // Handle empty spoke numbers
          post_title: item["Post Title"],
          keyword: item["Keyword"],
          url_slug: cleanSlug,
          cpc: cleanCpc,
          difficulty: item["Difficulty"],
          volume: item["Volume"],
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        };
      });
      
      // Use a transaction to ensure all inserts succeed or fail together
      if (contentPlanItemsInserts.length > 0) {
        console.log(`🔵 Prepared ${contentPlanItemsInserts.length} items for insertion`);
        
        try {
          // Delete existing items for this content plan to avoid duplicates
          const { error: deleteError } = await supabase
            .from("content_plan_items")
            .delete()
            .eq("content_plan_id", contentPlanId);
            
          if (deleteError) {
            console.error(`❌ Error deleting existing content plan items: ${deleteError.message}`, deleteError);
          } else {
            console.log(`🔵 Successfully deleted existing content plan items for plan ${contentPlanId}`);
          }
          
          // Insert all new items
          const { data: insertedItems, error: insertError } = await supabase
            .from("content_plan_items")
            .insert(contentPlanItemsInserts)
            .select();
            
          if (insertError) {
            console.error(`❌ Error inserting content plan items: ${insertError.message}`, insertError);
          } else {
            console.log(`🔵 Successfully inserted ${insertedItems?.length || 0} content plan items`);
          }
        } catch (transactionError) {
          console.error(`❌ Transaction error: ${transactionError.message}`, transactionError);
        }
      }
    }

    console.log("🔵 Operation completed successfully");
    return new Response(
      JSON.stringify(result),
      { 
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200 
      }
    );
  } catch (error) {
    console.error(`❌ Error processing request: ${error.message}`, error);
    
    return new Response(
      JSON.stringify({ error: error.message, stack: error.stack }),
      { 
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400
      }
    );
  }
});