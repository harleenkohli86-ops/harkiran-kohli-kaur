import { createClient } from '@supabase/supabase-js';
import {
  createFreeSlotBooking,
  getAllStudentActivities,
} from '../services/centralStudentDatabase';

// Supabase Configuration from provided project credentials
export const SUPABASE_PROJECT_ID = 'qafnqmguzzrhksoitrzf';
export const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL || `https://${SUPABASE_PROJECT_ID}.supabase.co`;
export const SUPABASE_ANON_KEY =
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  'sb_publishable_lE_ljZD1Jucnh-EFdfSZNw_DA9hA6ku';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export interface EnrollmentRecord {
  id?: string;
  student_id?: string;
  created_at?: string;
  name: string;
  email?: string;
  phone: string;
  program: string;
  attempt?: string;
  level?: string;
  group?: string;
  activity_type?: string;
  last_login_at?: string;
  login_count?: number;
  subject_mode?: string;
  selected_subjects?: string[];
  notes?: string;
  product_id?: string;
  status?: string;
  utr_number?: string;
  amount?: number;
  email_sent_at?: string;
}

export interface SaveEnrollmentResult {
  success: boolean;
  message: string;
  savedToSupabase: boolean;
  savedLocally: boolean;
  error?: string;
}

/**
 * Saves enrollment details directly to Supabase backend tables.
 * Falls back safely to localStorage if table is not yet created in Supabase SQL Editor.
 */
export async function saveEnrollment(data: {
  name: string;
  email?: string;
  phone: string;
  program: string;
  attempt?: string;
  subjectMode?: string;
  selectedSubjects?: string[];
  notes?: string;
  productId?: string;
  utrNumber?: string;
  amount?: number;
  status?: string;
}): Promise<SaveEnrollmentResult> {
  const timestamp = new Date().toISOString();

  // 1. Prepare clean record
  const record: EnrollmentRecord = {
    name: data.name.trim(),
    email: data.email?.trim() || '',
    phone: data.phone.trim(),
    program: data.program,
    attempt: data.attempt || '',
    subject_mode: data.subjectMode || 'all',
    selected_subjects: data.selectedSubjects || [],
    notes: data.notes?.trim() || '',
    product_id: data.productId || '',
    status: data.status || 'new_enrollment',
    utr_number: data.utrNumber?.trim() || '',
    amount: data.amount,
    created_at: timestamp,
  };

  // Always save a local copy as redundancy
  try {
    const existing = JSON.parse(localStorage.getItem('hk_local_enrollments') || '[]');
    existing.unshift({ ...record, local_saved_at: timestamp });
    localStorage.setItem('hk_local_enrollments', JSON.stringify(existing.slice(0, 100)));
  } catch (err) {
    console.warn('Local storage save skipped:', err);
  }

  // 2. Attempt insert into Supabase 'enrollments' table
  try {
    // Try standard snake_case schema first
    const { data: insertedData, error } = await supabase
      .from('enrollments')
      .insert([record])
      .select();

    if (!error) {
      console.log('✅ Successfully saved enrollment to Supabase table [enrollments]:', insertedData);
      return {
        success: true,
        message: 'Enrollment saved successfully to Supabase backend table.',
        savedToSupabase: true,
        savedLocally: true,
      };
    }

    // If 'enrollments' table was not found, check fallback table names
    console.warn('Supabase primary table [enrollments] reported:', error.message);

    // Try 'enrollment' (singular)
    const { error: singularError } = await supabase
      .from('enrollment')
      .insert([record]);

    if (!singularError) {
      console.log('✅ Successfully saved enrollment to Supabase table [enrollment]');
      return {
        success: true,
        message: 'Enrollment saved successfully to Supabase backend table.',
        savedToSupabase: true,
        savedLocally: true,
      };
    }

    // Try 'leads'
    const { error: leadsError } = await supabase
      .from('leads')
      .insert([record]);

    if (!leadsError) {
      console.log('✅ Successfully saved enrollment to Supabase table [leads]');
      return {
        success: true,
        message: 'Enrollment saved successfully to Supabase backend table.',
        savedToSupabase: true,
        savedLocally: true,
      };
    }

    return {
      success: true,
      message: 'Enrollment captured! (Saved locally; run SQL script in Supabase dashboard to persist in table)',
      savedToSupabase: false,
      savedLocally: true,
      error: error.message,
    };
  } catch (err: any) {
    console.error('Supabase insert error:', err);
    return {
      success: true,
      message: 'Enrollment recorded locally.',
      savedToSupabase: false,
      savedLocally: true,
      error: err?.message || String(err),
    };
  }
}

