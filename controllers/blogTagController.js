import BlogTag from '../models/BlogTag.js';

export const getBlogTags = async (req, res) => {
  try {
    const tags = await BlogTag.find().sort({ createdAt: -1 });
    res.json(tags);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching blog tags' });
  }
};

export const createBlogTag = async (req, res) => {
  try {
    const name = {
      ru: req.body['name.ru'] || req.body.name?.ru || '',
      en: req.body['name.en'] || req.body.name?.en || ''
    };
    const tag = await BlogTag.create({ name });
    res.status(201).json(tag);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error creating blog tag' });
  }
};

export const updateBlogTag = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = {};
    const nameRu = req.body['name.ru'] || req.body.name?.ru;
    const nameEn = req.body['name.en'] || req.body.name?.en;
    if (nameRu || nameEn) {
      updateData.name = { ru: nameRu || '', en: nameEn || '' };
    }
    const tag = await BlogTag.findByIdAndUpdate(id, updateData, { returnDocument: 'after' });
    res.json(tag);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error updating blog tag' });
  }
};

export const deleteBlogTag = async (req, res) => {
  try {
    await BlogTag.findByIdAndDelete(req.params.id);
    res.json({ message: 'Blog tag deleted' });
  } catch (error) {
    res.status(500).json({ message: 'Error deleting blog tag' });
  }
};
