import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.43.1";
import { corsHeaders } from "../_shared/cors.ts";
import { load } from "npm:cheerio@1.0.0-rc.12";

interface SchemaValues {
  headline?: string;
  description?: string;
  author?: string;
  datePublished?: string;
  dateModified?: string;
  image?: {
    url?: string;
    width?: number;
    height?: number;
  };
  mainEntityOfPage?: string;
  keywords: string[];
  articleSection: string[];
  citation: { url?: string; name?: string }[];
  articleBody?: string;
  text?: string;
  wordCount?: number;
  faq: { name: string; text: string }[];
}

type OptionalString = string | null | undefined;

const templatePath = new URL(
  "../_shared/templates/otcblogtemplate.html",
  import.meta.url,
);
const TEMPLATE_HTML = await Deno.readTextFile(templatePath);

const START_MARKERS = Array.from(
  TEMPLATE_HTML.matchAll(/<!-- START:([A-Z_]+) -->/g),
).map((m) => m[1]);

const REQUIRED_BODY_MARKERS = [
  "SUMMARY",
  "SINGLE_ITEM",
  "SINGLE_SKU",
  "QUOTE",
  "QUOTE_COPY",
  "QUOTE_AUTHOR",
  "ITEM_LIST",
  "MULTIPLE_SKUS",
  "FULL_IMG",
  "SIDE_CATEGORY",
  "ASIDE",
  "FAQ",
  "REFERENCES",
];

function normalizeWhitespace(value: OptionalString): string | undefined {
  if (!value) return undefined;
  return value.replace(/\s+/g, " ").trim();
}

function parseSchema(raw: OptionalString): SchemaValues | undefined {
  if (!raw) return undefined;
  try {
    const data = JSON.parse(raw);
    const graph = Array.isArray(data?.["@graph"]) ? data["@graph"] : [];
    const blogNode = graph.find((node: any) =>
      node?.["@type"] === "BlogPosting" || node?.["@type"] === "Article"
    );
    const faqNode = graph.find((node: any) => node?.["@type"] === "FAQPage");
    if (!blogNode) return undefined;

    const image = blogNode.image ?? {};
    const imgObj = Array.isArray(image) ? image[0] : image;
    const mainEntity = blogNode.mainEntityOfPage;
    const mainEntityId = typeof mainEntity === "string"
      ? mainEntity
      : mainEntity?.["@id"];

    const keywords = Array.isArray(blogNode.keywords)
      ? blogNode.keywords
      : blogNode.keywords
      ? [blogNode.keywords]
      : [];

    const sections = Array.isArray(blogNode.articleSection)
      ? blogNode.articleSection
      : blogNode.articleSection
      ? [blogNode.articleSection]
      : [];

    let citations: { url?: string; name?: string }[] = [];
    if (Array.isArray(blogNode.citation)) {
      citations = blogNode.citation.map((c: any) => ({
        url: c?.url,
        name: c?.name,
      }));
    } else if (blogNode.citation) {
      citations = [{
        url: blogNode.citation?.url,
        name: blogNode.citation?.name,
      }];
    }

    const faqItems: { name: string; text: string }[] = [];
    if (Array.isArray(faqNode?.mainEntity)) {
      for (const entry of faqNode.mainEntity) {
        const question = entry?.name;
        const answer = entry?.acceptedAnswer?.text;
        if (question && answer) {
          faqItems.push({
            name: normalizeWhitespace(question) ?? "",
            text: normalizeWhitespace(answer) ?? "",
          });
        }
      }
    }

    const wordCount = Number(blogNode.wordCount);

    return {
      headline: normalizeWhitespace(blogNode.headline),
      description: normalizeWhitespace(blogNode.description),
      author: normalizeWhitespace(blogNode.author?.name ?? blogNode.author) ??
        "OrientalTrading Staff",
      datePublished: blogNode.datePublished,
      dateModified: blogNode.dateModified ?? blogNode.datePublished,
      image: {
        url: imgObj?.url,
        width: Number(imgObj?.width) || 1400,
        height: Number(imgObj?.height) || 933,
      },
      mainEntityOfPage: mainEntityId,
      keywords,
      articleSection: sections,
      citation: citations,
      articleBody: blogNode.articleBody ?? "",
      text: blogNode.text ?? blogNode.description,
      wordCount: Number.isFinite(wordCount) ? wordCount : undefined,
      faq: faqItems,
    };
  } catch (_err) {
    return undefined;
  }
}