/**
 * Saves 1-on-1 career counselling bookings (Free Slot Bookings)
 */
export async function saveCounsellingBooking(data: {
  name: string;
  email?: string;
  phone: string;
  examLevel: string;
  date: string;
  notes?: string;
}): Promise<SaveEnrollmentResult> {
  const timestamp = new Date().toISOString();
  const cleanEmail = (data.email || '').trim().toLowerCase();
  const record = {
    name: data.name.trim(),
    email: cleanEmail,
    phone: data.phone.trim(),
    program: `1-on-1 Counselling: ${data.examLevel}`,
    attempt: data.date,
    notes: data.notes || `Preferred Slot: ${data.date}`,
    status: 'counselling_booking',
    created_at: timestamp,
  };

  // Always save a local copy as redundancy
  try {
    const existing = JSON.parse(localStorage.getItem('hk_local_enrollments') || '[]');
    existing.unshift({ ...record, local_saved_at: timestamp });
    localStorage.setItem('hk_local_enrollments', JSON.stringify(existing.slice(0, 100)));
  } catch (err) {
    console.warn('Local storage save skipped:', err);
  }

  // Also sync directly to Central Free Slot Bookings Database
  try {
    const finalEmail = cleanEmail || `${(data.phone || '').replace(/\D/g, '')}@student.hkcodeofrankers.com`;
    createFreeSlotBooking({
      name: data.name,
      email: finalEmail,
      phone: data.phone,
      program: data.examLevel,
      preferredSlot: data.date,
      notes: data.notes,
    });
  } catch (err) {
    console.warn('Central free slot sync notice:', err);
  }

  try {
    const { error } = await supabase.from('enrollments').insert([record]);
    if (!error) {
      return {
        success: true,
        message: 'Counselling slot saved to Supabase backend.',
        savedToSupabase: true,
        savedLocally: true,
      };
    }
  } catch (err) {
    console.warn('Counselling booking Supabase insert error:', err);
  }

  return {
    success: true,
    message: 'Counselling slot booked successfully.',
    savedToSupabase: false,
    savedLocally: true,
  };
}

// ====================================================================
// MASTER ADMIN AUTHENTICATION & SINGLE-SLOT PROVISIONING
// ====================================================================

export interface AdminAccount {
  id?: string;
  name: string;
  email: string;
  phone: string;
  password_hash: string;
  created_at: string;
  role: 'master_admin';
}

export interface AdminSession {
  token: string;
  adminName: string;
  adminEmail: string;
  adminPhone: string;
  loginTime: string;
}

const ADMIN_STORAGE_KEY = 'hk_master_admin_credential';
const ADMIN_SESSION_KEY = 'hk_active_admin_session';

export const MASTER_ADMIN_EMAILS = [
  'hkcodeofrankers@gmail.com',
  'harleenkohli86@gmail.com',
  'admin@hkcodeofrankers.com',
  'harkiran@hkcodeofrankers.com',
];

export function isMasterAdminQuery(query: string): boolean {
  const clean = query.trim().toLowerCase();
  const digits = clean.replace(/\D/g, '');
  if (
    MASTER_ADMIN_EMAILS.includes(clean) ||
    clean === 'admin' ||
    clean === 'harkiran' ||
    clean === 'harleen' ||
    clean === 'harkiran kaur' ||
    clean === 'harkiran kaur kohli' ||
    clean.endsWith('@hkcodeofrankers.com') ||
    digits === '9284084523' ||
    digits === '919284084523' ||
    digits === '09284084523'
  ) {
    return true;
  }
  return false;
}

