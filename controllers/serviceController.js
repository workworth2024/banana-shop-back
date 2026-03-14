import Service from '../models/Service.js';

export const getServices = async (req, res) => {
  try {
    const { page = 1, limit = 10, search = '', filter, startDate, endDate } = req.query;
    const query = {};
    
    if (search) {
      query.$or = [
        { 'title.ru': { $regex: search, $options: 'i' } },
        { 'title.en': { $regex: search, $options: 'i' } },
        { 'sub_title.ru': { $regex: search, $options: 'i' } },
        { 'sub_title.en': { $regex: search, $options: 'i' } }
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
    const services = await Service.find(query)
      .populate('filter_id')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));
    
    const total = await Service.countDocuments(query);

    res.json({ services, total, pages: Math.ceil(total / limit) });
  } catch (error) {
    res.status(500).json({ message: 'Error fetching services' });
  }
};

export const createService = async (req, res) => {
  try {
    const { price } = req.body;
    const title = {
      ru: req.body['title.ru'] || '',
      en: req.body['title.en'] || ''
    };
    const sub_title = {
      ru: req.body['sub_title.ru'] || '',
      en: req.body['sub_title.en'] || ''
    };
    const desc = {
      ru: req.body['desc.ru'] || '',
      en: req.body['desc.en'] || ''
    };
    const sub_desc = {
      ru: req.body['sub_desc.ru'] || '',
      en: req.body['sub_desc.en'] || ''
    };
    const path_image = req.file ? `/uploads/${req.file.filename}` : '';
    const link = req.body.link || '';
    const necessary_data = {
      ru: req.body['necessary_data.ru'] || '',
      en: req.body['necessary_data.en'] || ''
    };
    const implementation_period = {
      ru: req.body['implementation_period.ru'] || '',
      en: req.body['implementation_period.en'] || ''
    };
    
    const serviceData = { title, sub_title, desc, sub_desc, price, path_image, link, necessary_data, implementation_period };
    const filterId = req.body.filter_id;
    if (filterId && filterId.trim()) {
      serviceData.filter_id = filterId;
    }
    
    const service = await Service.create(serviceData);
    res.status(201).json(service);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error creating service' });
  }
};

export const updateService = async (req, res) => {
  try {
    const { id } = req.params;
    const { price } = req.body;
    const updateData = {
      price,
      link: req.body.link || '',
      necessary_data: {
        ru: req.body['necessary_data.ru'] || '',
        en: req.body['necessary_data.en'] || ''
      },
      implementation_period: {
        ru: req.body['implementation_period.ru'] || '',
        en: req.body['implementation_period.en'] || ''
      }
    };
    
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
    if (req.body['sub_title.ru'] || req.body['sub_title.en']) {
      updateData.sub_title = {
        ru: req.body['sub_title.ru'] || '',
        en: req.body['sub_title.en'] || ''
      };
    }
    if (req.body['desc.ru'] || req.body['desc.en']) {
      updateData.desc = {
        ru: req.body['desc.ru'] || '',
        en: req.body['desc.en'] || ''
      };
    }
    if (req.body['sub_desc.ru'] || req.body['sub_desc.en']) {
      updateData.sub_desc = {
        ru: req.body['sub_desc.ru'] || '',
        en: req.body['sub_desc.en'] || ''
      };
    }
    
    if (req.file) updateData.path_image = `/uploads/${req.file.filename}`;
    
    const service = await Service.findByIdAndUpdate(id, updateData, { new: true });
    res.json(service);
  } catch (error) {
    res.status(500).json({ message: 'Error updating service' });
  }
};

export const deleteService = async (req, res) => {
  try {
    await Service.findByIdAndDelete(req.params.id);
    res.json({ message: 'Service deleted' });
  } catch (error) {
    res.status(500).json({ message: 'Error deleting service' });
  }
};
