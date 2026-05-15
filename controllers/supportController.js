import SupportTicket from '../models/SupportTicket.js';
import SupportMessage from '../models/SupportMessage.js';
import CustomerUser from '../models/CustomerUser.js';
import User from '../models/User.js';
import { io, onlineCustomers } from '../server.js';
import { bunnyUpload, generateFilename, getBunnyPublicUrl } from '../utils/bunnyStorage.js';
import { createAdminNotif } from './adminNotifController.js';

const TEXT_MAX = 4000;
const SUBJECT_MAX = 200;
const PREVIEW_LEN = 140;

const safeStr = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const isObjId = (v) => typeof v === 'string' && /^[a-f0-9]{24}$/i.test(v);

const ticketRoom = (id) => `ticket:${id}`;
const STAFF_ROOM = 'support:staff';
const customerRoom = (id) => `customer:${id}`;

const buildPreview = (text, attachments) => {
  if (text) return text.replace(/\s+/g, ' ').slice(0, PREVIEW_LEN);
  if (attachments?.length) {
    const img = attachments.filter(a => a.kind === 'image').length;
    const file = attachments.length - img;
    const parts = [];
    if (img) parts.push(`📷 ${img}`);
    if (file) parts.push(`📎 ${file}`);
    return parts.join(' ');
  }
  return '';
};

const populateTicketForList = (q) =>
  q.populate({ path: 'customerId', select: 'uid username email language lastSeen' })
   .populate({ path: 'assignedTo', select: 'name email' });

const emitTicketUpdate = (ticket) => {
  const payload = ticket.toObject ? ticket.toObject() : ticket;
  io.of('/support').to(STAFF_ROOM).emit('ticket:updated', { ticket: payload });
  io.of('/support').to(customerRoom(payload.customerId?._id || payload.customerId)).emit('ticket:updated', { ticket: payload });
  io.of('/support').to(ticketRoom(payload._id)).emit('ticket:updated', { ticket: payload });
};

const uploadAttachments = async (ticketUid, files) => {
  if (!files?.length) return [];
  const out = [];
  for (const f of files) {
    const filename = generateFilename(f.originalname);
    const remotePath = `/support/${ticketUid}/${filename}`;
    await bunnyUpload(remotePath, f.buffer, f.mimetype);
    out.push({
      url: getBunnyPublicUrl(remotePath),
      name: f.originalname,
      size: f.size,
      mime: f.mimetype,
      kind: f.mimetype.startsWith('image/') ? 'image' : 'file'
    });
  }
  return out;
};

/* =====================  CUSTOMER  ===================== */

export const customerListTickets = async (req, res) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const q = { customerId: req.customer._id };
    if (status && ['open', 'pending', 'closed'].includes(status)) q.status = status;
    const skip = (Number(page) - 1) * Number(limit);
    const [items, total] = await Promise.all([
      SupportTicket.find(q).sort({ lastMessageAt: -1 }).skip(skip).limit(Number(limit)).lean(),
      SupportTicket.countDocuments(q)
    ]);
    res.json({ items, total, pages: Math.ceil(total / Number(limit)) });
  } catch (e) {
    console.error('[support] customerListTickets', e);
    res.status(500).json({ message: 'Server error' });
  }
};

export const customerGetTicket = async (req, res) => {
  try {
    const ticket = await SupportTicket.findOne({ _id: req.params.id, customerId: req.customer._id }).lean();
    if (!ticket) return res.status(404).json({ message: 'Ticket not found' });
    const messages = await SupportMessage.find({ ticketId: ticket._id, deletedAt: null })
      .sort({ createdAt: -1 }).limit(50).lean();
    messages.reverse();
    res.json({ ticket, messages });
  } catch (e) {
    console.error('[support] customerGetTicket', e);
    res.status(500).json({ message: 'Server error' });
  }
};

export const customerGetMessages = async (req, res) => {
  try {
    const ticket = await SupportTicket.findOne({ _id: req.params.id, customerId: req.customer._id }).select('_id').lean();
    if (!ticket) return res.status(404).json({ message: 'Ticket not found' });
    const { before, limit = 30 } = req.query;
    const q = { ticketId: ticket._id, deletedAt: null };
    if (before) q.createdAt = { $lt: new Date(before) };
    const messages = await SupportMessage.find(q).sort({ createdAt: -1 }).limit(Math.min(Number(limit), 100)).lean();
    messages.reverse();
    res.json({ messages });
  } catch (e) {
    console.error('[support] customerGetMessages', e);
    res.status(500).json({ message: 'Server error' });
  }
};

