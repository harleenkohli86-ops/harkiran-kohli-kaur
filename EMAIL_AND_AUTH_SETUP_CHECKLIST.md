# HK Code of Rankers — Email & Admin Authentication Manual Setup Checklist

This document provides the exact, production-verified instructions to activate and manage the automated email notifications and secure Admin authentication for HK Code of Rankers.

---

## 1. Summary of Architecture & Security Enhancements

1. **Automatic Student Registration Notification (to `hk.code.of.rankers@gmail.com`)**:
   - Fires automatically whenever a genuine student creates an account.
   - Includes full student details: Student ID, Name, Email, Phone, Program, Level/Group, Attempt, Registration Date & Time.
   - **Never exposes** password, OTP, tokens, or sensitive credentials.
   - **Deduplication**: Protected by server-side deduplication to prevent duplicate emails on page reloads, logins, or profile edits.

2. **Admin Authentication & OTP Flow**:
   - Admin email: `hkcodeofrankers@gmail.com`.
   - Master Admin enters password (`Kaur131327`).
   - Server validates credentials and generates a secure 6-digit one-time verification code (valid for 10 minutes, single use).
   - Verification code is dispatched strictly to `hkcodeofrankers@gmail.com`.
   - **Zero Frontend Leakage**: The verification code is **never** printed in console, never returned in API response, never in localStorage/sessionStorage, never prefilled in input, and never exposed on the login screen.
   - **No Recovery PIN**: Any legacy recovery PIN display has been completely removed from the frontend.
   - Rate limiting and maximum 5 attempt protection enabled.

---

## 2. Resend Email Provider Setup (Recommended)

1. Sign up / log in to [Resend.com](https://resend.com).
2. Go to **API Keys** -> Click **Create API Key**.
   - Name: `HK Code of Rankers Production`
   - Permission: Full Access
3. Copy your API key (starts with `re_...`).
4. Set the environment variable in your production host (or `.env`):
   ```env
   RESEND_API_KEY=re_your_api_key_here
   RESEND_FROM_EMAIL=HK Code of Rankers <onboarding@resend.dev>
   ```
   *(Once you verify your custom domain in Resend, you can change `RESEND_FROM_EMAIL` to `HK Code of Rankers <notifications@hkcodeofrankers.com>`)*.

---

## 3. Supabase Backend Configuration (Project ID: `qafnqmguzzrhksoitrzf`)

### Step 3.1: Apply SQL Schema Updates
1. Open your Supabase Dashboard: [https://supabase.com/dashboard/project/qafnqmguzzrhksoitrzf](https://supabase.com/dashboard/project/qafnqmguzzrhksoitrzf).
2. Click on **SQL Editor** from the left navigation.
3. Open `supabase_schema.sql` from this repository, copy its contents, paste them into the SQL Editor, and click **Run**.
4. This ensures:
   - `enrollments` table has strict Row-Level Security (RLS).
   - `admin_accounts` has `hkcodeofrankers@gmail.com` as the master admin.
   - The security functions are granted to authenticated and anonymous users safely.

### Step 3.2: (Optional) Deploy Supabase Edge Functions
If deploying Supabase Edge Functions:
1. Install Supabase CLI: `npm i -g supabase`
2. Link your project:
   ```bash
   supabase link --project-ref qafnqmguzzrhksoitrzf
   ```
3. Set your Resend secret in Supabase:
   ```bash
   supabase secrets set RESEND_API_KEY=re_your_api_key_here
   ```
4. Deploy the functions:
   ```bash
   supabase functions deploy send-email
   supabase functions deploy handle-registration
   ```

---

## 4. Testing & Verification

### Test 1: Admin Login & OTP Email
1. Navigate to `/admin` in your browser.
2. In **Admin Email or Phone**, enter: `hkcodeofrankers@gmail.com` (or phone `9284084523`).
3. In **Master Password**, enter: `Kaur131327`.
4. Click **Verify Credentials & Send Email Token**.
5. Check inbox for `hkcodeofrankers@gmail.com`.
6. Enter the 6-digit OTP code received in email into the 6-digit input box.
7. Click **Complete 2FA & Access Admin Portal**.
8. Verify that the Admin Portal loads all student records, inquiries, and free slot bookings.

### Test 2: New Student Registration Notification
1. Open an incognito window or log out.
2. Register a new test student with a valid phone number and email.
3. Complete the registration.
4. Verify that `hk.code.of.rankers@gmail.com` receives the official notification:
   - Subject: `New Student Registration – HK Code of Rankers`
   - Contains: Student ID, Name, Email, Phone, Program, Level/Group, Attempt, Registration Date & Time.
   - Does NOT contain the student's password or sensitive token.
5. Log in as that student or refresh the page — observe that **no duplicate email** is dispatched.
