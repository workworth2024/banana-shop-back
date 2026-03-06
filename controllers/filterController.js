import Filter from '../models/Filter.js';

export const getFilters = async (req, res) => {
  try {
    const filters = await Filter.find().sort({ createdAt: -1 });
    res.json(filters);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching filters' });
  }
};

export const createFilter = async (req, res) => {
  try {
    const { color } = req.body;
    const name = {
      ru: req.body['name.ru'] || '',
      en: req.body['name.en'] || ''
    };
    
    const filter = await Filter.create({ name, color });
    res.status(201).json(filter);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error creating filter' });
  }
};

export const updateFilter = async (req, res) => {
  try {
    const { id } = req.params;
    const { color } = req.body;
    const updateData = { color };
    
    if (req.body['name.ru'] || req.body['name.en']) {
      updateData.name = {
        ru: req.body['name.ru'] || '',
        en: req.body['name.en'] || ''
      };
    }
    
    const filter = await Filter.findByIdAndUpdate(id, updateData, { new: true });
    res.json(filter);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error updating filter' });
  }
};

export const deleteFilter = async (req, res) => {
  try {
    const { id } = req.params;
    await Filter.findByIdAndDelete(id);
    res.json({ message: 'Filter deleted' });
  } catch (error) {
    res.status(500).json({ message: 'Error deleting filter' });
  }
};
