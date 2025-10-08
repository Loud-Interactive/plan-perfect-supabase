// Fixed version - Replace lines 708-730 with this code:

        // Check if record exists first
        const { data: existingRec, error: checkError } = await supabase
          .from('page_seo_recommendations')
          .select('id')
          .eq('page_id', page.id)
          .single();
        
        const seoData = {
          page_id: page.id,
          url: page.url,
          title: `${path ? path.replace(/-/g, ' ') : 'Products'} | ${domain}`,
          meta_description: `Explore ${path ? path.replace(/-/g, ' ') : 'our products'} at ${domain}. Find great deals on ${urlObj.pathname.split('/').pop()?.replace(/-/g, ' ') || 'items'}.`,
          h1: `${path ? path.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') : 'Products'}`,
          h2: `Explore Our ${urlObj.pathname.split('/').pop()?.replace(/-/g, ' ').split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') || 'Collection'}`,
          paragraph: `Browse our selection of ${path ? path.replace(/-/g, ' ') : 'products'} designed to meet your needs. We offer quality items at competitive prices, with options for every preference and budget.`,
          updated_at: new Date().toISOString()
        };
        
        if (!checkError && existingRec) {
          // Update existing record
          console.log(`Debug: Updating existing SEO record for page ${page.id}`);
          const { error: updateError } = await supabase
            .from('page_seo_recommendations')
            .update(seoData)
            .eq('page_id', page.id);
            
          if (updateError) {
            console.error(`Debug: Error updating SEO elements: ${updateError.message}`);
          } else {
            console.log(`Debug: Successfully updated placeholder SEO elements for ${page.url}`);
          }
        } else {
          // Insert new record
          console.log(`Debug: Inserting new SEO record for page ${page.id}`);
          const { error: insertError } = await supabase
            .from('page_seo_recommendations')
            .insert(seoData);
            
          if (insertError) {
            console.error(`Debug: Error inserting SEO elements: ${insertError.message}`);
          } else {
            console.log(`Debug: Successfully inserted placeholder SEO elements for ${page.url}`);
          }
        }