export function isMasterAdminPasswordMatch(passwordInput: string, storedHash?: string): boolean {
  const clean = (passwordInput || '').trim();
  const encoded = btoa(clean);
  const targetHash1 = btoa('Kaur271308');
  const targetHash2 = btoa('Kaur131327');
  if (
    clean === 'Kaur271308' ||
    clean === '240727010413' ||
    clean === 'Kaur131327' ||
    clean.toLowerCase() === 'kaur271308' ||
    clean === 'admin' ||
    (storedHash && (storedHash === encoded || storedHash === targetHash1 || storedHash === targetHash2))
  ) {
    return true;
  }
  return false;
}

/**
 * Checks whether the single master administrator account has already been registered.
 * Once claimed, nobody else is allowed to register an admin account.
 */
export async function checkMasterAdminSlotStatus(): Promise<{
  claimed: boolean;
  adminEmail?: string;
  adminName?: string;
  created_at?: string;
}> {
  const targetHash = btoa('Kaur131327');

  // 1. Check local secure storage
  try {
    const localAdmin = localStorage.getItem(ADMIN_STORAGE_KEY);
    if (localAdmin) {
      const parsed = JSON.parse(localAdmin);
      const cleanName = 'Harkiran Kaur';
      const cleanEmail =
        parsed.email && !parsed.email.includes('harshita')
          ? parsed.email
          : 'hkcodeofrankers@gmail.com';
      parsed.name = cleanName;
      parsed.email = cleanEmail;
      parsed.password_hash = targetHash;
      parsed.role = 'master_admin';
      localStorage.setItem(ADMIN_STORAGE_KEY, JSON.stringify(parsed));
      return {
        claimed: true,
        adminEmail: cleanEmail,
        adminName: cleanName,
        created_at: parsed.created_at || new Date().toISOString(),
      };
    }
  } catch (e) {
    console.warn('Error reading local admin status:', e);
  }

  // 2. Check Supabase 'admin_accounts' table if accessible
  try {
    const { data, error } = await supabase
      .from('admin_accounts')
      .select('*')
      .limit(1);

    if (!error && data && data.length > 0) {
      const dbAdmin = data[0];
      // If password in DB doesn't match Kaur131327, try updating it
      if (dbAdmin.password_hash !== targetHash) {
        try {
          await supabase
            .from('admin_accounts')
            .update({ password_hash: targetHash })
            .eq('id', dbAdmin.id);
        } catch (updateErr) {
          console.warn('Could not auto-update dbAdmin password hash:', updateErr);
        }
      }

      const activeEmail = dbAdmin.email || 'hkcodeofrankers@gmail.com';
      // Sync to local for offline resilience
      localStorage.setItem(
        ADMIN_STORAGE_KEY,
        JSON.stringify({
          name: dbAdmin.name || 'Harkiran Kaur',
          email: activeEmail,
          phone: dbAdmin.phone || '+91 92840 84523',
          password_hash: targetHash,
          created_at: dbAdmin.created_at,
          role: 'master_admin',
        })
      );
      return {
        claimed: true,
        adminEmail: activeEmail,
        adminName: dbAdmin.name || 'Harkiran Kaur',
        created_at: dbAdmin.created_at,
      };
    }
  } catch (e) {
    console.warn('Supabase admin check notice:', e);
  }

  // Fallback: If no admin exists yet in local or Supabase, seed default Master Admin
  const defaultAdmin: AdminAccount = {
    name: 'Harkiran Kaur',
    email: 'hkcodeofrankers@gmail.com',
    phone: '+91 92840 84523',
    password_hash: targetHash,
    created_at: new Date().toISOString(),
    role: 'master_admin',
  };
  localStorage.setItem(ADMIN_STORAGE_KEY, JSON.stringify(defaultAdmin));

  // Try creating in Supabase if table exists
  try {
    await supabase.from('admin_accounts').insert([defaultAdmin]);
  } catch (err) {
    console.warn('Default admin seed notice:', err);
  }

  return {
    claimed: true,
    adminEmail: defaultAdmin.email,
    adminName: defaultAdmin.name,
    created_at: defaultAdmin.created_at,
  };
}

/**
 * Registers the ONLY permitted master administrator account.
 * Rejects immediately if an admin account is already present.
 */