function stringifySchema(values: SchemaValues): string {
  const safe = (val: OptionalString, fallback = "") =>
    JSON.stringify(val ?? fallback);
  const arr = (list: string[]) =>
    `[
${
      list.map((item) => `                            ${JSON.stringify(item)}`)
        .join(",\n")
    }
                        ]`;
  const citations = values.citation.length
    ? `                        [
${
      values.citation.map((c) =>
        `                            {
                                "@type": "WebPage",
                                "url": ${safe(c.url)},
                                "name": ${safe(c.name)}
                            }`
      ).join(",\n")
    }
                        ]`
    : "[]";
  const faq = values.faq.length
    ? `                        [
${
      values.faq.map((qa) =>
        `                            {
                                "@type": "Question",
                                "name": ${safe(qa.name)},
                                "acceptedAnswer": {
                                    "@type": "Answer",
                                    "text": ${safe(qa.text)}
                                }
                            }`
      ).join(",\n")
    }
                        ]`
    : "[]";

  return `    <script type="application/ld+json">
        {
            "@context": "https://schema.org",
            "@graph": [
                
                //START:SCHEMA_BLOGPOSTING
                {
                    "@type": "BlogPosting",
                    "headline": ${safe(values.headline)},
                    "description": ${safe(values.description)},
                    "author": {
                        "@type": "Person",
                        "name": ${safe(values.author)}
                    },
                    "datePublished": ${safe(values.datePublished)},
                    "dateModified": ${
    safe(values.dateModified ?? values.datePublished)
  },
                    "isPartOf": {
                        "@id": "https://www.orientaltrading.com/#site"
                    },
                    "publisher": {
                        "@id": "https://www.orientaltrading.com/#organization"
                    },
                    "image": {
                        "@type": "ImageObject",
                        "url": ${safe(values.image?.url)},
                        "width": ${values.image?.width ?? 1400},
                        "height": ${values.image?.height ?? 933}
                    },
                    "mainEntityOfPage": {
                        "@type": "WebPage",
                        "@id": ${
    safe(
      values.mainEntityOfPage ??
        "https://www.orientaltrading.com/article_path#blogpost",
    )
  }
                    },
                    "speakable": {
                        "@type": "SpeakableSpecification",
                        "cssSelector": [
                            ".c_article_summary",
                            ".c_article_takeaway"
                        ]
                    },
                    "keywords": ${arr(values.keywords)},
                    "articleSection": ${arr(values.articleSection)},
                    "citation": ${citations},
                    "articleBody": ${safe(values.articleBody)},
                    "text": ${safe(values.text)},
                    "wordCount": ${values.wordCount ?? 0},
                    "inLanguage": "en-US"
                },
                //END:SCHEMA_BLOGPOSTING
                //START:SCHEMA_FAQ
                {
                    "@type": "FAQPage",
                    "mainEntity": ${faq}
                }
                //END:SCHEMA_FAQ
            ]
        }
    </script>`;
}

function slugify(text?: string | null): string {
  if (!text) return "section";
  return text
    .replace(/[^a-zA-Z0-9\s-]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "-") || "section";
}

function wrapAside(
  bodyHtml: string,
  href?: string,
  ctaText?: string,
  align: "left" | "right" = "left",
): string {
  const floatClass = align === "right"
    ? "u_floatR u_mw_30 u_mw_50@tablet u_mw_100@mobile u_padLM u_padH0@mobile u_padBM"
    : "u_floatL u_mw_30 u_mw_50@tablet u_mw_100@mobile u_padRM u_padH0@mobile u_padBM";

  const cta = href && ctaText
    ? `            <div class="u_padTS">
                <a href="${href}" class="c_article_tip_cta o_btn o_btnS o_btnWhite u_bgColor1_hover o_btn__in">${ctaText}</a>
            </div>
`
    : "";

  return `                                <!-- START:ASIDE -->
                                <div class="${floatClass}">
                                <div class="u_bgColor2 u_txtWhite u_padM u_font4 u_txtS u_radiusM">
                                <aside class="c_article_aside u_block">
${bodyHtml.trim()}
${cta.trim()}
                                </aside>
                                </div>
                                </div>
                                <!-- END:ASIDE -->`;
}

