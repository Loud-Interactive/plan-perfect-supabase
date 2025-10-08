# Preferences Perfect API - Deployment Guide

This document outlines the steps to deploy the Preferences Perfect API to your Supabase project.

## Prerequisites

1. Supabase CLI installed
2. Access to your Supabase project
3. Database access for running migrations

## Step 1: Run Database Migrations

Apply the database schema by running the SQL migration:

```bash
# Using Supabase CLI
supabase db diff --use-migra -f 20250410_preferences_perfect_tables

# Alternative: Run the SQL script manually in the SQL Editor
# Copy the contents of /migrations/20250410_preferences_perfect_tables.sql
# and execute it in the Supabase SQL Editor
```

## Step 2: Deploy Helper Functions

Deploy the shared helper functions:

```bash
supabase functions deploy helpers
```

Note: The helpers function contains shared utility functions used by all other PP API functions.

## Step 3: Deploy the API Edge Functions

Deploy all the API endpoints:

```bash
# Deploy each endpoint individually
supabase functions deploy pp-create-pairs
supabase functions deploy pp-get-guid
supabase functions deploy pp-get-pairs
supabase functions deploy pp-get-all-pairs
supabase functions deploy pp-get-pairs-by-guid
supabase functions deploy pp-update-pair
supabase functions deploy pp-update-pairs
supabase functions deploy pp-get-specific-pairs
supabase functions deploy pp-patch-pairs
```

## Step 4: Verify Deployment

Test the API endpoints to ensure they're working correctly:

```bash
# Test read-only endpoint
curl -X GET "https://<your-project-ref>.supabase.co/functions/v1/pp-get-pairs/example.com"

# Test authenticated endpoint (requires a valid JWT token)
curl -X POST \
  -H "Authorization: Bearer <your-jwt-token>" \
  -H "Content-Type: application/json" \
  -d '{"domain": "example.com", "key_value_pairs": {"test": "value"}}' \
  "https://<your-project-ref>.supabase.co/functions/v1/pp-create-pairs"
```

## Endpoint URLs

Once deployed, your API endpoints will be available at:

- `https://<your-project-ref>.supabase.co/functions/v1/pp-create-pairs`
- `https://<your-project-ref>.supabase.co/functions/v1/pp-get-guid/<domain>`
- `https://<your-project-ref>.supabase.co/functions/v1/pp-get-pairs/<domain>`
- `https://<your-project-ref>.supabase.co/functions/v1/pp-get-all-pairs/<domain>`
- `https://<your-project-ref>.supabase.co/functions/v1/pp-get-pairs-by-guid/<domain>/<guid>`
- `https://<your-project-ref>.supabase.co/functions/v1/pp-update-pair/<domain>/<guid>/<key>`
- `https://<your-project-ref>.supabase.co/functions/v1/pp-update-pairs/<domain>/<guid>`
- `https://<your-project-ref>.supabase.co/functions/v1/pp-get-specific-pairs/<domain>/keys`
- `https://<your-project-ref>.supabase.co/functions/v1/pp-patch-pairs/<domain>`

## Step 5: Set Up Access Policies (Optional)

If you need to customize the Row Level Security policies, you can do so in the Supabase Dashboard:

1. Go to the Authentication > Policies section
2. Select the `pairs` table
3. Customize the existing policies or add new ones

## Troubleshooting

If you encounter issues during deployment:

1. Check Supabase function logs:
   ```bash
   supabase functions logs
   ```

2. Verify database migration was applied correctly:
   ```bash
   # List tables to verify pairs table exists
   SELECT table_name FROM information_schema.tables WHERE table_schema = 'public';
   
   # Check view
   SELECT * FROM information_schema.views WHERE table_name = 'latest_pairs';
   ```

3. Test RLS policies:
   ```sql
   -- Test unauthenticated access to pairs table
   SET LOCAL ROLE anon;
   SELECT * FROM pairs WHERE domain = 'example.com';
   
   -- Test authenticated access
   SET LOCAL ROLE authenticated;
   INSERT INTO pairs (domain, guid, key, value) 
   VALUES ('test.com', uuid_generate_v4(), 'test_key', 'test_value');
   ```

## Environment Variables

The edge functions rely on the following environment variables, which should be automatically set in your Supabase project:

- `SUPABASE_URL`: Your Supabase project URL
- `SUPABASE_ANON_KEY`: Your Supabase anonymous key

## Updating the API

To update the API after making changes:

1. Make your changes to the relevant files
2. Re-deploy the affected functions:
   ```bash
   supabase functions deploy <function-name>
   ```

## Security Considerations

- The API implements Row Level Security to control access
- Read-only endpoints are accessible without authentication
- Write operations require authentication
- Consider adding rate limiting for production deployments

## Testing

A test script is provided that you can use to test the API after deployment:

```bash
chmod +x pp-test.sh
./pp-test.sh <supabase-url> <supabase-anon-key> [jwt-token]
```

This will run a series of tests against your deployed API to verify that it's working correctly.