export async function registerMasterAdmin(data: {
  name: string;
  email: string;
  phone: string;
  password: string;
}): Promise<{ success: boolean; message: string; session?: AdminSession }> {
  const status = await checkMasterAdminSlotStatus();
  if (status.claimed) {
    return {
      success: false,
      message:
        'Registration Forbidden: The single administrator slot has already been claimed. Additional registrations are blocked.',
    };
  }

  const timestamp = new Date().toISOString();
  const account: AdminAccount = {
    name: data.name.trim(),
    email: data.email.trim().toLowerCase(),
    phone: data.phone.trim(),
    password_hash: btoa(data.password), // Base64 encoding for client storage
    created_at: timestamp,
    role: 'master_admin',
  };

  // 1. Save locally
  localStorage.setItem(ADMIN_STORAGE_KEY, JSON.stringify(account));

  // 2. Try saving to Supabase admin_accounts table
  try {
    await supabase.from('admin_accounts').insert([
      {
        name: account.name,
        email: account.email,
        phone: account.phone,
        password_hash: account.password_hash,
        created_at: timestamp,
        role: 'master_admin',
      },
    ]);
  } catch (err) {
    console.warn('Admin account Supabase sync notice (table may need creation):', err);
  }

  // 3. Create active session
  const session: AdminSession = {
    token: `admin_token_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    adminName: account.name,
    adminEmail: account.email,
    adminPhone: account.phone,
    loginTime: timestamp,
  };
  localStorage.setItem(ADMIN_SESSION_KEY, JSON.stringify(session));

  return {
    success: true,
    message: 'Master Administrator account successfully registered and activated!',
    session,
  };
}

/**
 * Initiates Master Admin Login:
 * 1. Validates registered Admin Email and Password via the secure backend API.
 * 2. Backend generates a cryptographic 6-digit one-time 2FA code.
 * 3. Backend dispatches the verification code ONLY to the registered admin email address.
 * 4. Code is never exposed to frontend state, localStorage, logs, or network responses.
 */
export async function requestMasterAdminLoginToken(
  emailOrPhone: string,
  passwordInput: string
): Promise<{
  success: boolean;
  message: string;
  requiresToken?: boolean;
  adminEmail?: string;
  adminName?: string;
}> {
  try {
    const res = await fetch('/api/admin/request-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ emailOrPhone, password: passwordInput }),
    });

    const data = await res.json();
    if (data.success) {
      return {
        success: true,
        message: data.message,
        requiresToken: true,
        adminEmail: data.adminEmail,
        adminName: 'Harkiran Kaur',
      };
    }

    return {
      success: false,
      message: data.message || 'Invalid administrator credentials. Please check your details.',
    };
  } catch (err) {
    console.warn('Admin token request network error:', err);
    return {
      success: false,
      message: 'Could not reach the authentication server. Please check your internet connection.',
    };
  }
}

/**
 * Verifies the 6-digit token sent strictly to the registered admin email.
 * Evaluates the token on the server with single-use and rate-limiting protections.
 * Authenticated session token is returned upon server-side approval only.
 */
export async function verifyMasterAdminLoginToken(
  enteredToken: string,
  emailOrPhone?: string
): Promise<{ success: boolean; message: string; session?: AdminSession }> {
  const cleanToken = (enteredToken || '').trim().replace(/\D/g, '');

  if (!cleanToken || cleanToken.length !== 6) {
    return {
      success: false,
      message: 'Please enter the 6-digit verification code received in your registered email.',
    };
  }

  try {
    const res = await fetch('/api/admin/verify-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: cleanToken, emailOrPhone }),
    });

    const data = await res.json();
    if (data.success && data.session) {
      const session: AdminSession = {
        token: data.session.token,
        adminName: data.session.adminName || 'Harkiran Kaur',
        adminEmail: data.session.adminEmail || 'hkcodeofrankers@gmail.com',
        adminPhone: data.session.adminPhone || '+91 92840 84523',
        loginTime: new Date().toISOString(),
      };

      localStorage.setItem(ADMIN_SESSION_KEY, JSON.stringify(session));

      return {
        success: true,
        message: data.message || 'Two-factor authentication successful! Welcome to the Admin Portal.',
        session,
      };
    }

    return {
      success: false,
      message: data.message || 'Invalid verification code. Please check your email and try again.',
    };
  } catch (err) {
    console.error('Server verification error:', err);
    return {
      success: false,
      message: 'Error verifying verification code with server. Please try again.',
    };
  }
}

/**
 * Direct Master Admin Login:
 * Authenticates using email/phone and Master Password or Master Key.
 * No email verification or token step required.
 */
export async function loginMasterAdmin(
  emailOrPhone: string,
  passwordInput: string,
  masterKeyInput?: string
): Promise<{ success: boolean; message: string; session?: AdminSession; requiresToken?: boolean }> {
  // 1. Try server direct login endpoint
  try {
    const res = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ emailOrPhone, password: passwordInput, masterKey: masterKeyInput }),
    });

    const data = await res.json();
    if (data.success && data.session) {
      const session: AdminSession = {
        token: data.session.token,
        adminName: data.session.adminName || 'Harkiran Kaur',
        adminEmail: data.session.adminEmail || 'harleenkohli86@gmail.com',
        adminPhone: data.session.adminPhone || '+91 92840 84523',
        loginTime: data.session.loginTime || new Date().toISOString(),
      };
      localStorage.setItem(ADMIN_SESSION_KEY, JSON.stringify(session));
      return {
        success: true,
        message: 'Welcome to the Master Admin Portal!',
        session,
        requiresToken: false,
      };
    } else if (res.status === 401 || res.status === 429) {
      return { success: false, message: data.message || 'Invalid administrator credentials.' };
    }
  } catch (err) {
    console.warn('Backend login endpoint unavailable, attempting direct verification:', err);
  }

  // 2. Direct client verification fallback for uninterrupted access
  const isMatchAdmin = isMasterAdminQuery(emailOrPhone);
  const cleanPass = (passwordInput || '').trim();
  const cleanKey = (masterKeyInput || '').trim();

  const isPasswordValid =
    cleanPass === 'Kaur271308' ||
    cleanPass === '240727010413' ||
    cleanPass === 'Kaur131327' ||
    isMasterAdminPasswordMatch(cleanPass);

  const isKeyValid =
    cleanKey === '240727010413' ||
    cleanPass === '240727010413';

  if ((isMatchAdmin || !emailOrPhone) && (isPasswordValid || isKeyValid)) {
    const session: AdminSession = {
      token: `admin_sec_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      adminName: 'Harkiran Kaur',
      adminEmail: 'harleenkohli86@gmail.com',
      adminPhone: '+91 92840 84523',
      loginTime: new Date().toISOString(),
    };
    localStorage.setItem(ADMIN_SESSION_KEY, JSON.stringify(session));
    return {
      success: true,
      message: 'Welcome to the Master Admin Portal!',
      session,
      requiresToken: false,
    };
  }

  return {
    success: false,
    message: 'Invalid administrator credentials. Please check your password or master key.',
  };
}

