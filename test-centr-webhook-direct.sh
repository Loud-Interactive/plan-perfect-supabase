#!/bin/bash

# Direct test of Centr webhook delivery
# This bypasses the update-task-status function and calls the webhook directly

source .env

echo "🧪 Testing Centr Webhook Direct Delivery"
echo "═══════════════════════════════════════"
echo ""

# Prepare test payload
PAYLOAD='{
  "guid": "test-'$(date +%s)'",
  "event": "content_complete",
  "timestamp": "'$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")'",
  "data": {
    "status": "completed",
    "title": "Test Article: Centr Fitness Guide",
    "slug": "test-article-centr-fitness-guide",
    "client_domain": "centr.com",
    "html_link": "https://docs.google.com/document/d/test",
    "content": "Test content for webhook",
    "seo_keyword": "fitness",
    "meta_description": "Test article",
    "live_post_url": "https://shop.centr.com/blog/test"
  }
}'

# Generate signature
SECRET="MDAdVT7rXYThlWUz6h/kwbKYsotGcFOfyPqBI30ojvUA1qHb6dF1dx5oddaSnib1"
SIGNATURE=$(echo -n "$PAYLOAD" | openssl dgst -sha256 -hmac "$SECRET" | sed 's/^.* //')

echo "📤 Sending test webhook to Centr UAT endpoint..."
echo "   URL: https://uat.centr.com/webhooks/v1/loud-articles?code=sk_0wjgbMYDFkXscTeSze4rPvk96nliBIy1PnykQruamuQ="
echo "   Signature: sha256=$SIGNATURE"
echo ""

# Send webhook
curl -v -X POST "https://uat.centr.com/webhooks/v1/loud-articles?code=sk_0wjgbMYDFkXscTeSze4rPvk96nliBIy1PnykQruamuQ=" \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Signature: sha256=$SIGNATURE" \
  -H "X-Webhook-Event: content_complete" \
  -H "X-Webhook-ID: test-direct" \
  -H "X-Webhook-GUID: test-$(date +%s)" \
  -H "X-Webhook-Timestamp: $(date -u +"%Y-%m-%dT%H:%M:%S.000Z")" \
  -d "$PAYLOAD" 2>&1 | grep -E "(< HTTP|< Content-Type|^{|^<)"

echo ""
echo ""
echo "✅ Test complete! Check the output above for the response."

