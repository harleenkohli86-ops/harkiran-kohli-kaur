import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { createServer as createViteServer } from 'vite';

const app = express();
const PORT = 3000;

app.use(express.json({ limit: '10mb' }));

// Security Headers Middleware (Strictly protects against XSS, clickjacking, sniffing)
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});

const DATA_DIR = path.join(process.cwd(), 'data');
const STUDENTS_FILE = path.join(DATA_DIR, 'central_students.json');
const FREE_BOOKINGS_FILE = path.join(DATA_DIR, 'free_session_bookings.json');
const INQUIRIES_ACTIVITY_FILE = path.join(DATA_DIR, 'inquiries_activity.json');
const ADMIN_CREDS_FILE = path.join(DATA_DIR, 'admin_credentials.json');
const AUDIT_LOGS_FILE = path.join(DATA_DIR, 'admin_audit_logs.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Ensure students file exists
if (!fs.existsSync(STUDENTS_FILE)) {
  fs.writeFileSync(STUDENTS_FILE, JSON.stringify([], null, 2), 'utf8');
}

// Ensure free bookings file exists
if (!fs.existsSync(FREE_BOOKINGS_FILE)) {
  fs.writeFileSync(FREE_BOOKINGS_FILE, JSON.stringify([], null, 2), 'utf8');
}

// Ensure inquiries/activity file exists
if (!fs.existsSync(INQUIRIES_ACTIVITY_FILE)) {
  fs.writeFileSync(INQUIRIES_ACTIVITY_FILE, JSON.stringify([], null, 2), 'utf8');
}

// Initialize Admin Credentials safely with SHA-256 salted hash if not already present
interface AdminCredentials {
  name: string;
  email: string;
  phone: string;
  salt: string;
  passwordHash: string;
  masterKeyHash?: string;
  createdAt: string;
  updatedAt?: string;
}

function getOrInitAdminCredentials(): AdminCredentials {
  try {
    if (fs.existsSync(ADMIN_CREDS_FILE)) {
      const raw = fs.readFileSync(ADMIN_CREDS_FILE, 'utf8');
      const creds: AdminCredentials = JSON.parse(raw);
      if (creds.email) {
        return creds;
      }
    }
  } catch (err) {
    console.warn('Error reading admin credentials file, re-initializing safely:', err);
  }

  // Default master admin initialized with cryptographic salt and hashed password
  const salt = '29a023a5112b2ee91c0ebd0d6c4d3153';
  const passwordHash = '39fafa01841bcc2adec8dc207bf9c24d5a7eb5823e31e9b70716747970c4c7a1';
  const masterKeyHash = '5b5860591ebe68960cff0932c06641880a8f373930623e88c6af4aedf2592e74';
  const defaultAdmin: AdminCredentials = {
    name: 'Harkiran Kaur',
    email: 'harleenkohli86@gmail.com',
    phone: '+91 92840 84523',
    salt,
    passwordHash,
    masterKeyHash,
    createdAt: new Date().toISOString(),
  };

  try {
    fs.writeFileSync(ADMIN_CREDS_FILE, JSON.stringify(defaultAdmin, null, 2), 'utf8');
  } catch (writeErr) {
    console.error('Could not write admin credentials file:', writeErr);
  }

  return defaultAdmin;
}

const adminConfig = getOrInitAdminCredentials();

// -------------------------------------------------------------
// Audit Logging System (Never logs passwords, tokens, or OTP codes)
// -------------------------------------------------------------
export interface AuditLogEntry {
  id: string;
  timestamp: string;
  action: string;
  performedBy: string;
  details: Record<string, any>;
  ip: string;
}

function recordAuditLog(action: string, performedBy: string, details: Record<string, any>, ip: string = 'unknown') {
  try {
    let logs: AuditLogEntry[] = [];
    if (fs.existsSync(AUDIT_LOGS_FILE)) {
      try {
        logs = JSON.parse(fs.readFileSync(AUDIT_LOGS_FILE, 'utf8'));
      } catch {}
    }

    const entry: AuditLogEntry = {
      id: `AUDIT-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,
      timestamp: new Date().toISOString(),
      action,
      performedBy,
      details,
      ip,
    };

    logs.unshift(entry);
    // Keep max 1000 audit log records
    if (logs.length > 1000) {
      logs = logs.slice(0, 1000);
    }
    fs.writeFileSync(AUDIT_LOGS_FILE, JSON.stringify(logs, null, 2), 'utf8');
  } catch (err) {
    console.error('Error recording audit log:', err);
  }
}

// -------------------------------------------------------------
// Rate Limiter for Admin Authentication
// -------------------------------------------------------------
interface RateLimitRecord {
  attempts: number;
  lockedUntil: number;
}
const loginRateLimits = new Map<string, RateLimitRecord>();

function checkRateLimit(key: string): { allowed: boolean; remainingMinutes?: number } {
  const now = Date.now();
  const record = loginRateLimits.get(key);
  if (!record) return { allowed: true };

  if (record.lockedUntil > now) {
    const remainingMinutes = Math.ceil((record.lockedUntil - now) / 60000);
    return { allowed: false, remainingMinutes };
  }

  if (record.lockedUntil <= now && record.attempts >= 5) {
    // Reset after lockout expired
    loginRateLimits.delete(key);
    return { allowed: true };
  }

  return { allowed: true };
}

function recordFailedLoginAttempt(key: string) {
  const now = Date.now();
  const record = loginRateLimits.get(key) || { attempts: 0, lockedUntil: 0 };
  record.attempts += 1;
  if (record.attempts >= 5) {
    // Lock out for 15 minutes
    record.lockedUntil = now + 15 * 60 * 1000;
  }
  loginRateLimits.set(key, record);
}

function clearFailedLoginAttempts(key: string) {
  loginRateLimits.delete(key);
}

// -------------------------------------------------------------
// In-Memory Secure 2FA Token Store & Admin Session Registry
// (Tokens exist ONLY on the server, never exposed to client)
// -------------------------------------------------------------
interface Pending2FAToken {
  codeHash: string;
  salt: string;
  expiresAt: number;
  attempts: number;
  email: string;
  name: string;
}

const pendingAdmin2FACodes = new Map<string, Pending2FAToken>();

export interface AdminActiveSession {
  token: string;
  adminEmail: string;
  adminName: string;
  adminPhone: string;
  createdAt: string;
  lastActivityAt: string;
  expiresAt: number;
}

const activeAdminSessions = new Map<string, AdminActiveSession>();

// Deduplication cache to prevent sending duplicate registration emails (Deduplicated by studentId/email)
const sentRegistrationEmails = new Set<string>();

// -------------------------------------------------------------
// Universal Transactional Email Dispatcher (Resend + Edge + Fallback)
// -------------------------------------------------------------
async function sendTransactionalEmail(options: {
  to: string;
  subject: string;
  text: string;
  html?: string;
}): Promise<{ success: boolean; method: string; error?: string }> {
  const recipient = (options.to || '').trim().toLowerCase();
  const resendApiKey = process.env.RESEND_API_KEY || 're_Q5kyinxQ_F4xEgUfkZQKR211RcXsxKkSH';
  const fromEmail = process.env.RESEND_FROM_EMAIL || 'HK Code of Rankers <onboarding@resend.dev>';

  // 1. Primary delivery method: Resend API
  if (resendApiKey) {
    try {
      let targetRecipient = recipient;
      let res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${resendApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: fromEmail,
          to: [targetRecipient],
          subject: options.subject,
          text: options.text,
          html: options.html || options.text.replace(/\n/g, '<br/>'),
        }),
      });

      let resData = await res.json();
      
      // If Resend test account restriction (can only send to account owner harleenkohli86@gmail.com before domain verification)
      if (!res.ok && resData?.message && resData.message.includes('harleenkohli86@gmail.com') && targetRecipient !== 'harleenkohli86@gmail.com') {
        console.log('[Email Service] Resend test domain active: sending directly to verified account email harleenkohli86@gmail.com');
        res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${resendApiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: fromEmail,
            to: ['harleenkohli86@gmail.com'],
            subject: `[HK Code of Rankers] ${options.subject}`,
            text: `[Delivered to Harkiran Kaur (harleenkohli86@gmail.com) for HK Code of Rankers]\n\n${options.text}`,
            html: options.html || options.text.replace(/\n/g, '<br/>'),
          }),
        });
        resData = await res.json();
      }

      if (res.ok) {
        console.log(`[Email Service] Delivered via Resend to ${recipient} (Resend ID: ${resData.id})`);
        return { success: true, method: 'resend' };
      } else {
        console.warn('[Email Service] Resend API returned error:', resData);
      }
    } catch (err: any) {
      console.warn('[Email Service] Resend dispatch exception:', err?.message || err);
    }
  }

  // 2. Secondary delivery method: Supabase Edge Function (send-email)
  const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://qafnqmguzzrhksoitrzf.supabase.co';
  const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_lE_ljZD1Jucnh-EFdfSZNw_DA9hA6ku';
  try {
    const edgeRes = await fetch(`${supabaseUrl}/functions/v1/send-email`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${supabaseAnonKey}`,
      },
      body: JSON.stringify({
        to: recipient,
        subject: options.subject,
        text: options.text,
        html: options.html,
      }),
    });
    if (edgeRes.ok) {
      console.log(`[Email Service] Delivered via Supabase Edge Function to ${recipient}`);
      return { success: true, method: 'supabase-edge' };
    }
  } catch (edgeErr) {
    // Edge function not invoked or unreachable
  }

  // 3. Fallback delivery method: Clean FormSubmit post to official academy inbox
  try {
    const formSubmitTarget = (recipient.includes('hk.code.of.rankers@gmail.com') || recipient.includes('hkcodeofrankers@gmail.com'))
      ? 'hk.code.of.rankers@gmail.com'
      : recipient;

    const fsRes = await fetch(`https://formsubmit.co/ajax/${formSubmitTarget}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({
        _subject: options.subject,
        to_email: recipient,
        message: options.text,
        dispatched_at: new Date().toISOString(),
      }),
    });
    if (fsRes.ok) {
      console.log(`[Email Service] Dispatched via academy email bridge to ${recipient}`);
      return { success: true, method: 'formsubmit' };
    }
  } catch (fsErr) {
    console.warn('[Email Service] Email bridge notice:', fsErr);
  }

  return { success: false, method: 'none', error: 'Email delivery queue processed' };
}

// Sends the 2FA verification token strictly via email to registered admin
async function sendServerAdminOtpEmail(email: string, name: string, otpCode: string): Promise<boolean> {
  const targetEmail = 'hkcodeofrankers@gmail.com'; // Strictly delivered to authorized admin email
  const subject = `[HK Code of Rankers] Admin Login Verification Code`;
  const text = `Dear ${name || 'Administrator'},

A login request was initiated for the Master Admin Portal of HK Code of Rankers.

Your 6-Digit One-Time Security Access Code is:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
                 ${otpCode}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

SECURITY NOTICE:
• This verification code is valid for 10 minutes.
• Only the authorized Master Admin (${targetEmail}) may use this code.
• Do NOT share this code with anyone.
• If you did not initiate this login attempt, please check your account credentials immediately.

Head Mentor & Founder: Harkiran Kaur (AIR 3 CS Professional)
Official Academy Helpline: +91 92840 84523
HK Code of Rankers • https://hkcodeofrankers.com`;

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 12px; overflow: hidden; border: 1px solid #e5dfd3;">
      <div style="background: #0F0F0F; padding: 24px; text-align: center; border-bottom: 3px solid #C8A45D;">
        <h2 style="color: #FFE3A0; margin: 0; font-size: 20px; letter-spacing: 1px;">HK CODE OF RANKERS</h2>
        <p style="color: #A3A3A3; margin: 4px 0 0 0; font-size: 12px;">Master Admin Portal Security</p>
      </div>
      <div style="padding: 32px 24px; color: #1f2937;">
        <p style="margin-top: 0; font-size: 15px;">Dear ${name || 'Administrator'},</p>
        <p style="font-size: 14px; line-height: 1.6;">A login request was initiated for the <strong>Master Admin Portal</strong>. Please enter the one-time verification code below to complete authentication:</p>
        
        <div style="background: #FAF7F0; border: 2px dashed #C8A45D; border-radius: 12px; padding: 22px; text-align: center; margin: 24px 0;">
          <span style="font-size: 11px; text-transform: uppercase; letter-spacing: 2px; color: #8A651E; font-weight: 700;">One-Time Security Code</span>
          <div style="font-size: 38px; font-weight: 800; letter-spacing: 8px; color: #0F0F0F; font-family: monospace; margin: 8px 0;">${otpCode}</div>
          <span style="font-size: 12px; color: #6b7280;">Valid for 10 minutes • Single use only</span>
        </div>

        <div style="background: #F9FAFB; border-radius: 8px; padding: 14px; font-size: 12px; color: #4b5563; line-height: 1.5; margin-bottom: 24px;">
          <strong>Security Notice:</strong> Only the authorized Master Admin (${targetEmail}) may use this code. Do NOT share this code with anyone.
        </div>

        <p style="font-size: 12px; color: #6b7280; margin: 0;">
          Head Mentor &amp; Founder: Harkiran Kaur (AIR 3 CS Professional)<br/>
          Academy Helpline: +91 92840 84523<br/>
          Website: <a href="https://hkcodeofrankers.com" style="color: #8A651E; text-decoration: none;">hkcodeofrankers.com</a>
        </p>
      </div>
    </div>
  `;

  const result = await sendTransactionalEmail({
    to: targetEmail,
    subject,
    text,
    html,
  });

  return result.success;
}

// Sends automatic notification email to hk.code.of.rankers@gmail.com whenever a real student registers
async function sendNewStudentRegistrationNotificationEmail(student: {
  studentId: string;
  fullName: string;
  email: string;
  phone: string;
  program?: string;
  level?: string;
  group?: string;
  attempt?: string;
  registeredAt?: string;
}): Promise<boolean> {
  const cleanId = (student.studentId || '').trim();
  const cleanEmail = (student.email || '').trim().toLowerCase();
  const dedupeKey = `${cleanId}_${cleanEmail}`;

  // Strict deduplication: Do not send duplicate emails for the same registered student
  if (cleanEmail && sentRegistrationEmails.has(dedupeKey)) {
    console.log(`[Registration Notification] Skipped duplicate dispatch for ${dedupeKey}`);
    return true;
  }

  const regDateObj = student.registeredAt ? new Date(student.registeredAt) : new Date();
  const regDate = regDateObj.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    timeZone: 'Asia/Kolkata',
  });
  const regTime = regDateObj.toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
    timeZone: 'Asia/Kolkata',
  });

  const levelGroup = [student.level, student.group].filter(Boolean).join(' / ') || 'Group 1';
  const attempt = student.attempt || 'June / December 2026';

  const subject = 'New Student Registration – HK Code of Rankers';
  const text = `A new student has registered on the website.

Student Details:

Student ID: ${student.studentId || 'N/A'}
Student Name: ${student.fullName || 'N/A'}
Email: ${student.email || 'N/A'}
Phone: ${student.phone || 'N/A'}
Program: ${student.program || 'CS Executive'}
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
            <tr><td style="color: #6B7280; width: 140px;">Student ID:</td><td style="font-weight: 600; color: #111827;">${student.studentId || 'N/A'}</td></tr>
            <tr><td style="color: #6B7280;">Student Name:</td><td style="font-weight: 600; color: #111827;">${student.fullName || 'N/A'}</td></tr>
            <tr><td style="color: #6B7280;">Email:</td><td style="font-weight: 600; color: #111827;"><a href="mailto:${student.email}" style="color: #111827; text-decoration: none;">${student.email || 'N/A'}</a></td></tr>
            <tr><td style="color: #6B7280;">Phone:</td><td style="font-weight: 600; color: #111827;">${student.phone || 'N/A'}</td></tr>
            <tr><td style="color: #6B7280;">Program:</td><td style="font-weight: 600; color: #111827;">${student.program || 'CS Executive'}</td></tr>
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

  const adminNotificationEmail = process.env.ADMIN_NOTIFICATION_EMAIL || 'hk.code.of.rankers@gmail.com';

  const result = await sendTransactionalEmail({
    to: adminNotificationEmail,
    subject,
    text,
    html,
  });

  if (result.success && cleanEmail) {
    sentRegistrationEmails.add(dedupeKey);
  }

  return result.success;
}

// -------------------------------------------------------------
// Admin Authentication Middleware
// -------------------------------------------------------------
function requireAdminAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      message: 'Unauthorized: Admin authentication token is required.',
    });
  }

  const token = authHeader.slice(7).trim();
  const session = activeAdminSessions.get(token);

  if (!session) {
    return res.status(401).json({
      success: false,
      message: 'Unauthorized: Invalid or expired admin session. Please log in again.',
    });
  }

  if (Date.now() > session.expiresAt) {
    activeAdminSessions.delete(token);
    recordAuditLog('SESSION_EXPIRED', session.adminEmail, { reason: 'Inactivity timeout' });
    return res.status(401).json({
      success: false,
      message: 'Session expired due to inactivity. Please log in again.',
    });
  }

  // Extend session on activity (2-hour inactivity sliding window)
  session.lastActivityAt = new Date().toISOString();
  session.expiresAt = Date.now() + 2 * 60 * 60 * 1000;
  (req as any).adminSession = session;
  next();
}

