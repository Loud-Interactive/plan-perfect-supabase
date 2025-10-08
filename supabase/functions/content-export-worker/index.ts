import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { insertEvent, supabaseAdmin } from "../_shared/client.ts";
import { enqueueJob } from "../_shared/queue.ts";
import { registerBeforeUnload, runBackground } from "../_shared/runtime.ts";
import { completeStage, failStage, startStage } from "../_shared/stages.ts";
import { fetchClientSynopsis } from "../_shared/synopsis.ts";
import {
  addStyleTag,
  htmlToMarkdown,
  inlineImages,
  markdownToHtml,
  reinstituteCitations,
} from "../_shared/html.ts";
import { sendEmail } from "../_shared/email.ts";
import { uploadHtmlToDrive } from "../_shared/googleDrive.ts";
import { updateLegacyTask } from "../_shared/tasks.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

registerBeforeUnload(() => console.log("content-export-worker terminating"));

async function uploadHtml(jobId: string, html: string) {
  const bucket = Deno.env.get("CONTENT_BUCKET") ?? "content-html";
  const fileName = `${jobId}.html`;
  const arrayBuffer = new TextEncoder().encode(html);
  const { error } = await supabaseAdmin.storage.from(bucket).upload(
    fileName,
    arrayBuffer,
    {
      upsert: true,
      contentType: "text/html; charset=utf-8",
    },
  );
  if (error) {
    console.error("Failed to upload html", error);
    await insertEvent(jobId, "error", "Storage upload failed", { error });
    throw error;
  }
  const { data: signedData } = await supabaseAdmin.storage.from(bucket)
    .createSignedUrl(fileName, 60 * 60 * 24 * 7);
  const publicUrlResponse = supabaseAdmin.storage.from(bucket).getPublicUrl(
    fileName,
  );
  const publicUrl = publicUrlResponse.data?.publicUrl ?? null;
  return {
    bucket,
    fileName,
    signedUrl: signedData?.signedUrl ?? null,
    publicUrl,
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: corsHeaders,
    });
  }

  const visibility = Number(Deno.env.get("CONTENT_QUEUE_VISIBILITY") ?? "600");
  const { data, error } = await supabaseAdmin.rpc("dequeue_stage", {
    p_queue: "content",
    p_visibility: visibility,
  });
  if (error) {
    console.error("Failed to pop export message", error);
    return new Response(JSON.stringify({ error: "queue_pop_failed" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (!data || data.length === 0) {
    return new Response(JSON.stringify({ message: "no messages" }), {
      status: 204,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const record = data[0] as {
    msg_id: number;
    message: {
      job_id: string;
      stage?: string;
      payload?: Record<string, unknown>;
    };
  };
  const { msg_id, message } = record;
  const jobId = message?.job_id;
  const stage = message?.stage ?? "distribution";

  if (!jobId) {
    await supabaseAdmin.rpc("archive_message", {
      p_queue: "content",
      p_msg_id: msg_id,
    });
    return new Response(
      JSON.stringify({ message: "invalid message archived" }),
      {
        status: 202,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }

  if (stage !== "distribution") {
    await enqueueJob("content", jobId, stage, message?.payload ?? {});
    await supabaseAdmin.rpc("archive_message", {
      p_queue: "content",
      p_msg_id: msg_id,
    });
    return new Response(
      JSON.stringify({ message: `forwarded stage ${stage}` }),
      {
        status: 202,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }

  await insertEvent(jobId, "processing", "Distribution stage started");
  const attempt = await startStage(jobId, "distribution");
  const maxAttempts = Number(Deno.env.get("CONTENT_STAGE_MAX_ATTEMPTS") ?? "3");

  const { data: job } = await supabaseAdmin
    .from("content_jobs")
    .select("payload, requester_email")
    .eq("id", jobId)
    .maybeSingle();

  const { data: draftData } = await supabaseAdmin
    .from("content_payloads")
    .select("data")
    .eq("job_id", jobId)
    .eq("stage", "draft")
    .maybeSingle();

  if (!job) {
    throw new Error(`Job ${jobId} not found`);
  }

  if (!draftData) {
    throw new Error(`Draft payload missing for job ${jobId}`);
  }

  const payload = (job.payload ?? {}) as Record<string, unknown>;
  const requesterEmail = job.requester_email as string | undefined;
  const draftSections = Array.isArray(draftData.data?.sections)
    ? (draftData.data.sections as string[])
    : [];
  const markdown = draftSections.join("\n\n") ||
    htmlToMarkdown(String(payload?.html ?? ""));
  const clientDomain = (payload?.client_domain as string) ?? "";
  const outlineGuid = payload?.content_plan_outline_guid as string | undefined;
  const articleTitle = (payload?.title as string) ??
    (payload?.keyword as string) ?? "ContentPerfect Article";

  const work = (async () => {
    try {
      if (!markdown) {
        throw new Error("Draft markdown missing for distribution stage");
      }

      const synopsis = await fetchClientSynopsis(clientDomain);
      const synopsisRecord = (synopsis ?? {}) as Record<string, unknown>;
      const domainForPrompts = clientDomain ||
        (typeof synopsisRecord.domain === "string"
          ? (synopsisRecord.domain as string)
          : null);

      const htmlFromLLM = await markdownToHtml(
        markdown,
        synopsisRecord,
        Boolean(payload?.regenerate),
        domainForPrompts ?? undefined,
      );
      let htmlWithStyle = addStyleTag(htmlFromLLM, synopsisRecord);
      htmlWithStyle = await inlineImages(htmlWithStyle);
      const finalHtml = await reinstituteCitations(
        htmlWithStyle,
        markdown,
        synopsisRecord,
        domainForPrompts ?? undefined,
      );

      const asset = await uploadHtml(jobId, finalHtml);

      const { error: assetError } = await supabaseAdmin
        .from("content_assets")
        .insert({
          job_id: jobId,
          asset_type: "html",
          storage_path: `${asset.bucket}/${asset.fileName}`,
          external_url: asset.signedUrl,
        });

      if (assetError) {
        throw assetError;
      }

      const driveLink = await uploadHtmlToDrive(
        `${articleTitle}.html`,
        finalHtml,
        Deno.env.get("GOOGLE_DRIVE_PARENT_FOLDER_ID") ?? undefined,
      );

      const htmlLinkForTask = asset.publicUrl ?? asset.signedUrl ?? driveLink ??
        null;
      const googleDocLinkForTask = driveLink ?? asset.publicUrl ??
        asset.signedUrl ?? null;

      await updateLegacyTask(outlineGuid, {
        status: "Complete",
        content: finalHtml,
        unedited_content: markdown,
        html_link: htmlLinkForTask,
        google_doc_link: googleDocLinkForTask,
        message: "Content export completed",
      });

      const emailBody =
        `<p>Your HTML content for <strong>${clientDomain}</strong> is ready.</p><p><a href="${
          driveLink ?? "#"
        }">Google Drive Link</a></p>`;
      const notifyEmails = [
        requesterEmail,
        ...(Deno.env.get("TEAM_NOTIFY_EMAILS") ?? "").split(","),
      ]
        .map((e) => e?.trim())
        .filter(Boolean) as string[];
      for (const email of notifyEmails) {
        try {
          await sendEmail(email, `[HTML READY] ${articleTitle}`, emailBody);
        } catch (emailError) {
          console.error("Failed to send notification email", emailError);
        }
      }

      await completeStage(jobId, "distribution");

      await supabaseAdmin
        .from("content_jobs")
        .update({
          stage: "complete",
          status: "completed",
          result: {
            storage: asset,
            drive_link: driveLink,
          },
        })
        .eq("id", jobId);

      await insertEvent(jobId, "completed", "Distribution stage completed", {
        storage: asset,
        drive_link: driveLink,
      });

      await enqueueJob("content", jobId, "complete", {});
      await supabaseAdmin.rpc("archive_message", {
        p_queue: "content",
        p_msg_id: msg_id,
      });
    } catch (workerError) {
      console.error("Distribution worker failure", workerError);
      await insertEvent(jobId, "error", "Distribution stage failed", {
        error: workerError,
      });
      await failStage(jobId, "distribution", workerError);
      if (attempt < maxAttempts) {
        await enqueueJob("content", jobId, "distribution", {});
      }
      await supabaseAdmin.rpc("archive_message", {
        p_queue: "content",
        p_msg_id: msg_id,
      });
    }
  })();

  runBackground(work);

  return new Response(
    JSON.stringify({ message: "distribution stage scheduled", job_id: jobId }),
    {
      status: 202,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    },
  );
});
