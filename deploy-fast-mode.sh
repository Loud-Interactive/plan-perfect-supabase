#!/bin/bash

# Fast Mode Outline Generation Deployment Script
# This script deploys the fast mode outline generation feature

set -e

echo "🚀 Starting Fast Mode Deployment..."

# Apply database migrations
echo "📊 Applying database migrations..."
supabase db push

# Deploy modified generate-outline function
echo "📦 Deploying generate-outline function..."
supabase functions deploy generate-outline --project-ref jsypctdhynsdqrfifvdh

# Deploy new fast-outline-search function
echo "⚡ Deploying fast-outline-search function..."
supabase functions deploy fast-outline-search --project-ref jsypctdhynsdqrfifvdh

# Deploy new fast-analyze-outline-content function
echo "🎯 Deploying fast-analyze-outline-content function..."
supabase functions deploy fast-analyze-outline-content --project-ref jsypctdhynsdqrfifvdh

echo "✅ Deployment complete!"
echo ""
echo "📝 Next steps:"
echo "1. Verify GROQ_API_KEY secret is set: supabase secrets list"
echo "2. If not set, run: supabase secrets set GROQ_API_KEY=your_key --project-ref jsypctdhynsdqrfifvdh"
echo "3. Test fast mode with: fast: true parameter in generate-outline requests"
echo ""
echo "🎯 Happy fast outlining!"
