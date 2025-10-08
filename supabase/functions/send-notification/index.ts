// supabase/functions/send-notification/index.ts
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// SendGrid is a popular email service
// You can use any email service by modifying this code
interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
  from?: string;
}

async function sendEmail({ to, subject, html, from = 'noreply@planperfect.com' }: SendEmailOptions) {
  const apiKey = Deno.env.get('SENDGRID_API_KEY')
  
  if (!apiKey) {
    throw new Error('SENDGRID_API_KEY is not set')
  }
  
  const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      personalizations: [{
        to: [{ email: to }]
      }],
      from: { email: from },
      subject,
      content: [{
        type: 'text/html',
        value: html
      }]
    })
  })
  
  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Failed to send email: ${response.status} ${errorText}`)
  }
  
  return response
}

serve(async (req) => {
  // Set CORS headers for all responses
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  }

  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders, status: 204 })
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
  
  try {
    // Parse the request body
    const { task_id, old_status, new_status, email } = await req.json()
    
    console.log(`Processing notification for task ${task_id}, status change from ${old_status} to ${new_status}`)
    
    if (!task_id || !new_status || !email) {
      return new Response(
        JSON.stringify({ error: "task_id, new_status, and email are required" }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }
    
    // Initialize Supabase client with service role key for admin rights
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') || '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
    )
    
    // Fetch the task data
    console.log("Fetching task data...")
    const { data: task, error: fetchError } = await supabaseClient
      .from('tasks')
      .select('task_id, title, client_name, client_domain')
      .eq('task_id', task_id)
      .single()
    
    if (fetchError || !task) {
      console.error("Error fetching task:", fetchError)
      return new Response(
        JSON.stringify({ error: `Failed to fetch task: ${fetchError?.message || 'Task not found'}` }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }
    
    // Generate notification content based on status change
    console.log("Generating notification content...")
    
    const { subject, html } = generateNotificationContent(task, old_status, new_status)
    
    // Send the email notification
    console.log(`Sending email notification to ${email}...`)
    await sendEmail({
      to: email,
      subject,
      html
    })
    
    console.log(`Successfully sent notification for task ${task_id}`)
    
    return new Response(
      JSON.stringify({ 
        success: true, 
        message: "Notification sent successfully"
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error("Error in sending notification:", error)
    
    return new Response(
      JSON.stringify({ error: `Failed to send notification: ${error.message}` }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

// Generate notification content based on status change
function generateNotificationContent(
  task: { task_id: string; title: string; client_name: string; client_domain: string },
  oldStatus: string | null,
  newStatus: string
): { subject: string; html: string } {
  const appUrl = Deno.env.get('APP_URL') || 'https://app.planperfect.com'
  const taskUrl = `${appUrl}/tasks/${task.task_id}`
  
  let subject = '';
  let content = '';
  
  switch (newStatus) {
    case 'Complete':
      subject = `Task Completed: ${task.title}`;
      content = `
        <h1>Task Completed</h1>
        <p>Your task "<strong>${task.title}</strong>" for client "${task.client_name}" has been completed.</p>
        <p>You can view the completed task and results here:</p>
        <p><a href="${taskUrl}" target="_blank">View Task</a></p>
      `;
      break;
      
    case 'In Progress':
      subject = `Task Started: ${task.title}`;
      content = `
        <h1>Task In Progress</h1>
        <p>Your task "<strong>${task.title}</strong>" for client "${task.client_name}" is now in progress.</p>
        <p>You can check the status of your task here:</p>
        <p><a href="${taskUrl}" target="_blank">View Task</a></p>
      `;
      break;
      
    case 'Failed':
      subject = `Task Failed: ${task.title}`;
      content = `
        <h1>Task Processing Failed</h1>
        <p>We encountered an issue while processing your task "<strong>${task.title}</strong>" for client "${task.client_name}".</p>
        <p>Our team has been notified and will look into the issue. You can check the status here:</p>
        <p><a href="${taskUrl}" target="_blank">View Task</a></p>
        <p>If you need immediate assistance, please contact support.</p>
      `;
      break;
      
    case 'Requested':
      subject = `New Task Created: ${task.title}`;
      content = `
        <h1>New Task Created</h1>
        <p>A new task has been created:</p>
        <ul>
          <li><strong>Title:</strong> ${task.title}</li>
          <li><strong>Client:</strong> ${task.client_name}</li>
          <li><strong>Domain:</strong> ${task.client_domain}</li>
        </ul>
        <p>You can view the task details here:</p>
        <p><a href="${taskUrl}" target="_blank">View Task</a></p>
      `;
      break;
      
    default:
      subject = `Task Status Update: ${task.title}`;
      content = `
        <h1>Task Status Updated</h1>
        <p>The status of your task "<strong>${task.title}</strong>" for client "${task.client_name}" has been updated to <strong>${newStatus}</strong>.</p>
        <p>You can view the current status here:</p>
        <p><a href="${taskUrl}" target="_blank">View Task</a></p>
      `;
  }
  
  // Common email template
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${subject}</title>
      <style>
        body {
          font-family: Arial, sans-serif;
          line-height: 1.6;
          color: #333;
          max-width: 600px;
          margin: 0 auto;
          padding: 20px;
        }
        h1 {
          color: #1a5f7a;
        }
        a {
          color: #1a5f7a;
          text-decoration: none;
        }
        a:hover {
          text-decoration: underline;
        }
        .button {
          display: inline-block;
          padding: 10px 20px;
          background-color: #1a5f7a;
          color: white !important;
          text-decoration: none;
          border-radius: 5px;
          margin: 20px 0;
        }
        .footer {
          margin-top: 30px;
          padding-top: 20px;
          border-top: 1px solid #eee;
          font-size: 12px;
          color: #666;
        }
      </style>
    </head>
    <body>
      ${content}
      
      <div class="footer">
        <p>This is an automated notification from PlanPerfect. Please do not reply directly to this email.</p>
        <p>© ${new Date().getFullYear()} PlanPerfect</p>
      </div>
    </body>
    </html>
  `;
  
  return { subject, html };
}