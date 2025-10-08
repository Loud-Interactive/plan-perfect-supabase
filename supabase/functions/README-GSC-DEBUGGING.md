# Google Search Console API Debugging Guide

This guide explains how to use the GSC API debugging tools to diagnose and fix issues with empty or missing GSC data.

## Common GSC API Issues

When working with the Google Search Console API, you might encounter the following common issues:

1. **Empty results**: API calls return successfully but with no data
2. **Permission errors**: The service account lacks access to the GSC property
3. **URL format mismatches**: Using the wrong URL format for a GSC property
4. **No data in the specified date range**: The site has data, but not for the requested dates
5. **API errors**: Various HTTP errors when calling the API

## Using the GSC API Debugger

We've created two specialized tools to help diagnose and fix GSC API issues:

1. **GSC API Debug Function** (`debug-gsc-api`): A Supabase Edge Function that performs comprehensive diagnostics
2. **GSC API Debugger Interface** (`gsc-api-debugger.html`): A web interface for running diagnostics and viewing results

### Running a Diagnostic Test

1. Open `gsc-api-debugger.html` in your browser
2. Enter the site URL you're trying to access (e.g., `sc-domain:example.com` or `https://www.example.com/`)
3. Select a date range
4. Check "Test alternative URL formats" to try common URL patterns
5. Click "Debug GSC API"

The debugger will run a series of tests to identify issues with your GSC API access.

### Understanding the Results

The debugger provides a comprehensive analysis with four key sections:

#### 1. Issues & Recommendations

This tab shows detected problems and specific recommendations to fix them. Common recommendations include:

- Adjusting the URL format to match GSC exactly
- Verifying service account permissions 
- Using different dimension combinations
- Trying broader date ranges

#### 2. Available Sites

Shows all GSC properties your service account can access. Check whether your target site appears in this list.

#### 3. Test Results

Shows detailed results for each test combination, organized by URL format and dimension combination.

#### 4. Raw Data

Shows the complete API response for advanced troubleshooting.

## Common Problems and Solutions

### 1. Wrong URL Format

**Problem:** The URL format used in your API calls doesn't match the exact format in GSC.

**Solution:** 
- For domain properties, use `sc-domain:example.com` (no www, no http://)
- For URL-prefix properties, use the exact format shown in GSC (e.g., `https://www.example.com/`)
- Use the "Suggested URL Formats" from the debugger to find the correct format

### 2. Service Account Permissions

**Problem:** Your service account doesn't have access to the GSC property.

**Solution:**
- Verify the service account email shown in the debugger
- Add this email to GSC with at least "Read & Analyze" permissions
- Wait up to 24 hours for permission changes to propagate

### 3. No Data in Date Range

**Problem:** Your API calls are correctly formatted, but return no data for the specified dates.

**Solution:**
- Use a broader date range (last 30-90 days)
- Remember GSC data may take 2-3 days to appear
- For new sites, it may take weeks before any search data is available

### 4. Dimension Combinations

**Problem:** Some dimension combinations return data while others don't.

**Solution:**
- Use the dimension combinations shown as successful in the debugger
- Try simpler queries with fewer dimensions (e.g., just 'query' instead of 'page,query')
- Remember that not all dimension combinations are valid in GSC API

## Programmatic Debugging

You can also call the debug function programmatically:

```javascript
const response = await fetch('https://your-project.supabase.co/functions/v1/debug-gsc-api', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    siteUrl: 'sc-domain:example.com',
    startDate: '2023-01-01',
    endDate: '2023-01-31',
    testAllFormats: true
  })
});

const data = await response.json();
console.log(data.diagnostics.recommendations);
```

## Updating Your Code

Once you've identified the correct URL format and dimension combinations, update your GSC processing code:

```javascript
// Use the exact URL format from GSC
const siteUrl = 'sc-domain:example.com'; // or the format identified by the debugger

// Use a working dimension combination
const dimensions = ['query']; // or another combination that returned data

// Use a sufficiently broad date range
const startDate = '2023-01-01';
const endDate = '2023-01-31';
```

## Additional Resources

- [Google Search Console API Documentation](https://developers.google.com/webmaster-tools/search-console-api-original/v3/how-tos/search_analytics)
- [GSC API Dimensions Reference](https://developers.google.com/webmaster-tools/search-console-api-original/v3/searchanalytics/query#dimensionFilterGroups.filters.dimension)
- [Google OAuth Service Account Setup](https://developers.google.com/identity/protocols/oauth2/service-account)