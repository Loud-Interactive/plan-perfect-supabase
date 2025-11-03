# Centr API Configuration

## Overview
This document contains API keys and webhook secrets for integrating with Centr's content completion webhook system.

## LOUD API Keys

The following API keys are used for authenticating with the LOUD/Centr API:

### Available Keys:
- `sk_G1EKW1LV3vdCqm4773DabJUI5yjtdlA+KN1uQysGYIs=`
- `sk_x4YMQtIpRtiepnPTOAHpdSiTDVcCcfdGct8I4OkRSO8=`
- ✅ `sk_b2dM4mpo2KNbAWHjfc3tjLKGaO7Cv95f0zhwV4Rh27k=` *(Active)*
- ✅ `sk_0wjgbMYDFkXscTeSze4rPvk96nliBIy1PnykQruamuQ=` *(Active)*

## LOUD Webhook Secret

Used for generating HMAC-SHA256 signatures for webhook payloads:

- ✅ `MDAdVT7rXYThlWUz6h/kwbKYsotGcFOfyPqBI30ojvUA1qHb6dF1dx5oddaSnib1` *(Active)*

## Related Files

- **Webhook Integration**: `supabase/functions/_shared/webhook-helpers-v2.ts`
- **Status Update Function**: `supabase/functions/update-task-status/index.ts`
- **General Webhook Integration**: `supabase/functions/_shared/webhook-integration.ts`

## Webhook Configuration

The Centr webhook integration sends `content_complete` events when tasks are finished:

```typescript
POST https://shop.centr.com/api/webhooks/loud?code=xxx
Headers:
  - Content-Type: application/json
  - X-Webhook-Event: content_complete
  - X-Webhook-Signature: <HMAC-SHA256 signature>
  
Payload:
{
  "event": "content_complete",
  "task_id": "...",
  "domain": "...",
  "status": "...",
  "timestamp": "...",
  "data": { ... }
}
```

## Security Notes

- ⚠️ **Keep these keys secure** - Do not commit to public repositories
- The webhook secret is used to generate signatures that Centr validates
- Signatures are computed as: `HMAC-SHA256(payload_string, webhook_secret)`
- The signature is sent in the `X-Webhook-Signature` header (NOT in the payload body)

## Previous Issues Resolved

1. ✅ Fixed `globalThis.crypto.subtle` usage for Deno Edge Functions
2. ✅ Corrected webhook payload format (signature only in header, not body)
3. ✅ Fixed domain extraction from `live_post_url` instead of `url`
4. ✅ Resolved case sensitivity in status matching

## Testing

To test webhook delivery manually:

```bash
curl -X POST "https://shop.centr.com/api/webhooks/loud?code=xxx" \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Event: content_complete" \
  -H "X-Webhook-Signature: <computed_signature>" \
  -d '{"event":"content_complete","task_id":"test",...}'
```

## Troubleshooting

If webhooks fail:
1. Check that the endpoint URL includes the `code` query parameter
2. Verify the signature is computed correctly using the active webhook secret
3. Ensure the signature is in the header (not the body)
4. Check Centr's WAF isn't blocking the request (look for incident IDs in 403 responses)

---

*Last Updated: 2025-10-30*
*Contact: martin@loud.us*

