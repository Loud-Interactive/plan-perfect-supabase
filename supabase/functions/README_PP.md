# Preferences Perfect API

This directory contains the Supabase Edge Functions that implement the Preferences Perfect API, which provides a flexible key-value storage mechanism for domain-specific preferences.

## Directory Structure

The API is structured as follows:

- `helpers.ts` - Shared utility functions for domain normalization, boolean conversion, etc.
- Function directories (following the project convention):
  - `pp-create-pairs/` - Create/update pairs for a domain
  - `pp-get-guid/` - Get GUID for a domain
  - `pp-get-pairs/` - Get all key-value pairs for a domain
  - `pp-get-all-pairs/` - Get all pairs including historical data
  - `pp-get-pairs-by-guid/` - Get pairs for a specific domain and GUID
  - `pp-update-pair/` - Update a specific key-value pair
  - `pp-update-pairs/` - Update multiple pairs at once
  - `pp-get-specific-pairs/` - Get specific keys for a domain
  - `pp-patch-pairs/` - Update pairs for a domain without specifying GUID
- Supporting files:
  - `PP_DEPLOYMENT.md` - Deployment instructions
  - `pp-test.sh` - Test script for testing the API

## Features

- Store and retrieve key-value pairs associated with domains
- Automatic domain normalization to prevent duplicates
- Support for boolean value conversion
- View history of preference changes
- Row-level security with public read-only access and authenticated write access
- Comprehensive error handling and reporting

## Database Schema

The API uses the following database schema:

- `pairs` table for storing key-value pairs
- `latest_pairs` view for retrieving only the most recent values
- `pairs_history` table for tracking changes (optional)

The database schema is defined in `/migrations/20250410_preferences_perfect_tables.sql`.

## Deployment

See `PP_DEPLOYMENT.md` for detailed deployment instructions.

## Authentication

- All operations are accessible without authentication
- No JWT token is required for any endpoint
- All endpoints use the service role key internally
- Note: If you need to restrict write access, you can modify the endpoints to check for authorization headers

## Testing

A test script `pp-test.sh` is provided to verify that the API is working correctly. 

To run the tests:

```bash
./pp-test.sh <supabase-url> <supabase-anon-key> [jwt-token]
```

## API Documentation

### Public Endpoints (No Authentication Required)

- `GET /pp-get-guid/{domain}` - Get GUID for a domain
- `GET /pp-get-pairs/{domain}` - Get all pairs for a domain
- `POST /pp-get-specific-pairs/{domain}/keys` - Get specific keys

### Authenticated Endpoints (Authentication Required)

- `POST /pp-create-pairs` - Create/update pairs
- `GET /pp-get-all-pairs/{domain}` - Get all pairs including history
- `GET /pp-get-pairs-by-guid/{domain}/{guid}` - Get pairs by domain and GUID
- `PUT /pp-update-pair/{domain}/{guid}/{key}` - Update a specific pair
- `PUT /pp-update-pairs/{domain}/{guid}` - Update multiple pairs
- `PATCH /pp-patch-pairs/{domain}` - Update pairs without specifying GUID