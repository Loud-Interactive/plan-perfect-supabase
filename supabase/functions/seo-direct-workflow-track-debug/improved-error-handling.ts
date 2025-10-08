// Improved error handling for SEO elements generation with retry logic

// Helper function to retry edge function calls
async function callEdgeFunctionWithRetry(
  url: string,
  body: any,
  headers: any,
  maxRetries: number = 3,
  initialDelay: number = 1000
): Promise<Response | null> {
  let lastError: Error | null = null;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`Debug: Attempt ${attempt}/${maxRetries} calling ${url}`);
      
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body)
      });
      
      // Check for boot errors specifically
      if (response.status === 503) {
        const responseText = await response.text();
        if (responseText.includes('BOOT_ERROR')) {
          console.error(`Debug: Edge function boot error on attempt ${attempt}: ${responseText}`);
          
          // For boot errors, wait longer between retries
          if (attempt < maxRetries) {
            const delay = initialDelay * Math.pow(2, attempt - 1) * 2; // Double the delay for boot errors
            console.log(`Debug: Waiting ${delay}ms before retry due to boot error...`);
            await new Promise(resolve => setTimeout(resolve, delay));
            continue;
          }
        }
      }
      
      // If we get here, return the response (whether successful or not)
      return response;
      
    } catch (error) {
      lastError = error as Error;
      console.error(`Debug: Network error on attempt ${attempt}: ${lastError.message}`);
      
      if (attempt < maxRetries) {
        const delay = initialDelay * Math.pow(2, attempt - 1);
        console.log(`Debug: Waiting ${delay}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  console.error(`Debug: All ${maxRetries} attempts failed. Last error: ${lastError?.message}`);
  return null;
}

// Replace the SEO elements generation section (lines 650-698) with:
    // Step 5: Generate SEO elements with retry logic
    console.log(`Debug: Generating SEO elements for ${page.url}`);
    
    try {
      let success = false;
      let elementsResponse = null;
      
      try {
        // Call generate-seo-elements-ds function with retry logic
        elementsResponse = await callEdgeFunctionWithRetry(
          `${SUPABASE_URL}/functions/v1/generate-seo-elements-ds`,
          {
            pageId: page.id,
            url: page.url
          },
          {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${SUPABASE_KEY}`
          },
          3, // max retries
          2000 // initial delay of 2 seconds
        );
        
        if (elementsResponse) {
          let elementsResponseText = '';
          try {
            elementsResponseText = await elementsResponse.text();
            console.log(`Debug: SEO elements response status: ${elementsResponse.status}`);
            console.log(`Debug: SEO elements response preview: ${elementsResponseText.substring(0, 200)}...`);
          } catch (textError) {
            console.error(`Debug: Error getting elements response text: ${textError.message}`);
          }
          
          if (elementsResponse.ok) {
            console.log(`Debug: Successfully generated SEO elements for ${page.url}`);
            
            try {
              const elementsResult = JSON.parse(elementsResponseText);
              
              if (elementsResult.success && elementsResult.seoElements) {
                console.log(`Debug: Generated SEO elements: Title=${elementsResult.seoElements.title?.substring(0, 30)}..., H1=${elementsResult.seoElements.h1?.substring(0, 30)}...`);
                success = true;
                seoSuccess = true;
              } else {
                console.error(`Debug: SEO elements returned success=false or missing data: ${JSON.stringify(elementsResult)}`);
              }
            } catch (parseError) {
              console.error(`Debug: Error parsing SEO elements response: ${parseError.message}`);
            }
          } else {
            // Log the specific error
            if (elementsResponse.status === 503) {
              console.error(`Debug: SEO service temporarily unavailable (503). Response: ${elementsResponseText}`);
              errorMessage = 'SEO service temporarily unavailable - will use placeholder content';
            } else {
              console.error(`Debug: SEO elements generation failed: ${elementsResponse.status} ${elementsResponse.statusText} - ${elementsResponseText}`);
              errorMessage = `SEO generation failed with status ${elementsResponse.status}`;
            }
          }
        } else {
          console.error(`Debug: Failed to connect to SEO elements service after all retries`);
          errorMessage = 'Could not connect to SEO generation service';
        }
      } catch (apiError) {
        console.error(`Debug: API call exception for SEO elements: ${apiError.message}`);
        errorMessage = `SEO generation error: ${apiError.message}`;
      }
      
      // Always ensure we have SEO content, even if it's placeholder
      if (!success) {
        console.log(`Debug: Using fallback placeholder SEO content for ${page.url}`);
        // The existing fallback code continues here...