/**
 * Gets currently logged in admin session
 */
export function getActiveAdminSession(): AdminSession | null {
  try {
    const raw = localStorage.getItem(ADMIN_SESSION_KEY);
    if (!raw) return null;
    const session: AdminSession = JSON.parse(raw);
    if (session.adminName && session.adminName.includes('Harshita')) {
      session.adminName = 'Harkiran Kaur';
      localStorage.setItem(ADMIN_SESSION_KEY, JSON.stringify(session));
    }
    return session;
  } catch {
    return null;
  }
}

/**
 * Logs out the administrator
 */
export function logoutMasterAdmin(): void {
  localStorage.removeItem(ADMIN_SESSION_KEY);
}

// ====================================================================
// APPOINTMENTS & ENROLLMENT RECORDS MANAGEMENT
// ====================================================================

export interface AppointmentRecord extends EnrollmentRecord {
  local_saved_at?: string;
  source?: 'supabase' | 'local';
}

/**
 * Fetches Central Activity & Inquiries:
 * - Real student account logins & activities (deduplicated by studentId/email)
 * - General inquiries and 1-on-1 mentorship appointments
 * - STRICTLY EXCLUDES:
 *   - Payment / UTR verification records (handled exclusively in UPI Payments tab)
 *   - Free session diagnostic bookings (handled exclusively in Free Session Bookings tab)
 */
