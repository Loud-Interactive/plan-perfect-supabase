// Google Auth for Supabase Edge Functions
// Uses WebCrypto APIs to generate JWT tokens for Google API service account authentication

/**
 * Generates a Google API access token from service account credentials.
 * @param {Object} credentials - Service account JSON credentials
 * @param {Array<string>} scopes - API scopes to request
 * @returns {Promise<string>} Access token
 */
export async function getGoogleAccessToken(credentials, scopes = ['https://www.googleapis.com/auth/webmasters.readonly']) {
  if (!credentials.client_email || !credentials.private_key) {
    throw new Error('Invalid service account credentials. Missing client_email or private_key.');
  }

  console.log(`Generating access token for service account: ${credentials.client_email}`);
  
  // Create JWT header
  const header = {
    alg: 'RS256',
    typ: 'JWT'
  };

  // Current time in seconds
  const now = Math.floor(Date.now() / 1000);
  
  // Create JWT claim set
  const claimSet = {
    iss: credentials.client_email,
    scope: scopes.join(' '),
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600, // 1 hour expiration
    iat: now
  };

  // Convert objects to base64url encoded strings
  const base64Header = btoa(JSON.stringify(header))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
    
  const base64ClaimSet = btoa(JSON.stringify(claimSet))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  
  // Concatenate header and claim set
  const base64HeaderAndClaimSet = `${base64Header}.${base64ClaimSet}`;
  
  // Prepare the private key for crypto operation
  // Strip PEM header/footer and whitespace
  const pem = credentials.private_key
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\s+/g, '');
  
  // Convert base64 to binary
  const binaryDer = base64ToBinary(pem);
  
  // Import the key
  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    binaryDer,
    {
      name: 'RSASSA-PKCS1-v1_5',
      hash: 'SHA-256'
    },
    false,
    ['sign']
  );
  
  // Sign the JWT
  const textEncoder = new TextEncoder();
  const signatureBuffer = await crypto.subtle.sign(
    { name: 'RSASSA-PKCS1-v1_5' },
    cryptoKey,
    textEncoder.encode(base64HeaderAndClaimSet)
  );
  
  // Convert signature to base64url
  const signatureArray = Array.from(new Uint8Array(signatureBuffer));
  const base64Signature = btoa(String.fromCharCode.apply(null, signatureArray))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  
  // Create the full JWT
  const jwt = `${base64HeaderAndClaimSet}.${base64Signature}`;
  
  // Exchange JWT for access token
  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt
    })
  });
  
  if (!tokenResponse.ok) {
    const errorText = await tokenResponse.text();
    console.error('Token exchange error:', errorText);
    throw new Error(`Failed to exchange JWT for access token: ${tokenResponse.status} ${errorText}`);
  }
  
  const tokenData = await tokenResponse.json();
  
  if (!tokenData.access_token) {
    throw new Error(`No access token returned: ${JSON.stringify(tokenData)}`);
  }
  
  console.log(`Successfully obtained access token (expires in ${tokenData.expires_in}s)`);
  return tokenData.access_token;
}

/**
 * Helper function to convert base64 to binary
 */
function base64ToBinary(base64) {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}