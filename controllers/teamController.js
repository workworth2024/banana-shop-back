import TeamMember from '../models/TeamMember.js';
import { bunnyUpload, generateFilename, getBunnyPublicUrl } from '../utils/bunnyStorage.js';
import { deleteAnyFile } from '../utils/deleteFile.js';

const deleteTeamPhoto = (photo) => {
  if (!photo) return;
  deleteAnyFile(photo);
};

const uploadTeamPhoto = async (file) => {
  const filename = generateFilename(file.originalname);
  const remotePath = `/team/${filename}`;
  await bunnyUpload(remotePath, file.buffer, file.mimetype);
  return getBunnyPublicUrl(remotePath);
};

/** CRM — full list, including hidden members. */
export const getTeamMembers = async (req, res) => {
  try {
    const members = await TeamMember.find({}).sort({ sortOrder: 1, createdAt: 1 });
    res.json({ members });
  } catch (error) {
    res.status(500).json({ message: 'Error fetching team members' });
  }
};

/** Public storefront — only active members, admin fields stripped. */
export const getPublicTeamMembers = async (req, res) => {
  try {
    const members = await TeamMember.find({ isActive: true })
      .select('name position photo socialLabel socialLink sortOrder')
      .sort({ sortOrder: 1, createdAt: 1 });
    res.json({ members });
  } catch (error) {
    res.status(500).json({ message: 'Error fetching team members' });
  }
};

export const createTeamMember = async (req, res) => {
  try {
    const name = String(req.body?.name || '').trim();
    if (!name) return res.status(400).json({ message: 'Имя обязательно' });

    const lastMember = await TeamMember.findOne({}).sort({ sortOrder: -1 }).select('sortOrder');
    const nextSortOrder = (lastMember?.sortOrder ?? -1) + 1;

    const member = await TeamMember.create({
      name,
      position: { ru: req.body?.['position.ru'] || '', en: req.body?.['position.en'] || '' },
      socialLabel: req.body?.socialLabel || '',
      socialLink: req.body?.socialLink || '',
      isActive: req.body?.isActive === undefined ? true : req.body.isActive === 'true' || req.body.isActive === true,
      photo: req.file ? await uploadTeamPhoto(req.file) : '',
      sortOrder: nextSortOrder
    });
    res.status(201).json(member);
  } catch (error) {
    console.error('createTeamMember error:', error.message, error.stack);
    res.status(500).json({ message: error.message || 'Error creating team member' });
  }
};

export const updateTeamMember = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = {
      name: String(req.body?.name || '').trim(),
      position: { ru: req.body?.['position.ru'] || '', en: req.body?.['position.en'] || '' },
      socialLabel: req.body?.socialLabel || '',
      socialLink: req.body?.socialLink || ''
    };
    if (req.body?.isActive !== undefined) {
      updateData.isActive = req.body.isActive === 'true' || req.body.isActive === true;
    }

    if (req.file) {
      const old = await TeamMember.findById(id).select('photo');
      deleteTeamPhoto(old?.photo);
      updateData.photo = await uploadTeamPhoto(req.file);
    }

    const member = await TeamMember.findByIdAndUpdate(id, updateData, { returnDocument: 'after' });
    if (!member) return res.status(404).json({ message: 'Team member not found' });
    res.json(member);
  } catch (error) {
    console.error('updateTeamMember error:', error.message, error.stack);
    res.status(500).json({ message: error.message || 'Error updating team member' });
  }
};

export const deleteTeamMember = async (req, res) => {
  try {
    const member = await TeamMember.findByIdAndDelete(req.params.id);
    deleteTeamPhoto(member?.photo);
    res.json({ message: 'Team member deleted' });
  } catch (error) {
    res.status(500).json({ message: 'Error deleting team member' });
  }
};

/** Bulk-reorders members — body: { ids: [id1, id2, ...] } in the desired display order. */
export const reorderTeamMembers = async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || !ids.length) {
      return res.status(400).json({ message: 'ids array required' });
    }
    await Promise.all(
      ids.map((id, index) => TeamMember.updateOne({ _id: id }, { $set: { sortOrder: index } }))
    );
    const members = await TeamMember.find({}).sort({ sortOrder: 1, createdAt: 1 });
    res.json({ members });
  } catch (error) {
    res.status(500).json({ message: 'Error reordering team members' });
  }
};
