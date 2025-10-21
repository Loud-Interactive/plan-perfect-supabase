# Brand Positioning Fields - Quick Reference

## 🎯 3 Strategic Fields for Outline Generation

### 1. competitors (array)
**Purpose**: Prevent competitor-promoting sections  
**Format**: Array of strings  
**Example**:
```json
["Mailchimp", "Constant Contact", "ConvertKit"]
```

**Impact on Outline**:
- ❌ Prevents: "Section: Top 5 Mailchimp Alternatives"
- ✅ Creates: "Section: Essential Features for Your Business"

---

### 2. brand_positioning (string)
**Purpose**: Reinforce unique value proposition  
**Format**: String (2-3 sentences)  
**Example**:
```json
"We are the only email platform built specifically for e-commerce brands that need deep Shopify integration and abandoned cart recovery. We focus on ROI-driven automation, not just email sending."
```

**Impact on Outline**:
- ✅ Sections aligned with differentiation
- ✅ Structure reinforces unique value
- ✅ Avoids generic "me-too" content

---

### 3. target_audience (string)
**Purpose**: Ensure section relevance  
**Format**: String describing reader profile  
**Example**:
```json
"E-commerce store owners with 100-10,000 products who are frustrated with generic email tools. They need advanced segmentation based on purchase history. Technical comfort level: moderate."
```

**Impact on Outline**:
- ✅ Topics relevant to audience needs
- ✅ Appropriate complexity level
- ✅ Addresses specific pain points

---

## 📝 How to Add to Pairs Table

### SQL Insert
```sql
INSERT INTO pairs (domain, key, value) VALUES
  ('yourdomain.com', 'competitors', '["Competitor A", "Competitor B"]'),
  ('yourdomain.com', 'brand_positioning', 'We are the only...'),
  ('yourdomain.com', 'target_audience', 'Business owners who...');
```

### Via API
```bash
curl -X POST "https://pp-api.replit.app/pairs" \
  -H "Content-Type: application/json" \
  -d '{
    "domain": "yourdomain.com",
    "competitors": ["Competitor A", "Competitor B"],
    "brand_positioning": "We are the only...",
    "target_audience": "Business owners who..."
  }'
```

---

## ✅ Checklist for Setup

- [ ] Identify your 3-5 main competitors
- [ ] Write 2-3 sentence brand positioning statement
- [ ] Describe target audience (job title, company size, pain points)
- [ ] Add to pairs table
- [ ] Test outline generation
- [ ] Compare before/after outlines
- [ ] Iterate on positioning statement

---

## 🚫 What NOT to Include

These fields are for **drafting only**, NOT outline generation:
- ❌ `voice_traits` - Writing style
- ❌ `tone` - Content tone
- ❌ `language_style` - Vocabulary

**Why?** Outline stage = Strategic structure. Drafting stage = Tactical execution.

---

## 🔍 Quick Test

```sql
-- Check if your domain has brand positioning fields
SELECT key, value 
FROM pairs 
WHERE domain = 'yourdomain.com' 
  AND key IN ('competitors', 'brand_positioning', 'target_audience');
```

Expected result: 3 rows

---

**Updated**: 2025-10-20  
**Status**: ✅ Live in Production