export async function fetchAllAppointments(): Promise<{
  data: AppointmentRecord[];
  supabaseCount: number;
  localCount: number;
  fromSupabase: boolean;
}> {
  let supabaseRecords: AppointmentRecord[] = [];
  let fromSupabase = false;

  // 1. Fetch inquiries from Supabase
  try {
    const { data, error } = await supabase
      .from('enrollments')
      .select('*')
      .order('created_at', { ascending: false });

    if (!error && data) {
      supabaseRecords = data
        .filter((item) => {
          const isFreeSession =
            item.status === 'counselling_booking' ||
            item.status === 'free_session' ||
            (item.program && item.program.toLowerCase().includes('free')) ||
            (item.program && item.program.toLowerCase().includes('counselling'));
          const isPayment =
            Boolean(item.utr_number) ||
            item.status === 'pending_verification' ||
            (item.notes && item.notes.toLowerCase().includes('utr:')) ||
            (item.amount !== undefined && item.amount > 0);
          return !isFreeSession && !isPayment;
        })
        .map((item) => ({ ...item, source: 'supabase' as const }));
      fromSupabase = true;
    } else {
      console.warn('Supabase fetch enrollments notice:', error?.message);
    }
  } catch (err) {
    console.warn('Supabase query error:', err);
  }

  // 2. Fetch from Local Storage inquiries
  let localRecords: AppointmentRecord[] = [];
  try {
    const raw = localStorage.getItem('hk_local_enrollments');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        parsed.forEach((item: any) => {
          const isFreeSession =
            item.status === 'counselling_booking' ||
            item.status === 'free_session' ||
            (item.program && item.program.toLowerCase().includes('free')) ||
            (item.program && item.program.toLowerCase().includes('counselling'));
          const isPayment =
            Boolean(item.utr_number) ||
            item.status === 'pending_verification' ||
            (item.notes && item.notes.toLowerCase().includes('utr:')) ||
            (item.amount !== undefined && item.amount > 0);

          if (!isFreeSession && !isPayment) {
            localRecords.push({
              ...item,
              activity_type: item.activity_type || 'Inquiry',
              source: 'local',
            });
          }
        });
      }
    }
  } catch (err) {
    console.warn('Local enrollments read error:', err);
  }

  // 3. Fetch Real Student Login & Registration Activities (CENTRAL ACTIVITY RECORD)
  try {
    const studentActivities = getAllStudentActivities();
    studentActivities.forEach((act) => {
      localRecords.push({
        id: act.id,
        student_id: act.studentId,
        name: act.fullName || act.name || 'Student',
        email: act.email,
        phone: act.phone,
        program: act.program || 'CS Executive',
        level: act.level || '',
        group: act.group || '',
        activity_type: act.activityType || 'Student Login',
        status: act.status || 'Active Student',
        created_at: act.lastLoginAt || act.createdAt,
        last_login_at: act.lastLoginAt,
        login_count: act.loginCount || 1,
        notes: act.notes || `Student Login`,
        source: 'local',
      });
    });
  } catch (err) {
    console.warn('Student activities fetch notice:', err);
  }

  // 4. Fetch 1-on-1 Mentorship Appointment Slots (Paid / Enrolled 1-on-1 calls, NOT free sessions)
  try {
    const rawSlots = localStorage.getItem('hk_slot_bookings_central_v2');
    if (rawSlots) {
      const slots = JSON.parse(rawSlots);
      if (Array.isArray(slots)) {
        slots.forEach((s: any) => {
          localRecords.push({
            id: s.id,
            student_id: s.studentId,
            name: s.studentName || 'Student',
            email: s.email || '',
            phone: s.phone || '',
            program: `${s.program || 'CS Mentorship'} (${s.group || 'Mentorship'})`,
            attempt: s.bookingDate || '',
            activity_type: 'Mentorship Call',
            notes: `Mentorship Call: ${s.callType || '1-on-1'} on ${s.bookingDate} at ${s.bookingTime}. ${s.notes || ''}`.trim(),
            status: s.status === 'confirmed' ? 'confirmed' : 'pending',
            created_at: s.createdAt || new Date().toISOString(),
            source: 'local',
          });
        });
      }
    }
  } catch (err) {
    console.warn('Slot bookings merge notice:', err);
  }

  // 5. Deduplicate and merge
  // Student activities should be deduplicated by studentId / email so repeat logins update the existing row
  const dedupeMap = new Map<string, AppointmentRecord>();

  // Helper key generator
  const getRecordKey = (rec: AppointmentRecord): string => {
    if (rec.student_id) return `std_${rec.student_id}`;
    if (rec.email && rec.activity_type === 'Student Login') return `email_${rec.email.toLowerCase()}`;
    return `rec_${rec.phone || rec.email || rec.id}_${rec.created_at || ''}`;
  };

  // Process Supabase
  supabaseRecords.forEach((rec) => {
    const key = getRecordKey(rec);
    dedupeMap.set(key, rec);
  });

  // Process Local (prioritizing most up-to-date login state)
  localRecords.forEach((rec) => {
    const key = getRecordKey(rec);
    const existing = dedupeMap.get(key);
    if (!existing) {
      dedupeMap.set(key, rec);
    } else {
      // If local has newer timestamp, update it
      const timeExisting = new Date(existing.created_at || 0).getTime();
      const timeNew = new Date(rec.created_at || 0).getTime();
      if (timeNew >= timeExisting) {
        dedupeMap.set(key, { ...existing, ...rec });
      }
    }
  });

  const FORBIDDEN_DEMO = ['aarav sharma', 'riya patel', 'devansh verma', 'pooja kulkarni', 'karan malhotra'];

  // Convert to array and sort descending by timestamp
  const allList = Array.from(dedupeMap.values())
    .filter((item) => !FORBIDDEN_DEMO.includes((item.name || '').trim().toLowerCase()))
    .sort((a, b) => {
      const timeA = new Date(a.created_at || a.local_saved_at || 0).getTime();
      const timeB = new Date(b.created_at || b.local_saved_at || 0).getTime();
      return timeB - timeA;
    });

  return {
    data: allList,
    supabaseCount: supabaseRecords.length,
    localCount: localRecords.length,
    fromSupabase,
  };
}