export const customerCreateTicket = async (req, res) => {
  try {
    const subject = safeStr(req.body.subject, SUBJECT_MAX) || 'Support request';
    const text = safeStr(req.body.text, TEXT_MAX);
    const attachments = await uploadAttachments('new', req.files || []);
    if (!text && attachments.length === 0) {
      return res.status(400).json({ message: 'Empty message' });
    }
    const ticket = await SupportTicket.create({
      customerId: req.customer._id,
      subject,
      status: 'open',
      lastMessageAt: new Date(),
      lastMessagePreview: buildPreview(text, attachments),
      lastMessageBy: 'customer',
      unreadByStaff: 1,
      meta: { ip: req.ip, ua: req.headers['user-agent']?.slice(0, 200) }
    });
    const message = await SupportMessage.create({
      ticketId: ticket._id,
      senderRole: 'customer',
      senderId: req.customer._id,
      senderName: req.customer.username,
      text,
      attachments
    });
    const populated = await populateTicketForList(SupportTicket.findById(ticket._id)).lean();
    io.of('/support').to(STAFF_ROOM).emit('ticket:created', { ticket: populated });
    io.of('/support').to(customerRoom(req.customer._id)).emit('ticket:created', { ticket: populated });
    io.of('/support').to(ticketRoom(ticket._id)).emit('message:new', { message: message.toObject() });
    io.of('/support').to(STAFF_ROOM).emit('message:new', { message: message.toObject() });

    createAdminNotif({
      category: 'support',
      type: 'support_new_ticket',
      title: 'New support ticket',
      message: `${req.customer.username}: ${ticket.lastMessagePreview || subject}`,
      link: `/support?ticket=${ticket._id}`,
      meta: { ticketId: ticket._id, customerId: req.customer._id }
    }).catch(() => {});

    res.status(201).json({ ticket: populated, message });
  } catch (e) {
    console.error('[support] customerCreateTicket', e);
    res.status(500).json({ message: 'Server error' });
  }
};

export const customerSendMessage = async (req, res) => {
  try {
    const ticket = await SupportTicket.findOne({ _id: req.params.id, customerId: req.customer._id });
    if (!ticket) return res.status(404).json({ message: 'Ticket not found' });
    if (ticket.status === 'closed') return res.status(409).json({ message: 'Ticket is closed' });

    const text = safeStr(req.body.text, TEXT_MAX);
    const attachments = await uploadAttachments(ticket.uid, req.files || []);
    if (!text && attachments.length === 0) return res.status(400).json({ message: 'Empty message' });

    const message = await SupportMessage.create({
      ticketId: ticket._id,
      senderRole: 'customer',
      senderId: req.customer._id,
      senderName: req.customer.username,
      text,
      attachments
    });

    ticket.lastMessageAt = message.createdAt;
    ticket.lastMessagePreview = buildPreview(text, attachments);
    ticket.lastMessageBy = 'customer';
    ticket.unreadByStaff = (ticket.unreadByStaff || 0) + 1;
    if (ticket.status === 'pending') ticket.status = 'open';
    await ticket.save();

    const populated = await populateTicketForList(SupportTicket.findById(ticket._id)).lean();
    io.of('/support').to(ticketRoom(ticket._id)).emit('message:new', { message: message.toObject() });
    io.of('/support').to(STAFF_ROOM).emit('message:new', { message: message.toObject() });
    emitTicketUpdate(populated);

    res.status(201).json({ message });
  } catch (e) {
    console.error('[support] customerSendMessage', e);
    res.status(500).json({ message: 'Server error' });
  }
};

export const customerMarkRead = async (req, res) => {
  try {
    const ticket = await SupportTicket.findOne({ _id: req.params.id, customerId: req.customer._id });
    if (!ticket) return res.status(404).json({ message: 'Ticket not found' });
    if (ticket.unreadByCustomer > 0) {
      ticket.unreadByCustomer = 0;
      await ticket.save();
    }
    await SupportMessage.updateMany(
      { ticketId: ticket._id, senderRole: 'staff', readByCustomerAt: null },
      { $set: { readByCustomerAt: new Date() } }
    );
    const populated = await populateTicketForList(SupportTicket.findById(ticket._id)).lean();
    emitTicketUpdate(populated);
    io.of('/support').to(ticketRoom(ticket._id)).emit('ticket:read', {
      ticketId: String(ticket._id), by: 'customer', at: new Date()
    });
    res.json({ ok: true });
  } catch (e) {
    console.error('[support] customerMarkRead', e);
    res.status(500).json({ message: 'Server error' });
  }
};

