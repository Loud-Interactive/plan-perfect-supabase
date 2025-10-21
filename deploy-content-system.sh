#!/bin/bash
# Deploy PlanPerfect Content Generation System
# All 7 required edge functions for the content pipeline

set -e  # Exit on error

echo "🚀 Deploying PlanPerfect Content Generation System"
echo "================================================================"

cd /Users/martinbowling/Projects/pp-supabase

# Deploy intake function (entry point)
echo ""
echo "1️⃣ Deploying content-intake (entry point)..."
supabase functions deploy content-intake --no-verify-jwt

# Deploy worker functions (6 stages)
echo ""
echo "2️⃣ Deploying content-research-worker..."
supabase functions deploy content-research-worker --no-verify-jwt

echo ""
echo "3️⃣ Deploying content-outline-worker..."
supabase functions deploy content-outline-worker --no-verify-jwt

echo ""
echo "4️⃣ Deploying content-draft-worker..."
supabase functions deploy content-draft-worker --no-verify-jwt

echo ""
echo "5️⃣ Deploying content-qa-worker..."
supabase functions deploy content-qa-worker --no-verify-jwt

echo ""
echo "6️⃣ Deploying content-export-worker..."
supabase functions deploy content-export-worker --no-verify-jwt

echo ""
echo "7️⃣ Deploying content-complete-worker..."
supabase functions deploy content-complete-worker --no-verify-jwt

echo ""
echo "================================================================"
echo "✅ All content system functions deployed!"
echo "================================================================"
echo ""
echo "📋 Deployed Functions:"
echo "  1. content-intake - Entry point"
echo "  2. content-research-worker - Stage 1: Research"
echo "  3. content-outline-worker - Stage 2: Outline"
echo "  4. content-draft-worker - Stage 3: Draft"
echo "  5. content-qa-worker - Stage 4: QA"
echo "  6. content-export-worker - Stage 5: Export"
echo "  7. content-complete-worker - Stage 6: Complete"
echo ""
echo "🧪 Ready to test! Run:"
echo "  python test-medidrive-content.py"

