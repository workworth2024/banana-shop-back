import Manual from '../models/Manual.js';

export const getManuals = async (req, res) => {
  try {
    const { page = 1, limit = 10, search = '', filter, startDate, endDate } = req.query;
    const query = {};
    
    if (search) {
      query.$or = [
        { 'title.ru': { $regex: search, $options: 'i' } },
        { 'title.en': { $regex: search, $options: 'i' } },
        { 'desc.ru': { $regex: search, $options: 'i' } },
        { 'desc.en': { $regex: search, $options: 'i' } }
      ];
    }
    
    if (filter) query.filter_id = filter;

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
    const manuals = await Manual.find(query)
      .populate('filter_id')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));
    
    const total = await Manual.countDocuments(query);

    res.json({ manuals, total, pages: Math.ceil(total / limit) });
  } catch (error) {
    res.status(500).json({ message: 'Error fetching manuals' });
  }
};

export const createManual = async (req, res) => {
  try {
    const { link } = req.body;
    const title = {
      ru: req.body['title.ru'] || '',
      en: req.body['title.en'] || ''
    };
    const desc = {
      ru: req.body['desc.ru'] || '',
      en: req.body['desc.en'] || ''
    };
    const path_to_file = req.file ? `/uploads/manuals/${req.file.filename}` : '';
    
    const manualData = { title, desc, link, path_to_file };
    const filterId = req.body.filter_id;
    if (filterId && filterId.trim()) {
      manualData.filter_id = filterId;
    }
    
    const manual = await Manual.create(manualData);
    res.status(201).json(manual);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error creating manual' });
  }
};

export const updateManual = async (req, res) => {
  try {
    const { id } = req.params;
    const { link } = req.body;
    const updateData = { link };
    
    const filterId = req.body.filter_id;
    if (filterId && filterId.trim()) {
      updateData.filter_id = filterId;
    } else {
      updateData.filter_id = null;
    }
    
    if (req.body['title.ru'] || req.body['title.en']) {
      updateData.title = {
        ru: req.body['title.ru'] || '',
        en: req.body['title.en'] || ''
      };
    }
    if (req.body['desc.ru'] || req.body['desc.en']) {
      updateData.desc = {
        ru: req.body['desc.ru'] || '',
        en: req.body['desc.en'] || ''
      };
    }
    
    if (req.file) updateData.path_to_file = `/uploads/manuals/${req.file.filename}`;
    const manual = await Manual.findByIdAndUpdate(id, updateData, { new: true });
    res.json(manual);
  } catch (error) {
    res.status(500).json({ message: 'Error updating manual' });
  }
};

export const deleteManual = async (req, res) => {
  try {
    await Manual.findByIdAndDelete(req.params.id);
    res.json({ message: 'Manual deleted' });
  } catch (error) {
    res.status(500).json({ message: 'Error deleting manual' });
  }
};
