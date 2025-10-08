const SENDGRID_API_KEY = Deno.env.get('SEND_GRID_API_KEY')
const SENDGRID_FROM_EMAIL = Deno.env.get('SENDGRID_FROM_EMAIL') ?? 'no-reply@contentperfect.ai'

if (!SENDGRID_API_KEY) {
  console.warn('SEND_GRID_API_KEY not set—emails will not send')
}

export async function sendEmail(to: string, subject: string, html: string) {
  if (!SENDGRID_API_KEY) {
    console.warn('SendGrid key missing, skipping email')
    return
  }

  const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SENDGRID_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: to }] }],
      from: { email: SENDGRID_FROM_EMAIL },
      subject,
      content: [{ type: 'text/html', value: html }],
    }),
  })

  if (!response.ok) {
    const text = await response.text()
    console.error('SendGrid error', response.status, text)
    throw new Error(`SendGrid error ${response.status}`)
  }
}
