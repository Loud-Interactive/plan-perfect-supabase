# Update Plan Status

This edge function allows updating the status of a content plan by adding a new record to the `content_plan_statuses` table.

## Functionality

The function takes a `plan_guid` and a `status` string, then inserts a new record into the `content_plan_statuses` table with the current timestamp.

## API Endpoint

`POST /functions/v1/update-plan-status`

## Request Body

```json
{
  "plan_guid": "8e8965d2-3b3a-48a1-8986-9f789547233e",
  "status": "Processing Complete"
}
```

## Response

### Success Response (200 OK)

```json
{
  "success": true,
  "message": "Status for plan 8e8965d2-3b3a-48a1-8986-9f789547233e updated to \"Processing Complete\"",
  "data": [
    {
      "id": 1520,
      "plan_guid": "8e8965d2-3b3a-48a1-8986-9f789547233e",
      "status": "Processing Complete",
      "timestamp": "2025-04-04 15:30:48.123456+00"
    }
  ]
}
```

### Error Responses

#### Missing Required Fields (400 Bad Request)

```json
{
  "error": "Missing required fields: plan_guid and status are required"
}
```

#### Server Error (500 Internal Server Error)

```json
{
  "error": "An unexpected error occurred: [error message]"
}
```

## Usage Example

```javascript
// Example using fetch
const response = await fetch('https://your-project.supabase.co/functions/v1/update-plan-status', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer your-anon-key-or-service-role-key'
  },
  body: JSON.stringify({
    plan_guid: '8e8965d2-3b3a-48a1-8986-9f789547233e',
    status: 'Processing Complete'
  })
});

const data = await response.json();
console.log(data);
```