interface ExtractedContent {
  pageTitle?: string;
  metaDescription?: string;
  canonical?: string;
  schema?: SchemaValues;
  headerHtml?: {
    breadcrumb?: string;
    language?: string;
    title?: string;
    readTime?: string;
    publish?: string;
    author?: string;
    social?: string;
    headerImage?: string;
  };
  summaryHtml?: string;
  asideBlocks: string[];
  articleSections: string[];
  takeawaysHtml?: string;
  referencesHtml?: string;
  tocItems?: string[];
}

function mergeExtractedContent(
  target: ExtractedContent,
  extra: ExtractedContent,
): ExtractedContent {
  const merged: ExtractedContent = {
    pageTitle: extra.pageTitle ?? target.pageTitle,
    metaDescription: extra.metaDescription ?? target.metaDescription,
    canonical: extra.canonical ?? target.canonical,
    schema: extra.schema ?? target.schema,
    headerHtml: {
      ...(target.headerHtml ?? {}),
      ...(extra.headerHtml ?? {}),
    },
    summaryHtml: extra.summaryHtml ?? target.summaryHtml,
    asideBlocks: [...target.asideBlocks, ...extra.asideBlocks],
    articleSections: [...target.articleSections, ...extra.articleSections],
    takeawaysHtml: extra.takeawaysHtml ?? target.takeawaysHtml,
    referencesHtml: extra.referencesHtml ?? target.referencesHtml,
    tocItems: extra.tocItems ?? target.tocItems,
  };
  return merged;
}

function extractContent(html: string): ExtractedContent {
  const $ = load(html, { decodeEntities: false });
  const content: ExtractedContent = {
    asideBlocks: [],
    articleSections: [],
  };

  content.pageTitle = normalizeWhitespace($("title").first().text());
  content.metaDescription = $('meta[name="description"]').attr("content") ??
    undefined;
  content.canonical = $('link[rel="canonical"]').attr("href") ?? undefined;

  content.schema = parseSchema(
    $("script[type='application/ld+json']").first().text(),
  );

  const header = $("header.u_marBM").first();
  if (header.length) {
    content.headerHtml = {
      breadcrumb: header.find("nav.c_breadcrumbs").first().toString(),
      language: header.find("div.c_article_language_toggle").first().toString(),
      title: header.find("h1").first().toString(),
      readTime: header.find("span.c_article_header_read_time").first()
        .toString(),
      publish: header.find("span.c_article_header_date").first().toString(),
      author: header.find("span.c_article_header_author").first().toString(),
      social: header.find("div.c_article_header_social").first().toString(),
    };

    const headerImages: string[] = [];
    header.find("div.u_responsive_embed, div.u_hide.u_show@mobile").each(
      (_i, el) => {
        headerImages.push($(el).toString());
      },
    );
    if (headerImages.length) {
      content.headerHtml.headerImage = headerImages.join("\n");
    }
  }

  const article = $("article.u_txtM").first();
  if (!article.length) {
    return mergeExtractedContent(content, extractGenericContent($));
  }

  article.find("div.post_callout").each((i, el) => {
    const block = $(el);
    const align = block.hasClass("post_callout_right") ? "right" : "left";
    const anchor = block.find("a").first();
    const href = anchor.attr("href");
    const ctaText = anchor.text().trim();
    anchor.remove();
    const bodyHtml = block.html() ?? "";
    content.asideBlocks.push(
      wrapAside(bodyHtml, href, ctaText, align === "right" ? "right" : "left"),
    );
  });

  const summarySection = article.find("section#summary").first();
  if (summarySection.length) {
    content.summaryHtml = summarySection.toString();
  }

  const takeaways = article.find("section#key-takeaways").first();
  if (takeaways.length) {
    takeaways.find(".key_takeaways_cta_button").each((_i, el) => {
      $(el).replaceWith($(el).html() ?? "");
    });
    const heading = takeaways.find(".c_article_heading").first();
    if (heading.length) {
      heading.replaceWith(
        `<h2 class="c_article_heading o_hXL u_lhf u_marBS">${heading.text()}</h2>`,
      );
    }
    content.takeawaysHtml = takeaways.toString();
  }

  const references = article.find("section#references").first();
  if (references.length) {
    const heading = references.find(".c_article_heading").first();
    if (heading.length) {
      heading.replaceWith(
        `<h2 class="c_article_heading o_hXL u_lhf u_marBS">${heading.text()}</h2>`,
      );
    }
    content.referencesHtml = references.toString();
  }

  article.children("section").each((_, el) => {
    const section = $(el);
    const id = section.attr("id");
    if (id === "summary" || id === "key-takeaways" || id === "references") {
      return;
    }
    content.articleSections.push(section.toString());
  });

  const tocItems: string[] = [];
  $("ul.c_article_toc_list").first().find("li").each((_i, li) => {
    tocItems.push($(li).toString());
  });
  content.tocItems = tocItems;

  if (!content.summaryHtml && content.articleSections.length === 0) {
    return mergeExtractedContent(content, extractGenericContent($));
  }

  return content;
}