export const customerActiveTickets = async (req, res) => {
  try {
    const items = await SupportTicket.find({
      customerId: req.customer._id,
      status: { $in: ['open', 'pending'] }
    }).sort({ lastMessageAt: -1 }).lean();
    res.json({ items });
  } catch (e) {
    console.error('[support] customerActiveTickets', e);
    res.status(500).json({ message: 'Server error' });
  }
};

/* =====================  STAFF  ===================== */

export const staffListTickets = async (req, res) => {
  try {
    const { status, q, from, to, page = 1, limit = 30 } = req.query;
    const filter = {};
    if (status && ['open', 'pending', 'closed'].includes(status)) filter.status = status;
    if (from || to) {
      filter.lastMessageAt = {};
      if (from) filter.lastMessageAt.$gte = new Date(from);
      if (to) filter.lastMessageAt.$lte = new Date(to);
    }

    if (q && typeof q === 'string') {
      const safe = q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const customers = await CustomerUser.find({
        $or: [
          { username: { $regex: safe, $options: 'i' } },
          { email: { $regex: safe, $options: 'i' } },
          { uid: { $regex: safe, $options: 'i' } }
        ]
      }).select('_id').limit(50).lean();
      filter.customerId = { $in: customers.map(c => c._id) };
    }

    const skip = (Number(page) - 1) * Number(limit);
    const [items, total, openCount] = await Promise.all([
      populateTicketForList(SupportTicket.find(filter).sort({ lastMessageAt: -1 }).skip(skip).limit(Number(limit))).lean(),
      SupportTicket.countDocuments(filter),
      SupportTicket.countDocuments({ status: { $in: ['open', 'pending'] } })
    ]);

    const withOnline = items.map(t => ({
      ...t,
      customerOnline: onlineCustomers.has(String(t.customerId?._id || t.customerId))
    }));

    res.json({ items: withOnline, total, pages: Math.ceil(total / Number(limit)), openCount });
  } catch (e) {
    console.error('[support] staffListTickets', e);
    res.status(500).json({ message: 'Server error' });
  }
};

export const staffGetTicket = async (req, res) => {
  try {
    const ticket = await populateTicketForList(SupportTicket.findById(req.params.id)).lean();
    if (!ticket) return res.status(404).json({ message: 'Ticket not found' });
    const messages = await SupportMessage.find({ ticketId: ticket._id, deletedAt: null })
      .sort({ createdAt: -1 }).limit(50).lean();
    messages.reverse();
    ticket.customerOnline = onlineCustomers.has(String(ticket.customerId?._id || ticket.customerId));
    res.json({ ticket, messages });
  } catch (e) {
    console.error('[support] staffGetTicket', e);
    res.status(500).json({ message: 'Server error' });
  }
};

export const staffGetMessages = async (req, res) => {
  try {
    const { before, limit = 30 } = req.query;
    const q = { ticketId: req.params.id, deletedAt: null };
    if (before) q.createdAt = { $lt: new Date(before) };
    const messages = await SupportMessage.find(q).sort({ createdAt: -1 }).limit(Math.min(Number(limit), 100)).lean();
    messages.reverse();
    res.json({ messages });
  } catch (e) {
    console.error('[support] staffGetMessages', e);
    res.status(500).json({ message: 'Server error' });
  }
};

export const staffSendMessage = async (req, res) => {
  try {
    const ticket = await SupportTicket.findById(req.params.id);
    if (!ticket) return res.status(404).json({ message: 'Ticket not found' });
    if (ticket.status === 'closed') return res.status(409).json({ message: 'Ticket is closed' });

    const text = safeStr(req.body.text, TEXT_MAX);
    const attachments = await uploadAttachments(ticket.uid, req.files || []);
    if (!text && attachments.length === 0) return res.status(400).json({ message: 'Empty message' });

    const message = await SupportMessage.create({
      ticketId: ticket._id,
      senderRole: 'staff',
      senderId: req.user._id,
      senderName: req.user.name || 'Support',
      text,
      attachments
    });

    ticket.lastMessageAt = message.createdAt;
    ticket.lastMessagePreview = buildPreview(text, attachments);
    ticket.lastMessageBy = 'staff';
    ticket.unreadByCustomer = (ticket.unreadByCustomer || 0) + 1;
    ticket.status = 'pending';
    if (!ticket.assignedTo) ticket.assignedTo = req.user._id;
    await ticket.save();

    const populated = await populateTicketForList(SupportTicket.findById(ticket._id)).lean();
    io.of('/support').to(ticketRoom(ticket._id)).emit('message:new', { message: message.toObject() });
    io.of('/support').to(STAFF_ROOM).emit('message:new', { message: message.toObject() });
    io.of('/support').to(customerRoom(ticket.customerId)).emit('message:new', { message: message.toObject() });
    emitTicketUpdate(populated);

    res.status(201).json({ message });
  } catch (e) {
    console.error('[support] staffSendMessage', e);
    res.status(500).json({ message: 'Server error' });
  }
};

