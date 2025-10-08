# Bulk HTML Processor: Quick Deployment Guide

This guide covers the steps to deploy and use the Bulk HTML Processor system.

## Step 1: Deploy the Edge Function

First, set up the Edge Function that will process HTML content:

```bash
# Create the function directory
mkdir -p supabase/functions/process-direct-html

# Copy the provided process-direct-html-code.ts file to index.ts
cp supabase/functions/process-direct-html-code.ts supabase/functions/process-direct-html/index.ts

# Deploy the function
cd supabase
supabase functions deploy process-direct-html --no-verify-jwt
```

## Step 2: Access the UI

The Bulk HTML Processor UI is ready to use! You can access it in any of these ways:

1. **Open directly in a browser**: 
   - Simply open the `bulk-html-processor.html` file in your browser

2. **Host on a local server**:
   ```bash
   # Using Python's built-in HTTP server
   python -m http.server 8000
   # Then access: http://localhost:8000/bulk-html-processor.html
   ```

3. **Host in Supabase Storage**:
   - Upload the HTML file to your Supabase storage bucket
   - Make the bucket public or generate a signed URL

## Step 3: Process HTML in Bulk

1. Open the UI in your browser
2. Prepare a CSV file with columns for URLs and target keywords
3. Upload the CSV and configure column mappings
4. Set the concurrent processing limit (5-10 recommended)
5. Click "Start Processing"
6. View results and export as needed

## Troubleshooting

- **CORS Issues**: If you encounter CORS errors fetching HTML, use the CORS proxy field
- **Rate Limiting**: If sites block requests, reduce concurrent threads and add delays
- **Large Files**: For CSV files with thousands of URLs, process in smaller batches

## Example CSV Format

```
url,keyword
https://example.com/page1,seo optimization
https://example.com/page2,content marketing
```

## Customization

To modify the analysis algorithm, edit the Edge Function code. Key areas to customize:

- Scoring algorithms in `calculateOverallScore()`
- Recommendation generation in `generateRecommendations()`
- Keyword extraction in `extractTopKeywords()`

## Next Steps

For more advanced usage:
- Integrate with database storage
- Add authentication to the Edge Function
- Implement custom scoring algorithms
- Add visualization dashboards