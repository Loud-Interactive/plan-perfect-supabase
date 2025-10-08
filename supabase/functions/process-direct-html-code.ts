// This is a simplified version of the Edge Function code
// To deploy, create a process-direct-html directory and place this code in index.ts

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import * as cheerio from "https://esm.sh/cheerio@1.0.0-rc.12";

interface ProcessHtmlRequest {
  html: string;
  targetKeyword?: string;
  url?: string;
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      },
    });
  }

  try {
    const requestData: ProcessHtmlRequest = await req.json();
    const { html, targetKeyword = "general content", url } = requestData;

    if (!html) {
      return new Response(
        JSON.stringify({ error: "HTML content is required" }),
        {
          status: 400,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          },
        }
      );
    }

    // Load HTML into cheerio
    const $ = cheerio.load(html);

    // Extract text content
    const bodyText = $("body").text().trim();
    
    // Analyze content
    const analysis = {
      url,
      wordCount: calculateWordCount(bodyText),
      keywordDensity: calculateKeywordDensity(bodyText, targetKeyword),
      headingScore: calculateHeadingScore($, targetKeyword),
      overallScore: 75, // Simplified for this example
      topKeywords: extractTopKeywords(bodyText),
      headings: extractHeadings($, targetKeyword),
      recommendations: ["This is a simplified example"]
    };

    return new Response(JSON.stringify(analysis), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message || "An error occurred" }),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      }
    );
  }
});

// Example helper functions (simplified versions)
function calculateWordCount(text: string): number {
  return text.split(/\s+/).filter(word => word.length > 0).length;
}

function calculateKeywordDensity(text: string, targetKeyword: string): number {
  if (targetKeyword === "general content") return 0;
  
  const lowerText = text.toLowerCase();
  const lowerKeyword = targetKeyword.toLowerCase();
  let count = 0;
  let index = lowerText.indexOf(lowerKeyword);
  
  while (index !== -1) {
    count++;
    index = lowerText.indexOf(lowerKeyword, index + 1);
  }
  
  const totalWords = calculateWordCount(text);
  return totalWords > 0 ? (count / totalWords) * 100 : 0;
}

function calculateHeadingScore($: cheerio.CheerioAPI, targetKeyword: string): number {
  // Simplified implementation
  return 70;
}

function extractTopKeywords(text: string) {
  // Simplified implementation
  return [
    { term: "example", count: 5 },
    { term: "keyword", count: 3 }
  ];
}

function extractHeadings($: cheerio.CheerioAPI, targetKeyword: string) {
  const headings = [];
  
  $("h1, h2, h3, h4, h5, h6").each((_, element) => {
    const level = element.name;
    const text = $(element).text().trim();
    const containsKeyword = targetKeyword !== "general content" && 
      text.toLowerCase().includes(targetKeyword.toLowerCase());
    
    headings.push({
      level,
      text,
      containsKeyword,
    });
  });
  
  return headings;
}