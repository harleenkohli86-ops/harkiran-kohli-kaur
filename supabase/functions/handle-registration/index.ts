// Supabase Edge Function: handle-registration
// Formats and sends official New Student Registration notification to hk.code.of.rankers@gmail.com
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    if (!resendApiKey) {
      return new Response(
        JSON.stringify({ error: "RESEND_API_KEY not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const payload = await req.json();
    const record = payload.record || payload;

    const studentId = record.student_id || record.studentId || "N/A";
    const studentName = record.name || record.fullName || "N/A";
    const studentEmail = record.email || "N/A";
    const studentPhone = record.phone || "N/A";
    const program = record.program || "CS Executive";
    const level = record.level || "";
    const group = record.group || "";
    const levelGroup = [level, group].filter(Boolean).join(" / ") || record.subject_mode || "Group 1";
    const attempt = record.attempt || record.targetExam || "June / Dec 2026";

    const regDateObj = record.created_at ? new Date(record.created_at) : new Date();
    const regDate = regDateObj.toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "long",
      year: "numeric",
      timeZone: "Asia/Kolkata",
    });
    const regTime = regDateObj.toLocaleTimeString("en-IN", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
      timeZone: "Asia/Kolkata",
    });

    const subject = "New Student Registration – HK Code of Rankers";
    const text = `A new student has registered on the website.

Student Details:

Student ID: ${studentId}
Student Name: ${studentName}
Email: ${studentEmail}
Phone: ${studentPhone}
Program: ${program}
Level/Group: ${levelGroup}
Attempt: ${attempt}
Registration Date: ${regDate}
Registration Time: ${regTime}

Please login to the Admin Portal to review/manage the student.`;

    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 12px; overflow: hidden; border: 1px solid #e5dfd3;">
        <div style="background: #0F0F0F; padding: 24px; text-align: center; border-bottom: 3px solid #C8A45D;">
          <h2 style="color: #FFE3A0; margin: 0; font-size: 20px; letter-spacing: 1px;">HK CODE OF RANKERS</h2>
          <p style="color: #A3A3A3; margin: 4px 0 0 0; font-size: 12px;">New Student Registration Notification</p>
        </div>
        <div style="padding: 32px 24px; color: #1f2937;">
          <p style="margin-top: 0; font-size: 15px; font-weight: 600;">A new student has registered on the website.</p>
          
          <div style="background: #F9FAFB; border: 1px solid #E5E7EB; border-radius: 10px; padding: 20px; margin: 20px 0;">
            <h3 style="margin-top: 0; font-size: 14px; color: #8A651E; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 1px solid #E5E7EB; padding-bottom: 8px;">Student Details</h3>
            
            <table style="width: 100%; font-size: 13px; line-height: 1.8;">
              <tr><td style="color: #6B7280; width: 140px;">Student ID:</td><td style="font-weight: 600; color: #111827;">${studentId}</td></tr>
              <tr><td style="color: #6B7280;">Student Name:</td><td style="font-weight: 600; color: #111827;">${studentName}</td></tr>
              <tr><td style="color: #6B7280;">Email:</td><td style="font-weight: 600; color: #111827;"><a href="mailto:${studentEmail}" style="color: #111827; text-decoration: none;">${studentEmail}</a></td></tr>
              <tr><td style="color: #6B7280;">Phone:</td><td style="font-weight: 600; color: #111827;">${studentPhone}</td></tr>
              <tr><td style="color: #6B7280;">Program:</td><td style="font-weight: 600; color: #111827;">${program}</td></tr>
              <tr><td style="color: #6B7280;">Level/Group:</td><td style="font-weight: 600; color: #111827;">${levelGroup}</td></tr>
              <tr><td style="color: #6B7280;">Attempt:</td><td style="font-weight: 600; color: #111827;">${attempt}</td></tr>
              <tr><td style="color: #6B7280;">Registration Date:</td><td style="font-weight: 600; color: #111827;">${regDate}</td></tr>
              <tr><td style="color: #6B7280;">Registration Time:</td><td style="font-weight: 600; color: #111827;">${regTime}</td></tr>
            </table>
          </div>

          <p style="font-size: 13px; color: #4B5563;">Please login to the Admin Portal to review/manage the student.</p>

          <div style="text-align: center; margin: 28px 0 16px 0;">
            <a href="https://hkcodeofrankers.com/admin" style="background: #0F0F0F; color: #FFE3A0; border: 1px solid #C8A45D; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-size: 13px; font-weight: 600; display: inline-block;">
              Open Admin Portal &rarr;
            </a>
          </div>
        </div>
      </div>
    `;

    const sender = Deno.env.get("RESEND_FROM_EMAIL") || "HK Code of Rankers <onboarding@resend.dev>";
    const recipient = Deno.env.get("ADMIN_NOTIFICATION_EMAIL") || "hk.code.of.rankers@gmail.com";

    const resendResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: sender,
        to: [recipient],
        subject,
        text,
        html,
      }),
    });

    const resendData = await resendResponse.json();

    return new Response(JSON.stringify({ success: resendResponse.ok, data: resendData }), {
      status: resendResponse.status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