export const staffAssign = async (req, res) => {
  try {
    const { userId } = req.body;
    const target = userId && isObjId(userId) ? userId : req.user._id;
    const ticket = await SupportTicket.findByIdAndUpdate(
      req.params.id,
      { $set: { assignedTo: target } },
      { new: true }
    );
    if (!ticket) return res.status(404).json({ message: 'Ticket not found' });
    const populated = await populateTicketForList(SupportTicket.findById(ticket._id)).lean();
    emitTicketUpdate(populated);
    res.json({ ticket: populated });
  } catch (e) {
    console.error('[support] staffAssign', e);
    res.status(500).json({ message: 'Server error' });
  }
};

export const staffClose = async (req, res) => {
  try {
    const ticket = await SupportTicket.findById(req.params.id);
    if (!ticket) return res.status(404).json({ message: 'Ticket not found' });
    if (ticket.status === 'closed') return res.json({ ok: true });

    ticket.status = 'closed';
    ticket.closedAt = new Date();
    ticket.closedBy = req.user._id;
    await ticket.save();

    const sysMsg = await SupportMessage.create({
      ticketId: ticket._id,
      senderRole: 'system',
      text: `Ticket closed by ${req.user.name || 'support'}`
    });

    const populated = await populateTicketForList(SupportTicket.findById(ticket._id)).lean();
    io.of('/support').to(ticketRoom(ticket._id)).emit('message:new', { message: sysMsg.toObject() });
    io.of('/support').to(ticketRoom(ticket._id)).emit('ticket:closed', { ticketId: String(ticket._id), by: req.user._id });
    io.of('/support').to(customerRoom(ticket.customerId)).emit('ticket:closed', { ticketId: String(ticket._id) });
    emitTicketUpdate(populated);
    res.json({ ticket: populated });
  } catch (e) {
    console.error('[support] staffClose', e);
    res.status(500).json({ message: 'Server error' });
  }
};

export const staffReopen = async (req, res) => {
  try {
    const ticket = await SupportTicket.findById(req.params.id);
    if (!ticket) return res.status(404).json({ message: 'Ticket not found' });
    ticket.status = 'open';
    ticket.closedAt = null;
    ticket.closedBy = null;
    await ticket.save();

    const sysMsg = await SupportMessage.create({
      ticketId: ticket._id,
      senderRole: 'system',
      text: `Ticket reopened by ${req.user.name || 'support'}`
    });

    const populated = await populateTicketForList(SupportTicket.findById(ticket._id)).lean();
    io.of('/support').to(ticketRoom(ticket._id)).emit('message:new', { message: sysMsg.toObject() });
    emitTicketUpdate(populated);
    res.json({ ticket: populated });
  } catch (e) {
    console.error('[support] staffReopen', e);
    res.status(500).json({ message: 'Server error' });
  }
};

export const staffMarkRead = async (req, res) => {
  try {
    const ticket = await SupportTicket.findById(req.params.id);
    if (!ticket) return res.status(404).json({ message: 'Ticket not found' });
    if (ticket.unreadByStaff > 0) {
      ticket.unreadByStaff = 0;
      await ticket.save();
    }
    await SupportMessage.updateMany(
      { ticketId: ticket._id, senderRole: 'customer', readByStaffAt: null },
      { $set: { readByStaffAt: new Date() } }
    );
    const populated = await populateTicketForList(SupportTicket.findById(ticket._id)).lean();
    emitTicketUpdate(populated);
    io.of('/support').to(ticketRoom(ticket._id)).emit('ticket:read', {
      ticketId: String(ticket._id), by: 'staff', at: new Date()
    });
    res.json({ ok: true });
  } catch (e) {
    console.error('[support] staffMarkRead', e);
    res.status(500).json({ message: 'Server error' });
  }
};

export const staffStats = async (req, res) => {
  try {
    const [open, pending, unread] = await Promise.all([
      SupportTicket.countDocuments({ status: 'open' }),
      SupportTicket.countDocuments({ status: 'pending' }),
      SupportTicket.aggregate([
        { $match: { status: { $in: ['open', 'pending'] } } },
        { $group: { _id: null, sum: { $sum: '$unreadByStaff' } } }
      ])
    ]);
    res.json({
      open, pending,
      unread: unread[0]?.sum || 0,
      activeTotal: open + pending
    });
  } catch (e) {
    console.error('[support] staffStats', e);
    res.status(500).json({ message: 'Server error' });
  }
};
