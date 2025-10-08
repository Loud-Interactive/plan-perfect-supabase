# Content Plan Processing Edge Function

This Supabase Edge Function processes content plan tables (in markdown format) by sending them to OpenAI and saving the resulting JSON back to the database.

## What It Does

1. Gets triggered when `content_plans.content_plan_table` is updated
2. Sends the markdown content to OpenAI for processing
3. Extracts the JSON result from within `<answer>` tags
4. Updates the `content_plans.content_plan` field with the processed JSON

## Deployment

Deploy this function to your Supabase project:

```bash
# Navigate to the functions directory
cd supabase/functions

# Deploy the function
supabase functions deploy process-content-plan --project-ref your-project-ref
```

Then apply the SQL trigger:

```bash
# Run the SQL file to set up the trigger
psql -h your-db-host -U your-username -d your-database -f ../content-plan-trigger.sql
```

## Environment Variables

Make sure the following environment variables are set in your Supabase project:

- `OPENAI_API_KEY`: Your OpenAI API key
- `SUPABASE_URL`: Your Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY`: Your Supabase service role key

You can set these using the Supabase CLI:

```bash
supabase secrets set OPENAI_API_KEY=your-openai-api-key --project-ref your-project-ref
```

## Testing

To test the function manually, you can invoke it with:

```bash
curl -X POST 'https://your-project-ref.supabase.co/functions/v1/process-content-plan' \
  -H 'Authorization: Bearer your-anon-key' \
  -H 'Content-Type: application/json' \
  -d '{"content_plan_id": 123}'
``` 