function replaceBetweenMarkers(
  template: string,
  marker: string,
  replacement: string,
): string {
  const start = `<!-- START:${marker} -->`;
  const end = `<!-- END:${marker} -->`;
  const pattern = new RegExp(`${start}[\s\S]*?${end}`);
  if (!pattern.test(template)) return template;
  return template.replace(pattern, `${start}\n${replacement}\n${end}`);
}

function ensureMarkers(articleHtml: string): string {
  for (const marker of REQUIRED_BODY_MARKERS) {
    if (!articleHtml.includes(`<!-- START:${marker} -->`)) {
      articleHtml +=
        `\n                                <!-- START:${marker} -->\n                                <!-- END:${marker} -->`;
    }
  }
  return articleHtml;
}

function buildSummaryFromGeneric(summaryHtml: string): string {
  const summaryText = load(summaryHtml, { decodeEntities: false })
    .root()
    .text()
    .replace(/Summary\s*/i, "")
    .trim();
  return `                                <section id="summary" class="c_article_summary u_bgColor1 u_txtWhite u_padM u_radiusM u_marBM">
                                    <h2 class="c_article_summary_heading o_hL u_lhf u_marBS">Summary</h2>
                                    <p class="u_lhtf">${summaryText}</p>
                                </section>`;
}

function convertKeyTakeaways(divHtml: string): string {
  const $ = load(divHtml, { decodeEntities: false });
  const heading = $("strong").first().text().trim() || "Key Takeaways";
  const items = $("ol").first().html() ?? "";
  const cta = $("a").first();
  let ctaBlock = "";
  if (cta.length) {
    const href = cta.attr("href") ?? "#";
    const text = cta.text().trim();
    ctaBlock = `                                    <div class="u_padTS">
                                        <a href="${href}" class="c_article_takeaway_cta o_btn o_btnM o_btnColor1 o_btn__in">
                                            ${text}
                                        </a>
                                    </div>
`;
  }
  return `                                <section id="key-takeaways" class="c_article_takeaway u_bgWhite u_txtColor1Dark u_padM u_radiusM u_marBL u_marBM@mobile u_bdr u_bdrColor1 u_shadowXS">
                                    <h2 class="c_article_heading o_hXL u_lhf u_marBS">${heading}</h2>
                                    <ul class="o_list o_list__styled u_padLM u_block">
${items}
                                    </ul>
${ctaBlock}                                </section>`;
}

function convertReferences(divHtml: string): string {
  const listHtml = load(divHtml, { decodeEntities: false })
    .root()
    .find("ol")
    .first()
    .html() ?? "";
  return `                                <section id="references" class="u_bgGray1 u_padM u_txtS u_marBL u_marBM@mobile">
                                    <h2 class="c_article_heading o_hXL u_lhf u_marBS">References</h2>
                                    <ol class="o_list o_list__styled u_padLM u_block">
${listHtml}
                                    </ol>
                                </section>`;
}