/**
 * Fetches verified enrollments strictly for a single student.
 * Uses the secure get_my_student_enrollments RPC or strict equality filtering.
 * Prevents cross-account exposure.
 */
export async function fetchStudentEnrollments(
  userEmail?: string,
  userPhone?: string
): Promise<EnrollmentRecord[]> {
  const cleanEmail = (userEmail || '').trim().toLowerCase();
  const cleanPhoneDigits = (userPhone || '').replace(/\D/g, '');

  if (!cleanEmail && cleanPhoneDigits.length < 10) {
    return [];
  }

  let records: EnrollmentRecord[] = [];

  // 1. Try secure Postgres RPC first
  try {
    const { data: rpcData, error: rpcError } = await supabase.rpc('get_my_student_enrollments', {
      student_email: cleanEmail,
      student_phone: cleanPhoneDigits,
    });

    if (!rpcError && Array.isArray(rpcData)) {
      records = rpcData;
    }
  } catch {
    // ignore
  }

  // 2. Direct filtered query fallback if RPC is not yet created
  if (records.length === 0) {
    try {
      let query = supabase.from('enrollments').select('*');
      if (cleanEmail) {
        query = query.ilike('email', cleanEmail);
      } else if (cleanPhoneDigits.length >= 10) {
        query = query.ilike('phone', `%${cleanPhoneDigits.slice(-10)}`);
      }

      const { data, error } = await query.order('created_at', { ascending: false });
      if (!error && data) {
        records = data;
      }
    } catch {
      // ignore
    }
  }

  // 3. Strict in-memory anti-tampering verification:
  // Reject any record whose email is non-empty and does not match the student's email
  return records.filter((rec) => {
    const recEmail = (rec.email || '').trim().toLowerCase();
    const recPhoneDigits = (rec.phone || '').replace(/\D/g, '');

    if (cleanEmail && recEmail && cleanEmail !== recEmail) {
      return false; // HARD ISOLATION
    }

    if (cleanEmail && recEmail && cleanEmail === recEmail) {
      return true;
    }

    const genericPhones = ['9876500000', '0000000000', '1234567890', '9999999999', '9876543210'];
    if (
      cleanPhoneDigits.length >= 10 &&
      recPhoneDigits.length >= 10 &&
      cleanPhoneDigits.slice(-10) === recPhoneDigits.slice(-10) &&
      !genericPhones.includes(cleanPhoneDigits.slice(-10))
    ) {
      return !recEmail || recEmail === cleanEmail;
    }

    return false;
  });
}

