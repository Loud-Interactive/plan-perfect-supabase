// Supabase Edge Function: publish-shopify-by-outline
// Description: Publishes or updates a Shopify article based on a content plan outline GUID

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { findTaskForOutline } from "../process-shopify-queue-enhanced/task-lookup-fix.ts";

const SHOPIFY_API_HEADER = "X-Shopify-Access-Token";
const SUSPICIOUS_IMAGE_PATTERNS = [
  /placeholder/i,
  /default/i,
  /stock/i,
  /unsplash/i,
  /pexels/i,
  /\/[0-9]+\.[0-9]+\.(jpg|png|jpeg)/i,
  /sample/i,
  /temp/i,
  /dummy/i,
];

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      {
        status: 405,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

  if (!supabaseUrl || !supabaseServiceKey) {
    return new Response(
      JSON.stringify({ error: "Missing Supabase configuration" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const body = await req.json();
    const {
      content_plan_outline_guid,
      force_recreate = false,
      publish_live: publishOverride,
      update_only = false,
    } = body ?? {};

    if (
      !content_plan_outline_guid ||
      typeof content_plan_outline_guid !== "string"
    ) {
      return new Response(
        JSON.stringify({ error: "content_plan_outline_guid is required" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    console.log(
      `Publish request received for outline ${content_plan_outline_guid}`,
    );

    // Look up outline for client context
    const { data: outline, error: outlineError } = await supabase
      .from("content_plan_outlines")
      .select("guid, post_title, status, client_name, domain")
      .eq("guid", content_plan_outline_guid)
      .maybeSingle();

    if (outlineError) {
      console.error("Error fetching outline:", outlineError.message);
      return new Response(
        JSON.stringify({
          error: "Failed to fetch outline",
          details: outlineError.message,
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    if (!outline) {
      return new Response(
        JSON.stringify({
          error: `Outline not found for guid ${content_plan_outline_guid}`,
        }),
        {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Find the best task associated with this outline
    const task = await findTaskForOutline(supabase, content_plan_outline_guid);

    if (!task) {
      return new Response(
        JSON.stringify({
          error:
            `No task content found for outline ${content_plan_outline_guid}`,
        }),
        {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const shopifyConfig = await resolveShopifyConfig(supabase, task, outline);

    if (!shopifyConfig) {
      return new Response(
        JSON.stringify({
          error: "Shopify configuration not found for this outline",
          context: {
            task_client_id: task.client_id ?? null,
            task_client_domain: task.client_domain ?? null,
            outline_domain: outline.domain ?? null,
            outline_client_name: outline.client_name ?? null,
          },
        }),
        {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    validateShopifyConfig(shopifyConfig);

    if (!isMeaningful(task.content)) {
      return new Response(
        JSON.stringify({
          error: "Task content is empty or placeholder",
          task_id: task.task_id,
        }),
        {
          status: 422,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const effectiveTitle = (task.title || outline.post_title || "").trim();

    if (!effectiveTitle) {
      return new Response(
        JSON.stringify({
          error: "Unable to determine title for article",
          task_id: task.task_id,
          outline_guid: content_plan_outline_guid,
        }),
        {
          status: 422,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const publishingTask = { ...task, title: effectiveTitle };

    const publishPreference = typeof publishOverride === "boolean"
      ? publishOverride
      : (shopifyConfig.publish_mode ?? "live") === "live";

    let { data: syncStatus } = await supabase
      .from("shopify_sync_status")
      .select("*")
      .eq("content_plan_outline_guid", content_plan_outline_guid)
      .maybeSingle();

    if (force_recreate && syncStatus?.id) {
      console.log(
        "Force recreate requested – clearing existing sync status record",
      );
      await supabase
        .from("shopify_sync_status")
        .delete()
        .eq("id", syncStatus.id);
      syncStatus = null;
    }

    const articleData = await buildArticleData(
      publishingTask,
      shopifyConfig,
      supabase,
    );
    const blogId = shopifyConfig.shopify_blog_id;
    const shopifyDomain = shopifyConfig.shopify_domain;
    const apiVersion = shopifyConfig.shopify_api_version || "2023-10";
    const token = shopifyConfig.shopify_access_token;

    let action: "create" | "update" = "create";
    let articleResponse: any | null = null;

    if (syncStatus?.shopify_article_gid) {
      // Verify the article still exists
      const exists = await verifyArticleExists(
        shopifyDomain,
        apiVersion,
        blogId,
        syncStatus.shopify_article_gid,
        token,
      );

      if (exists) {
        articleResponse = await updateShopifyArticle({
          shopifyDomain,
          apiVersion,
          blogId,
          token,
          articleId: syncStatus.shopify_article_gid,
          articleData,
          publishLive: publishPreference,
        });
        action = "update";
      } else {
        console.log(
          "Existing article not found in Shopify, creating a new one",
        );
        syncStatus = null;
      }
    }

    if (!syncStatus) {
      if (update_only) {
        throw new Error(
          "Article does not exist in Shopify yet and update_only is true",
        );
      }
      articleResponse = await createShopifyArticle({
        shopifyDomain,
        apiVersion,
        blogId,
        token,
        articleData,
        publishLive: publishPreference,
      });
      action = "create";
    }

    if (!articleResponse) {
      throw new Error("No Shopify response received for publish attempt");
    }

    const article = articleResponse.article ?? articleResponse.articles?.[0];

    if (!article) {
      throw new Error("Shopify response did not include article data");
    }

    const postUrl = buildPostUrl(shopifyConfig, article.handle);

    await upsertSyncStatus({
      supabase,
      syncStatus,
      outlineGuid: content_plan_outline_guid,
      article,
      postUrl,
    });

    await updateTaskLiveUrl(supabase, task.task_id, postUrl);

    return new Response(
      JSON.stringify({
        success: true,
        action,
        outline_guid: content_plan_outline_guid,
        task_id: task.task_id,
        article_id: article.id,
        handle: article.handle,
        published: Boolean(article.published_at || article.published),
        post_url: postUrl,
      }),
      {
        status: action === "create" ? 201 : 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (error) {
    console.error("Error in publish-shopify-by-outline:", error);

    const message = error instanceof Error ? error.message : String(error);

    return new Response(
      JSON.stringify({ error: message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});

async function resolveShopifyConfig(supabase: any, task: any, outline: any) {
  const attempts: Array<{ column: string; value: string }> = [];

  const tryFetch = async (
    column: string,
    value: string,
  ): Promise<any | null> => {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    if (!trimmed) return null;

    const { data, error } = await supabase
      .from("shopify_configs")
      .select("*")
      .eq(column, trimmed)
      .maybeSingle();

    if (error) {
      console.error(
        `Error fetching Shopify config by ${column} (${trimmed}):`,
        error.message,
      );
      throw new Error(
        `Failed to fetch Shopify configuration by ${column}: ${error.message}`,
      );
    }

    if (data) {
      return data;
    }

    attempts.push({ column, value: trimmed });
    return null;
  };

  let config = null;

  if (task?.client_id) {
    config = await tryFetch("client_id", task.client_id);
  }

  if (!config && task?.client_domain) {
    config = await tryFetch("client_domain", task.client_domain);
  }

  if (!config && outline?.domain) {
    config = await tryFetch("client_domain", outline.domain);
  }

  if (!config && attempts.length > 0) {
    console.warn(
      "Unable to locate Shopify config after attempts:",
      JSON.stringify(attempts),
    );
  }

  return config;
}

function validateShopifyConfig(config: any) {
  const missing = [];

  if (!config.shopify_domain) missing.push("shopify_domain");
  if (!config.shopify_access_token) missing.push("shopify_access_token");
  if (!config.shopify_blog_id) missing.push("shopify_blog_id");
  if (!config.shopify_blog_url) missing.push("shopify_blog_url");

  if (missing.length > 0) {
    throw new Error(
      `Shopify configuration missing required fields: ${missing.join(", ")}`,
    );
  }
}

function isMeaningful(content: unknown): boolean {
  if (typeof content !== "string") return false;
  const stripped = content
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .trim();
  return stripped.length > 0 && !/^no content available$/i.test(stripped);
}

async function buildArticleData(task: any, shopifyConfig: any, supabase: any) {
  let title = task.title?.trim() ?? "";
  if (shopifyConfig.shopify_post_suffix) {
    title = `${title} ${shopifyConfig.shopify_post_suffix}`.trim();
  }

  const article: Record<string, unknown> = {
    title,
    author: shopifyConfig.shopify_post_author || "Admin",
  };

  const bodyHtml = ensureHeroImage(task, shopifyConfig);
  article.body_html = bodyHtml;

  const summary = extractSummary(bodyHtml);
  if (summary) {
    article.summary_html = summary;
  }

  const heroImage = resolveHeroImage(task, shopifyConfig);
  if (heroImage) {
    article.image = {
      src: heroImage,
      alt: title,
    };
  }

  if (shopifyConfig.shopify_template) {
    article.template_suffix = shopifyConfig.shopify_template;
  }

  return article;
}

function resolveHeroImage(task: any, shopifyConfig: any): string | null {
  const candidate = task.hero_image_url?.trim();
  if (candidate && !isSuspiciousImage(candidate)) {
    return candidate;
  }

  const fallback = shopifyConfig.shopify_post_featured_image?.trim();
  return fallback && !isSuspiciousImage(fallback) ? fallback : null;
}

function isSuspiciousImage(url: string): boolean {
  return SUSPICIOUS_IMAGE_PATTERNS.some((pattern) => pattern.test(url));
}

function ensureHeroImage(task: any, shopifyConfig: any): string {
  let bodyHtml = typeof task.content === "string" ? task.content : "";
  const hero = resolveHeroImage(task, shopifyConfig);

  if (!hero) return bodyHtml;

  const leadImageRegex =
    /<div\s+class=\"lead-image\"[^>]*>[\s\S]*?<img[^>]*>\s*<\/div>/i;
  const replacement = `<div class="lead-image">
  <img src="${hero}" alt="${(task.title || "Article hero").toString().trim()}">
</div>`;

  if (leadImageRegex.test(bodyHtml)) {
    return bodyHtml.replace(leadImageRegex, replacement);
  }

  return `${replacement}\n\n${bodyHtml}`;
}

function extractSummary(bodyHtml: string): string | null {
  try {
    const summaryMatch = bodyHtml.match(
      /<div[^>]*id="summary"[^>]*>[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>[\s\S]*?<\/div>/i,
    );
    if (summaryMatch?.[1]) {
      return cleanSummary(summaryMatch[1]);
    }

    const firstParagraph = bodyHtml.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
    if (firstParagraph?.[1]) {
      return cleanSummary(firstParagraph[1]).slice(0, 300);
    }
  } catch (error) {
    console.warn(
      "Failed to extract summary:",
      error instanceof Error ? error.message : error,
    );
  }
  return null;
}

function cleanSummary(input: string): string {
  return input
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function verifyArticleExists(
  shopifyDomain: string,
  apiVersion: string,
  blogId: string,
  articleId: string,
  token: string,
): Promise<boolean> {
  try {
    const response = await fetch(
      `https://${shopifyDomain}/admin/api/${apiVersion}/blogs/${blogId}/articles/${articleId}.json`,
      {
        method: "GET",
        headers: {
          [SHOPIFY_API_HEADER]: token,
          "Content-Type": "application/json",
        },
      },
    );

    return response.ok;
  } catch (error) {
    console.error("Article existence check failed:", error);
    return false;
  }
}

async function createShopifyArticle(params: {
  shopifyDomain: string;
  apiVersion: string;
  blogId: string;
  token: string;
  articleData: Record<string, unknown>;
  publishLive: boolean;
}) {
  const { shopifyDomain, apiVersion, blogId, token, articleData, publishLive } =
    params;

  const payload = {
    article: {
      ...articleData,
      published: publishLive,
      published_at: publishLive ? new Date().toISOString() : null,
    },
  };

  const response = await fetch(
    `https://${shopifyDomain}/admin/api/${apiVersion}/blogs/${blogId}/articles.json`,
    {
      method: "POST",
      headers: {
        [SHOPIFY_API_HEADER]: token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    },
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to create Shopify article: ${errorText}`);
  }

  return await response.json();
}

async function updateShopifyArticle(params: {
  shopifyDomain: string;
  apiVersion: string;
  blogId: string;
  token: string;
  articleId: string;
  articleData: Record<string, unknown>;
  publishLive: boolean;
}) {
  const {
    shopifyDomain,
    apiVersion,
    blogId,
    token,
    articleId,
    articleData,
    publishLive,
  } = params;

  const payload = {
    article: {
      ...articleData,
      id: parseInt(articleId, 10),
      published: publishLive,
      published_at: publishLive ? new Date().toISOString() : null,
    },
  };

  const response = await fetch(
    `https://${shopifyDomain}/admin/api/${apiVersion}/blogs/${blogId}/articles/${articleId}.json`,
    {
      method: "PUT",
      headers: {
        [SHOPIFY_API_HEADER]: token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    },
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to update Shopify article: ${errorText}`);
  }

  return await response.json();
}

function buildPostUrl(shopifyConfig: any, handle: string): string {
  const base = shopifyConfig.shopify_blog_url?.replace(/\/$/, "") ?? "";
  return `${base}/${handle}`;
}

async function upsertSyncStatus(params: {
  supabase: any;
  syncStatus: any;
  outlineGuid: string;
  article: any;
  postUrl: string;
}) {
  const { supabase, syncStatus, outlineGuid, article, postUrl } = params;
  const payload = {
    shopify_article_gid: article.id?.toString() ?? null,
    shopify_handle: article.handle ?? null,
    post_url: postUrl,
    is_published: Boolean(article.published_at || article.published),
    last_synced_at: new Date().toISOString(),
    sync_error: null,
  };

  if (syncStatus?.id) {
    await supabase
      .from("shopify_sync_status")
      .update(payload)
      .eq("id", syncStatus.id);
  } else {
    await supabase
      .from("shopify_sync_status")
      .insert({
        content_plan_outline_guid: outlineGuid,
        ...payload,
      });
  }
}

async function updateTaskLiveUrl(
  supabase: any,
  taskId: string,
  postUrl: string,
) {
  if (!taskId || !postUrl) return;

  await supabase
    .from("tasks")
    .update({
      live_post_url: postUrl,
      updated_at: new Date().toISOString(),
    })
    .eq("task_id", taskId);
}
