import ContactForm from '../models/ContactForm.js';

export const createContactForm = async (req, res) => {
  try {
    const { name, telegram, email, message } = req.body;
    if (!name || !telegram || !message) {
      return res.status(400).json({ message: 'Поля имя, telegram и сообщение обязательны' });
    }
    const form = await ContactForm.create({ name, telegram, email: email || '', message });
    res.status(201).json(form);
  } catch (error) {
    res.status(500).json({ message: error.message || 'Error creating contact form' });
  }
};

export const getContactForms = async (req, res) => {
  try {
    const { page = 1, limit = 20, search = '', status = '', startDate, endDate } = req.query;
    const query = {};

    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { telegram: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } }
      ];
    }

    if (status) query.status = status;

    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        query.createdAt.$lte = end;
      }
    }

    const skip = (page - 1) * limit;
    const forms = await ContactForm.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));
    const total = await ContactForm.countDocuments(query);
    res.json({ forms, total, pages: Math.ceil(total / limit) });
  } catch (error) {
    res.status(500).json({ message: 'Error fetching contact forms' });
  }
};

export const updateContactFormStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    if (!['Pending', 'Answered'].includes(status)) {
      return res.status(400).json({ message: 'Invalid status' });
    }
    const form = await ContactForm.findByIdAndUpdate(id, { status }, { new: true });
    if (!form) return res.status(404).json({ message: 'Contact form not found' });
    res.json(form);
  } catch (error) {
    res.status(500).json({ message: 'Error updating contact form' });
  }
};

export const deleteContactForm = async (req, res) => {
  try {
    await ContactForm.findByIdAndDelete(req.params.id);
    res.json({ message: 'Contact form deleted' });
  } catch (error) {
    res.status(500).json({ message: 'Error deleting contact form' });
  }
};
