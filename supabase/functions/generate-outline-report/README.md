# Generate Outline Report Function

This Supabase Edge Function creates a comprehensive HTML report for an outline generation job.

## Purpose

This function:
1. Retrieves all data related to an outline generation job
2. Compiles search terms, search results, and analyses
3. Formats the generated outline in a user-friendly way
4. Returns a complete HTML report that can be viewed in a browser

## Deployment

```bash
supabase functions deploy generate-outline-report
```

## Environment Variables

Make sure these are set in your Supabase project:
- SUPABASE_URL
- SUPABASE_SERVICE_ROLE_KEY

## Usage

This function returns HTML directly, so you can:

1. Open it in a browser:
```
https://[YOUR-PROJECT-REF].supabase.co/functions/v1/generate-outline-report?job_id=[JOB-ID]
```

2. Or fetch it programmatically:
```javascript
const response = await fetch(
  `https://[YOUR-PROJECT-REF].supabase.co/functions/v1/generate-outline-report?job_id=${jobId}`,
  {
    headers: {
      'Authorization': `Bearer ${supabaseAnonKey}`
    }
  }
);

const htmlReport = await response.text();
// Display or save the HTML report
```

### Request Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| job_id | string | Yes | ID of the job to generate a report for |

### Response

The function returns a complete HTML document that includes:

1. **Header Section**:
   - Post title, keywords, domain
   - Job status and timestamps
   
2. **Search Terms Section**:
   - List of search terms used
   
3. **Search Results Section**:
   - Table of search results with URLs and titles
   
4. **URL Analysis Section**:
   - Detailed breakdown of analyzed URLs
   - Headings structure for each URL
   
5. **Generated Outline Section**:
   - Complete outline with all sections and subheadings
   
The report is styled for easy reading and can be printed or saved as PDF.

## Related Functions

- `generate-outline`: Initiates the outline generation process
- `process-outline-job`: Handles the outline generation workflow
- `get-outline-status`: Checks the status of an outline generation job