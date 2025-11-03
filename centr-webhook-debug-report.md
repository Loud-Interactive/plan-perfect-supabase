# Centr Webhook Integration - Debug Report

**Date:** October 30, 2025  
**Status:** Signature validation failing (HTTP 403)  
**Contact:** Erik @ Centr

---

## Implementation Summary

We've implemented the LOUD → Centr webhook integration per the spec provided, but are consistently receiving `HTTP 403: Forbidden` with the message "Invalid webhook signature".

### What We've Implemented (Per Spec)

✅ **Endpoint**: `POST https://uat.centr.com/webhooks/v1/loud-articles?code=sk_0wjgbMYDFkXscTeSze4rPvk96nliBIy1PnykQruamuQ=`

✅ **Authentication**:
- API key in query parameter: `code=sk_0wjgbMYDFkXscTeSze4rPvk96nliBIy1PnykQruamuQ=`

✅ **Signature Generation**:
- Algorithm: HMAC-SHA256
- Secret: `MDAdVT7rXYThlWUz6h/kwbKYsotGcFOfyPqBI30ojvUA1qHb6dF1dx5oddaSnib1`
- Input: Full JSON request body (compact, no whitespace)
- Format: `sha256=<64_char_hex_digest>`
- Header: `X-Webhook-Signature: sha256=<hex>`

✅ **Payload Format**:
```json
{
  "guid": "ae1c8678-4178-4fe9-888a-2674af83a959",
  "event": "content_complete",
  "timestamp": "2025-10-30T18:02:42.347Z",
  "data": {
    "status": "completed",
    "title": "chris hemsworth gym workout",
    "slug": "chris-hemsworth-gym-workout",
    "client_domain": "centr.com",
    "html_link": null,
    "google_doc_link": null,
    "content": "<html>...</html>",
    "seo_keyword": "chris hemsworth gym workout",
    "meta_description": "Master Chris Hemsworth's workout foundation...",
    "live_post_url": "https://centr.com/chris-hemsworth-gym-workout"
  }
}
```

✅ **Headers Sent**:
```
Content-Type: application/json
X-Webhook-Signature: sha256=<hex_signature>
X-Webhook-Event: content_complete
X-Webhook-ID: 90a96442-89cb-4a2c-bcef-1bb288e48d24
X-Webhook-GUID: ae1c8678-4178-4fe9-888a-2674af83a959
X-Webhook-Timestamp: 2025-10-30T18:02:42.347Z
```

---

## Actual Test - Real Payload Sent

**Task Details:**
- Task ID: `ae1c8678-4178-4fe9-888a-2674af83a959`
- Title: "chris hemsworth gym workout"
- Timestamp: `2025-10-30T18:02:42.347Z`
- Payload Size: 36.4 KB (full HTML article content)

**Signature Generated:**
```
sha256=65339df3b01576b3d009b6ca44e82355d6e352f1e084159895870142c3500af2
```

**Complete Payload Structure:**
```json
{
  "guid": "ae1c8678-4178-4fe9-888a-2674af83a959",
  "event": "content_complete",
  "timestamp": "2025-10-30T18:02:42.347Z",
  "data": {
    "status": "Completed",
    "title": "chris hemsworth gym workout",
    "slug": "chris-hemsworth-gym-workout",
    "client_domain": "centr.com",
    "html_link": null,
    "google_doc_link": null,
    "content": "<!DOCTYPE html>...[full HTML, 34.9 KB]...",
    "seo_keyword": "chris hemsworth gym workout",
    "meta_description": "Master Chris Hemsworth's workout foundation...",
    "live_post_url": "https://centr.com/chris-hemsworth-gym-workout"
  }
}
```

**Files Provided:**
- `actual-payload-compact.json` - The exact bytes sent (compact JSON, 36.4 KB)
- `actual-payload-complete.json` - Same payload formatted for readability
- `signature-info.txt` - Signature and test instructions

**To Verify Signature:**
```bash
# Using the compact payload file
cat actual-payload-compact.json | openssl dgst -sha256 -hmac "MDAdVT7rXYThlWUz6h/kwbKYsotGcFOfyPqBI30ojvUA1qHb6dF1dx5oddaSnib1"

# Expected output: 65339df3b01576b3d009b6ca44e82355d6e352f1e084159895870142c3500af2
```

---

## Troubleshooting Already Done

We've tried multiple signature formats:
- ❌ `sha256=<hex>` (current - per your spec)
- ❌ Raw hex without prefix
- ❌ Base64 encoding

All result in the same `HTTP 403: Forbidden` response.

---

## Questions for Centr

1. **Secret Verification**: Can you confirm the webhook secret `MDAdVT7rXYThlWUz6h/kwbKYsotGcFOfyPqBI30ojvUA1qHb6dF1dx5oddaSnib1` is correct for our integration?

2. **Test Signature**: Can you verify the signature for the test payload above on your end? It should produce: `4e86d4d1dc2d73e9008693d8a68c2792aa23cbeebb227565d9b5e1b741fae3ff`

3. **Payload Formatting**: Do you need the JSON body formatted in any specific way? (whitespace, key ordering, etc.)

4. **Additional Validation**: Are there any additional validation steps beyond the signature that aren't documented? (e.g., timestamp window, IP whitelist, etc.)

5. **Webhook Configuration**: Is the webhook properly configured on your end for domain `centr.com`?

6. **Test Endpoint**: Do you have a test endpoint that returns more detailed error messages we could use for debugging?

---

## Current Webhook Status

**Webhook ID**: `90a96442-89cb-4a2c-bcef-1bb288e48d24`  
**Domain**: `centr.com`  
**Status**: Active  
**Last Called**: `2025-10-30T18:02:42.348Z`  
**Failure Count**: 3  
**Last Error**: `HTTP 403: Forbidden`

---

## Next Steps

We're confident our implementation matches your specification. To resolve this blocker, we need either:

1. Confirmation that the webhook secret is correct
2. An example of a valid signature for a specific payload
3. More detailed error messages from your endpoint
4. A test call from your side to verify the integration

Please let us know what additional information you need to help diagnose this issue.

---

**Contact**: martin@loud.us  
**Implementation**: Supabase Edge Functions (Deno runtime)  
**Documentation Reference**: LOUD API v2 Webhooks Integration Guide (October 2025)

