# Schema Generation - Deployment Instructions

## 1. Set up environment variables

In the Supabase dashboard, set the following environment variables:

- `GROQ_API_KEY`: Your Groq API key
- `SUPABASE_URL`: `https://jsypctdhynsdqrfifvdh.supabase.co`
- `SUPABASE_SERVICE_ROLE_KEY`: `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpzeXBjdGRoeW5zZHFyZmlmdmRoIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc0MDY5MjAzMiwiZXhwIjoyMDU2MjY4MDMyfQ.19Eds9LcZbb-rwLCpPJsk7kMIa7eTU7wIw_-Yn_iyG8`

## 2. Deploy the Edge Function

```bash
supabase functions deploy generate-schema
```

## 3. Apply the database trigger

Execute the SQL in `schema-generation-trigger.sql` in the Supabase SQL Editor.

## 4. Test the function

Update a task's `live_post_url` field and check if the `schema_data` field gets populated.

## Additional Information

- The Edge Function has a 60-second timeout. For very large articles, you may need to implement a more robust solution.
- If you encounter any issues, check the function logs in the Supabase dashboard.
- The function uses an external service for converting URLs to markdown, which requires an API key that is already hardcoded in the function.