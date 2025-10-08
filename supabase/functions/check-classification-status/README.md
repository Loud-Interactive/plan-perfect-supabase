# Check Classification Status Edge Function

This Supabase Edge Function checks the status of one or more keyword classification jobs and provides detailed progress information.

## Features

- Check status of a specific job by ID
- List all jobs for a user
- Provides progress information (completed batches, keywords processed)
- Calculates estimated time remaining to completion
- Admin support for checking jobs of other users

## Usage

### Request Format

This is a GET endpoint with the following query parameters:

- `jobId` (optional): UUID of a specific classification job to check
- `userId` (optional, admin only): Check jobs for a specific user (requires admin privileges)

Examples:
```
/functions/v1/check-classification-status?jobId=123e4567-e89b-12d3-a456-426614174000
/functions/v1/check-classification-status
```

### Authentication

This endpoint requires a valid JWT token in the Authorization header:

```
Authorization: Bearer your-jwt-token
```

### Response Format (specific job)

```json
{
  "data": {
    "id": "123e4567-e89b-12d3-a456-426614174000",
    "domain": "example.com",
    "status": "processing",
    "progress": 45,
    "batch_size": 50,
    "current_batch": 23,
    "total_batches": 500,
    "created_at": "2025-05-21T12:34:56.789Z",
    "updated_at": "2025-05-21T13:45:12.345Z",
    "last_processed_at": "2025-05-21T13:45:12.345Z",
    "error": null,
    "metadata": {},
    "resultsCount": 1150,
    "estimatedTimeRemaining": "About 2 hours"
  },
  "timestamp": "2025-05-21T13:45:15.123Z"
}
```

### Response Format (all jobs)

```json
{
  "data": [
    {
      "id": "123e4567-e89b-12d3-a456-426614174000",
      "domain": "example.com",
      "status": "processing",
      "progress": 45,
      "batch_size": 50,
      "current_batch": 23,
      "total_batches": 500,
      "created_at": "2025-05-21T12:34:56.789Z",
      "updated_at": "2025-05-21T13:45:12.345Z",
      "last_processed_at": "2025-05-21T13:45:12.345Z",
      "error": null,
      "metadata": {},
      "resultsCount": 1150,
      "estimatedTimeRemaining": "About 2 hours"
    },
    {
      "id": "234f6789-e89b-12d3-a456-426614174000",
      "domain": "anothersite.com",
      "status": "completed",
      "progress": 100,
      "batch_size": 50,
      "current_batch": 100,
      "total_batches": 100,
      "created_at": "2025-05-20T15:30:45.123Z",
      "updated_at": "2025-05-20T16:15:23.456Z",
      "last_processed_at": "2025-05-20T16:15:23.456Z",
      "error": null,
      "metadata": {},
      "resultsCount": 5000,
      "estimatedTimeRemaining": "N/A"
    }
  ],
  "timestamp": "2025-05-21T13:45:15.123Z"
}
```

## Deployment

Deploy this function using the Supabase CLI:

```bash
supabase functions deploy check-classification-status
```

## Admin Functionality

Administrators can check the status of jobs for any user by including the `userId` parameter. The function checks if the current user has admin privileges before allowing access to other users' jobs.

To enable this functionality, you need to create a database function to check admin roles:

```sql
CREATE OR REPLACE FUNCTION check_admin_role(user_uuid UUID)
RETURNS TABLE(is_admin BOOLEAN) AS $$
BEGIN
  -- This is a simplified example - implement your own admin role checking logic
  RETURN QUERY
  SELECT EXISTS (
    SELECT 1 FROM auth.users
    WHERE id = user_uuid
    AND raw_app_meta_data->>'role' = 'admin'
  );
END;
$$ LANGUAGE plpgsql;