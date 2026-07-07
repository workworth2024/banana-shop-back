import Template from '../models/Template.js';

const buildMultilingual = (body, field) => ({
  ru: body[`${field}.ru`] || body[field]?.ru || '',
  en: body[`${field}.en`] || body[field]?.en || ''
});

export const getTemplates = async (req, res) => {
  try {
    const templates = await Template.find().sort({ createdAt: -1 });
    res.json(templates);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching templates' });
  }
};

export const createTemplate = async (req, res) => {
  try {
    const title = buildMultilingual(req.body, 'title');
    const content = buildMultilingual(req.body, 'content');
    const template = await Template.create({ title, content });
    res.status(201).json(template);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error creating template' });
  }
};

export const updateTemplate = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = {};
    const title = buildMultilingual(req.body, 'title');
    if (title.ru || title.en) updateData.title = title;
    const content = buildMultilingual(req.body, 'content');
    if (content.ru || content.en) updateData.content = content;
    const template = await Template.findByIdAndUpdate(id, updateData, { returnDocument: 'after' });
    res.json(template);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error updating template' });
  }
};

export const deleteTemplate = async (req, res) => {
  try {
    await Template.findByIdAndDelete(req.params.id);
    res.json({ message: 'Template deleted' });
  } catch (error) {
    res.status(500).json({ message: 'Error deleting template' });
  }
};
