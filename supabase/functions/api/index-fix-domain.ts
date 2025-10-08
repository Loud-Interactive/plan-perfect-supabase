// Patch for the API to handle 'domain' field and convert it to 'client_domain'
// This is a temporary fix - the client should be updated to use 'client_domain'

// Add this transformation before the validFields check (around line 360)
// This code snippet should be inserted into the existing API index.ts file

// Transform 'domain' to 'client_domain' for backward compatibility
if (requestBody.domain && !requestBody.client_domain) {
  requestBody.client_domain = requestBody.domain;
  delete requestBody.domain;
  console.log('Transformed domain field to client_domain for backward compatibility');
}

// The rest of the existing code continues...