# Process All Content Plans

This one-time utility function will process all existing content plans in your database that have content_plan_table data.

## What It Does

1. Fetches all content plans that have content_plan_table data
2. Calls the process-content-plan function for each one
3. Returns a summary of successful processing and any errors encountered

## Deployment

Deploy this function to your Supabase project:

```bash
# Navigate to the functions directory
cd supabase/functions

# Deploy the function
supabase functions deploy process-all-content-plans --project-ref your-project-ref
```

## Running the Migration

After deployment, you can run the function to process all content plans. This is a one-time operation for data migration.

```bash
# Using curl
curl -X POST 'https://your-project-ref.supabase.co/functions/v1/process-all-content-plans' \
  -H 'Authorization: Bearer your-anon-key'
```

Or you can invoke it from the browser (requires authentication):

1. Go to Supabase Dashboard > Edge Functions
2. Find "process-all-content-plans" and click "Invoke"

## Important Notes

- This is a long-running operation if you have many content plans
- The function includes a small delay (500ms) between processing each record to avoid rate limits
- For very large datasets, consider modifying the function to process in batches 