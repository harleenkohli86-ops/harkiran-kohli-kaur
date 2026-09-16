import React, { useState, useEffect } from 'react';
import { CentralStudent } from '../../services/centralStudentDatabase';
import {
  DirectUpiSubmission,
  fetchDirectUpiSubmissionsFromSupabase,
  approveDirectUpiSubmissionInSupabase,
  rejectDirectUpiSubmissionInSupabase,
} from '../../lib/supabase';
import {
  Search,
  CheckCircle2,
  Clock,
  XCircle,
  Mail,
  Phone,
  Copy,
  Check,
  CreditCard,
  RefreshCw,
  Bookmark,
  Loader2,
  Calendar,
  AlertCircle,
  ShieldCheck,
  Filter,
} from 'lucide-react';

interface PaymentApprovalsTabProps {
  students?: CentralStudent[];
  approvingId?: string | null;
  onApprovePayment?: (student: CentralStudent) => void;
  onRejectPayment?: (student: CentralStudent) => void;
  onOpenMentorshipChart?: (student: CentralStudent) => void;
  onRefresh?: () => void;
  adminName?: string;
}

export const PaymentApprovalsTab: React.FC<PaymentApprovalsTabProps> = ({
  students = [],
  approvingId,
  onApprovePayment,
  onRejectPayment,
  onOpenMentorshipChart,
  onRefresh,
  adminName = 'Harkiran Kaur',
}) => {
  const [submissions, setSubmissions] = useState<DirectUpiSubmission[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>('pending');
  const [copiedUtr, setCopiedUtr] = useState<string | null>(null);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [rejectingItem, setRejectingItem] = useState<DirectUpiSubmission | null>(null);
  const [rejectReason, setRejectReason] = useState('Payment UTR verification failed in bank statement');

  // Load latest real submissions directly from Supabase
  const loadSubmissions = async () => {
    setIsLoading(true);
    try {
      const { data } = await fetchDirectUpiSubmissionsFromSupabase();

      // Also merge any students who have submitted payments locally/via checkout
      const mergedList = [...data];
      students.forEach((s) => {
        if (s.purchasedCourse || (s.paymentStatus && s.paymentStatus !== 'unpaid')) {
          const utr = s.purchasedCourse?.utrNumber || s.purchasedCourse?.transactionRef || '';
          const alreadyInList = mergedList.some(
            (m) =>
              (utr && m.utrNumber === utr) ||
              (m.studentId && m.studentId === s.studentId) ||
              (m.email && s.email && m.email.toLowerCase() === s.email.toLowerCase())
          );
          if (!alreadyInList) {
            const isApproved = s.paymentStatus === 'approved';
            const isRejected = s.paymentStatus === 'rejected';
            const status = isApproved ? 'approved' : isRejected ? 'rejected' : 'pending';
            const paymentDateStr = s.purchasedCourse?.paymentDate || s.updatedAt || new Date().toISOString();
            const pDate = new Date(paymentDateStr);
            mergedList.push({
              id: `std_${s.studentId}`,
              studentName: s.fullName,
              studentId: s.studentId,
              email: s.email,
              phone: s.phone,
              program: s.purchasedCourse?.courseName || s.targetExam,
              level: s.level,
              group: s.group,
              attempt: s.targetExam,
              amount: s.purchasedCourse?.finalAmount || s.purchasedCourse?.amount || 2999,
              utrNumber: utr || 'N/A',
              paymentDate: pDate.toLocaleDateString('en-IN', {
                day: 'numeric',
                month: 'short',
                year: 'numeric',
              }),
              paymentTime: pDate.toLocaleTimeString('en-IN', {
                hour: '2-digit',
                minute: '2-digit',
                hour12: true,
              }),
              status,
              rawStatus: s.paymentStatus,
              createdAt: paymentDateStr,
              notes: s.purchasedCourse?.paymentProofNotes || '',
              productId: s.purchasedCourse?.courseId || 'cs-mentorship-batch',
            });
          }
        }
      });

      setSubmissions(mergedList);
    } catch (err) {
      console.warn('Error loading submissions:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadSubmissions();
  }, []);

  const handleRefresh = async () => {
    await loadSubmissions();
    if (onRefresh) onRefresh();
  };

  const handleCopyUtr = (utr: string) => {
    navigator.clipboard.writeText(utr);
    setCopiedUtr(utr);
    setTimeout(() => setCopiedUtr(null), 2500);
  };

  const handleApprove = async (sub: DirectUpiSubmission) => {
    setActionLoadingId(sub.id);
    setActionMessage(null);
    try {
      const res = await approveDirectUpiSubmissionInSupabase(sub, adminName);
      if (res.success) {
        setActionMessage({ type: 'success', text: res.message });
        await loadSubmissions();
        if (onRefresh) onRefresh();
      } else {
        setActionMessage({ type: 'error', text: res.message });
      }
    } catch (err: any) {
      setActionMessage({ type: 'error', text: err?.message || 'Error approving payment.' });
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleConfirmReject = async () => {
    if (!rejectingItem) return;
    setActionLoadingId(rejectingItem.id);
    setActionMessage(null);
    try {
      const res = await rejectDirectUpiSubmissionInSupabase(rejectingItem, rejectReason, adminName);
      if (res.success) {
        setActionMessage({ type: 'success', text: res.message });
        setRejectingItem(null);
        await loadSubmissions();
        if (onRefresh) onRefresh();
      } else {
        setActionMessage({ type: 'error', text: res.message });
      }
    } catch (err: any) {
      setActionMessage({ type: 'error', text: err?.message || 'Error rejecting payment.' });
    } finally {
      setActionLoadingId(null);
    }
  };

  // Counts
  const pendingCount = submissions.filter((s) => s.status === 'pending').length;
  const approvedCount = submissions.filter((s) => s.status === 'approved').length;
  const rejectedCount = submissions.filter((s) => s.status === 'rejected').length;

  // Filtering
  const filtered = submissions.filter((s) => {
    if (statusFilter === 'pending' && s.status !== 'pending') return false;
    if (statusFilter === 'approved' && s.status !== 'approved') return false;
    if (statusFilter === 'rejected' && s.status !== 'rejected') return false;

    if (search.trim()) {
      const q = search.toLowerCase();
      const matchName = s.studentName.toLowerCase().includes(q);
      const matchId = s.studentId.toLowerCase().includes(q);
      const matchEmail = s.email.toLowerCase().includes(q);
      const matchPhone = s.phone.includes(q);
      const matchUtr = s.utrNumber.toLowerCase().includes(q);
      const matchProgram = s.program.toLowerCase().includes(q);
      return matchName || matchId || matchEmail || matchPhone || matchUtr || matchProgram;
    }
    return true;
  });

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="bg-gradient-to-r from-[#1C1917] via-[#2E2419] to-[#1C1917] text-white border-2 border-[#C8A45D]/50 p-6 rounded-3xl shadow-xl flex flex-col md:flex-row md:items-center justify-between gap-5">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-[#C8A45D]/20 border-2 border-[#C8A45D]/60 flex items-center justify-center text-[#FFE3A0] shrink-0 shadow-inner">
            <CreditCard className="w-7 h-7 text-[#C8A45D]" />
          </div>
          <div>
            <div className="text-[10px] uppercase font-montserrat font-bold text-[#FFE3A0] tracking-wider flex items-center gap-2">
              <span>Official Admin Portal</span>
              <span className="px-2 py-0.5 bg-[#C8A45D]/20 text-[#FFE3A0] border border-[#C8A45D]/40 rounded text-[9px] font-mono">
                Supabase Single Source of Truth
              </span>
            </div>
            <h2 className="font-cinzel text-lg sm:text-xl font-bold text-white mt-1">
              Direct UPI Approval & Mentorship Activation
            </h2>
            <p className="text-xs text-gray-300 max-w-2xl leading-relaxed mt-0.5">
              Review genuine student payments submitted via UPI with 12-digit UTR references. Approving a payment marks the Supabase record as <strong>approved</strong>, activates the student's mentorship program, and adds them to <strong>Student Mentorship → Registered</strong>.
            </p>
          </div>
        </div>

        {/* Quick Filter Pills */}
        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <button
            onClick={() => setStatusFilter('pending')}
            className={`px-4 py-2 rounded-xl text-xs font-montserrat font-bold flex items-center gap-2 transition-all cursor-pointer ${
              statusFilter === 'pending'
                ? 'bg-amber-500 text-black shadow-lg ring-2 ring-amber-300'
                : 'bg-white/10 text-gray-200 hover:bg-white/20'
            }`}
          >
            <Clock className="w-4 h-4" />
            <span>Pending ({pendingCount})</span>
            {pendingCount > 0 && (
              <span className="w-2 h-2 rounded-full bg-red-500 animate-ping ml-1" />
            )}
          </button>

          <button
            onClick={() => setStatusFilter('approved')}
            className={`px-4 py-2 rounded-xl text-xs font-montserrat font-bold flex items-center gap-2 transition-all cursor-pointer ${
              statusFilter === 'approved'
                ? 'bg-emerald-500 text-white shadow-lg ring-2 ring-emerald-300'
                : 'bg-white/10 text-gray-200 hover:bg-white/20'
            }`}
          >
            <CheckCircle2 className="w-4 h-4" />
            <span>Approved ({approvedCount})</span>
          </button>

          <button
            onClick={() => setStatusFilter('all')}
            className={`px-4 py-2 rounded-xl text-xs font-montserrat font-bold flex items-center gap-2 transition-all cursor-pointer ${
              statusFilter === 'all'
                ? 'bg-white text-black shadow-lg ring-2 ring-gray-300'
                : 'bg-white/10 text-gray-200 hover:bg-white/20'
            }`}
          >
            <span>All Records ({submissions.length})</span>
          </button>
        </div>
      </div>

      {/* Action Toast / Feedback */}
      {actionMessage && (
        <div
          className={`p-4 rounded-2xl border flex items-center justify-between text-xs font-medium animate-fade-in ${
            actionMessage.type === 'success'
              ? 'bg-emerald-50 border-emerald-500 text-emerald-950'
              : 'bg-rose-50 border-rose-500 text-rose-950'
          }`}
        >
          <div className="flex items-center gap-2.5">
            {actionMessage.type === 'success' ? (
              <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
            ) : (
              <AlertCircle className="w-5 h-5 text-rose-600 shrink-0" />
            )}
            <span>{actionMessage.text}</span>
          </div>
          <button
            onClick={() => setActionMessage(null)}
            className="text-gray-500 hover:text-black font-bold text-xs p-1"
          >
            ✕
          </button>
        </div>
      )}

      {/* Search & Refresh Toolbar */}
      <div className="bg-white border border-[#C8A45D]/30 p-4 rounded-2xl shadow-sm flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="relative flex-1 w-full max-w-md">
          <Search className="w-4 h-4 text-gray-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search by Student Name, Student ID, Email, Phone, or UTR..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs focus:outline-none focus:border-[#C8A45D]"
          />
        </div>

        <div className="flex items-center gap-2 self-end sm:self-auto">
          <button
            onClick={handleRefresh}
            disabled={isLoading}
            className="px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-xl text-gray-800 transition-colors cursor-pointer flex items-center gap-1.5 text-xs font-semibold"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-[#8A651E]' : ''}`} />
            <span>{isLoading ? 'Fetching Supabase...' : 'Refresh'}</span>
          </button>
        </div>
      </div>

      {/* Direct UPI Approvals Table */}
      <div className="bg-white border border-[#C8A45D]/30 rounded-2xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-[#1C1917] text-white font-montserrat font-bold text-[11px] uppercase tracking-wider">
                <th className="py-4 px-4">Student Details</th>
                <th className="py-4 px-4">Contact Info</th>
                <th className="py-4 px-4">Program & Level/Group</th>
                <th className="py-4 px-4">Attempt</th>
                <th className="py-4 px-4">Amount</th>
                <th className="py-4 px-4">12-Digit UTR Number</th>
                <th className="py-4 px-4">Payment Date & Time</th>
                <th className="py-4 px-4 text-center">Status</th>
                <th className="py-4 px-4 text-right">Approval Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 bg-white">
              {isLoading && submissions.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-16 text-center text-gray-500 text-xs">
                    <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2 text-[#C8A45D]" />
                    <span>Loading genuine student payments from Supabase...</span>
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-16 text-center text-gray-500 text-xs">
                    {statusFilter === 'pending'
                      ? '✨ No pending payments! All student UPI submissions have been verified and processed.'
                      : 'No student payment records found matching your search.'}
                  </td>
                </tr>
              ) : (
                filtered.map((sub) => {
                  const isPending = sub.status === 'pending';
                  const isApproved = sub.status === 'approved';
                  const isRejected = sub.status === 'rejected';
                  const isActing = actionLoadingId === sub.id;

                  return (
                    <tr
                      key={sub.id}
                      className={`transition-colors ${
                        isPending ? 'bg-amber-50/70 hover:bg-amber-50' : 'hover:bg-gray-50/80'
                      }`}
                    >
                      {/* Student Name & Student ID */}
                      <td className="py-4 px-4 font-semibold text-gray-900">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-xl bg-[#FAF5E9] border border-[#C8A45D]/50 text-[#8A651E] font-bold flex items-center justify-center font-cinzel text-sm shrink-0">
                            {sub.studentName.charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <div className="font-bold text-gray-950 text-xs">{sub.studentName}</div>
                            <div className="inline-flex items-center gap-1 px-1.5 py-0.2 bg-gray-100 text-gray-700 rounded text-[10px] font-mono mt-0.5 border border-gray-200">
                              <span>ID:</span>
                              <strong className="text-black">{sub.studentId}</strong>
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* Contact Info (Email & Phone) */}
                      <td className="py-4 px-4">
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-1 text-[11px] text-gray-700">
                            <Mail className="w-3 h-3 text-gray-400 shrink-0" />
                            <span className="font-mono">{sub.email || 'N/A'}</span>
                          </div>
                          <div className="flex items-center gap-1 text-[11px] text-gray-700">
                            <Phone className="w-3 h-3 text-gray-400 shrink-0" />
                            <span>{sub.phone || 'N/A'}</span>
                          </div>
                        </div>
                      </td>

                      {/* Program & Level/Group */}
                      <td className="py-4 px-4">
                        <div className="font-bold text-gray-900 text-xs">{sub.program}</div>
                        <div className="text-[10px] text-gray-500 font-medium">
                          {sub.level} • {sub.group}
                        </div>
                      </td>

                      {/* Attempt */}
                      <td className="py-4 px-4 text-xs text-gray-700 font-medium">
                        {sub.attempt || 'December 2026'}
                      </td>

                      {/* Amount */}
                      <td className="py-4 px-4">
                        <div className="font-bold text-[#8A651E] text-xs font-montserrat">
                          ₹{sub.amount.toLocaleString('en-IN')}
                        </div>
                        <span className="text-[9px] text-gray-500">Direct UPI</span>
                      </td>

                      {/* UTR Number */}
                      <td className="py-4 px-4 font-mono">
                        <div className="flex items-center gap-1.5">
                          <span className="font-bold text-gray-950 text-xs bg-gray-100 px-2 py-1 rounded-lg border border-gray-300 select-all">
                            {sub.utrNumber}
                          </span>
                          {sub.utrNumber !== 'N/A' && (
                            <button
                              onClick={() => handleCopyUtr(sub.utrNumber)}
                              className="p-1 hover:bg-gray-200 rounded text-gray-600 transition-colors cursor-pointer"
                              title="Copy UTR number to verify in bank account statement"
                            >
                              {copiedUtr === sub.utrNumber ? (
                                <Check className="w-3.5 h-3.5 text-emerald-600" />
                              ) : (
                                <Copy className="w-3.5 h-3.5 text-gray-500" />
                              )}
                            </button>
                          )}
                        </div>
                        {copiedUtr === sub.utrNumber && (
                          <span className="text-[9px] text-emerald-600 font-bold block pt-0.5">
                            Copied to clipboard!
                          </span>
                        )}
                      </td>

                      {/* Payment Date & Time */}
                      <td className="py-4 px-4 text-gray-700 text-xs">
                        <div className="flex items-center gap-1 font-medium">
                          <Calendar className="w-3 h-3 text-gray-400" />
                          <span>{sub.paymentDate}</span>
                        </div>
                        <div className="text-[10px] text-gray-400 font-mono">{sub.paymentTime}</div>
                      </td>

                      {/* Status */}
                      <td className="py-4 px-4 text-center">
                        {isPending && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold bg-amber-100 text-amber-950 border border-amber-300 animate-pulse">
                            <Clock className="w-3 h-3 text-amber-700" />
                            <span>Pending Verification</span>
                          </span>
                        )}
                        {isApproved && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
                            <Check className="w-3 h-3 text-emerald-600" />
                            <span>Approved</span>
                          </span>
                        )}
                        {isRejected && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold bg-rose-100 text-rose-800 border border-rose-300">
                            <XCircle className="w-3 h-3 text-rose-600" />
                            <span>Rejected</span>
                          </span>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="py-4 px-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {isPending && (
                            <>
                              <button
                                onClick={() => handleApprove(sub)}
                                disabled={isActing}
                                className="px-3.5 py-1.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-montserrat font-bold text-xs rounded-xl shadow-xs flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                                title="Verify UTR in bank, activate mentorship program, and sync student to Registered list"
                              >
                                {isActing ? (
                                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                ) : (
                                  <CheckCircle2 className="w-3.5 h-3.5" />
                                )}
                                <span>APPROVE</span>
                              </button>

                              <button
                                onClick={() => setRejectingItem(sub)}
                                disabled={isActing}
                                className="px-2.5 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 font-bold text-xs rounded-xl flex items-center gap-1 cursor-pointer disabled:opacity-50"
                                title="Reject payment with reason"
                              >
                                <XCircle className="w-3.5 h-3.5 text-rose-600" />
                                <span>REJECT</span>
                              </button>
                            </>
                          )}

                          {isApproved && (
                            <div className="flex items-center gap-1 text-[11px] font-bold text-emerald-700">
                              <ShieldCheck className="w-4 h-4 text-emerald-600" />
                              <span>Mentorship Active</span>
                            </div>
                          )}

                          {isRejected && (
                            <span className="text-[11px] text-gray-500 italic">No Access Granted</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Reject Modal Dialog */}
      {rejectingItem && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 max-w-md w-full shadow-2xl border border-rose-200 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-rose-100 text-rose-600 flex items-center justify-center">
                <XCircle className="w-6 h-6" />
              </div>
              <div>
                <h3 className="font-montserrat font-bold text-base text-gray-900">
                  Reject UPI Payment
                </h3>
                <p className="text-xs text-gray-500">
                  {rejectingItem.studentName} (UTR: {rejectingItem.utrNumber})
                </p>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">
                Reason for Rejection
              </label>
              <textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                rows={3}
                className="w-full p-2.5 border border-gray-300 rounded-xl text-xs focus:border-rose-500 focus:outline-none"
                placeholder="Explain why this payment could not be verified..."
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => setRejectingItem(null)}
                className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl text-xs font-semibold cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmReject}
                disabled={actionLoadingId === rejectingItem.id}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold cursor-pointer disabled:opacity-50"
              >
                {actionLoadingId === rejectingItem.id ? 'Rejecting...' : 'Confirm Rejection'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
