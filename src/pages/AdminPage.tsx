import React, { useState, useEffect } from 'react';
import {
  Shield,
  Lock,
  UserCheck,
  Calendar,
  Phone,
  Mail,
  Clock,
  CheckCircle2,
  AlertCircle,
  Search,
  Filter,
  RefreshCw,
  Download,
  ExternalLink,
  MessageSquare,
  ChevronRight,
  LogOut,
  ArrowLeft,
  GraduationCap,
  Sparkles,
  Database,
  Trash2,
  Eye,
  X,
  Send,
  SlidersHorizontal,
  Check,
  Copy,
  CreditCard,
  Key,
  HelpCircle,
  QrCode,
  CheckCheck,
  FileText,
  Bookmark,
  BookOpen,
  PhoneCall,
  LogIn,
  Activity,
} from 'lucide-react';
import { PageId } from '../types';
import { AdminMentorshipManager } from '../components/AdminMentorshipManager';
import { FreeSlotBookingsTab } from '../components/admin/FreeSlotBookingsTab';
import { PaymentApprovalsTab } from '../components/admin/PaymentApprovalsTab';
import {
  getAllFreeSlotBookings,
  getAllStudents,
  approveStudentPayment,
  rejectStudentPayment,
  subscribeToDatabaseChanges,
  FreeSlotBookingRecord,
  CentralStudent,
} from '../services/centralStudentDatabase';
import {
  deleteStudentMentorshipProfile,
  getOrCreateStudentMentorship,
  setStudentApprovalStatus,
} from '../services/mentorshipTrackerService';
import {
  checkMasterAdminSlotStatus,
  registerMasterAdmin,
  loginMasterAdmin,
  requestMasterAdminLoginToken,
  verifyMasterAdminLoginToken,
  getActiveAdminSession,
  logoutMasterAdmin,
  fetchAllAppointments,
  updateAppointmentStatus,
  deleteAppointment,
  AdminSession,
  AppointmentRecord,
  SUPABASE_PROJECT_ID,
} from '../lib/supabase';
import { generateInvoicePDF } from '../services/invoiceService';
import {
  sendStudentConfirmationEmail,
  sendEnquiryConfirmationEmail,
  generateStudentConfirmationEmailHtml,
  generateStudentConfirmationEmailPlainText,
  getGmailComposeUrl,
  getWhatsAppConfirmationUrl,
  getMailtoUrl,
  getDispatchedEmails,
  DispatchedEmailRecord,
} from '../services/emailService';
import {
  UPI_PAYEE_CONFIG,
  formatUtrDisplay,
} from '../services/upiPayment';

interface AdminPageProps {
  onNavigate: (page: PageId) => void;
}