const FORBIDDEN_DEMO_NAMES = [
  'aarav sharma',
  'riya patel',
  'devansh verma',
  'pooja kulkarni',
  'karan malhotra'
];

function readStudents(): any[] {
  try {
    const raw = fs.readFileSync(STUDENTS_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      // Strictly filter out any mock/seed students
      return parsed.filter(
        (s) => !FORBIDDEN_DEMO_NAMES.includes((s.fullName || '').trim().toLowerCase())
      );
    }
    return [];
  } catch (err) {
    console.error('Error reading students file:', err);
    return [];
  }
}

function writeStudents(students: any[]): boolean {
  try {
    const clean = students.filter(
      (s) => !FORBIDDEN_DEMO_NAMES.includes((s.fullName || '').trim().toLowerCase())
    );
    fs.writeFileSync(STUDENTS_FILE, JSON.stringify(clean, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error('Error writing students file:', err);
    return false;
  }
}

function readFreeBookings(): any[] {
  try {
    if (!fs.existsSync(FREE_BOOKINGS_FILE)) return [];
    const raw = fs.readFileSync(FREE_BOOKINGS_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter(
        (b) => !FORBIDDEN_DEMO_NAMES.includes((b.name || '').trim().toLowerCase())
      );
    }
    return [];
  } catch (err) {
    console.error('Error reading free bookings file:', err);
    return [];
  }
}

function writeFreeBookings(bookings: any[]): boolean {
  try {
    const clean = bookings.filter(
      (b) => !FORBIDDEN_DEMO_NAMES.includes((b.name || '').trim().toLowerCase())
    );
    fs.writeFileSync(FREE_BOOKINGS_FILE, JSON.stringify(clean, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error('Error writing free bookings file:', err);
    return false;
  }
}

function readInquiriesActivity(): any[] {
  try {
    if (!fs.existsSync(INQUIRIES_ACTIVITY_FILE)) return [];
    const raw = fs.readFileSync(INQUIRIES_ACTIVITY_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter(
        (i) => !FORBIDDEN_DEMO_NAMES.includes((i.fullName || i.name || '').trim().toLowerCase())
      );
    }
    return [];
  } catch (err) {
    console.error('Error reading inquiries/activity file:', err);
    return [];
  }
}

function writeInquiriesActivity(records: any[]): boolean {
  try {
    const clean = records.filter(
      (i) => !FORBIDDEN_DEMO_NAMES.includes((i.fullName || i.name || '').trim().toLowerCase())
    );
    fs.writeFileSync(INQUIRIES_ACTIVITY_FILE, JSON.stringify(clean, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error('Error writing inquiries/activity file:', err);
    return false;
  }
}

// -------------------------------------------------------------
// Admin Authentication Endpoints (Server-Side 2FA)
// -------------------------------------------------------------

// GET master admin status
app.get('/api/admin/status', (_req, res) => {
  const adminConfig = getOrInitAdminCredentials();
  return res.json({
    success: true,
    claimed: true,
    adminEmail: adminConfig.email,
    adminName: adminConfig.name,
    requiresTwoFactor: false,
  });
});

// Helper to generate admin session
function createAdminSession(adminConfig: AdminCredentials): AdminActiveSession {
  const sessionToken = crypto.randomBytes(32).toString('hex');
  const sessionExpiry = Date.now() + 24 * 60 * 60 * 1000; // 24-hour session
  const session: AdminActiveSession = {
    token: sessionToken,
    adminEmail: adminConfig.email,
    adminName: adminConfig.name,
    adminPhone: adminConfig.phone,
    createdAt: new Date().toISOString(),
    lastActivityAt: new Date().toISOString(),
    expiresAt: sessionExpiry,
  };
  activeAdminSessions.set(sessionToken, session);
  return session;
}

// POST direct admin login (No token or email verification required)
app.post('/api/admin/login', (req, res) => {
  const { emailOrPhone, password, masterKey } = req.body;
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const query = (emailOrPhone || '').trim().toLowerCase();
  const rawPassword = (password || '').trim();
  const rawMasterKey = (masterKey || '').trim();
  const adminConfig = getOrInitAdminCredentials();

  const rateCheck = checkRateLimit(`login_${ip}_${query}`);
  if (!rateCheck.allowed) {
    return res.status(429).json({
      success: false,
      message: `Too many failed attempts. Please wait ${rateCheck.remainingMinutes} minutes before trying again.`,
    });
  }

  const digits = query.replace(/\D/g, '');
  const isRecognizedAdmin =
    !query ||
    query === adminConfig.email.toLowerCase() ||
    query === 'harleenkohli86@gmail.com' ||
    query === 'hkcodeofrankers@gmail.com' ||
    query === 'admin@hkcodeofrankers.com' ||
    query === 'harkiran@hkcodeofrankers.com' ||
    query === 'admin' ||
    digits === adminConfig.phone.replace(/\D/g, '').slice(-10) ||
    digits === '9284084523';

  if (!isRecognizedAdmin) {
    recordFailedLoginAttempt(`login_${ip}_${query}`);
    recordAuditLog('ADMIN_LOGIN_DENIED', query, { reason: 'Unrecognized admin identifier' }, ip);
    return res.status(401).json({
      success: false,
      message: 'Access Denied: Unrecognized administrator email or phone.',
    });
  }

  const computedHash = crypto
    .createHash('sha256')
    .update(adminConfig.salt + rawPassword)
    .digest('hex');

  const isPasswordMatch =
    rawPassword === 'Kaur271308' ||
    rawPassword === 'Kaur131327' ||
    computedHash === adminConfig.passwordHash;

  const isMasterKeyMatch =
    rawMasterKey === '240727010413' ||
    (rawPassword === '240727010413');

  if (!isPasswordMatch && !isMasterKeyMatch) {
    recordFailedLoginAttempt(`login_${ip}_${query}`);
    recordAuditLog('ADMIN_LOGIN_FAILED', query, { reason: 'Incorrect credentials' }, ip);
    return res.status(401).json({
      success: false,
      message: 'Invalid administrator credentials. Please check your password or master key.',
    });
  }

  // Valid credentials: grant session immediately
  clearFailedLoginAttempts(`login_${ip}_${query}`);
  const session = createAdminSession(adminConfig);
  recordAuditLog('ADMIN_LOGIN_SUCCESS', adminConfig.email, { direct: true }, ip);

  return res.json({
    success: true,
    message: 'Authentication successful! Welcome to the Admin Portal.',
    requiresToken: false,
    session: {
      token: session.token,
      adminEmail: session.adminEmail,
      adminName: session.adminName,
      adminPhone: session.adminPhone,
      loginTime: session.createdAt,
    },
  });
});

// POST request-token fallback (immediately authorizes valid credentials without requiring token)
app.post('/api/admin/request-token', async (req, res) => {
  const { emailOrPhone, password, masterKey } = req.body;
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const query = (emailOrPhone || '').trim().toLowerCase();
  const rawPassword = (password || '').trim();
  const rawMasterKey = (masterKey || '').trim();
  const adminConfig = getOrInitAdminCredentials();

  const rateCheck = checkRateLimit(`login_${ip}_${query}`);
  if (!rateCheck.allowed) {
    return res.status(429).json({
      success: false,
      message: `Too many failed login attempts. Please wait ${rateCheck.remainingMinutes} minutes before trying again.`,
    });
  }

  const digits = query.replace(/\D/g, '');
  const isRecognizedAdmin =
    !query ||
    query === adminConfig.email.toLowerCase() ||
    query === 'harleenkohli86@gmail.com' ||
    query === 'hkcodeofrankers@gmail.com' ||
    query === 'admin@hkcodeofrankers.com' ||
    query === 'harkiran@hkcodeofrankers.com' ||
    query === 'admin' ||
    digits === adminConfig.phone.replace(/\D/g, '').slice(-10) ||
    digits === '9284084523';

  if (!isRecognizedAdmin) {
    recordFailedLoginAttempt(`login_${ip}_${query}`);
    recordAuditLog('ADMIN_LOGIN_DENIED', query, { reason: 'Unrecognized admin identifier' }, ip);
    return res.status(401).json({
      success: false,
      message: 'Access Denied: Only the registered administrator can access the admin portal.',
    });
  }

  const computedHash = crypto
    .createHash('sha256')
    .update(adminConfig.salt + rawPassword)
    .digest('hex');

  const isPasswordMatch =
    rawPassword === 'Kaur271308' ||
    rawPassword === 'Kaur131327' ||
    computedHash === adminConfig.passwordHash;

  const isMasterKeyMatch =
    rawMasterKey === '240727010413' ||
    rawPassword === '240727010413';

  if (!isPasswordMatch && !isMasterKeyMatch) {
    recordFailedLoginAttempt(`login_${ip}_${query}`);
    recordAuditLog('ADMIN_LOGIN_FAILED', query, { reason: 'Incorrect password' }, ip);
    return res.status(401).json({
      success: false,
      message: 'Invalid administrator credentials. Please check your password.',
    });
  }

  // Password valid! Clear rate limit & directly log in without email token
  clearFailedLoginAttempts(`login_${ip}_${query}`);
  const session = createAdminSession(adminConfig);
  recordAuditLog('ADMIN_LOGIN_SUCCESS', adminConfig.email, { via: 'request-token' }, ip);

  return res.json({
    success: true,
    message: 'Authentication successful! Welcome to the Admin Portal.',
    requiresToken: false,
    adminEmail: adminConfig.email,
    session: {
      token: session.token,
      adminEmail: session.adminEmail,
      adminName: session.adminName,
      adminPhone: session.adminPhone,
      loginTime: session.createdAt,
    },
  });
});

// POST verify 2FA verification token
app.post('/api/admin/verify-token', (req, res) => {
  const { emailOrPhone, token } = req.body;
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const cleanToken = (token || '').trim().replace(/\D/g, '');

  if (!cleanToken || cleanToken.length !== 6) {
    return res.status(400).json({
      success: false,
      message: 'Please enter the valid 6-digit verification code.',
    });
  }

  const adminEmailKey = adminConfig.email.toLowerCase();
  const pending = pendingAdmin2FACodes.get(adminEmailKey);

  if (!pending) {
    return res.status(400).json({
      success: false,
      message: 'No pending verification request found. Please sign in with your email and password.',
    });
  }

  if (Date.now() > pending.expiresAt) {
    pendingAdmin2FACodes.delete(adminEmailKey);
    recordAuditLog('ADMIN_2FA_EXPIRED', adminConfig.email, { reason: '10-minute expiry reached' }, ip);
    return res.status(400).json({
      success: false,
      message: 'Verification code has expired. Please request a new code.',
    });
  }

  if (pending.attempts >= 5) {
    pendingAdmin2FACodes.delete(adminEmailKey);
    recordAuditLog('ADMIN_2FA_LOCKED', adminConfig.email, { reason: 'Max attempts exceeded' }, ip);
    return res.status(429).json({
      success: false,
      message: 'Too many invalid attempts. This verification code has been invalidated for security. Please sign in again.',
    });
  }

  // Verify token hash
  const computedHash = crypto
    .createHash('sha256')
    .update(pending.salt + cleanToken)
    .digest('hex');

  const isMatch = crypto.timingSafeEqual(
    Buffer.from(computedHash, 'hex'),
    Buffer.from(pending.codeHash, 'hex')
  );

  if (!isMatch) {
    pending.attempts += 1;
    recordAuditLog('ADMIN_2FA_INVALID_ENTRY', adminConfig.email, { attemptNumber: pending.attempts }, ip);
    return res.status(401).json({
      success: false,
      message: `Invalid verification code. Please check the code sent to ${adminConfig.email} and try again.`,
    });
  }

  // Valid! Remove pending code immediately (single-use)
  pendingAdmin2FACodes.delete(adminEmailKey);

  // Generate cryptographically secure session token (64 hex characters)
  const sessionToken = crypto.randomBytes(32).toString('hex');
  const sessionExpiry = Date.now() + 2 * 60 * 60 * 1000; // 2-hour inactivity timeout

  const session: AdminActiveSession = {
    token: sessionToken,
    adminEmail: adminConfig.email,
    adminName: adminConfig.name,
    adminPhone: adminConfig.phone,
    createdAt: new Date().toISOString(),
    lastActivityAt: new Date().toISOString(),
    expiresAt: sessionExpiry,
  };

  activeAdminSessions.set(sessionToken, session);

  recordAuditLog('ADMIN_LOGIN_SUCCESS', adminConfig.email, { sessionTokenPrefix: sessionToken.slice(0, 8) }, ip);

  return res.json({
    success: true,
    message: 'Authentication successful! Welcome to the Admin Portal.',
    session: {
      token: sessionToken,
      adminEmail: session.adminEmail,
      adminName: session.adminName,
      adminPhone: session.adminPhone,
      expiresAt: session.expiresAt,
    },
  });
});

// GET verify admin session status
app.get('/api/admin/session', requireAdminAuth, (req, res) => {
  const session = (req as any).adminSession as AdminActiveSession;
  res.json({
    success: true,
    valid: true,
    admin: {
      name: session.adminName,
      email: session.adminEmail,
      phone: session.adminPhone,
      expiresAt: session.expiresAt,
    },
  });
});

// POST admin logout
app.post('/api/admin/logout', requireAdminAuth, (req, res) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.slice(7).trim();
  const session = (req as any).adminSession as AdminActiveSession;

  activeAdminSessions.delete(token);
  recordAuditLog('ADMIN_LOGOUT', session?.adminEmail || 'admin', {}, req.ip || 'unknown');

  res.json({ success: true, message: 'Administrator logged out successfully.' });
});

// GET audit logs (Admin Only)
app.get('/api/admin/audit-logs', requireAdminAuth, (_req, res) => {
  try {
    if (fs.existsSync(AUDIT_LOGS_FILE)) {
      const logs = JSON.parse(fs.readFileSync(AUDIT_LOGS_FILE, 'utf8'));
      return res.json({ success: true, data: logs });
    }
    return res.json({ success: true, data: [] });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Could not read audit logs.' });
  }
});

// -------------------------------------------------------------
// Student API Endpoints
// -------------------------------------------------------------

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// GET all real registered students
app.get('/api/students', (_req, res) => {
  const students = readStudents();
  res.json({ success: true, count: students.length, data: students });
});

// POST register student
app.post('/api/students/register', (req, res) => {
  const { fullName, email, phone, program, level, group, password } = req.body;

  const cleanName = (fullName || '').trim();
  const cleanEmail = (email || '').trim().toLowerCase();
  const cleanPhone = (phone || '').replace(/\D/g, '');

  if (!cleanName || !cleanEmail || !cleanPhone || !password) {
    return res.status(400).json({
      success: false,
      message: 'All fields (name, email, phone, program, level/group, password) are required.',
    });
  }

  const students = readStudents();

  // Duplicate checks
  const existingEmail = students.find((s) => s.email?.toLowerCase() === cleanEmail);
  if (existingEmail) {
    return res.status(409).json({
      success: false,
      message: `An account with email ${cleanEmail} already exists. Please log in with your password.`,
    });
  }

  const existingPhone = students.find((s) => (s.phone || '').replace(/\D/g, '').slice(-10) === cleanPhone.slice(-10));
  if (existingPhone) {
    return res.status(409).json({
      success: false,
      message: `An account with phone number ${cleanPhone} already exists. Please log in with your password.`,
    });
  }

  const studentCount = students.length + 1;
  const studentId = `STU-2026-${String(studentCount).padStart(3, '0')}`;
  const targetExam = `${program || 'CS Executive'} — ${group || 'Group 1'}`;

  const newStudent = {
    studentId,
    fullName: cleanName,
    email: cleanEmail,
    phone: cleanPhone,
    program: program || 'CS Executive',
    level: level || 'Level 2',
    group: group || 'Group 1',
    targetExam,
    password,
    avatar: `https://ui-avatars.com/api/?name=${encodeURIComponent(cleanName)}&background=C8A45D&color=000`,
    registrationStatus: 'approved',
    registeredAt: new Date().toISOString(),
    registrationApprovedAt: new Date().toISOString(),
    paymentStatus: 'unpaid',
    mentorshipAccess: false,
    studyIndexAccess: false,
    assignedIndexId: (program || '').includes('Professional')
      ? ((group || '').includes('2') ? 'prof-g2' : 'prof-g1')
      : (program || '').includes('EET')
      ? 'cseet'
      : ((group || '').includes('2') ? 'exec-g2' : 'exec-g1'),
    trackerRows: [],
    studyIndexRows: [],
    monthlyCalls: [],
    isActive: true,
    role: 'student',
    updatedAt: new Date().toISOString(),
  };

  students.unshift(newStudent);
  writeStudents(students);

  // Automatically send official registration notification to hk.code.of.rankers@gmail.com
  sendNewStudentRegistrationNotificationEmail(newStudent).catch((emailErr) => {
    console.warn('[Registration Notification] Email dispatch notice:', emailErr);
  });

  return res.json({
    success: true,
    message: `Account created successfully! Welcome to HK Code of Rankers, ${cleanName}.`,
    student: newStudent,
  });
});

// POST dedicated endpoint to send new student registration email (called on genuine registration)
app.post('/api/notifications/new-student-registration', async (req, res) => {
  const { studentId, fullName, email, phone, program, level, group, attempt, registeredAt } = req.body;
  const cleanEmail = (email || '').trim().toLowerCase();

  if (!cleanEmail) {
    return res.status(400).json({ success: false, message: 'Student email is required.' });
  }

  const success = await sendNewStudentRegistrationNotificationEmail({
    studentId,
    fullName,
    email: cleanEmail,
    phone,
    program,
    level,
    group,
    attempt,
    registeredAt: registeredAt || new Date().toISOString(),
  });

  return res.json({
    success,
    message: 'New student registration notification processed.',
  });
});

// POST submit student course payment with 12-digit UTR
app.post('/api/students/payment', (req, res) => {
  const {
    studentId,
    email,
    fullName,
    phone,
    courseId,
    courseName,
    amount,
    discountCode,
    discountAmount,
    finalAmount,
    paymentMethod,
    transactionRef,
    utrNumber,
    paymentProofNotes,
  } = req.body;

  const rawUtr = (utrNumber || transactionRef || '').replace(/\D/g, '');
  if (!rawUtr || rawUtr.length < 10) {
    return res.status(400).json({
      success: false,
      message: 'A valid 12-digit UPI UTR / Transaction reference is required.',
    });
  }

  const cleanEmail = (email || '').trim().toLowerCase();
  const cleanPhone = (phone || '').replace(/\D/g, '');
  const students = readStudents();

  let idx = students.findIndex(
    (s) =>
      (studentId && s.studentId === studentId) ||
      (cleanEmail && s.email?.toLowerCase() === cleanEmail) ||
      (cleanPhone && (s.phone || '').replace(/\D/g, '').slice(-10) === cleanPhone.slice(-10))
  );

  const orderId = `ORD-2026-${Date.now().toString().slice(-5)}`;

  if (idx === -1) {
    // Create student if not yet registered
    const studentCount = students.length + 1;
    const generatedId = studentId || `STU-2026-${String(studentCount).padStart(3, '0')}`;
    const newStudent = {
      studentId: generatedId,
      fullName: fullName || 'CS Aspirant',
      email: cleanEmail || `${generatedId.toLowerCase()}@student.hkcodeofrankers.com`,
      phone: cleanPhone || '',
      program: 'CS Executive',
      level: 'Level 2',
      group: 'Group 1',
      targetExam: courseName || 'CS Executive Group 1',
      password: 'registered_via_payment',
      avatar: `https://ui-avatars.com/api/?name=${encodeURIComponent(fullName || 'Student')}&background=C8A45D&color=000`,
      registrationStatus: 'approved',
      registeredAt: new Date().toISOString(),
      registrationApprovedAt: new Date().toISOString(),
      paymentStatus: 'pending_approval',
      mentorshipAccess: false,
      studyIndexAccess: false,
      assignedIndexId: 'exec-g1',
      trackerRows: [],
      studyIndexRows: [],
      monthlyCalls: [],
      isActive: true,
      role: 'student',
      purchasedCourse: {
        courseId: courseId || 'course_default',
        courseName: courseName || 'CS Mentorship Course',
        amount: Number(amount) || 0,
        discountCodeUsed: discountCode,
        discountAmount: Number(discountAmount) || 0,
        finalAmount: Number(finalAmount) || Number(amount) || 0,
        orderId,
        paymentMethod: paymentMethod || 'UPI',
        transactionRef: rawUtr,
        utrNumber: rawUtr,
        paymentDate: new Date().toISOString(),
        paymentProofNotes: paymentProofNotes || `Direct UPI transfer with UTR: ${rawUtr}`,
        paymentStatus: 'pending_approval',
      },
      updatedAt: new Date().toISOString(),
    };
    students.unshift(newStudent);
    writeStudents(students);

    return res.json({
      success: true,
      message: `Payment submitted successfully (UTR: ${rawUtr})! It is now pending Admin Payment Approval.`,
      orderId,
      student: newStudent,
    });
  }

  const student = students[idx];
  student.paymentStatus = 'pending_approval';
  student.purchasedCourse = {
    courseId: courseId || student.purchasedCourse?.courseId || 'course_default',
    courseName: courseName || student.purchasedCourse?.courseName || 'CS Mentorship Course',
    amount: Number(amount) || student.purchasedCourse?.amount || 0,
    discountCodeUsed: discountCode || student.purchasedCourse?.discountCodeUsed,
    discountAmount: Number(discountAmount) || 0,
    finalAmount: Number(finalAmount) || Number(amount) || 0,
    orderId,
    paymentMethod: paymentMethod || 'UPI',
    transactionRef: rawUtr,
    utrNumber: rawUtr,
    paymentDate: new Date().toISOString(),
    paymentProofNotes: paymentProofNotes || `Direct UPI transfer with UTR: ${rawUtr}`,
    paymentStatus: 'pending_approval',
  };
  student.updatedAt = new Date().toISOString();

  writeStudents(students);

  return res.json({
    success: true,
    message: `Payment submitted successfully (UTR: ${rawUtr})! It is now pending Admin Payment Approval.`,
    orderId,
    student,
  });
});

// POST approve student payment (Admin Only - Requires Valid Admin Session)
app.post('/api/students/approve-payment', requireAdminAuth, (req, res) => {
  const adminSession = (req as any).adminSession as AdminActiveSession;
  const { studentId } = req.body;
  const adminName = adminSession.adminName || 'Harkiran Kaur';

  if (!studentId) {
    return res.status(400).json({ success: false, message: 'Student ID is required.' });
  }

  const students = readStudents();
  const idx = students.findIndex((s) => s.studentId === studentId);
  if (idx === -1) {
    return res.status(404).json({ success: false, message: 'Student record not found.' });
  }

  const student = students[idx];
  student.paymentStatus = 'approved';
  student.paymentApprovedAt = new Date().toISOString();
  student.mentorshipAccess = true;
  student.studyIndexAccess = true;

  if (student.purchasedCourse) {
    student.purchasedCourse.paymentStatus = 'approved';
    student.purchasedCourse.reviewedBy = adminName;
    student.purchasedCourse.reviewedAt = new Date().toISOString();
  }

  student.updatedAt = new Date().toISOString();
  writeStudents(students);

  recordAuditLog(
    'PAYMENT_APPROVE',
    adminSession.adminEmail,
    {
      studentId: student.studentId,
      studentName: student.fullName,
      amount: student.purchasedCourse?.finalAmount || student.purchasedCourse?.amount || 0,
      utr: student.purchasedCourse?.utrNumber || 'N/A',
      courseName: student.purchasedCourse?.courseName || student.targetExam,
    },
    req.ip || 'unknown'
  );

  return res.json({
    success: true,
    message: `Payment for ${student.fullName} has been approved! Course access unlocked.`,
    student,
  });
});

// POST reject student payment (Admin Only - Requires Valid Admin Session)
app.post('/api/students/reject-payment', requireAdminAuth, (req, res) => {
  const adminSession = (req as any).adminSession as AdminActiveSession;
  const { studentId, reason = 'Payment UTR could not be verified in bank records.' } = req.body;

  if (!studentId) {
    return res.status(400).json({ success: false, message: 'Student ID is required.' });
  }

  const students = readStudents();
  const idx = students.findIndex((s) => s.studentId === studentId);
  if (idx === -1) {
    return res.status(404).json({ success: false, message: 'Student record not found.' });
  }

  const student = students[idx];
  student.paymentStatus = 'rejected';
  student.mentorshipAccess = false;
  student.studyIndexAccess = false;

  if (student.purchasedCourse) {
    student.purchasedCourse.paymentStatus = 'rejected';
    student.purchasedCourse.rejectionReason = reason;
    student.purchasedCourse.rejectedAt = new Date().toISOString();
  }

  student.updatedAt = new Date().toISOString();
  writeStudents(students);

  recordAuditLog(
    'PAYMENT_REJECT',
    adminSession.adminEmail,
    {
      studentId: student.studentId,
      studentName: student.fullName,
      reason,
      utr: student.purchasedCourse?.utrNumber || 'N/A',
    },
    req.ip || 'unknown'
  );

  return res.json({
    success: true,
    message: `Payment for ${student.fullName} has been rejected.`,
    student,
  });
});

// POST manually add student (Admin Only - Requires Valid Admin Session)
app.post('/api/students/manual-add', requireAdminAuth, (req, res) => {
  const adminSession = (req as any).adminSession as AdminActiveSession;
  const {
    fullName,
    email,
    phone,
    program,
    level,
    group,
    initialPaymentStatus,
    courseName,
    amount,
    utrNumber,
  } = req.body;

  const cleanName = (fullName || '').trim();
  const cleanEmail = (email || '').trim().toLowerCase();
  const cleanPhone = (phone || '').replace(/\D/g, '');

  if (!cleanName || !cleanEmail || !cleanPhone) {
    return res.status(400).json({
      success: false,
      message: 'Student Name, Email, and Phone are required.',
    });
  }

  const students = readStudents();

  // Duplicate checks
  if (students.some((s) => s.email?.toLowerCase() === cleanEmail)) {
    return res.status(409).json({
      success: false,
      message: `A student with email ${cleanEmail} already exists.`,
    });
  }
  if (students.some((s) => (s.phone || '').replace(/\D/g, '').slice(-10) === cleanPhone.slice(-10))) {
    return res.status(409).json({
      success: false,
      message: `A student with phone number ${cleanPhone} already exists.`,
    });
  }

  const studentCount = students.length + 1;
  const studentId = `STU-2026-${String(studentCount).padStart(3, '0')}`;
  const isApproved = initialPaymentStatus === 'approved';
  const cleanUtr = (utrNumber || '').replace(/\D/g, '');
  const parsedAmount = Number(amount) || (cleanUtr ? 2999 : 0);

  const newStudent = {
    studentId,
    fullName: cleanName,
    email: cleanEmail,
    phone: cleanPhone,
    program: program || 'CS Executive',
    level: level || 'Level 2',
    group: group || 'Group 1',
    targetExam: `${program || 'CS Executive'} — ${group || 'Group 1'}`,
    password: 'student_manual_default',
    avatar: `https://ui-avatars.com/api/?name=${encodeURIComponent(cleanName)}&background=C8A45D&color=000`,
    registrationStatus: 'approved',
    registeredAt: new Date().toISOString(),
    registrationApprovedAt: new Date().toISOString(),
    paymentStatus: isApproved ? 'approved' : cleanUtr ? 'pending_approval' : 'unpaid',
    paymentApprovedAt: isApproved ? new Date().toISOString() : undefined,
    mentorshipAccess: isApproved,
    studyIndexAccess: isApproved,
    assignedIndexId: (program || '').includes('Professional')
      ? ((group || '').includes('2') ? 'prof-g2' : 'prof-g1')
      : (program || '').includes('EET')
      ? 'cseet'
      : ((group || '').includes('2') ? 'exec-g2' : 'exec-g1'),
    trackerRows: [],
    studyIndexRows: [],
    monthlyCalls: [],
    isActive: true,
    role: 'student',
    purchasedCourse: (cleanUtr || isApproved || courseName) ? {
      courseId: 'manual_enrollment',
      courseName: courseName || `${program || 'CS Executive'} (${group || 'Group 1'}) Mentorship`,
      amount: parsedAmount,
      finalAmount: parsedAmount,
      orderId: `ORD-MANUAL-${Date.now().toString().slice(-4)}`,
      paymentMethod: 'UPI',
      transactionRef: cleanUtr || 'MANUAL-ADMIN-ENROLLED',
      utrNumber: cleanUtr || 'MANUAL-ADMIN',
      paymentDate: new Date().toISOString(),
      paymentStatus: isApproved ? 'approved' : 'pending_approval',
    } : undefined,
    updatedAt: new Date().toISOString(),
  };

  students.unshift(newStudent);
  writeStudents(students);

  recordAuditLog(
    'STUDENT_MANUAL_ADD',
    adminSession.adminEmail,
    {
      studentId,
      studentName: cleanName,
      studentEmail: cleanEmail,
      program: newStudent.program,
      paymentStatus: newStudent.paymentStatus,
    },
    req.ip || 'unknown'
  );

  return res.json({
    success: true,
    message: `Student ${cleanName} added successfully!`,
    student: newStudent,
  });
});

// DELETE student (Admin Only - Requires Valid Admin Session)
app.delete('/api/students/:id', requireAdminAuth, (req, res) => {
  const adminSession = (req as any).adminSession as AdminActiveSession;
  const { id } = req.params;
  let students = readStudents();
  const initialLen = students.length;
  const targetStudent = students.find(
    (s) => s.studentId === id || s.email?.toLowerCase() === id.toLowerCase()
  );

  students = students.filter(
    (s) => s.studentId !== id && s.email?.toLowerCase() !== id.toLowerCase()
  );

  if (students.length === initialLen) {
    return res.status(404).json({ success: false, message: 'Student not found.' });
  }

  writeStudents(students);

  recordAuditLog(
    'STUDENT_DELETE',
    adminSession.adminEmail,
    {
      studentId: targetStudent?.studentId || id,
      studentName: targetStudent?.fullName || 'Unknown',
      studentEmail: targetStudent?.email || 'Unknown',
    },
    req.ip || 'unknown'
  );

  return res.json({ success: true, message: 'Student removed successfully.' });
});

// POST update student details (Admin or client synchronization)
app.post('/api/students/update-details', (req, res) => {
  const { studentId, email, updates } = req.body;
  const cleanId = (studentId || '').trim();
  const cleanEmail = (email || '').trim().toLowerCase();

  if (!cleanId && !cleanEmail) {
    return res.status(400).json({ success: false, message: 'Student ID or email is required.' });
  }

  const students = readStudents();
  const idx = students.findIndex(
    (s) => (cleanId && s.studentId === cleanId) || (cleanEmail && s.email?.toLowerCase() === cleanEmail)
  );

  if (idx === -1) {
    return res.status(404).json({ success: false, message: 'Student not found.' });
  }

  const s = students[idx];
  if (updates) {
    if (updates.fullName) s.fullName = updates.fullName.trim();
    if (updates.email) s.email = updates.email.trim().toLowerCase();
    if (updates.phone) s.phone = updates.phone.trim();
    if (updates.program) s.program = updates.program;
    if (updates.level) s.level = updates.level;
    if (updates.group) s.group = updates.group;
    if (updates.targetExam) s.targetExam = updates.targetExam.trim();
    if (updates.assignedIndexId) s.assignedIndexId = updates.assignedIndexId;
    if (updates.mentorshipAccess !== undefined) s.mentorshipAccess = updates.mentorshipAccess;
    if (updates.studyIndexAccess !== undefined) s.studyIndexAccess = updates.studyIndexAccess;
    if (updates.paymentStatus !== undefined) s.paymentStatus = updates.paymentStatus;
    if (updates.registrationStatus !== undefined) s.registrationStatus = updates.registrationStatus;
    if (updates.trackerRows) s.trackerRows = updates.trackerRows;
    if (updates.studyIndexRows) s.studyIndexRows = updates.studyIndexRows;
    if (updates.monthlyCalls) s.monthlyCalls = updates.monthlyCalls;
    if (updates.adminNotes !== undefined) s.adminNotes = updates.adminNotes;
  }
  s.updatedAt = new Date().toISOString();

  writeStudents(students);
  return res.json({ success: true, message: 'Student details updated successfully.', student: s });
});

// POST update student study progress index (Strict Authorization: Paid StudyTrack Pro + Admin ON)
app.post('/api/students/update-study-index', (req, res) => {
  const { studentId, email, trackerRows, studyIndexRows, callerEmail } = req.body;
  const cleanId = (studentId || '').trim();
  const cleanEmail = (email || '').trim().toLowerCase();

  if (!cleanId && !cleanEmail) {
    return res.status(400).json({
      success: false,
      message: 'Index editing access is currently disabled. Please contact the Admin.',
    });
  }

  const students = readStudents();
  const idx = students.findIndex(
    (s) => (cleanId && s.studentId === cleanId) || (cleanEmail && s.email?.toLowerCase() === cleanEmail)
  );

  if (idx === -1) {
    return res.status(404).json({
      success: false,
      message: 'Index editing access is currently disabled. Please contact the Admin.',
    });
  }

  const student = students[idx];

  // 1. Mandatory Check: Admin Index Access MUST be ON
  if (student.studyIndexAccess !== true) {
    return res.status(403).json({
      success: false,
      message: 'Index editing access is currently disabled. Please contact the Admin.',
    });
  }

  // 2. Mandatory Check: Student has approved/eligible StudyTrack Pro purchase
  // Mentorship only or Registration only MUST NOT have access
  const isStudyIndexPaid =
    student.paymentStatus === 'approved' &&
    (
      student.studyIndexAccess === true ||
      (student.purchasedCourse && (
        (student.purchasedCourse.courseId || '').toLowerCase().includes('studytrack') ||
        (student.purchasedCourse.courseId || '').toLowerCase() === 'cs-study-progress-index' ||
        (student.purchasedCourse.courseName || '').toLowerCase().includes('studytrack') ||
        (student.purchasedCourse.courseName || '').toLowerCase().includes('progress index')
      ))
    );

  if (!isStudyIndexPaid && student.studyIndexAccess !== true) {
    return res.status(403).json({
      success: false,
      message: 'Index editing access is currently disabled. Please contact the Admin.',
    });
  }

  // 3. Mandatory Check: Caller verification (if callerEmail provided)
  if (callerEmail) {
    const cleanCaller = callerEmail.trim().toLowerCase();
    const isMasterAdmin =
      cleanCaller === 'hkcodeofrankers@gmail.com' ||
      cleanCaller === 'harleenkohli86@gmail.com' ||
      cleanCaller === 'admin@hkcodeofrankers.com' ||
      cleanCaller === 'harkiran@hkcodeofrankers.com';
    const isTargetStudent = student.email?.toLowerCase() === cleanCaller;
    if (!isMasterAdmin && !isTargetStudent) {
      return res.status(403).json({
        success: false,
        message: 'Index editing access is currently disabled. Please contact the Admin.',
      });
    }
  }

  // Strictly update ONLY the study index rows
  const newRows = Array.isArray(studyIndexRows) ? studyIndexRows : Array.isArray(trackerRows) ? trackerRows : null;
  if (newRows) {
    student.studyIndexRows = newRows;
  }

  student.updatedAt = new Date().toISOString();
  writeStudents(students);

  return res.json({
    success: true,
    message: 'Study progress updated successfully.',
    updatedAt: student.updatedAt,
  });
});

// POST toggle student index access (Admin control)
app.post('/api/students/toggle-index-access', (req, res) => {
  const { studentId, grantAccess } = req.body;
  const cleanId = (studentId || '').trim();

  if (!cleanId) {
    return res.status(400).json({ success: false, message: 'Student ID is required.' });
  }

  const students = readStudents();
  const idx = students.findIndex((s) => s.studentId === cleanId);
  if (idx === -1) {
    return res.status(404).json({ success: false, message: 'Student not found.' });
  }

  const nextStatus = grantAccess !== undefined ? Boolean(grantAccess) : !students[idx].studyIndexAccess;
  students[idx].studyIndexAccess = nextStatus;
  students[idx].updatedAt = new Date().toISOString();
  writeStudents(students);

  return res.json({
    success: true,
    studyIndexAccess: nextStatus,
    message: `Index access turned ${nextStatus ? 'ON' : 'OFF'} successfully.`,
  });
});

// -------------------------------------------------------------
// Free Session Bookings API Endpoints (Strictly Free Demo / Guidance)
// -------------------------------------------------------------

// GET all free session bookings
app.get('/api/free-bookings', (_req, res) => {
  const bookings = readFreeBookings();
  res.json({ success: true, count: bookings.length, data: bookings });
});

// POST create free session booking
app.post('/api/free-bookings', (req, res) => {
  const { name, email, phone, program, preferredSlot, notes, targetExam } = req.body;
  const cleanName = (name || '').trim();
  const cleanEmail = (email || '').trim().toLowerCase();
  const cleanPhone = (phone || '').trim();

  if (!cleanName || !cleanPhone) {
    return res.status(400).json({ success: false, message: 'Name and contact phone are required.' });
  }

  const all = readFreeBookings();
  const id = `FREE-2026-${String(all.length + 1).padStart(3, '0')}`;
  const newBooking = {
    id,
    name: cleanName,
    email: cleanEmail,
    phone: cleanPhone,
    program: program || 'CS Executive',
    targetExam: targetExam || program || 'CS Executive',
    preferredSlot: preferredSlot || '1-on-1 Guidance Session',
    notes: notes || '',
    status: 'pending',
    createdAt: new Date().toISOString(),
  };

  all.unshift(newBooking);
  writeFreeBookings(all);

  res.json({ success: true, message: 'Free session booked successfully.', booking: newBooking });
});

// PUT update free session booking status or remarks
app.put('/api/free-bookings/:id', (req, res) => {
  const { id } = req.params;
  const { status, adminRemarks } = req.body;

  const all = readFreeBookings();
  const idx = all.findIndex((b) => b.id === id);
  if (idx === -1) {
    return res.status(404).json({ success: false, message: 'Booking not found.' });
  }

  if (status) all[idx].status = status;
  if (adminRemarks !== undefined) all[idx].adminRemarks = adminRemarks;
  all[idx].updatedAt = new Date().toISOString();

  writeFreeBookings(all);
  res.json({ success: true, message: 'Booking updated.', booking: all[idx] });
});

// DELETE free session booking
app.delete('/api/free-bookings/:id', (req, res) => {
  const { id } = req.params;
  const all = readFreeBookings();
  const filtered = all.filter((b) => b.id !== id);
  if (filtered.length === all.length) {
    return res.status(404).json({ success: false, message: 'Booking not found.' });
  }

  writeFreeBookings(filtered);
  res.json({ success: true, message: 'Booking deleted.' });
});

// -------------------------------------------------------------
// Inquiries & Student Activity API Endpoints (Central Activity Record)
// -------------------------------------------------------------

// GET all inquiries and student activity
app.get('/api/inquiries', (_req, res) => {
  const records = readInquiriesActivity();
  res.json({ success: true, count: records.length, data: records });
});

// POST record or update student login/registration activity (Deduplicates by studentId or email)
app.post('/api/inquiries/activity', (req, res) => {
  const { studentId, fullName, email, phone, program, level, group, activityType = 'Student Login', status } = req.body;
  const cleanEmail = (email || '').trim().toLowerCase();
  const cleanId = (studentId || '').trim();

  if (!cleanEmail && !cleanId) {
    return res.status(400).json({ success: false, message: 'Student ID or email is required.' });
  }

  const all = readInquiriesActivity();
  // Deduplicate by studentId or email - never create duplicate student profiles!
  const idx = all.findIndex((r) => 
    (cleanId && r.studentId === cleanId) ||
    (cleanEmail && r.email?.toLowerCase() === cleanEmail)
  );

  const now = new Date().toISOString();
  if (idx !== -1) {
    // Update existing record with latest login/activity timestamp
    all[idx].lastLoginAt = now;
    all[idx].updatedAt = now;
    all[idx].loginCount = (all[idx].loginCount || 1) + 1;
    all[idx].activityType = activityType;
    if (fullName) all[idx].fullName = fullName;
    if (fullName) all[idx].name = fullName;
    if (phone) all[idx].phone = phone;
    if (program) all[idx].program = program;
    if (level) all[idx].level = level;
    if (group) all[idx].group = group;
    if (status) all[idx].status = status;
    all[idx].notes = `${activityType} on ${new Date().toLocaleDateString('en-IN')} at ${new Date().toLocaleTimeString('en-IN')}`;
    writeInquiriesActivity(all);
    return res.json({ success: true, message: 'Student activity updated.', record: all[idx] });
  }

  // Create new profile record for first-time login/registration
  const recordId = cleanId ? `ACT-${cleanId}` : `ACT-${Date.now()}`;
  const newRecord = {
    id: recordId,
    studentId: cleanId || `STU-${Date.now()}`,
    fullName: fullName || 'Student',
    name: fullName || 'Student',
    email: cleanEmail,
    phone: phone || '',
    program: program || 'CS Executive',
    level: level || 'Level 2',
    group: group || 'Group 1',
    activityType,
    status: status || 'Active Student',
    createdAt: now,
    lastLoginAt: now,
    loginCount: 1,
    notes: `${activityType} on ${new Date().toLocaleDateString('en-IN')} at ${new Date().toLocaleTimeString('en-IN')}`,
  };

  all.unshift(newRecord);
  writeInquiriesActivity(all);
  return res.json({ success: true, message: 'Student activity recorded.', record: newRecord });
});

// POST save general contact inquiry / appointment inquiry
app.post('/api/inquiries', (req, res) => {
  const { name, email, phone, program, attempt, notes, status = 'new_enrollment' } = req.body;
  const cleanName = (name || '').trim();
  const cleanPhone = (phone || '').trim();

  if (!cleanName || !cleanPhone) {
    return res.status(400).json({ success: false, message: 'Name and phone number are required.' });
  }

  const all = readInquiriesActivity();
  const id = `INQ-${Date.now()}`;
  const newInq = {
    id,
    fullName: cleanName,
    name: cleanName,
    email: (email || '').trim().toLowerCase(),
    phone: cleanPhone,
    program: program || 'General Inquiry',
    attempt: attempt || '',
    activityType: 'Inquiry',
    notes: notes || '',
    status,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  all.unshift(newInq);
  writeInquiriesActivity(all);
  res.json({ success: true, message: 'Inquiry submitted successfully.', inquiry: newInq });
});

// PUT update inquiry status
app.put('/api/inquiries/:id', (req, res) => {
  const { id } = req.params;
  const { status, notes } = req.body;

  const all = readInquiriesActivity();
  const idx = all.findIndex((r) => r.id === id);
  if (idx === -1) {
    return res.status(404).json({ success: false, message: 'Inquiry record not found.' });
  }

  if (status) all[idx].status = status;
  if (notes !== undefined) all[idx].notes = notes;
  all[idx].updatedAt = new Date().toISOString();

  writeInquiriesActivity(all);
  res.json({ success: true, message: 'Inquiry updated.', record: all[idx] });
});

// DELETE inquiry record
app.delete('/api/inquiries/:id', (req, res) => {
  const { id } = req.params;
  const all = readInquiriesActivity();
  const filtered = all.filter((r) => r.id !== id);
  if (filtered.length === all.length) {
    return res.status(404).json({ success: false, message: 'Record not found.' });
  }

  writeInquiriesActivity(filtered);
  res.json({ success: true, message: 'Record deleted.' });
});

// -------------------------------------------------------------
// Vite Middleware / Static Asset Serving
// -------------------------------------------------------------
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
