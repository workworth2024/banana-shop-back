import User from '../models/User.js';
import Role from '../models/Role.js';
import bcrypt from 'bcryptjs';

// Get all users with pagination, filtering and search
export const getUsers = async (req, res) => {
  try {
    const { page = 1, limit = 10, search = '', role, status, sortBy = 'createdAt', order = 'desc' } = req.query;

    const query = {};

    // Search by username or email
    if (search) {
      query.$or = [
        { username: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } }
      ];
    }

    // Filter by role
    if (role) {
      const roleDoc = await Role.findOne({ name: role });
      if (roleDoc) {
        query.role_id = roleDoc._id;
      }
    }

    // Filter by status
    if (status !== undefined && status !== '') {
      query.status = status === 'true';
    }

    const skip = (page - 1) * limit;
    const sortOptions = { [sortBy]: order === 'desc' ? -1 : 1 };

    const users = await User.find(query)
      .populate('role_id')
      .sort(sortOptions)
      .skip(skip)
      .limit(parseInt(limit))
      .select('-password');

    const total = await User.countDocuments(query);

    return res.status(200).json({
      users,
      total,
      pages: Math.ceil(total / limit),
      currentPage: parseInt(page)
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Ошибка при получении пользователей' });
  }
};

// Create a new user (Admin only)
export const createUser = async (req, res) => {
  try {
    const { username, email, password, role, status } = req.body;

    const userExists = await User.findOne({ $or: [{ username }, { email }] });
    if (userExists) {
      return res.status(400).json({ message: 'Пользователь уже существует' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const roleDoc = await Role.findOne({ name: role || 'new' });

    const newUser = await User.create({
      username,
      email,
      password: hashedPassword,
      role_id: roleDoc._id,
      status: status !== undefined ? status : true
    });

    const populatedUser = await User.findById(newUser._id).populate('role_id').select('-password');

    return res.status(201).json({
      message: 'Пользователь успешно создан',
      user: populatedUser
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Ошибка при создании пользователя' });
  }
};

// Update user (Admin only)
export const updateUser = async (req, res) => {
  try {
    const { id } = req.params;
    const { username, email, role, status, password } = req.body;

    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({ message: 'Пользователь не найден' });
    }

    const updateData = {};
    if (username) updateData.username = username;
    if (email) updateData.email = email;
    if (status !== undefined) updateData.status = status;
    
    if (role) {
      const roleDoc = await Role.findOne({ name: role });
      if (roleDoc) {
        updateData.role_id = roleDoc._id;
      }
    }

    if (password) {
      updateData.password = await bcrypt.hash(password, 10);
    }

    const updatedUser = await User.findByIdAndUpdate(id, updateData, { new: true })
      .populate('role_id')
      .select('-password');

    return res.status(200).json({
      message: 'Данные пользователя обновлены',
      user: updatedUser
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Ошибка при обновлении пользователя' });
  }
};

// Delete user (Admin only)
export const deleteUser = async (req, res) => {
  try {
    const { id } = req.params;
    const user = await User.findByIdAndDelete(id);
    if (!user) {
      return res.status(404).json({ message: 'Пользователь не найден' });
    }
    return res.status(200).json({ message: 'Пользователь удален' });
  } catch (error) {
    return res.status(500).json({ message: 'Ошибка при удалении пользователя' });
  }
};

// Get all roles
export const getRoles = async (req, res) => {
  try {
    const roles = await Role.find();
    return res.status(200).json(roles);
  } catch (error) {
    return res.status(500).json({ message: 'Ошибка при получении ролей' });
  }
};
