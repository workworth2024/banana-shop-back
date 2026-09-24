import PartnerTag from '../models/PartnerTag.js';

export const getPartnerTags = async (req, res) => {
  try {
    const tags = await PartnerTag.find().sort({ createdAt: -1 });
    res.json(tags);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching partner tags' });
  }
};

export const createPartnerTag = async (req, res) => {
  try {
    const name = {
      ru: req.body['name.ru'] || req.body.name?.ru || '',
      en: req.body['name.en'] || req.body.name?.en || ''
    };
    const tag = await PartnerTag.create({ name });
    res.status(201).json(tag);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error creating partner tag' });
  }
};

export const updatePartnerTag = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = {};
    const nameRu = req.body['name.ru'] || req.body.name?.ru;
    const nameEn = req.body['name.en'] || req.body.name?.en;
    if (nameRu || nameEn) {
      updateData.name = { ru: nameRu || '', en: nameEn || '' };
    }
    const tag = await PartnerTag.findByIdAndUpdate(id, updateData, { returnDocument: 'after' });
    res.json(tag);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error updating partner tag' });
  }
};

export const deletePartnerTag = async (req, res) => {
  try {
    await PartnerTag.findByIdAndDelete(req.params.id);
    res.json({ message: 'Partner tag deleted' });
  } catch (error) {
    res.status(500).json({ message: 'Error deleting partner tag' });
  }
};