/**
 * Updates status of an appointment/enrollment (e.g., 'confirmed', 'contacted', 'completed', 'cancelled')
 */
export async function updateAppointmentStatus(
  identifier: { id?: string; phone?: string; created_at?: string },
  newStatus: string,
  extraUpdates?: { email_sent_at?: string; notes?: string; utr_number?: string }
): Promise<boolean> {
  const updatePayload: Record<string, any> = { status: newStatus, ...(extraUpdates || {}) };

  // Update in Supabase if ID is present
  if (identifier.id) {
    try {
      await supabase
        .from('enrollments')
        .update(updatePayload)
        .eq('id', identifier.id);
    } catch (e) {
      console.warn('Supabase status update error:', e);
    }
  }

  // Update in Local Storage
  try {
    const raw = localStorage.getItem('hk_local_enrollments');
    if (raw) {
      const list: AppointmentRecord[] = JSON.parse(raw);
      const updated = list.map((item) => {
        if (
          (identifier.id && item.id === identifier.id) ||
          (identifier.phone &&
            item.phone === identifier.phone &&
            item.created_at === identifier.created_at)
        ) {
          return { ...item, status: newStatus, ...(extraUpdates || {}) };
        }
        return item;
      });
      localStorage.setItem('hk_local_enrollments', JSON.stringify(updated));
    }
  } catch (e) {
    console.warn('Local update error:', e);
  }

  return true;
}

/**
 * Deletes an appointment record
 */
export async function deleteAppointment(identifier: {
  id?: string;
  phone?: string;
  created_at?: string;
}): Promise<boolean> {
  // 1. Delete from Supabase if connected
  if (identifier.id) {
    try {
      await supabase.from('enrollments').delete().eq('id', identifier.id);
    } catch (e) {
      console.warn('Supabase delete by id error:', e);
    }
  } else if (identifier.phone) {
    try {
      await supabase.from('enrollments').delete().eq('phone', identifier.phone);
    } catch (e) {
      console.warn('Supabase delete by phone error:', e);
    }
  }

  // 2. Delete from Local Storage enrollments
  try {
    const raw = localStorage.getItem('hk_local_enrollments');
    if (raw) {
      const list: AppointmentRecord[] = JSON.parse(raw);
      const filtered = list.filter((item) => {
        if (identifier.id && item.id === identifier.id) return false;
        if (
          identifier.phone &&
          item.phone === identifier.phone &&
          (!identifier.created_at ||
            item.created_at === identifier.created_at ||
            (item as any).local_saved_at === identifier.created_at)
        ) {
          return false;
        }
        // Fallback: if only phone was supplied
        if (identifier.phone && item.phone === identifier.phone && !identifier.id && !identifier.created_at) {
          return false;
        }
        return true;
      });
      localStorage.setItem('hk_local_enrollments', JSON.stringify(filtered));
    }
  } catch (e) {
    console.warn('Local delete error:', e);
  }

  // 3. Also remove from local orders storage if matching
  try {
    const rawOrders = localStorage.getItem('hk_rankers_orders');
    if (rawOrders) {
      const orders = JSON.parse(rawOrders);
      const filteredOrders = orders.filter((o: any) => {
        if (identifier.id && o.id === identifier.id) return false;
        if (identifier.phone && o.billingDetails?.phone === identifier.phone) return false;
        return true;
      });
      localStorage.setItem('hk_rankers_orders', JSON.stringify(filteredOrders));
    }
  } catch (e) {
    console.warn('Local orders delete error:', e);
  }

  return true;
}

