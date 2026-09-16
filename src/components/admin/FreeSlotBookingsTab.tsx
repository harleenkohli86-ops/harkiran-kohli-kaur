import React, { useState } from 'react';
import {
  PhoneCall,
  Calendar,
  Clock,
  Mail,
  Phone,
  User,
  MessageSquare,
  Search,
  CheckCircle,
  AlertTriangle,
  Trash2,
  Copy,
  Check,
  Download,
  RefreshCw,
  FileText,
} from 'lucide-react';
import { FreeSlotBookingRecord, FreeSlotStatus } from '../../services/centralStudentDatabase';
import {
  parseSlotDateTime,
  updateFreeSlotBookingStatusInSupabase,
  deleteFreeSlotBookingFromSupabase,
} from '../../lib/supabase';

interface FreeSlotBookingsTabProps {
  bookings: FreeSlotBookingRecord[];
  onRefresh: () => Promise<void> | void;
  isLoading?: boolean;
}

export const FreeSlotBookingsTab: React.FC<FreeSlotBookingsTabProps> = ({
  bookings,
  onRefresh,
  isLoading = false,
}) => {
  const [filter, setFilter] = useState<'all' | 'booked' | 'completed' | 'rescheduled'>('all');
  const [search, setSearch] = useState('');
  const [editingRemarksId, setEditingRemarksId] = useState<string | null>(null);
  const [remarksInput, setRemarksInput] = useState('');
  const [bookingToDelete, setBookingToDelete] = useState<FreeSlotBookingRecord | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  // Status Counts
  const bookedCount = bookings.filter((b) => b.status === 'booked' || b.status === 'pending' || b.status === 'confirmed').length;
  const completedCount = bookings.filter((b) => b.status === 'completed').length;
  const rescheduledCount = bookings.filter((b) => b.status === 'rescheduled').length;

  const handleCopy = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const handleStatusChange = async (
    bookingId: string,
    newStatus: FreeSlotStatus
  ) => {
    setUpdatingId(bookingId);
    try {
      await updateFreeSlotBookingStatusInSupabase(bookingId, newStatus);
      await onRefresh();
    } catch (err) {
      console.error('Failed to update free slot status:', err);
    } finally {
      setUpdatingId(null);
    }
  };

  const handleSaveRemarks = async (bookingId: string) => {
    const booking = bookings.find((b) => b.id === bookingId);
    if (!booking) return;
    setUpdatingId(bookingId);
    try {
      await updateFreeSlotBookingStatusInSupabase(bookingId, booking.status, remarksInput);
      setEditingRemarksId(null);
      setRemarksInput('');
      await onRefresh();
    } catch (err) {
      console.error('Failed to save remarks:', err);
    } finally {
      setUpdatingId(null);
    }
  };

  const handleDeleteBooking = async (bookingId: string) => {
    setUpdatingId(bookingId);
    try {
      await deleteFreeSlotBookingFromSupabase(bookingId);
      setBookingToDelete(null);
      await onRefresh();
    } catch (err) {
      console.error('Failed to delete booking:', err);
    } finally {
      setUpdatingId(null);
    }
  };

  const filteredBookings = bookings.filter((b) => {
    if (filter === 'booked') {
      const isBooked = b.status === 'booked' || b.status === 'pending' || b.status === 'confirmed';
      if (!isBooked) return false;
    } else if (filter !== 'all' && b.status !== filter) {
      return false;
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      return (
        b.name.toLowerCase().includes(q) ||
        b.email.toLowerCase().includes(q) ||
        b.phone.includes(q) ||
        b.program.toLowerCase().includes(q) ||
        b.id.toLowerCase().includes(q) ||
        (b.notes && b.notes.toLowerCase().includes(q))
      );
    }
    return true;
  });

  const openWhatsApp = (b: FreeSlotBookingRecord) => {
    const cleanPhone = b.phone.replace(/\D/g, '');
    const phoneWithCountry = cleanPhone.length === 10 ? `91${cleanPhone}` : cleanPhone;
    const slotInfo = parseSlotDateTime(b.preferredSlot);
    const text = encodeURIComponent(
      `Hello ${b.name}! This is Harkiran Kaur Kohli (AIR 3 CS Professional) from HK Code of Rankers.\n\n` +
      `Thank you for booking your Free 1-on-1 Guidance Demo Session!\n` +
      `📚 Target Exam: ${b.program}\n` +
      `📅 Selected Date: ${slotInfo.selectedDate}\n` +
      `⏰ Selected Time: ${slotInfo.selectedTime}\n` +
      `🆔 Reference: ${b.id}\n\n` +
      `I am looking forward to our strategy call to build your structured CS study plan. Please let me know if this time works for you!`
    );
    window.open(`https://wa.me/${phoneWithCountry}?text=${text}`, '_blank');
  };

  const openGmail = (b: FreeSlotBookingRecord) => {
    const slotInfo = parseSlotDateTime(b.preferredSlot);
    const subject = encodeURIComponent(`1-on-1 Free Strategy Call Confirmation — HK Code of Rankers (${b.id})`);
    const body = encodeURIComponent(
      `Dear ${b.name},\n\n` +
      `Thank you for booking your 1-on-1 Free Strategy Call with Harkiran Kaur Kohli (AIR 3 CS Professional, 413/700 with 4 exemptions).\n\n` +
      `YOUR FREE SESSION DETAILS:\n` +
      `• Candidate Name: ${b.name}\n` +
      `• Target Exam / Level: ${b.program}\n` +
      `• Selected Date: ${slotInfo.selectedDate}\n` +
      `• Selected Time: ${slotInfo.selectedTime}\n` +
      `• WhatsApp Mobile: ${b.phone}\n` +
      `• Booking Reference: ${b.id}\n\n` +
      (b.notes ? `Your Inquiries / Goals: "${b.notes}"\n\n` : '') +
      `We will connect at your chosen slot. Please keep your current study schedule and questions ready.\n\n` +
      `Warm regards,\n` +
      `Harkiran Kaur Kohli\n` +
      `All India Rank 3 (AIR 3) | Founder, HK Code of Rankers\n` +
      `Official Desk: hk.code.of.rankers@gmail.com`
    );
    window.open(`https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(b.email)}&su=${subject}&body=${body}`, '_blank');
  };

  const exportToCSV = () => {
    if (bookings.length === 0) return;
    const headers = [
      'Booking ID',
      'Student Name',
      'Phone Number',
      'Email',
      'Target Exam',
      'Selected Date',
      'Selected Time',
      'Registration Date',
      'Registration Time',
      'Status',
      'Student Notes',
      'Admin Remarks',
    ];
    const rows = bookings.map((b) => {
      const slot = parseSlotDateTime(b.preferredSlot);
      const regDate = new Date(b.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
      const regTime = new Date(b.createdAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
      return [
        b.id,
        `"${b.name.replace(/"/g, '""')}"`,
        `"${b.phone.replace(/"/g, '""')}"`,
        `"${b.email.replace(/"/g, '""')}"`,
        `"${b.program.replace(/"/g, '""')}"`,
        `"${slot.selectedDate.replace(/"/g, '""')}"`,
        `"${slot.selectedTime.replace(/"/g, '""')}"`,
        `"${regDate}"`,
        `"${regTime}"`,
        b.status,
        `"${(b.notes || '').replace(/"/g, '""')}"`,
        `"${(b.adminRemarks || '').replace(/"/g, '""')}"`,
      ];
    });
    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `HK_Free_Demo_Session_Bookings_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="bg-gradient-to-r from-[#171512] to-[#0F0F0F] text-white border-2 border-[#C8A45D]/40 p-5 rounded-3xl shadow-md flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-2xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-300 shrink-0">
            <PhoneCall className="w-6 h-6 text-emerald-400" />
          </div>
          <div>
            <div className="text-[10px] uppercase font-montserrat font-bold text-emerald-400 tracking-wider flex items-center gap-1.5">
              <span>Free Demo Sessions</span>
              <span className="px-1.5 py-0.2 bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 rounded text-[9px]">
                Supabase Database: enrollments
              </span>
            </div>
            <h2 className="font-cinzel text-base sm:text-lg font-bold text-white mt-0.5">
              Free Session Bookings (1st Guidance Call Demo)
            </h2>
            <p className="text-xs text-gray-400">
              Students who booked a complimentary 1-on-1 strategy session. Synced directly from the Supabase database.
            </p>
          </div>
        </div>

        {/* Status Filter Badges */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setFilter('all')}
            className={`px-3 py-1.5 rounded-xl text-xs font-montserrat font-bold transition-all cursor-pointer ${
              filter === 'all'
                ? 'bg-[#C8A45D] text-black shadow-md'
                : 'bg-white/10 text-gray-300 hover:bg-white/20'
            }`}
          >
            All ({bookings.length})
          </button>
          <button
            onClick={() => setFilter('booked')}
            className={`px-3 py-1.5 rounded-xl text-xs font-montserrat font-bold transition-all cursor-pointer ${
              filter === 'booked'
                ? 'bg-amber-500 text-black shadow-md'
                : 'bg-white/10 text-gray-300 hover:bg-white/20'
            }`}
          >
            Booked ({bookedCount})
          </button>
          <button
            onClick={() => setFilter('completed')}
            className={`px-3 py-1.5 rounded-xl text-xs font-montserrat font-bold transition-all cursor-pointer ${
              filter === 'completed'
                ? 'bg-blue-500 text-white shadow-md'
                : 'bg-white/10 text-gray-300 hover:bg-white/20'
            }`}
          >
            Completed ({completedCount})
          </button>
          <button
            onClick={() => setFilter('rescheduled')}
            className={`px-3 py-1.5 rounded-xl text-xs font-montserrat font-bold transition-all cursor-pointer ${
              filter === 'rescheduled'
                ? 'bg-purple-500 text-white shadow-md'
                : 'bg-white/10 text-gray-300 hover:bg-white/20'
            }`}
          >
            Rescheduled ({rescheduledCount})
          </button>
        </div>
      </div>

      {/* Search & Actions Bar */}
      <div className="bg-white border border-[#C8A45D]/30 p-4 rounded-2xl shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-gray-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search student name, email, phone, target exam..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs focus:outline-none focus:border-[#C8A45D]"
          />
        </div>

        <div className="flex items-center gap-2 self-end sm:self-auto">
          <button
            onClick={() => onRefresh()}
            disabled={isLoading}
            className="px-3.5 py-2 bg-[#FAF5E9] hover:bg-[#F3EAD3] border border-[#C8A45D]/40 text-[#8A651E] text-xs font-montserrat font-bold rounded-xl flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
            title="Refresh bookings directly from Supabase database"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            <span>{isLoading ? 'Syncing...' : 'Refresh DB'}</span>
          </button>

          <button
            onClick={exportToCSV}
            disabled={bookings.length === 0}
            className="px-3.5 py-2 bg-gray-100 hover:bg-gray-200 disabled:opacity-50 text-gray-800 text-xs font-montserrat font-bold rounded-xl flex items-center gap-2 border border-gray-300 transition-colors cursor-pointer"
            title="Download CSV report of free session bookings"
          >
            <Download className="w-3.5 h-3.5 text-gray-600" />
            <span>Export CSV</span>
          </button>
        </div>
      </div>

      {/* Bookings Table */}
      <div className="bg-white border border-[#C8A45D]/30 rounded-2xl shadow-sm overflow-hidden">
        {filteredBookings.length === 0 ? (
          <div className="p-12 text-center space-y-3">
            <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center mx-auto text-gray-400">
              <PhoneCall className="w-6 h-6" />
            </div>
            <p className="text-gray-600 font-medium text-sm">No free session bookings found.</p>
            <p className="text-xs text-gray-400">When students submit the Free Demo Session booking modal, their details appear here in real-time from Supabase.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-[#1C1917] text-white font-montserrat font-bold text-[11px] uppercase tracking-wider">
                  <th className="py-3.5 px-4">Student & Contact Details</th>
                  <th className="py-3.5 px-4">Target Exam</th>
                  <th className="py-3.5 px-4">Selected Date & Time</th>
                  <th className="py-3.5 px-4">Registration Date & Time</th>
                  <th className="py-3.5 px-4">Notes</th>
                  <th className="py-3.5 px-4 text-center">Status</th>
                  <th className="py-3.5 px-4 text-right">Connect Directly</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 bg-white">
                {filteredBookings.map((b) => {
                  const isEditingRemarks = editingRemarksId === b.id;
                  const isUpdating = updatingId === b.id;
                  const slot = parseSlotDateTime(b.preferredSlot);
                  const regDate = new Date(b.createdAt).toLocaleDateString('en-IN', {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                  });
                  const regTime = new Date(b.createdAt).toLocaleTimeString('en-IN', {
                    hour: '2-digit',
                    minute: '2-digit',
                  });

                  // Normalize status for display
                  let normalizedStatus: FreeSlotStatus = 'booked';
                  if (b.status === 'completed') normalizedStatus = 'completed';
                  else if (b.status === 'rescheduled') normalizedStatus = 'rescheduled';
                  else normalizedStatus = 'booked';

                  return (
                    <tr key={b.id} className="hover:bg-gray-50/80 transition-colors">
                      {/* 1. Student Name, 2. Phone, 3. Email */}
                      <td className="py-3.5 px-4 space-y-1.5 align-top max-w-xs">
                        <div className="font-bold text-gray-950 text-xs flex items-center gap-1.5">
                          <User className="w-3.5 h-3.5 text-[#C8A45D]" />
                          <span>{b.name}</span>
                        </div>

                        {/* Phone with copy */}
                        <div className="flex items-center gap-1.5 text-gray-700 text-[11px] bg-emerald-50/70 px-2 py-1 rounded border border-emerald-200">
                          <Phone className="w-3 h-3 text-emerald-700 shrink-0" />
                          <span className="font-mono font-medium text-emerald-900 select-all">{b.phone}</span>
                          <button
                            onClick={() => handleCopy(b.phone, `phone-${b.id}`)}
                            className="ml-auto text-emerald-600 hover:text-emerald-950 p-0.5"
                            title="Copy WhatsApp phone number"
                          >
                            {copiedKey === `phone-${b.id}` ? (
                              <Check className="w-3 h-3 text-emerald-600" />
                            ) : (
                              <Copy className="w-3 h-3" />
                            )}
                          </button>
                        </div>

                        {/* Email with copy */}
                        <div className="flex items-center gap-1.5 text-gray-700 text-[11px] bg-gray-50 px-2 py-1 rounded border border-gray-200">
                          <Mail className="w-3 h-3 text-[#8A651E] shrink-0" />
                          <span className="font-mono truncate select-all">{b.email || 'No email provided'}</span>
                          {b.email && (
                            <button
                              onClick={() => handleCopy(b.email, `email-${b.id}`)}
                              className="ml-auto text-gray-400 hover:text-black p-0.5"
                              title="Copy email address"
                            >
                              {copiedKey === `email-${b.id}` ? (
                                <Check className="w-3 h-3 text-emerald-600" />
                              ) : (
                                <Copy className="w-3 h-3" />
                              )}
                            </button>
                          )}
                        </div>

                        <div className="text-[10px] text-gray-400 font-mono">
                          Ref: {b.id}
                        </div>
                      </td>

                      {/* 4. Target Exam / Attempt */}
                      <td className="py-3.5 px-4 align-top">
                        <span className="font-semibold text-gray-900 text-xs bg-[#FAF5E9] text-[#8A651E] px-2.5 py-1 rounded-lg border border-[#C8A45D]/30 inline-block">
                          {b.program}
                        </span>
                      </td>

                      {/* 5. Selected Date, 6. Selected Time */}
                      <td className="py-3.5 px-4 space-y-1 align-top">
                        <div className="text-xs font-semibold text-gray-800 flex items-center gap-1.5">
                          <Calendar className="w-3.5 h-3.5 text-[#C8A45D]" />
                          <span>{slot.selectedDate}</span>
                        </div>
                        <div className="text-[11px] text-gray-600 flex items-center gap-1.5 bg-gray-50 px-2 py-0.5 rounded border border-gray-200 w-fit">
                          <Clock className="w-3 h-3 text-gray-500" />
                          <span>{slot.selectedTime}</span>
                        </div>
                      </td>

                      {/* 7. Registration Date, 8. Registration Time */}
                      <td className="py-3.5 px-4 space-y-0.5 align-top">
                        <div className="text-xs text-gray-800 font-medium">
                          {regDate}
                        </div>
                        <div className="text-[10px] text-gray-400 font-mono">
                          {regTime}
                        </div>
                      </td>

                      {/* 10. Notes, if available */}
                      <td className="py-3.5 px-4 space-y-1 max-w-xs align-top">
                        {b.notes ? (
                          <p className="text-[11px] text-gray-700 italic bg-amber-50/70 p-2 rounded-lg border border-amber-200/70 leading-relaxed">
                            "{b.notes}"
                          </p>
                        ) : (
                          <span className="text-[11px] text-gray-400 italic">No notes provided</span>
                        )}
                        {b.adminRemarks && !isEditingRemarks && (
                          <div className="text-[10.5px] text-emerald-800 bg-emerald-50 px-2 py-1 rounded border border-emerald-200">
                            <strong>Admin Note:</strong> {b.adminRemarks}
                          </div>
                        )}
                        {isEditingRemarks && (
                          <div className="flex items-center gap-1 mt-1">
                            <input
                              type="text"
                              value={remarksInput}
                              onChange={(e) => setRemarksInput(e.target.value)}
                              placeholder="Add admin note..."
                              className="px-2 py-1 bg-white border border-gray-300 rounded text-xs flex-1"
                            />
                            <button
                              onClick={() => handleSaveRemarks(b.id)}
                              disabled={isUpdating}
                              className="px-2 py-1 bg-[#C8A45D] text-black font-bold text-xs rounded cursor-pointer"
                            >
                              Save
                            </button>
                            <button
                              onClick={() => setEditingRemarksId(null)}
                              className="px-2 py-1 bg-gray-200 text-gray-700 text-xs rounded cursor-pointer"
                            >
                              Cancel
                            </button>
                          </div>
                        )}
                      </td>

                      {/* 9. Current Status (Booked, Completed, Rescheduled) */}
                      <td className="py-3.5 px-4 text-center align-top">
                        <select
                          value={normalizedStatus}
                          disabled={isUpdating}
                          onChange={(e) =>
                            handleStatusChange(b.id, e.target.value as FreeSlotStatus)
                          }
                          className={`text-xs font-bold px-3 py-1.5 rounded-xl border cursor-pointer transition-all shadow-xs ${
                            normalizedStatus === 'completed'
                              ? 'bg-blue-100 text-blue-800 border-blue-300'
                              : normalizedStatus === 'rescheduled'
                              ? 'bg-purple-100 text-purple-800 border-purple-300'
                              : 'bg-amber-100 text-amber-900 border-amber-300'
                          }`}
                        >
                          <option value="booked">Booked</option>
                          <option value="completed">Completed</option>
                          <option value="rescheduled">Rescheduled</option>
                        </select>
                        {isUpdating && (
                          <div className="text-[9px] text-gray-400 mt-1">Updating...</div>
                        )}
                      </td>

                      {/* Actions: Direct WhatsApp, Email & Delete */}
                      <td className="py-3.5 px-4 text-right align-top">
                        <div className="flex flex-col gap-1.5 items-end">
                          <button
                            onClick={() => openWhatsApp(b)}
                            className="w-full max-w-[160px] px-2.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-montserrat font-bold transition-all flex items-center justify-center gap-1.5 shadow-sm cursor-pointer"
                            title="Chat with candidate on WhatsApp"
                          >
                            <MessageSquare className="w-3.5 h-3.5" />
                            <span>WhatsApp Chat</span>
                          </button>

                          <button
                            onClick={() => openGmail(b)}
                            className="w-full max-w-[160px] px-2.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-montserrat font-bold transition-all flex items-center justify-center gap-1.5 shadow-sm cursor-pointer"
                            title="Send confirmation email via Gmail"
                          >
                            <Mail className="w-3.5 h-3.5" />
                            <span>Email Student</span>
                          </button>

                          <div className="flex items-center gap-1 pt-0.5">
                            <button
                              onClick={() => {
                                setEditingRemarksId(b.id);
                                setRemarksInput(b.adminRemarks || '');
                              }}
                              className="px-2 py-0.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded text-[11px] transition-colors cursor-pointer border border-gray-200"
                              title="Edit Remarks"
                            >
                              Remarks
                            </button>
                            <button
                              onClick={() => setBookingToDelete(b)}
                              className="p-1 bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 rounded transition-colors cursor-pointer"
                              title="Delete Booking Record"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
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

      {/* Delete Confirmation Modal */}
      {bookingToDelete && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-red-200 space-y-4">
            <div className="flex items-center gap-3 text-red-600">
              <div className="w-10 h-10 rounded-xl bg-red-100 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5 text-red-600" />
              </div>
              <div>
                <h3 className="font-bold text-gray-900 text-base">Delete Free Session Booking</h3>
                <p className="text-xs text-gray-500">This will remove the booking from the database.</p>
              </div>
            </div>

            <div className="p-3 bg-gray-50 rounded-xl border border-gray-200 text-xs space-y-1">
              <div><span className="font-semibold text-gray-700">Student:</span> {bookingToDelete.name}</div>
              <div><span className="font-semibold text-gray-700">Phone:</span> {bookingToDelete.phone}</div>
              <div><span className="font-semibold text-gray-700">Target Exam:</span> {bookingToDelete.program}</div>
              <div><span className="font-semibold text-gray-700">Slot:</span> {bookingToDelete.preferredSlot}</div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setBookingToDelete(null)}
                className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold rounded-xl text-xs transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleDeleteBooking(bookingToDelete.id)}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-semibold rounded-xl text-xs transition-colors cursor-pointer flex items-center gap-1.5"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Confirm Delete</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
