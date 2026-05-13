import ManualTag from '../models/ManualTag.js';

export const getManualTags = async (req, res) => {
  try {
    const tags = await ManualTag.find().sort({ createdAt: -1 });
    res.json(tags);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching manual tags' });
  }
};

export const createManualTag = async (req, res) => {
  try {
    const name = {
      ru: req.body['name.ru'] || req.body.name?.ru || '',
      en: req.body['name.en'] || req.body.name?.en || ''
    };
    const tag = await ManualTag.create({ name });
    res.status(201).json(tag);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error creating manual tag' });
  }
};

export const updateManualTag = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = {};
    const nameRu = req.body['name.ru'] || req.body.name?.ru;
    const nameEn = req.body['name.en'] || req.body.name?.en;
    if (nameRu || nameEn) {
      updateData.name = { ru: nameRu || '', en: nameEn || '' };
    }
    const tag = await ManualTag.findByIdAndUpdate(id, updateData, { returnDocument: 'after' });
    res.json(tag);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error updating manual tag' });
  }
};

export const deleteManualTag = async (req, res) => {
  try {
    await ManualTag.findByIdAndDelete(req.params.id);
    res.json({ message: 'Manual tag deleted' });
  } catch (error) {
    res.status(500).json({ message: 'Error deleting manual tag' });
  }
};