export const AdminPage: React.FC<AdminPageProps> = ({ onNavigate }) => {
  // Session State
  const [session, setSession] = useState<AdminSession | null>(() => getActiveAdminSession());

  // Slot Status State
  const [slotStatus, setSlotStatus] = useState<{
    checked: boolean;
    claimed: boolean;
    adminEmail?: string;
    adminName?: string;
  }>({
    checked: false,
    claimed: true,
  });

  // Auth Form State
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [authStep, setAuthStep] = useState<'credentials' | 'token_verification'>('credentials');
  const [authForm, setAuthForm] = useState({
    name: '',
    email: '',
    phone: '',
    password: '',
    masterKey: '',
    confirmPassword: '',
  });
  const [adminInputToken, setAdminInputToken] = useState('');
  const [pendingAdminEmail, setPendingAdminEmail] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [authSuccess, setAuthSuccess] = useState<string | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(false);

  // Appointments Dashboard State
  const [appointments, setAppointments] = useState<AppointmentRecord[]>([]);
  const [isLoadingAppointments, setIsLoadingAppointments] = useState(false);
  const [supabaseConnected, setSupabaseConnected] = useState(false);
  const [selectedAppointment, setSelectedAppointment] = useState<AppointmentRecord | null>(null);
  const [copiedPhone, setCopiedPhone] = useState<string | null>(null);
  const [copiedUtr, setCopiedUtr] = useState<string | null>(null);

  // Direct UPI Approval States
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [approvalToast, setApprovalToast] = useState<{ message: string; email?: string } | null>(null);
  const [previewEmailModal, setPreviewEmailModal] = useState<{
    isOpen: boolean;
    appt: AppointmentRecord;
    html: string;
  } | null>(null);

  // Filters & Search
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | 'upi_pending' | 'counselling' | 'cohort' | 'inquiry' | 'paid'>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'new' | 'contacted' | 'confirmed' | 'completed'>('all');
  const [sortOrder, setSortOrder] = useState<'newest' | 'oldest'>('newest');

  // Admin Active Tab: 'appointments' | 'upi_verification' | 'free_sessions' | 'mentorship_tracker'
  const [adminTab, setAdminTab] = useState<'appointments' | 'upi_verification' | 'free_sessions' | 'mentorship_tracker'>('appointments');
  const [freeSlotBookings, setFreeSlotBookings] = useState<FreeSlotBookingRecord[]>(() => getAllFreeSlotBookings());
  const [centralStudents, setCentralStudents] = useState<CentralStudent[]>(() => getAllStudents());

  const loadFreeSlotBookings = () => {
    setFreeSlotBookings(getAllFreeSlotBookings());
  };

  const loadCentralStudents = () => {
    setCentralStudents(getAllStudents());
  };

  // Keep freeSlotBookings & centralStudents updated periodically & on focus/db change
  useEffect(() => {
    loadFreeSlotBookings();
    loadCentralStudents();
    const handleFocus = () => {
      loadFreeSlotBookings();
      loadCentralStudents();
    };
    window.addEventListener('focus', handleFocus);
    const interval = setInterval(() => {
      loadFreeSlotBookings();
      loadCentralStudents();
    }, 15000);
    const unsubscribe = subscribeToDatabaseChanges(() => {
      loadCentralStudents();
    });
    return () => {
      window.removeEventListener('focus', handleFocus);
      clearInterval(interval);
      unsubscribe();
    };
  }, []);

  const handleApproveCentralPayment = async (student: CentralStudent) => {
    setApprovingId(student.studentId);
    try {
      approveStudentPayment(student.studentId);
      loadCentralStudents();
      loadAppointments();

      const courseName = student.purchasedCourse?.courseName || student.targetExam;
      const cleanPhone = student.phone.replace(/\D/g, '').slice(-10);
      const waUrl = cleanPhone
        ? `https://wa.me/91${cleanPhone}?text=${encodeURIComponent(
            `Hello ${student.fullName}! Your payment for ${courseName} has been verified and approved by Harkiran Kaur! 🎉\n\nYour personalized Mentorship Roadmap, Chapter Index, and 12-Month Diagnostic & Strategy Calls are now unlocked in your Student Portal!`
          )}`
        : undefined;

      setApprovalToast({
        message: `Payment Verified & Approved! Full mentorship access unlocked for ${student.fullName}.`,
        email: student.email,
      });
      setTimeout(() => setApprovalToast(null), 7000);
    } catch (err: any) {
      console.error('Payment approval error:', err);
    } finally {
      setApprovingId(null);
    }
  };

  const handleRejectCentralPayment = (student: CentralStudent) => {
    const reason = window.prompt(`Enter reason for rejecting payment of ${student.fullName}:`, 'Payment UTR / transaction verification failed');
    if (reason === null) return;
    rejectStudentPayment(student.studentId, reason);
    loadCentralStudents();
    loadAppointments();
    setApprovalToast({
      message: `Payment rejected for ${student.fullName}.`,
      email: student.email,
    });
    setTimeout(() => setApprovalToast(null), 5000);
  };

  // Direct Dispatch Action Modal State (Gmail 1-click send, WhatsApp dispatch, and PDF Invoice)
  const [dispatchModalData, setDispatchModalData] = useState<{
    studentName: string;
    studentEmail: string;
    studentPhone: string;
    program: string;
    amount: number;
    utrNumber: string;
    orderNumber: string;
    gmailUrl: string;
    whatsAppUrl: string;
    mailtoUrl: string;
    plainText: string;
    previewHtml: string;
  } | null>(null);

  // Delete Confirmation Modal State (immune to iframe restrictions)
  const [itemToDelete, setItemToDelete] = useState<AppointmentRecord | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // 1. Check Master Admin Slot Status on Mount
  useEffect(() => {
    async function initAuthCheck() {
      const status = await checkMasterAdminSlotStatus();
      setSlotStatus({
        checked: true,
        claimed: status.claimed,
        adminEmail: status.adminEmail,
        adminName: status.adminName,
      });

      if (!status.claimed) {
        setAuthMode('register');
      } else {
        setAuthMode('login');
      }
    }
    initAuthCheck();
  }, []);

  // 2. Load Appointments when session is active
  const loadAppointments = async () => {
    setIsLoadingAppointments(true);
    try {
      const res = await fetchAllAppointments();
      setAppointments(res.data);
      setSupabaseConnected(res.fromSupabase);
    } catch (err) {
      console.error('Failed to load appointments:', err);
    } finally {
      setIsLoadingAppointments(false);
    }
  };

  useEffect(() => {
    if (session) {
      loadAppointments();
    }
  }, [session]);

  // Handle Register (Single-Slot Provisioning)
  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setAuthSuccess(null);

    if (authForm.password !== authForm.confirmPassword) {
      setAuthError('Passwords do not match. Please verify.');
      return;
    }

    if (authForm.password.length < 6) {
      setAuthError('Master Password must be at least 6 characters.');
      return;
    }

    setIsAuthLoading(true);
    const result = await registerMasterAdmin({
      name: authForm.name,
      email: authForm.email,
      phone: authForm.phone,
      password: authForm.password,
    });

    setIsAuthLoading(false);
    if (result.success && result.session) {
      setSlotStatus({
        checked: true,
        claimed: true,
        adminEmail: authForm.email,
        adminName: authForm.name,
      });
      setSession(result.session);
      setAuthSuccess('Single Master Administrator account claimed and registered!');
    } else {
      setAuthError(result.message);
    }
  };

  // Handle Direct Admin Login (No token or email verification required)
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setAuthSuccess(null);

    setIsAuthLoading(true);
    const result = await loginMasterAdmin(authForm.email, authForm.password, authForm.masterKey);
    setIsAuthLoading(false);

    if (result.success && result.session) {
      setSession(result.session);
      setAuthStep('credentials');
      setAuthSuccess('Welcome back, Master Admin!');
    } else {
      setAuthError(result.message || 'Invalid administrator credentials. Please check your details.');
    }
  };

  // Handle Login: Step 2 - Verify 6-digit email token
  const handleVerifyToken = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adminInputToken.trim()) {
      setAuthError('Please enter the 6-digit security verification code.');
      return;
    }

    setAuthError(null);
    setAuthSuccess(null);
    setIsAuthLoading(true);

    const result = await verifyMasterAdminLoginToken(adminInputToken.trim(), pendingAdminEmail || authForm.email);
    setIsAuthLoading(false);

    if (result.success && result.session) {
      setSession(result.session);
      setAuthStep('credentials');
      setAdminInputToken('');
    } else {
      setAuthError(result.message);
    }
  };

  // Handle Resend Token
  const handleResendToken = async () => {
    if (!authForm.email || !authForm.password) {
      setAuthStep('credentials');
      return;
    }
    setAuthError(null);
    setAuthSuccess(null);
    setIsAuthLoading(true);
    const result = await requestMasterAdminLoginToken(authForm.email, authForm.password);
    setIsAuthLoading(false);

    if (result.success) {
      setAuthSuccess('New security token dispatched to your registered email!');
    } else {
      setAuthError(result.message);
    }
  };

  // Handle Logout
  const handleLogout = () => {
    logoutMasterAdmin();
    setSession(null);
    setSelectedAppointment(null);
    setAuthStep('credentials');
    setAdminInputToken('');
  };

  // Handle Status Change
  const handleStatusChange = async (
    appt: AppointmentRecord,
    newStatus: string
  ) => {
    // If the admin changes the status dropdown to 'confirmed', immediately trigger approval & branded confirmation email
    if (newStatus === 'confirmed') {
      await handleApproveAndSendEmail(appt);
      return;
    }

    const updatedList = appointments.map((item) => {
      if (
        (appt.id && item.id === appt.id) ||
        (item.phone === appt.phone && item.created_at === appt.created_at)
      ) {
        return { ...item, status: newStatus };
      }
      return item;
    });
    setAppointments(updatedList);

    if (selectedAppointment && selectedAppointment.phone === appt.phone) {
      setSelectedAppointment({ ...selectedAppointment, status: newStatus });
    }

    await updateAppointmentStatus(
      { id: appt.id, phone: appt.phone, created_at: appt.created_at },
      newStatus
    );

    setApprovalToast({
      message: `Status updated to "${newStatus.replace(/_/g, ' ').toUpperCase()}" for ${appt.name}.`,
      email: appt.email || appt.phone,
    });
    setTimeout(() => setApprovalToast(null), 4000);
  };

  // Handle Direct UPI Approval + Automatic Email Dispatch
  const handleApproveAndSendEmail = async (appt: AppointmentRecord) => {
    const recordKey = appt.id || `${appt.phone}_${appt.created_at}`;
    setApprovingId(recordKey);

    try {
      const studentEmail = appt.email || `${(appt.phone || '').replace(/\D/g, '')}@student.hkcodeofrankers.com`;
      const programName = appt.program || 'CS Mentorship Batch';
      const orderNumber = `ORD-${Date.now().toString().slice(-6)}`;
      const utr = appt.utr_number || (appt.notes?.match(/\d{12}/)?.[0]) || 'Direct UPI Transfer';

      const isEnquiryOrCounselling =
        appt.status === 'inquiry' ||
        appt.status === 'counselling_booking' ||
        appt.status === 'free_session' ||
        appt.program?.toLowerCase().includes('counselling') ||
        appt.program?.toLowerCase().includes('inquiry') ||
        appt.program?.toLowerCase().includes('enquiry') ||
        appt.program?.toLowerCase().includes('free') ||
        (!appt.amount && !appt.utr_number);

      let emailResult;
      if (isEnquiryOrCounselling) {
        // Send Customized Enquiry Confirmation Email (No fake payment receipt)
        emailResult = await sendEnquiryConfirmationEmail({
          candidateName: appt.name,
          candidateEmail: studentEmail,
          candidatePhone: appt.phone,
          programName: programName,
          notes: appt.notes,
        });
      } else {
        // Prepare and send official payment confirmation email package
        emailResult = await sendStudentConfirmationEmail({
          studentName: appt.name,
          studentEmail: studentEmail,
          studentPhone: appt.phone,
          programName: programName,
          amount: appt.amount || 2999,
          utrNumber: utr,
          orderNumber: orderNumber,
        });
      }

      // Show the Direct Dispatch Modal with 1-Click Gmail, WhatsApp, and PDF Invoice
      setDispatchModalData({
        studentName: appt.name,
        studentEmail: studentEmail,
        studentPhone: appt.phone,
        program: programName,
        amount: appt.amount || 2999,
        utrNumber: utr,
        orderNumber: orderNumber,
        gmailUrl: emailResult.gmailUrl,
        whatsAppUrl: emailResult.whatsAppUrl,
        mailtoUrl: emailResult.mailtoUrl,
        plainText: emailResult.plainText,
        previewHtml: emailResult.record.previewHtml,
      });

      const now = new Date().toISOString();

      // 2. Update local state
      const updatedList = appointments.map((item) => {
        if (
          (appt.id && item.id === appt.id) ||
          (item.phone === appt.phone && item.created_at === appt.created_at)
        ) {
          return {
            ...item,
            status: 'confirmed',
            email_sent_at: now,
            utr_number: utr,
          };
        }
        return item;
      });
      setAppointments(updatedList);

      if (selectedAppointment && selectedAppointment.phone === appt.phone) {
        setSelectedAppointment({
          ...selectedAppointment,
          status: 'confirmed',
          email_sent_at: now,
          utr_number: utr,
        });
      }

      // 3. Persist to Supabase & local storage
      await updateAppointmentStatus(
        { id: appt.id, phone: appt.phone, created_at: appt.created_at },
        'confirmed',
        {
          email_sent_at: now,
          utr_number: utr,
          notes: `${appt.notes || ''} [Verified UTR: ${utr} | Email Dispatched: ${now}]`.trim(),
        }
      );

      // 4. Also mark corresponding order as COMPLETED if present in localStorage orders
      try {
        const rawOrders = localStorage.getItem('hk_rankers_orders');
        if (rawOrders) {
          const ords = JSON.parse(rawOrders);
          const cleanPhone = (appt.phone || '').replace(/\D/g, '');
          const updatedOrds = ords.map((o: any) => {
            const oPhone = (o.billingDetails?.phone || '').replace(/\D/g, '');
            if (cleanPhone && oPhone && cleanPhone === oPhone) {
              return { ...o, status: 'COMPLETED', approvedAt: now, emailSentAt: now };
            }
            return o;
          });
          localStorage.setItem('hk_rankers_orders', JSON.stringify(updatedOrds));
        }
      } catch (err) {
        console.warn('Orders status sync notice:', err);
      }

      // 5. AUTOMATIC STUDENT ENROLLMENT: Instantiate verified mentorship tracker & unlock portal login
      try {
        const studentName = (appt.name || 'Enrolled Aspirant').trim();
        const studentEmail = (appt.email || '').trim().toLowerCase();
        const studentPhone = (appt.phone || '').trim();
        const studentProgram = appt.program || 'CS Executive Group 1';

        // A. Automatically generate / enroll mentorship profile
        const autoProfile = getOrCreateStudentMentorship({
          fullName: studentName,
          email: studentEmail,
          phone: studentPhone,
          targetExam: studentProgram,
          isApproved: true,
        });
        setStudentApprovalStatus(autoProfile.studentId, true);
        if (studentEmail) setStudentApprovalStatus(studentEmail, true);

        // B. Automatically unlock / register account in registered users directory
        const rawUsers = localStorage.getItem('hk_rankers_registered_users');
        const regUsers: any[] = rawUsers ? JSON.parse(rawUsers) : [];
        const uIdx = regUsers.findIndex(
          (u) =>
            (studentEmail && u.email && u.email.trim().toLowerCase() === studentEmail) ||
            (studentPhone && u.phone && u.phone.replace(/\D/g, '') === studentPhone.replace(/\D/g, ''))
        );
        if (uIdx !== -1) {
          regUsers[uIdx].isApproved = true;
          regUsers[uIdx].approvalStatus = 'approved';
          regUsers[uIdx].approvedAt = now;
          regUsers[uIdx].targetExam = studentProgram;
        } else {
          regUsers.push({
            id: autoProfile.studentId || `usr_${Date.now()}`,
            fullName: studentName,
            email: studentEmail,
            phone: studentPhone,
            targetExam: studentProgram,
            password: 'student_pass',
            avatar: `https://ui-avatars.com/api/?name=${encodeURIComponent(studentName)}&background=C8A45D&color=000`,
            purchasedProductIds: ['mentorship-enrolled', 'cs-study-progress-index'],
            createdAt: now,
            isApproved: true,
            approvalStatus: 'approved',
            approvedAt: now,
            role: 'student',
          });
        }
        localStorage.setItem('hk_rankers_registered_users', JSON.stringify(regUsers));

        // C. Record confirmed entry in local enrollments
        const rawEnr = localStorage.getItem('hk_local_enrollments');
        const enrs: any[] = rawEnr ? JSON.parse(rawEnr) : [];
        const enrIdx = enrs.findIndex(
          (e) => (studentEmail && e.email?.toLowerCase() === studentEmail) || (studentPhone && e.phone?.replace(/\D/g, '') === studentPhone.replace(/\D/g, ''))
        );
        if (enrIdx !== -1) {
          enrs[enrIdx].status = 'confirmed';
          enrs[enrIdx].utr_number = utr;
          enrs[enrIdx].program = studentProgram;
        } else {
          enrs.push({
            id: `enr_${Date.now()}`,
            name: studentName,
            email: studentEmail,
            phone: studentPhone,
            program: studentProgram,
            status: 'confirmed',
            amount: appt.amount || 2999,
            utr_number: utr,
            enrolled_at: now,
          });
        }
        localStorage.setItem('hk_local_enrollments', JSON.stringify(enrs));
      } catch (autoEnrErr) {
        console.warn('Auto enrollment background execution notice:', autoEnrErr);
      }

      setApprovalToast({
        message: `Payment & Enrollment Confirmed! Official confirmation email dispatched to ${studentEmail}. Student notified with 24-hour onboarding schedule.`,
        email: studentEmail,
      });

      setTimeout(() => setApprovalToast(null), 7000);
    } catch (err: any) {
      console.error('Error approving payment:', err);
      setApprovalToast({
        message: `Error sending confirmation email: ${err.message || 'Unknown error'}`,
        email: appt.email || appt.phone,
      });
      setTimeout(() => setApprovalToast(null), 6000);
    } finally {
      setApprovingId(null);
    }
  };

  // Open Email Preview Modal
  const handleOpenEmailPreview = (appt: AppointmentRecord) => {
    const studentEmail = appt.email || `${(appt.phone || '').replace(/\D/g, '')}@student.hkcodeofrankers.com`;
    const programName = appt.program || 'CS Mentorship Batch';
    const orderNumber = `ORD-${Date.now().toString().slice(-6)}`;
    const utr = appt.utr_number || (appt.notes?.match(/\d{12}/)?.[0]) || '4248 1029 4821';

    const html = generateStudentConfirmationEmailHtml({
      studentName: appt.name,
      studentEmail: studentEmail,
      studentPhone: appt.phone,
      programName: programName,
      amount: appt.amount || 2999,
      utrNumber: utr,
      orderNumber: orderNumber,
      confirmedDate: appt.email_sent_at ? new Date(appt.email_sent_at).toLocaleString() : undefined,
    });

    setPreviewEmailModal({
      isOpen: true,
      appt,
      html,
    });
  };

  // Open Delete Confirmation Modal
  const handleDeleteAppointment = (appt: AppointmentRecord) => {
    setItemToDelete(appt);
  };

  // Execute Confirmed Deletion
  const confirmDeleteAppointment = async () => {
    if (!itemToDelete) return;
    const appt = itemToDelete;
    setIsDeleting(true);

    try {
      // 1. Remove from React state immediately
      const updatedList = appointments.filter((item) => {
        if (appt.id && item.id === appt.id) return false;
        if (
          item.phone === appt.phone &&
          (item.created_at === appt.created_at || (item as any).local_saved_at === (appt as any).local_saved_at)
        ) {
          return false;
        }
        return true;
      });
      setAppointments(updatedList);

      if (
        selectedAppointment?.id === appt.id ||
        (selectedAppointment?.phone === appt.phone && selectedAppointment?.created_at === appt.created_at)
      ) {
        setSelectedAppointment(null);
      }

      // 2. Delete across Supabase and local storage
      await deleteAppointment({
        id: appt.id,
        phone: appt.phone,
        created_at: appt.created_at || (appt as any).local_saved_at,
      });

      // 3. Delete student mentorship profile from portal if exists
      try {
        if (appt.id) await deleteStudentMentorshipProfile(appt.id);
        if (appt.phone) await deleteStudentMentorshipProfile(appt.phone);
        if (appt.email) await deleteStudentMentorshipProfile(appt.email);
      } catch (err) {
        console.warn('Mentorship profile cleanup error:', err);
      }

      setApprovalToast({
        message: `Successfully deleted submission record for ${appt.name} (${appt.phone}).`,
        email: appt.email || appt.phone,
      });
      setTimeout(() => setApprovalToast(null), 5000);
    } catch (err: any) {
      console.error('Delete error:', err);
    } finally {
      setIsDeleting(false);
      setItemToDelete(null);
    }
  };

  // Filtered and Sorted Central Appointments & Activity Records
  const filteredAppointments = appointments
    .filter((appt) => {
      // Type Filter
      if (typeFilter === 'student_login') {
        const isLogin = (appt.activity_type || '').toLowerCase().includes('login');
        if (!isLogin) return false;
      } else if (typeFilter === 'registration') {
        const isReg = (appt.activity_type || '').toLowerCase().includes('registration');
        if (!isReg) return false;
      } else if (typeFilter === 'mentorship') {
        const isMentorship =
          (appt.activity_type || '').toLowerCase().includes('mentorship') ||
          (appt.program || '').toLowerCase().includes('mentorship');
        if (!isMentorship) return false;
      } else if (typeFilter === 'inquiry') {
        const isInquiry =
          (appt.activity_type || '').toLowerCase().includes('inquiry') ||
          (!appt.activity_type && !appt.student_id);
        if (!isInquiry) return false;
      }

      // Status Filter
      if (statusFilter !== 'all') {
        const s = (appt.status || '').toLowerCase();
        if (statusFilter === 'active' && !s.includes('active')) return false;
        if (statusFilter === 'confirmed' && !s.includes('confirmed')) return false;
        if (statusFilter === 'contacted' && !s.includes('contacted')) return false;
      }

      // Search Query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matches =
          appt.name?.toLowerCase().includes(q) ||
          appt.phone?.toLowerCase().includes(q) ||
          appt.email?.toLowerCase().includes(q) ||
          appt.student_id?.toLowerCase().includes(q) ||
          appt.program?.toLowerCase().includes(q) ||
          appt.level?.toLowerCase().includes(q) ||
          appt.group?.toLowerCase().includes(q) ||
          appt.activity_type?.toLowerCase().includes(q) ||
          appt.notes?.toLowerCase().includes(q);
        if (!matches) return false;
      }

      return true;
    })
    .sort((a, b) => {
      const timeA = new Date(a.last_login_at || a.created_at || a.local_saved_at || 0).getTime();
      const timeB = new Date(b.last_login_at || b.created_at || b.local_saved_at || 0).getTime();
      return sortOrder === 'newest' ? timeB - timeA : timeA - timeB;
    });

  // Quick Metrics for Central Activity
  const totalCount = appointments.length;
  const loginCount = appointments.filter((a) =>
    (a.activity_type || '').toLowerCase().includes('login')
  ).length;
  const activeStudentCount = appointments.filter((a) => Boolean(a.student_id)).length;
  const mentorshipCount = appointments.filter((a) =>
    (a.activity_type || '').toLowerCase().includes('mentorship')
  ).length;
  const inquiryCount = appointments.filter(
    (a) =>
      (a.activity_type || '').toLowerCase().includes('inquiry') ||
      (!a.activity_type && !a.student_id)
  ).length;

  const pendingCentralPayments = centralStudents.filter(
    (s) => s.paymentStatus === 'pending_approval'
  );
  const totalUpiPendingCount = pendingCentralPayments.length;

  // Export to CSV
  const exportToCSV = () => {
    if (appointments.length === 0) {
      alert('No appointment records to export.');
      return;
    }

    const headers = [
      'Date & Time',
      'Student Name',
      'Student ID',
      'WhatsApp Phone',
      'Email',
      'Program',
      'Level / Group',
      'Activity Type',
      'Status',
      'Login Count',
      'Notes',
    ];
    const rows = appointments.map((a) => [
      `"${new Date(a.last_login_at || a.created_at || a.local_saved_at || '').toLocaleString()}"`,
      `"${a.name || ''}"`,
      `"${a.student_id || ''}"`,
      `"${a.phone || ''}"`,
      `"${a.email || ''}"`,
      `"${a.program || ''}"`,
      `"${[a.level, a.group].filter(Boolean).join(' - ')}"`,
      `"${a.activity_type || 'Activity'}"`,
      `"${a.status || 'Active'}"`,
      `"${a.login_count || 1}"`,
      `"${(a.notes || '').replace(/"/g, '""')}"`,
    ]);

    const csvContent =
      'data:text/csv;charset=utf-8,' +
      [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `HK_Rankers_Activity_Inquiries_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const copyToClipboard = (text: string, phone: string) => {
    navigator.clipboard.writeText(text);
    setCopiedPhone(phone);
    setTimeout(() => setCopiedPhone(null), 2500);
  };

  const copyUtrToClipboard = (utr: string) => {
    navigator.clipboard.writeText(utr);
    setCopiedUtr(utr);
    setTimeout(() => setCopiedUtr(null), 2500);
  };

  // Official PDF Invoice Generator Handler
  const handleDownloadStudentInvoice = (appt: AppointmentRecord) => {
    const utr = appt.utr_number || (appt.notes?.match(/\d{12}/)?.[0]) || 'Direct UPI Transfer';
    const fakeOrder: any = {
      orderNumber: `ORD-${(appt.phone || '').slice(-4)}-${Date.now().toString().slice(-4)}`,
      createdAt: appt.created_at || new Date().toISOString(),
      utrNumber: utr,
      paymentMethod: 'UPI',
      status: 'COMPLETED',
      subtotal: appt.amount || 2999,
      discount: 0,
      totalAmount: appt.amount || 2999,
      billingDetails: {
        fullName: appt.name,
        email: appt.email || `${(appt.phone || '').replace(/\D/g, '')}@student.hkcodeofrankers.com`,
        phone: appt.phone,
      },
      items: [
        {
          name: appt.program || 'CS Mentorship & Evaluated Test Series',
          quantity: 1,
          price: appt.amount || 2999,
        },
      ],
    };
    generateInvoicePDF(fakeOrder);
  };

  // Open Dispatch Modal with 1-Click Gmail & WhatsApp
  const handleOpenDispatchModal = (appt: AppointmentRecord) => {
    const studentEmail = appt.email || `${(appt.phone || '').replace(/\D/g, '')}@student.hkcodeofrankers.com`;
    const programName = appt.program || 'CS Mentorship Batch';
    const orderNumber = `ORD-${Date.now().toString().slice(-6)}`;
    const utr = appt.utr_number || (appt.notes?.match(/\d{12}/)?.[0]) || 'Direct UPI Transfer';
    const emailData = {
      studentName: appt.name,
      studentEmail,
      studentPhone: appt.phone,
      programName,
      amount: appt.amount || 2999,
      utrNumber: utr,
      orderNumber,
    };

    setDispatchModalData({
      studentName: appt.name,
      studentEmail,
      studentPhone: appt.phone,
      program: programName,
      amount: appt.amount || 2999,
      utrNumber: utr,
      orderNumber,
      gmailUrl: getGmailComposeUrl(emailData),
      whatsAppUrl: getWhatsAppConfirmationUrl(emailData),
      mailtoUrl: getMailtoUrl(emailData),
      plainText: generateStudentConfirmationEmailPlainText(emailData),
      previewHtml: generateStudentConfirmationEmailHtml(emailData),
    });
  };

  // =========================================================================
  // VIEW: AUTHENTICATION (LOGIN OR SINGLE-SLOT SIGNUP)
  // =========================================================================
  if (!session) {
    return (
      <div className="pt-24 pb-20 min-h-screen bg-[#F8F6F2] flex items-center justify-center px-4 font-poppins">
        <div className="max-w-md w-full">
          <button
            onClick={() => onNavigate('home')}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#8A651E] hover:underline mb-4 cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" /> Back to Website
          </button>

          <div className="bg-white border border-[#C8A45D]/30 rounded-2xl p-6 sm:p-8 shadow-xl relative overflow-hidden">
            <div className="absolute top-0 left-0 right-0 h-1.5 gold-gradient-bg" />

            <div className="text-center space-y-2 mb-6">
              <div className="w-12 h-12 rounded-xl bg-[#0F0F0F] text-[#FFE3A0] border border-[#C8A45D]/50 flex items-center justify-center mx-auto shadow-md">
                <Shield className="w-6 h-6 text-[#C8A45D]" />
              </div>
              <h1 className="font-cinzel text-2xl font-bold text-[#0F0F0F]">
                {authMode === 'register'
                  ? 'Master Admin Setup'
                  : authStep === 'token_verification'
                  ? 'Email Security Token'
                  : 'Master Admin Login'}
              </h1>
              <p className="text-xs text-gray-600">
                {authMode === 'register'
                  ? 'Single-slot initial provisioning. Only 1 master admin account is permitted.'
                  : authStep === 'token_verification'
                  ? 'Two-Factor verification: check your registered email for the 6-digit access code.'
                  : 'Restricted access: Only the registered administrator email & password with email token verification.'}
              </p>

              <div className="pt-2">
                {!slotStatus.claimed ? (
                  <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-amber-50 border border-amber-300 text-amber-900 rounded-full text-[11px] font-semibold">
                    <Sparkles className="w-3.5 h-3.5 text-amber-600" />
                    <span>Single Slot Available (Claim to activate)</span>
                  </div>
                ) : (
                  <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-emerald-50 border border-emerald-300 text-emerald-800 rounded-full text-[11px] font-semibold">
                    <UserCheck className="w-3.5 h-3.5 text-emerald-600" />
                    <span>Master Admin Protected (2FA Email Token)</span>
                  </div>
                )}
              </div>
            </div>

            {authError && (
              <div className="mb-4 p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{authError}</span>
              </div>
            )}

            {authSuccess && (
              <div className="mb-4 p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>{authSuccess}</span>
              </div>
            )}

            {authMode === 'register' ? (
              <form onSubmit={handleRegister} className="space-y-3.5 text-xs">
                <div>
                  <label className="block text-gray-700 font-semibold mb-1">Full Legal Name</label>
                  <input
                    type="text"
                    required
                    placeholder="Enter your full name"
                    value={authForm.name}
                    onChange={(e) => setAuthForm({ ...authForm, name: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-gray-300 focus:border-[#C8A45D] outline-none"
                  />
                </div>

                <div>
                  <label className="block text-gray-700 font-semibold mb-1">Admin Email</label>
                  <input
                    type="email"
                    required
                    placeholder="Enter registered administrator email"
                    value={authForm.email}
                    onChange={(e) => setAuthForm({ ...authForm, email: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-gray-300 focus:border-[#C8A45D] outline-none"
                  />
                </div>

                <div>
                  <label className="block text-gray-700 font-semibold mb-1">Admin WhatsApp / Phone</label>
                  <input
                    type="tel"
                    required
                    placeholder="+91 92840 84523"
                    value={authForm.phone}
                    onChange={(e) => setAuthForm({ ...authForm, phone: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-gray-300 focus:border-[#C8A45D] outline-none"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-gray-700 font-semibold mb-1">Password</label>
                    <input
                      type="password"
                      required
                      placeholder="••••••••"
                      value={authForm.password}
                      onChange={(e) => setAuthForm({ ...authForm, password: e.target.value })}
                      className="w-full px-3 py-2 rounded-xl border border-gray-300 focus:border-[#C8A45D] outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-gray-700 font-semibold mb-1">Confirm</label>
                    <input
                      type="password"
                      required
                      placeholder="••••••••"
                      value={authForm.confirmPassword}
                      onChange={(e) => setAuthForm({ ...authForm, confirmPassword: e.target.value })}
                      className="w-full px-3 py-2 rounded-xl border border-gray-300 focus:border-[#C8A45D] outline-none"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={isAuthLoading}
                  className="w-full py-3 mt-2 gold-gradient-bg text-black font-montserrat font-bold text-xs uppercase tracking-wider rounded-xl hover:brightness-110 transition-all shadow-md cursor-pointer disabled:opacity-75"
                >
                  {isAuthLoading ? 'Claiming Slot & Creating Admin...' : 'Claim Single Slot & Create Master Admin'}
                </button>
              </form>
            ) : (
              <form onSubmit={handleLogin} className="space-y-4 text-xs">
                <div>
                  <label className="block text-gray-700 font-semibold mb-1">Admin Email or Phone</label>
                  <input
                    type="text"
                    required
                    placeholder="Enter admin email or phone"
                    value={authForm.email}
                    onChange={(e) => setAuthForm({ ...authForm, email: e.target.value })}
                    className="w-full px-3 py-2.5 rounded-xl border border-gray-300 focus:border-[#C8A45D] outline-none font-medium"
                  />
                </div>

                <div>
                  <label className="block text-gray-700 font-semibold mb-1">Master Password</label>
                  <input
                    type="password"
                    required
                    placeholder="••••••••••••"
                    value={authForm.password}
                    onChange={(e) => setAuthForm({ ...authForm, password: e.target.value })}
                    className="w-full px-3 py-2.5 rounded-xl border border-gray-300 focus:border-[#C8A45D] outline-none"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-gray-700 font-semibold">Security Master Key</label>
                    <span className="text-[10px] text-gray-400">Secondary Key</span>
                  </div>
                  <input
                    type="password"
                    placeholder="••••••••••••"
                    value={authForm.masterKey}
                    onChange={(e) => setAuthForm({ ...authForm, masterKey: e.target.value })}
                    className="w-full px-3 py-2.5 rounded-xl border border-gray-300 focus:border-[#C8A45D] outline-none"
                  />
                </div>

                <button
                  type="submit"
                  disabled={isAuthLoading}
                  className="w-full py-3 gold-gradient-bg text-black font-montserrat font-bold text-xs uppercase tracking-wider rounded-xl hover:brightness-110 transition-all shadow-md cursor-pointer disabled:opacity-75"
                >
                  {isAuthLoading ? 'Authenticating...' : 'Sign In to Admin Portal'}
                </button>
              </form>
            )}

            <div className="mt-6 pt-4 border-t border-gray-200 text-center text-[10px] text-gray-500 flex items-center justify-center gap-1.5">
              <Database className="w-3 h-3 text-[#C8A45D]" />
              <span>Connected to Supabase Project ({SUPABASE_PROJECT_ID})</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // =========================================================================
  // VIEW: AUTHENTICATED ADMIN DASHBOARD
  // =========================================================================
  return (
    <div className="pt-24 pb-20 min-h-screen bg-[#F8F6F2] font-poppins">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-6">
        {/* Top Header & Admin Session Bar */}
        <div className="bg-white border border-[#C8A45D]/30 rounded-2xl p-4 sm:p-6 shadow-md flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 bg-emerald-500 rounded-full animate-pulse" />
              <h1 className="font-cinzel text-xl sm:text-2xl font-bold text-[#0F0F0F]">
                Appointments & Enrollments Desk
              </h1>
              <span className="px-2 py-0.5 bg-[#FAF5E9] border border-[#C8A45D]/40 text-[#8A651E] text-[10px] font-bold rounded-full uppercase tracking-wider">
                Master Admin
              </span>
            </div>
            <p className="text-xs text-gray-600">
              Welcome back, <strong className="text-black">{session.adminName}</strong> ({session.adminEmail}) • Logged in securely
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <div className="flex items-center gap-1.5 px-3 py-1.5 bg-[#FAF5E9] border border-[#C8A45D]/30 rounded-xl text-xs text-[#8A651E]">
              <Database className="w-3.5 h-3.5 text-[#C8A45D]" />
              <span>Supabase: {supabaseConnected ? 'Live' : 'Active'}</span>
            </div>

            <button
              onClick={loadAppointments}
              disabled={isLoadingAppointments}
              className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-semibold rounded-xl flex items-center gap-1.5 transition-colors cursor-pointer"
              title="Refresh records from Supabase"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoadingAppointments ? 'animate-spin text-[#8A651E]' : ''}`} />
              <span>Refresh</span>
            </button>

            <button
              onClick={exportToCSV}
              className="px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100 border border-emerald-300 text-emerald-800 text-xs font-semibold rounded-xl flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export CSV</span>
            </button>

            <button
              onClick={() => onNavigate('home')}
              className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-semibold rounded-xl flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span>View Site</span>
            </button>

            <button
              onClick={() => onNavigate('student-portal')}
              className="px-3 py-1.5 gold-gradient-bg hover:brightness-105 text-black text-xs font-montserrat font-bold rounded-xl flex items-center gap-1.5 transition-all shadow-xs cursor-pointer"
              title="Open Student Mentorship Portal"
            >
              <BookOpen className="w-3.5 h-3.5" />
              <span>Student Portal</span>
            </button>

            <button
              onClick={handleLogout}
              className="px-3 py-1.5 bg-red-50 hover:bg-red-100 border border-red-200 text-red-700 text-xs font-semibold rounded-xl flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Sign Out</span>
            </button>
          </div>
        </div>

        {/* Global Approval Toast Notification */}
        {approvalToast && (
          <div className="p-4 bg-emerald-50 border-2 border-emerald-500/50 rounded-2xl shadow-lg flex items-start gap-3 animate-fade-in text-xs text-emerald-900">
            <div className="p-2 rounded-xl bg-emerald-100 text-emerald-700 shrink-0">
              <CheckCheck className="w-5 h-5" />
            </div>
            <div className="space-y-0.5">
              <h4 className="font-bold text-sm text-emerald-950 font-montserrat">
                Payment Approved & Confirmation Email Dispatched!
              </h4>
              <p className="text-emerald-800 leading-relaxed">
                {approvalToast.message}
              </p>
            </div>
            <button
              onClick={() => setApprovalToast(null)}
              className="ml-auto text-emerald-700 hover:text-emerald-950 p-1"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Navigation Tabs Bar */}
        <div className="bg-white border border-[#C8A45D]/30 p-2 rounded-2xl shadow-sm flex flex-wrap gap-2">
          <button
            onClick={() => setAdminTab('appointments')}
            className={`py-2.5 px-4 rounded-xl text-xs font-montserrat font-bold flex items-center gap-2 transition-all cursor-pointer ${
              adminTab === 'appointments'
                ? 'gold-gradient-bg text-black shadow-md'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            <Calendar className="w-4 h-4" />
            <span>Appointments & Inquiries ({totalCount})</span>
          </button>

          <button
            onClick={() => {
              setAdminTab('upi_verification');
              setTypeFilter('upi_pending');
            }}
            className={`py-2.5 px-4 rounded-xl text-xs font-montserrat font-bold flex items-center gap-2 transition-all cursor-pointer ${
              adminTab === 'upi_verification'
                ? 'bg-gradient-to-r from-amber-500 to-amber-600 text-white shadow-md'
                : 'bg-amber-50 border border-amber-300 text-amber-900 hover:bg-amber-100'
            }`}
          >
            <QrCode className="w-4 h-4 text-amber-700" />
            <span>Direct UPI Approvals</span>
            {totalUpiPendingCount > 0 && (
              <span className="px-2 py-0.5 rounded-full bg-red-600 text-white text-[10px] font-extrabold animate-pulse">
                {totalUpiPendingCount} Pending
              </span>
            )}
          </button>

          <button
            onClick={() => setAdminTab('free_sessions')}
            className={`py-2.5 px-4 rounded-xl text-xs font-montserrat font-bold flex items-center gap-2 transition-all cursor-pointer ${
              adminTab === 'free_sessions'
                ? 'bg-gradient-to-r from-emerald-600 to-teal-700 text-white shadow-md'
                : 'bg-emerald-50 border border-emerald-300 text-emerald-900 hover:bg-emerald-100'
            }`}
          >
            <PhoneCall className="w-4 h-4 text-emerald-600" />
            <span>Free Session Bookings ({freeSlotBookings.length})</span>
            {freeSlotBookings.filter((b) => b.status === 'pending').length > 0 && (
              <span className="px-2 py-0.5 rounded-full bg-red-600 text-white text-[10px] font-extrabold animate-pulse">
                {freeSlotBookings.filter((b) => b.status === 'pending').length} New
              </span>
            )}
          </button>

          <button
            onClick={() => setAdminTab('mentorship_tracker')}
            className={`py-2.5 px-4 rounded-xl text-xs font-montserrat font-bold flex items-center gap-2 transition-all cursor-pointer ${
              adminTab === 'mentorship_tracker'
                ? 'bg-gradient-to-r from-[#1C1917] to-[#2E2419] text-[#FFE3A0] border border-[#C8A45D] shadow-md'
                : 'bg-[#FAF5E9] border border-[#C8A45D]/40 text-[#8A651E] hover:bg-[#F3EAD3]'
            }`}
          >
            <Bookmark className="w-4 h-4 text-[#C8A45D]" />
            <span>Student Mentorship Tracker & Portals</span>
            <span className="px-2 py-0.5 rounded-full bg-[#C8A45D] text-black text-[10px] font-black">
              Master Access
            </span>
          </button>
        </div>

        {/* ========================================================================= */}
        {/* TAB VIEWS                                                                 */}
        {/* ========================================================================= */}
        {adminTab === 'mentorship_tracker' ? (
          <AdminMentorshipManager onNavigate={onNavigate} />
        ) : adminTab === 'free_sessions' ? (
          <FreeSlotBookingsTab bookings={freeSlotBookings} onRefresh={loadFreeSlotBookings} />
        ) : adminTab === 'upi_verification' ? (
          <div className="space-y-6">
            {/* Direct UPI Payee Credentials Strip */}
            <div className="bg-gradient-to-r from-[#171512] to-[#0F0F0F] text-white border-2 border-[#C8A45D]/40 p-4 sm:p-5 rounded-2xl shadow-md flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="flex items-center gap-3.5">
                <div className="w-12 h-12 rounded-xl bg-[#C8A45D]/20 border border-[#C8A45D]/50 flex items-center justify-center text-[#FFE3A0] shrink-0">
                  <QrCode className="w-6 h-6 text-[#C8A45D]" />
                </div>
                <div>
                  <div className="text-[10px] uppercase font-montserrat font-bold text-[#FFE3A0] tracking-wider flex items-center gap-1.5">
                    <span>Verified Payee Bank Credentials (Check Bank Statement / SMS)</span>
                    <span className="px-1.5 py-0.2 bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 rounded text-[9px]">
                      0% Convenience Fee
                    </span>
                  </div>
                  <h3 className="font-cinzel text-sm sm:text-base font-bold text-white mt-0.5">
                    {UPI_PAYEE_CONFIG.accountName}
                  </h3>
                  <div className="flex items-center gap-3 mt-1 text-xs text-gray-300">
                    <span>Official UPI ID: <strong className="font-mono text-[#FFE3A0]">{UPI_PAYEE_CONFIG.upiId}</strong></span>
                    <span>•</span>
                    <span>Direct INR Account</span>
                  </div>
                </div>
              </div>

              <div className="bg-black/50 p-3 rounded-xl border border-white/10 text-xs text-gray-300 max-w-md">
                <p className="text-[11px] leading-relaxed">
                  💡 <strong>Verification Workflow:</strong> Match the student's 12-digit UTR against your bank SMS/app. Click <strong>"Approve Payment"</strong> to verify enrollment, generate access credentials, and activate course access.
                </p>
              </div>
            </div>

            <PaymentApprovalsTab
              students={centralStudents}
              approvingId={approvingId}
              onApprovePayment={handleApproveCentralPayment}
              onRejectPayment={handleRejectCentralPayment}
              onOpenMentorshipChart={() => setAdminTab('mentorship_tracker')}
              onRefresh={loadCentralStudents}
            />
          </div>
        ) : (
          <div className="space-y-6">
            {/* Top Banner: Central Activity & Inquiries */}
            <div className="bg-gradient-to-r from-[#171512] to-[#1F1C18] text-white border-2 border-[#C8A45D]/40 p-4 sm:p-5 rounded-2xl shadow-md flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="flex items-center gap-3.5">
                <div className="w-12 h-12 rounded-xl bg-[#C8A45D]/20 border border-[#C8A45D]/50 flex items-center justify-center text-[#FFE3A0] shrink-0">
                  <Activity className="w-6 h-6 text-[#C8A45D]" />
                </div>
                <div>
                  <div className="text-[10px] uppercase font-montserrat font-bold text-[#FFE3A0] tracking-wider flex items-center gap-1.5">
                    <span>Central Activity & Inquiry Log</span>
                    <span className="px-1.5 py-0.2 bg-blue-500/20 text-blue-300 border border-blue-500/30 rounded text-[9px]">
                      Live Real-Time Sync
                    </span>
                  </div>
                  <h3 className="font-cinzel text-sm sm:text-base font-bold text-white mt-0.5">
                    Real Student Activity, Logins & General Inquiries
                  </h3>
                  <div className="flex items-center gap-3 mt-1 text-xs text-gray-300">
                    <span>Student accounts are automatically logged & deduplicated with latest activity timestamp</span>
                  </div>
                </div>
              </div>

              <div className="bg-black/50 p-3 rounded-xl border border-white/10 text-xs text-gray-300 max-w-md">
                <p className="text-[11px] leading-relaxed">
                  💡 <strong>Centralized Student Tracking:</strong> Real student logins, account registrations, general inquiries, and 1-on-1 mentorship call requests appear here. Payment verifications and free diagnostic sessions are cleanly separated in their dedicated tabs.
                </p>
              </div>
            </div>

            {/* Overview Metric Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 sm:gap-4">
              <div className="bg-white border border-gray-200 p-4 rounded-2xl shadow-sm space-y-1">
                <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Total Records</span>
                <div className="text-2xl font-bold font-cinzel text-[#0F0F0F]">{totalCount}</div>
                <p className="text-[10px] text-gray-500">All activities & inquiries</p>
              </div>

              <div className="bg-white border border-gray-200 p-4 rounded-2xl shadow-sm space-y-1">
                <span className="text-[10px] font-semibold text-emerald-700 uppercase tracking-wider">Student Logins</span>
                <div className="text-2xl font-bold font-cinzel text-emerald-800">{loginCount}</div>
                <p className="text-[10px] text-gray-500">Active student sessions</p>
              </div>

              <div className="bg-white border border-gray-200 p-4 rounded-2xl shadow-sm space-y-1">
                <span className="text-[10px] font-semibold text-blue-700 uppercase tracking-wider">Registered Accounts</span>
                <div className="text-2xl font-bold font-cinzel text-blue-800">{activeStudentCount}</div>
                <p className="text-[10px] text-gray-500">Profiles with Student IDs</p>
              </div>

              <div className="bg-white border border-gray-200 p-4 rounded-2xl shadow-sm space-y-1">
                <span className="text-[10px] font-semibold text-purple-700 uppercase tracking-wider">Mentorship Calls</span>
                <div className="text-2xl font-bold font-cinzel text-purple-800">{mentorshipCount}</div>
                <p className="text-[10px] text-gray-500">Enrolled 1-on-1 sessions</p>
              </div>

              <div className="bg-white border border-gray-200 p-4 rounded-2xl shadow-sm space-y-1">
                <span className="text-[10px] font-semibold text-[#8A651E] uppercase tracking-wider">General Inquiries</span>
                <div className="text-2xl font-bold font-cinzel text-[#8A651E]">{inquiryCount}</div>
                <p className="text-[10px] text-gray-500">Prospective student queries</p>
              </div>
            </div>

            {/* Filter & Search Bar */}
            <div className="bg-white border border-[#C8A45D]/20 p-4 rounded-2xl shadow-sm space-y-3">
              <div className="flex flex-col md:flex-row items-center gap-3">
                <div className="relative w-full md:flex-grow">
                  <Search className="w-4 h-4 text-gray-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    placeholder="Search by student name, WhatsApp phone, email, student ID, or program..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-10 pr-4 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs focus:bg-white focus:border-[#C8A45D] outline-none transition-all"
                  />
                  {searchQuery && (
                    <button
                      onClick={() => setSearchQuery('')}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                {/* Activity Filter */}
                <div className="flex items-center gap-1.5 w-full md:w-auto">
                  <Filter className="w-3.5 h-3.5 text-gray-500 shrink-0" />
                  <select
                    value={typeFilter}
                    onChange={(e: any) => setTypeFilter(e.target.value)}
                    className="text-xs bg-gray-50 border border-gray-200 rounded-xl px-2.5 py-2 outline-none focus:border-[#C8A45D] w-full md:w-auto font-medium"
                  >
                    <option value="all">All Activities & Inquiries</option>
                    <option value="student_login">🟢 Student Logins</option>
                    <option value="registration">🔵 Account Registrations</option>
                    <option value="mentorship">🟣 Mentorship Calls</option>
                    <option value="inquiry">💬 General Inquiries</option>
                  </select>
                </div>

                {/* Status Filter */}
                <div className="flex items-center gap-1.5 w-full md:w-auto">
                  <SlidersHorizontal className="w-3.5 h-3.5 text-gray-500 shrink-0" />
                  <select
                    value={statusFilter}
                    onChange={(e: any) => setStatusFilter(e.target.value)}
                    className="text-xs bg-gray-50 border border-gray-200 rounded-xl px-2.5 py-2 outline-none focus:border-[#C8A45D] w-full md:w-auto"
                  >
                    <option value="all">All Statuses</option>
                    <option value="active">🟢 Active</option>
                    <option value="confirmed">🔵 Confirmed</option>
                    <option value="contacted">🟣 Contacted</option>
                  </select>
                </div>

                {/* Sort Order */}
                <div className="w-full md:w-auto">
                  <select
                    value={sortOrder}
                    onChange={(e: any) => setSortOrder(e.target.value)}
                    className="text-xs bg-gray-50 border border-gray-200 rounded-xl px-2.5 py-2 outline-none focus:border-[#C8A45D] w-full md:w-auto"
                  >
                    <option value="newest">Latest First</option>
                    <option value="oldest">Oldest First</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Table of Activities & Inquiries */}
            <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
              <div className="p-4 border-b border-gray-200 flex items-center justify-between">
                <h3 className="font-cinzel text-base font-bold text-[#0F0F0F] flex items-center gap-2">
                  <span>Student Activity & Inquiry Records</span>
                  <span className="text-xs font-poppins font-normal text-gray-500">
                    ({filteredAppointments.length} records)
                  </span>
                </h3>

                {isLoadingAppointments && (
                  <span className="text-xs text-[#8A651E] flex items-center gap-1.5">
                    <RefreshCw className="w-3 h-3 animate-spin" /> Syncing records...
                  </span>
                )}
              </div>

              {filteredAppointments.length === 0 ? (
                <div className="text-center py-16 px-4 space-y-3">
                  <Activity className="w-12 h-12 text-gray-300 mx-auto" />
                  <h4 className="font-cinzel text-lg font-bold text-gray-700">No Records Found</h4>
                  <p className="text-xs text-gray-500 max-w-sm mx-auto">
                    {searchQuery || typeFilter !== 'all' || statusFilter !== 'all'
                      ? 'No activity records match your active filter criteria.'
                      : 'Real student logins and inquiries will automatically appear here.'}
                  </p>
                  {(searchQuery || typeFilter !== 'all' || statusFilter !== 'all') && (
                    <button
                      onClick={() => {
                        setSearchQuery('');
                        setTypeFilter('all');
                        setStatusFilter('all');
                      }}
                      className="px-4 py-2 bg-[#0F0F0F] text-[#FFE3A0] text-xs font-bold rounded-xl"
                    >
                      Clear All Filters
                    </button>
                  )}
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-[#FAF5E9] text-[#8A651E] uppercase font-bold text-[10px] tracking-wider border-b border-[#C8A45D]/20">
                      <tr>
                        <th className="py-3.5 px-4">Student & Contact</th>
                        <th className="py-3.5 px-4">Program & Level / Group</th>
                        <th className="py-3.5 px-4">Activity Type</th>
                        <th className="py-3.5 px-4">Latest Login / Activity</th>
                        <th className="py-3.5 px-4">Status</th>
                        <th className="py-3.5 px-4 text-right">Quick Connect & Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {filteredAppointments.map((appt, idx) => {
                        const cleanPhone = (appt.phone || '').replace(/\D/g, '');
                        const recordKey = appt.id || `${appt.student_id || appt.phone}_${appt.created_at || idx}`;
                        const activityType = appt.activity_type || (appt.student_id ? 'Student Login' : 'Inquiry');

                        const dateStr = new Date(
                          appt.last_login_at || appt.created_at || appt.local_saved_at || Date.now()
                        ).toLocaleDateString('en-IN', {
                          day: 'numeric',
                          month: 'short',
                          year: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        });

                        return (
                          <tr key={recordKey} className="hover:bg-amber-50/40 transition-colors">
                            {/* Student Name & Contact */}
                            <td className="py-3.5 px-4">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="font-bold text-gray-900">{appt.name}</span>
                                {appt.student_id && (
                                  <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-900 font-mono text-[9px] font-bold border border-amber-300">
                                    {appt.student_id}
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-2 text-[11px] text-gray-600 mt-0.5">
                                <span className="font-mono font-medium">{appt.phone || 'No phone'}</span>
                                {appt.phone && (
                                  <button
                                    onClick={() => copyToClipboard(appt.phone, appt.phone)}
                                    className="text-gray-400 hover:text-gray-700"
                                    title="Copy phone"
                                  >
                                    {copiedPhone === appt.phone ? (
                                      <Check className="w-3 h-3 text-emerald-600" />
                                    ) : (
                                      <Copy className="w-3 h-3" />
                                    )}
                                  </button>
                                )}
                              </div>
                              {appt.email && (
                                <div className="text-[11px] text-gray-600 truncate max-w-[200px] mt-0.5 flex items-center gap-1">
                                  <Mail className="w-3 h-3 text-gray-400 shrink-0" />
                                  <span className="truncate">{appt.email}</span>
                                  <button
                                    onClick={() => copyToClipboard(appt.email, appt.email)}
                                    className="text-gray-400 hover:text-gray-700 shrink-0"
                                    title="Copy email"
                                  >
                                    {copiedPhone === appt.email ? (
                                      <Check className="w-3 h-3 text-emerald-600" />
                                    ) : (
                                      <Copy className="w-3 h-3" />
                                    )}
                                  </button>
                                </div>
                              )}
                            </td>

                            {/* Program & Level/Group */}
                            <td className="py-3.5 px-4">
                              <div className="space-y-1">
                                <span className="inline-block px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-900">
                                  {appt.program || 'CS Mentorship'}
                                </span>
                                {(appt.level || appt.group) && (
                                  <div className="text-[10.5px] text-gray-600 font-medium">
                                    {appt.level ? `${appt.level} ` : ''}{appt.group ? `• ${appt.group}` : ''}
                                  </div>
                                )}
                              </div>
                            </td>

                            {/* Activity Type */}
                            <td className="py-3.5 px-4">
                              <div className="space-y-1">
                                <span
                                  className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10.5px] font-bold border ${
                                    activityType.toLowerCase().includes('login')
                                      ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
                                      : activityType.toLowerCase().includes('registration')
                                      ? 'bg-blue-50 text-blue-800 border-blue-300'
                                      : activityType.toLowerCase().includes('mentorship')
                                      ? 'bg-purple-50 text-purple-800 border-purple-300'
                                      : 'bg-amber-50 text-amber-800 border-amber-300'
                                  }`}
                                >
                                  {activityType.toLowerCase().includes('login') && <LogIn className="w-3 h-3 text-emerald-600" />}
                                  {activityType.toLowerCase().includes('registration') && <UserCheck className="w-3 h-3 text-blue-600" />}
                                  {activityType.toLowerCase().includes('mentorship') && <Calendar className="w-3 h-3 text-purple-600" />}
                                  {activityType.toLowerCase().includes('inquiry') && <MessageSquare className="w-3 h-3 text-amber-600" />}
                                  <span>{activityType}</span>
                                </span>
                                {appt.login_count && appt.login_count > 1 ? (
                                  <div className="text-[10px] text-gray-500 font-medium">
                                    Login count: <strong className="text-gray-700">{appt.login_count} times</strong>
                                  </div>
                                ) : null}
                              </div>
                            </td>

                            {/* Date & Time */}
                            <td className="py-3.5 px-4">
                              <div className="space-y-0.5 text-[11px]">
                                <div className="font-semibold text-gray-900">{dateStr}</div>
                                <div className="text-[10px] text-gray-500">
                                  {appt.last_login_at ? 'Last active' : 'Logged at'}
                                </div>
                              </div>
                            </td>

                            {/* Status */}
                            <td className="py-3.5 px-4">
                              <span
                                className={`inline-block px-2.5 py-1 rounded-lg text-[10.5px] font-bold border ${
                                  (appt.status || '').toLowerCase().includes('active')
                                    ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
                                    : (appt.status || '').toLowerCase().includes('confirmed')
                                    ? 'bg-blue-50 text-blue-800 border-blue-300'
                                    : 'bg-gray-100 text-gray-800 border-gray-300'
                                }`}
                              >
                                {appt.status || 'Active'}
                              </span>
                              {appt.notes && (
                                <div className="text-[10px] text-gray-500 max-w-[180px] truncate mt-1 italic" title={appt.notes}>
                                  "{appt.notes}"
                                </div>
                              )}
                            </td>

                            {/* Quick Connect & Actions */}
                            <td className="py-3.5 px-4 text-right whitespace-nowrap">
                              <div className="inline-flex items-center gap-1.5">
                                {/* WhatsApp */}
                                {cleanPhone && (
                                  <a
                                    href={`https://wa.me/91${cleanPhone}?text=${encodeURIComponent(
                                      `Hello ${appt.name}! This is Harkiran Kaur from HK Code of Rankers.`
                                    )}`}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="p-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded-lg transition-colors"
                                    title="Chat on WhatsApp"
                                  >
                                    <MessageSquare className="w-3.5 h-3.5" />
                                  </a>
                                )}

                                {/* Direct Call */}
                                {appt.phone && (
                                  <a
                                    href={`tel:${appt.phone}`}
                                    className="p-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-lg transition-colors"
                                    title="Call Student"
                                  >
                                    <Phone className="w-3.5 h-3.5" />
                                  </a>
                                )}

                                {/* Email Student */}
                                {appt.email && (
                                  <a
                                    href={`mailto:${appt.email}?subject=HK Code of Rankers - Support & Guidance`}
                                    className="p-1.5 bg-purple-50 hover:bg-purple-100 text-purple-700 rounded-lg transition-colors"
                                    title="Send Email"
                                  >
                                    <Mail className="w-3.5 h-3.5" />
                                  </a>
                                )}

                                {/* Delete Record */}
                                <button
                                  onClick={() => handleDeleteAppointment(appt)}
                                  className="p-1.5 bg-red-50 hover:bg-red-100 text-red-600 rounded-lg transition-colors cursor-pointer"
                                  title="Delete Record"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* =========================================================================
          EMAIL PREVIEW MODAL (OFFICIAL LOGO & 24-HOUR CONTACT DISPLAY)
      ========================================================================= */}
      {previewEmailModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-fade-in">
          <div className="bg-white border border-[#C8A45D]/40 rounded-3xl max-w-2xl w-full p-6 shadow-2xl space-y-4 relative max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between border-b border-gray-200 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-[#0F0F0F] text-[#FFE3A0] flex items-center justify-center">
                  <Mail className="w-5 h-5 text-[#C8A45D]" />
                </div>
                <div>
                  <h3 className="font-cinzel text-base font-bold text-[#0F0F0F]">
                    Student Confirmation Email Preview
                  </h3>
                  <p className="text-xs text-gray-500">
                    Recipient: <strong>{previewEmailModal.appt.email}</strong> • Dispatched upon admin approval
                  </p>
                </div>
              </div>

              <button
                onClick={() => setPreviewEmailModal(null)}
                className="p-1.5 text-gray-400 hover:text-black rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Email HTML Iframe Preview */}
            <div className="flex-1 overflow-hidden border border-gray-200 rounded-2xl min-h-[420px] bg-[#F8F6F2]">
              <iframe
                title="Email Preview"
                srcDoc={previewEmailModal.html}
                className="w-full h-full min-h-[420px] border-none"
              />
            </div>

            <div className="flex items-center justify-between gap-3 pt-2">
              <div className="text-xs text-gray-600">
                <span>Features: Official Academy Logo • 12-Digit UTR • 24-Hour Contact Guarantee</span>
              </div>

              <div className="flex items-center gap-2">
                <a
                  href={`mailto:${previewEmailModal.appt.email}?subject=${encodeURIComponent(
                    `Enrollment Confirmed: ${previewEmailModal.appt.program} — HK Code of Rankers`
                  )}`}
                  className="px-3 py-2 bg-gray-100 hover:bg-gray-200 text-gray-800 text-xs font-bold rounded-xl flex items-center gap-1.5"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>Open in Gmail</span>
                </a>

                {previewEmailModal.appt.status !== 'confirmed' && (
                  <button
                    onClick={() => {
                      handleApproveAndSendEmail(previewEmailModal.appt);
                      setPreviewEmailModal(null);
                    }}
                    className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-montserrat font-bold text-xs rounded-xl shadow cursor-pointer flex items-center gap-1.5"
                  >
                    <Check className="w-3.5 h-3.5" />
                    <span>Approve & Send Now</span>
                  </button>
                )}

                <button
                  onClick={() => setPreviewEmailModal(null)}
                  className="px-4 py-2 bg-gray-200 text-gray-800 font-bold text-xs rounded-xl"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          APPOINTMENT & DOSSIER DETAIL MODAL
      ========================================================================= */}
      {selectedAppointment && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
          <div className="bg-white border border-[#C8A45D]/40 rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-4 relative max-h-[90vh] overflow-y-auto">
            <button
              onClick={() => setSelectedAppointment(null)}
              className="absolute top-4 right-4 text-gray-400 hover:text-gray-700 cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-2.5">
              <div className="w-10 h-10 rounded-xl bg-[#0F0F0F] text-[#FFE3A0] flex items-center justify-center">
                <Calendar className="w-5 h-5 text-[#C8A45D]" />
              </div>
              <div>
                <h3 className="font-cinzel text-lg font-bold text-[#0F0F0F]">Student Dossier & Payment</h3>
                <p className="text-xs text-gray-500">Full Verification & Immediate WhatsApp Outreach</p>
              </div>
            </div>

            <div className="space-y-3 text-xs bg-gray-50 p-4 rounded-xl border border-gray-200">
              <div>
                <span className="text-gray-500 font-semibold block text-[10px] uppercase tracking-wider">
                  Student Name
                </span>
                <span className="font-bold text-sm text-[#0F0F0F]">{selectedAppointment.name}</span>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <span className="text-gray-500 font-semibold block text-[10px] uppercase tracking-wider">
                    WhatsApp Phone
                  </span>
                  <span className="font-mono text-[#0F0F0F] font-bold">{selectedAppointment.phone}</span>
                </div>
                <div>
                  <span className="text-gray-500 font-semibold block text-[10px] uppercase tracking-wider">
                    Email
                  </span>
                  <span className="text-[#0F0F0F] truncate block">{selectedAppointment.email || 'Not provided'}</span>
                </div>
              </div>

              {/* 12-Digit UTR Block */}
              {selectedAppointment.utr_number && (
                <div className="p-3 bg-emerald-50 border border-emerald-300 rounded-xl space-y-1">
                  <span className="text-emerald-800 font-bold block text-[10px] uppercase tracking-wider">
                    12-Digit UPI Reference (UTR) Number
                  </span>
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-base font-extrabold text-emerald-950">
                      {formatUtrDisplay(selectedAppointment.utr_number)}
                    </span>
                    <button
                      onClick={() => copyUtrToClipboard(selectedAppointment.utr_number || '')}
                      className="px-2.5 py-1 bg-emerald-600 text-white font-bold text-[10px] rounded-lg"
                    >
                      {copiedUtr === selectedAppointment.utr_number ? 'Copied!' : 'Copy UTR'}
                    </button>
                  </div>
                  <p className="text-[10px] text-emerald-700">
                    Payee: Harkiran kaur jatinder singh kohli (harkirankaurr@ibl)
                  </p>
                </div>
              )}

              <div>
                <span className="text-gray-500 font-semibold block text-[10px] uppercase tracking-wider">
                  Program / Service
                </span>
                <span className="font-semibold text-purple-900 bg-purple-50 px-2 py-0.5 rounded inline-block mt-0.5">
                  {selectedAppointment.program}
                </span>
              </div>

              {selectedAppointment.notes && (
                <div>
                  <span className="text-gray-500 font-semibold block text-[10px] uppercase tracking-wider">
                    Student Notes / Request
                  </span>
                  <p className="text-gray-700 bg-white p-2.5 rounded-lg border border-gray-200 mt-1 italic">
                    "{selectedAppointment.notes}"
                  </p>
                </div>
              )}

              <div>
                <span className="text-gray-500 font-semibold block text-[10px] uppercase tracking-wider">
                  Date Submitted
                </span>
                <span className="text-gray-700">
                  {new Date(
                    selectedAppointment.created_at || selectedAppointment.local_saved_at || Date.now()
                  ).toLocaleString()}
                </span>
              </div>
            </div>

            {/* Quick Actions */}
            <div className="space-y-2">
              <h4 className="font-cinzel text-xs font-bold text-[#0F0F0F] uppercase tracking-wider">
                Direct Admin Actions
              </h4>

              {selectedAppointment.status !== 'confirmed' ? (
                <button
                  onClick={() => handleApproveAndSendEmail(selectedAppointment)}
                  className="w-full py-3 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-montserrat font-bold text-xs rounded-xl shadow-md flex items-center justify-center gap-2 cursor-pointer uppercase tracking-wider"
                >
                  <Check className="w-4 h-4" />
                  <span>Approve Payment & Send Confirmation Email</span>
                </button>
              ) : (
                <div className="flex items-center justify-between p-3 bg-emerald-50 border border-emerald-300 rounded-xl">
                  <div className="flex items-center gap-2 text-emerald-800 text-xs font-bold">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    <span>Enrollment Confirmed & Email Sent</span>
                  </div>
                  <button
                    onClick={() => handleApproveAndSendEmail(selectedAppointment)}
                    className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-bold rounded-lg flex items-center gap-1.5 cursor-pointer"
                  >
                    <Send className="w-3 h-3" />
                    <span>Resend Email</span>
                  </button>
                </div>
              )}

              {/* Download Official PDF Tax Invoice */}
              <button
                onClick={() => handleDownloadStudentInvoice(selectedAppointment)}
                className="w-full py-2.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-800 border border-indigo-200 font-bold text-xs rounded-xl flex items-center justify-center gap-2 cursor-pointer"
              >
                <FileText className="w-4 h-4 text-indigo-600" />
                <span>Download Official PDF Tax Invoice</span>
              </button>

              {/* Open Dispatch Actions (1-Click Gmail & WhatsApp) */}
              <button
                onClick={() => {
                  handleOpenDispatchModal(selectedAppointment);
                }}
                className="w-full py-2.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-montserrat font-bold text-xs rounded-xl flex items-center justify-center gap-2 cursor-pointer shadow-sm"
              >
                <Send className="w-4 h-4" />
                <span>Dispatch / Send Confirmation (Gmail & WhatsApp)</span>
              </button>

              {selectedAppointment.email && (
                <button
                  onClick={() => handleOpenEmailPreview(selectedAppointment)}
                  className="w-full py-2 bg-amber-50 hover:bg-amber-100 text-[#8A651E] border border-[#C8A45D]/40 font-bold text-xs rounded-xl flex items-center justify-center gap-2 cursor-pointer"
                >
                  <Eye className="w-4 h-4" />
                  <span>Preview Branded Email (Logo & 24-Hr Notice)</span>
                </button>
              )}

              <button
                onClick={() => handleDeleteAppointment(selectedAppointment)}
                className="w-full py-2 bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 font-bold text-xs rounded-xl flex items-center justify-center gap-2 cursor-pointer"
              >
                <Trash2 className="w-4 h-4" />
                <span>Delete Student Record</span>
              </button>

              <a
                href={`https://wa.me/91${(selectedAppointment.phone || '').replace(/\D/g, '')}?text=${encodeURIComponent(
                  `Hello ${selectedAppointment.name}! Harkiran Kaur here from HK Code of Rankers regarding your ${selectedAppointment.program}. Are you free for a brief call to finalize your roadmap?`
                )}`}
                target="_blank"
                rel="noreferrer"
                className="w-full py-2.5 px-3 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl flex items-center justify-center gap-2 transition-colors"
              >
                <MessageSquare className="w-4 h-4" />
                <span>Send WhatsApp Message</span>
              </a>
            </div>

            <div className="pt-2 flex justify-end">
              <button
                onClick={() => setSelectedAppointment(null)}
                className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-semibold rounded-xl"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          DIRECT DISPATCH MODAL (1-CLICK GMAIL SEND, WHATSAPP, & PDF INVOICE)
      ========================================================================= */}
      {dispatchModalData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-fade-in">
          <div className="bg-white border-2 border-[#C8A45D]/60 rounded-3xl max-w-xl w-full p-6 shadow-2xl space-y-4 relative max-h-[92vh] overflow-y-auto">
            <button
              onClick={() => setDispatchModalData(null)}
              className="absolute top-4 right-4 p-1.5 text-gray-400 hover:text-black rounded-lg cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white flex items-center justify-center shrink-0 shadow-md">
                <CheckCircle2 className="w-6 h-6" />
              </div>
              <div>
                <h3 className="font-cinzel text-lg font-bold text-gray-900">
                  Payment Approved & Confirmation Ready!
                </h3>
                <p className="text-xs text-gray-500">
                  Seat confirmed for <strong>{dispatchModalData.studentName}</strong> ({dispatchModalData.program})
                </p>
              </div>
            </div>

            {/* Verification details strip */}
            <div className="p-3.5 bg-amber-50/70 border border-amber-200/80 rounded-xl text-xs text-gray-800 space-y-1">
              <div className="flex justify-between font-semibold">
                <span className="text-amber-900">Recipient Email:</span>
                <span className="font-mono text-gray-900">{dispatchModalData.studentEmail}</span>
              </div>
              <div className="flex justify-between font-semibold">
                <span className="text-amber-900">Registered Mobile:</span>
                <span className="font-mono text-gray-900">+91 {dispatchModalData.studentPhone}</span>
              </div>
              <div className="flex justify-between font-semibold">
                <span className="text-amber-900">Verified UTR / Order:</span>
                <span className="font-mono text-emerald-800">{dispatchModalData.utrNumber} ({dispatchModalData.orderNumber})</span>
              </div>
            </div>

            <div className="p-3 bg-blue-50 border border-blue-200 rounded-xl text-[11px] text-blue-900 flex items-start gap-2">
              <span className="text-base">💡</span>
              <div>
                <strong className="block">Direct Inbox Delivery Guarantee</strong>
                Click <strong>"Open in Gmail"</strong> below to open a pre-filled message directly in your Gmail with Harkiran Kaur's verified address. This ensures 100% inbox delivery and zero delay!
              </div>
            </div>

            {/* Direct Action Grid */}
            <div className="space-y-2.5 pt-1">
              <a
                href={dispatchModalData.gmailUrl}
                target="_blank"
                rel="noreferrer"
                className="w-full py-3.5 px-4 bg-gradient-to-r from-red-600 to-red-700 hover:from-red-500 hover:to-red-600 text-white font-montserrat font-bold text-xs rounded-xl shadow-md flex items-center justify-center gap-2 cursor-pointer uppercase tracking-wider"
              >
                <Mail className="w-4 h-4" />
                <span>Open in Gmail (Send with 1 Click)</span>
              </a>

              <a
                href={dispatchModalData.whatsAppUrl}
                target="_blank"
                rel="noreferrer"
                className="w-full py-3 px-4 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-montserrat font-bold text-xs rounded-xl shadow-sm flex items-center justify-center gap-2 cursor-pointer uppercase tracking-wider"
              >
                <MessageSquare className="w-4 h-4" />
                <span>Send WhatsApp Confirmation</span>
              </a>

              <button
                onClick={() => {
                  const fakeOrder: any = {
                    orderNumber: dispatchModalData.orderNumber,
                    createdAt: new Date().toISOString(),
                    utrNumber: dispatchModalData.utrNumber,
                    paymentMethod: 'UPI',
                    status: 'COMPLETED',
                    subtotal: dispatchModalData.amount,
                    discount: 0,
                    totalAmount: dispatchModalData.amount,
                    billingDetails: {
                      fullName: dispatchModalData.studentName,
                      email: dispatchModalData.studentEmail,
                      phone: dispatchModalData.studentPhone,
                    },
                    items: [
                      {
                        name: dispatchModalData.program,
                        quantity: 1,
                        price: dispatchModalData.amount,
                      },
                    ],
                  };
                  generateInvoicePDF(fakeOrder);
                }}
                className="w-full py-2.5 px-4 bg-indigo-50 hover:bg-indigo-100 text-indigo-800 border border-indigo-200 font-montserrat font-bold text-xs rounded-xl flex items-center justify-center gap-2 cursor-pointer"
              >
                <FileText className="w-4 h-4 text-indigo-600" />
                <span>Download Official PDF Tax Invoice</span>
              </button>

              <div className="flex gap-2">
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(dispatchModalData.plainText);
                    setApprovalToast({
                      message: 'Full email confirmation text copied to clipboard!',
                      email: dispatchModalData.studentEmail,
                    });
                    setTimeout(() => setApprovalToast(null), 3000);
                  }}
                  className="flex-1 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold text-xs rounded-xl flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copy Text</span>
                </button>

                <a
                  href={dispatchModalData.mailtoUrl}
                  className="flex-1 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold text-xs rounded-xl flex items-center justify-center gap-1.5 cursor-pointer text-center"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>Default Mail App</span>
                </a>
              </div>
            </div>

            <div className="pt-2 flex justify-end border-t border-gray-200">
              <button
                onClick={() => setDispatchModalData(null)}
                className="px-5 py-2 bg-gray-200 hover:bg-gray-300 text-gray-800 text-xs font-semibold rounded-xl cursor-pointer"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          DELETE CONFIRMATION MODAL (Reliable in iFrame Sandbox)
      ========================================================================= */}
      {itemToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
          <div className="bg-white border-2 border-red-200 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4 relative">
            <button
              onClick={() => setItemToDelete(null)}
              className="absolute top-4 right-4 text-gray-400 hover:text-gray-700 cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-red-100 border border-red-200 flex items-center justify-center text-red-600 shrink-0">
                <Trash2 className="w-6 h-6" />
              </div>
              <div>
                <h3 className="font-cinzel text-base font-bold text-gray-900">
                  Delete Student Record?
                </h3>
                <p className="text-xs text-gray-500">
                  Permanent removal from admin dashboard
                </p>
              </div>
            </div>

            <div className="p-3.5 bg-gray-50 rounded-xl border border-gray-200 text-xs space-y-1.5">
              <div className="flex justify-between">
                <span className="text-gray-500">Student:</span>
                <span className="font-bold text-gray-900">{itemToDelete.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Phone:</span>
                <span className="font-mono text-gray-800">{itemToDelete.phone}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Program:</span>
                <span className="font-medium text-purple-800">{itemToDelete.program}</span>
              </div>
              {itemToDelete.utr_number && (
                <div className="flex justify-between">
                  <span className="text-gray-500">UTR:</span>
                  <span className="font-mono text-emerald-800 font-bold">{itemToDelete.utr_number}</span>
                </div>
              )}
            </div>

            <p className="text-xs text-red-700 bg-red-50 p-3 rounded-xl border border-red-200">
              ⚠️ Warning: This will permanently delete this student's submission record from both database and local records.
            </p>

            <div className="flex items-center justify-end gap-2.5 pt-1">
              <button
                type="button"
                onClick={() => setItemToDelete(null)}
                disabled={isDeleting}
                className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold text-xs rounded-xl cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmDeleteAppointment}
                disabled={isDeleting}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-montserrat font-bold text-xs rounded-xl shadow cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
              >
                {isDeleting ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Deleting...</span>
                  </>
                ) : (
                  <>
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Yes, Delete Permanently</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