function extractGenericContent($: ReturnType<typeof load>): ExtractedContent {
  const contentDiv = $("div.content").first();
  const result: ExtractedContent = { asideBlocks: [], articleSections: [] };
  if (!contentDiv.length) return result;

  const leadSection = $(".lead-section").first();
  const headerHtml: ExtractedContent["headerHtml"] = result.headerHtml ?? {};
  if (leadSection.length) {
    const title = leadSection.find("h1").first().text().trim();
    if (title) {
      headerHtml.title =
        `<h1 class="o_hXXL o_hXL@mobile u_lhf u_marBS u_txtColor2">${title}</h1>`;
    }

    const author = leadSection.find(".lead-author").first().text().trim();
    if (author) {
      headerHtml.author =
        `<span class="c_article_header_author u_bold">${author}</span>`;
    }

    const date = leadSection.find(".lead-date").first().text().trim();
    if (date) {
      headerHtml.publish =
        `<span class="c_article_header_date u_bold">${date}</span>`;
    }

    const readTime = leadSection.find(".lead-readtime").first().text().trim();
    if (readTime) {
      headerHtml.readTime =
        `<span class="c_article_header_read_time u_bold u_txtColor2">${readTime}</span>`;
    }

    const heroImg = leadSection.find(".lead-image img").first();
    if (heroImg.length) {
      const src = heroImg.attr("data-src") || heroImg.attr("src") || "";
      const alt = heroImg.attr("alt") || "";
      headerHtml.headerImage =
        `<div class="u_responsive_embed u_responsive_embed_42x9 u_relative u_hide@mobile">
    <div class="u_absoluteTL u_absoluteTR u_absoluteBL u_absoluteBR u_z1">
        <img class="lazyload" data-src="${src}" alt="${alt}" class="c_article_header_image u_marBS" />
    </div>
</div>`;
    }
  }

  headerHtml.breadcrumb = headerHtml.breadcrumb ??
    '<nav aria-label="Breadcrumb" class="u_relative u_marBXXS u_txtXS c_breadcrumbs">\n' +
      '    <ol class="">\n' +
      '        <li class="u_inline_block">\n' +
      '            <a href="/" class="u_a u_txtColor1 u_align_middle" title="Go to Home Page" aria-label="Go to Home Page">\n' +
      '                <span class="icon_home5" aria-hidden="true"></span>\n' +
      "            </a>\n" +
      "        </li>\n" +
      '        <li class="u_inline_block u_lhf">\n' +
      '            <span class="icon_arrow-right5 u_txtXS u_align_middle u_txtGray2" aria-hidden="true"></span>\n' +
      '            <a href="link.html" class="u_a u_align_middle u_txtColor1">\n' +
      "                <span>Blog</span>\n" +
      "            </a>\n" +
      "        </li>\n" +
      '        <li class="u_inline_block u_lhf u_bold">\n' +
      '            <span class="icon_arrow-right5 u_txtXS u_align_middle u_txtGray2" aria-hidden="true"></span>\n' +
      "        </li>\n" +
      "    </ol>\n" +
      "</nav>";

  headerHtml.language = headerHtml.language ??
    '<div class="c_article_language_toggle u_absoluteTR u_relative@mobile">\n' +
      '    <label class="c_article_header_share u_uppercase u_bold u_txtXXS u_marBXXS u_block u_txtGray4 u_sr_only" for="lang_toggle">Language</label>\n' +
      '    <div class="o_select o_selectS o_select_dark p_option p_option_link u_marBS">\n' +
      '        <select class="o_control" id="lang_toggle" name="lang_toggle" data-phreplace="Select Language">\n' +
      '            <option value="en-US" selected data-href="/sandbox/_pages/blog/en/article_template.jsp">English</option>\n' +
      '            <option value="es-419" data-href="/sandbox/_pages/blog/es/article_template.jsp">Español</option>\n' +
      "        </select>\n" +
      "    </div>\n" +
      "</div>";

  headerHtml.social = headerHtml.social ??
    '<div class="c_article_header_social u_txtS u_txtGray4 u_txt_right">\n' +
      '    <div class="u_flex u_txtGray4 u_align_items_center">\n' +
      '        <span class="c_article_header_share u_uppercase u_bold u_txtXXS u_block u_txtGray4">Share this article</span>\n' +
      '        <a aria-label="Share on Facebook" class="u_a o_btn u_padVXXS u_padHXS o_btnWhite o_btn__in u_block u_txt_center u_align_middle u_marLXXS js_facebook_share p_popit" data-type="default" href="https://www.facebook.com/sharer/sharer.php?u=[THIS URL]?cm_mmc=" ref="nofollow" title="Share on Facebook">\n' +
      '            <span aria-hidden="true" class="icon_facebook"></span>\n' +
      "        </a>\n" +
      '        <a aria-label="Share on Pinterest" class="u_a o_btn u_padVXXS u_padHXS o_btnWhite o_btn__in u_block u_txt_center u_align_middle u_marLXXS p_popit p_social_pinterest" data-share="pinterest" data-type="OTC" href="https://pinterest.com/pin/create/button/?url=[THIS URL]" ref="nofollow" title="Share on Pinterest">\n' +
      '            <span aria-hidden="true" class="icon_pinterest"></span>\n' +
      "        </a>\n" +
      '        <a class="u_a o_btn u_padVXXS u_padHXS o_btnWhite o_btn__in u_block u_txt_center u_align_middle u_marLXXS p_social_email" href="/web/tellAFriend/emailAFriend?article=[THISARTICLE]" ref="nofollow" target="_blank" title="Share on Email">\n' +
      '            <span aria-hidden="true" class="icon_envelop"></span>\n' +
      "        </a>\n" +
      '        <a aria-label="Print this Page" class="u_a o_btn u_padVXXS u_padHXS o_btnWhite o_btn__in u_block u_txt_center u_align_middle u_marLXXS p_social_print p_print" href="#" ref="nofollow" title="Print this page">\n' +
      '            <span aria-hidden="true" class="icon_printer2"></span>\n' +
      "        </a>\n" +
      "    </div>\n" +
      "</div>";

  result.headerHtml = headerHtml;

  const summary = contentDiv.find("div#summary").first();
  if (summary.length) {
    result.summaryHtml = buildSummaryFromGeneric(summary.html() ?? "");
  }

  const clone = load(contentDiv.html() ?? "", { decodeEntities: false });
  clone("#summary").remove();

  const keyTakeaways = clone("#key-takeaways").first();
  if (keyTakeaways.length) {
    result.takeawaysHtml = convertKeyTakeaways(keyTakeaways.html() ?? "");
    keyTakeaways.remove();
  }

  const references = clone("#references").first();
  if (references.length) {
    result.referencesHtml = convertReferences(references.html() ?? "");
    references.remove();
  }

  clone(".post_callout").each((_i, el) => {
    const callout = clone(el);
    let body = callout.find(".post_callout_text").html() ?? callout.html() ??
      "";
    const anchor = callout.find("a").first();
    const href = anchor.attr("href");
    const ctaText = anchor.text().trim();
    const align = callout.hasClass("post_callout_right") ? "right" : "left";
    callout.replaceWith(
      wrapAside(body, href, ctaText, align === "right" ? "right" : "left"),
    );
  });

  const bodyHtml = clone.root().html()?.trim() ?? "";
  if (bodyHtml) {
    const sectionId = slugify(contentDiv.find("h2").first().text()) ||
      "article-content";
    result.articleSections.push(
      `                                <section class="c_article_section u_marBL u_marBM@mobile" id="${sectionId}">
${bodyHtml}
                                </section>`,
    );
  }

  const tocItems: string[] = [];
  $("#toc ul li > a").each((_i, el) => {
    const link = $(el);
    const href = link.attr("href") || "#";
    const text = link.text().trim();
    tocItems.push(
      `<li><a class="u_a p_jump_link u_txtXS u_txtS@mobile u_block u_txtColor1 u_bgColor1_hover u_txtWhite_hover u_padHS u_padVXXS u_padVXS@mobile" href="${href}">${text}</a></li>`,
    );
  });
  if (tocItems.length) {
    result.tocItems = tocItems;
  }

  if (Object.keys(headerHtml).length) {
    result.headerHtml = headerHtml;
  }

  return result;
}
function mergeContent(template: string, content: ExtractedContent): string {
  let result = template;

  if (content.pageTitle) {
    result = replaceBetweenMarkers(
      result,
      "PAGE TITLE",
      `    <title>${content.pageTitle}</title>`,
    );
  }

  if (content.metaDescription) {
    result = result.replace(
      /(<meta name="description" content=")([^"]*)(" \/>)/,
      `$1${content.metaDescription}$3`,
    );
  }

  if (content.canonical) {
    result = result.replace(
      /(<link rel="canonical" href=")([^"]*)(")/,
      `$1${content.canonical}$3`,
    );
  }

  if (content.schema) {
    result = replaceBetweenMarkers(
      result,
      "ARTICLE_SCHEMA",
      stringifySchema(content.schema),
    );
  }

  if (content.headerHtml) {
    const { breadcrumb, language, title, readTime, publish, author, social } =
      content.headerHtml;
    if (breadcrumb) {
      result = replaceBetweenMarkers(result, "BREADCRUMB", breadcrumb);
    }
    if (language) result = replaceBetweenMarkers(result, "LANGUAGE", language);
    if (title) result = replaceBetweenMarkers(result, "TITLE", title);
    if (readTime) result = replaceBetweenMarkers(result, "READ_TIME", readTime);
    if (publish) result = replaceBetweenMarkers(result, "PUBLISH", publish);
    if (author) result = replaceBetweenMarkers(result, "AUTHOR", author);
    if (social) result = replaceBetweenMarkers(result, "SOCIAL", social);
    if (content.headerHtml.headerImage) {
      result = replaceBetweenMarkers(
        result,
        "HEADER_IMAGE",
        content.headerHtml.headerImage,
      );
    }
  }

  if (content.summaryHtml) {
    result = replaceBetweenMarkers(result, "SUMMARY", content.summaryHtml);
  }

  if (content.tocItems?.length) {
    result = result.replace(
      /(<ul class="c_article_toc_list">)[\s\S]*?(<\/ul>)/,
      `$1\n${
        content.tocItems.join("\n")
      }\n                                        $2`,
    );
  }

  let articleBody = "";
  if (content.summaryHtml) {
    articleBody +=
      `                                <!-- START:SUMMARY -->\n${content.summaryHtml}\n                                <!-- END:SUMMARY -->\n\n`;
  }
  articleBody += content.asideBlocks.join("\n\n");
  if (content.articleSections.length) {
    articleBody += "\n" + content.articleSections.join("\n");
  }
  if (content.takeawaysHtml) {
    articleBody +=
      `\n                                <!-- START:FAQ -->\n${content.takeawaysHtml}\n                                <!-- END:FAQ -->\n`;
  }
  if (content.referencesHtml) {
    articleBody +=
      `\n                                <!-- START:REFERENCES -->\n${content.referencesHtml}\n                                <!-- END:REFERENCES -->`;
  }

  articleBody = ensureMarkers(articleBody);
  result = replaceBetweenMarkers(result, "ARTICLE_BODY", articleBody);

  return result;
}

async function convertHtml(sourceHtml: string): Promise<string> {
  const content = extractContent(sourceHtml);
  return mergeContent(TEMPLATE_HTML, content);
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { content_plan_outline_guid } = await req.json();
    if (!content_plan_outline_guid) {
      return new Response(
        JSON.stringify({ error: "content_plan_outline_guid is required" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !supabaseServiceKey) {
      return new Response(
        JSON.stringify({ error: "Missing Supabase configuration" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const supabaseClient = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false },
    });

    const { data, error } = await supabaseClient
      .from("tasks")
      .select("content")
      .eq("content_plan_outline_guid", content_plan_outline_guid)
      .limit(1)
      .maybeSingle();

    if (error || !data?.content) {
      return new Response(JSON.stringify({ error: "Task content not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const converted = await convertHtml(data.content);

    return new Response(JSON.stringify({ html: converted }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error(err);
    return new Response(
      JSON.stringify({ error: "Unexpected error", details: `${err}` }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
