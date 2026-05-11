import Scenario from '../models/Scenario.js';

export const getScenarios = async (req, res) => {
  try {
    const { page = 1, limit = 50, search = '' } = req.query;
    const query = {};
    if (search) {
      const safe = String(search).slice(0, 100);
      query.$or = [
        { 'title.ru': { $regex: safe, $options: 'i' } },
        { 'title.en': { $regex: safe, $options: 'i' } }
      ];
    }
    const skip = (Number(page) - 1) * Number(limit);
    const [scenarios, total] = await Promise.all([
      Scenario.find(query).sort({ createdAt: -1 }).skip(skip).limit(Number(limit)),
      Scenario.countDocuments(query)
    ]);
    return res.json({ scenarios, total, pages: Math.ceil(total / Number(limit)) });
  } catch (err) {
    console.error('[Scenario] getScenarios error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

export const getScenarioById = async (req, res) => {
  try {
    const scenario = await Scenario.findById(req.params.id);
    if (!scenario) return res.status(404).json({ message: 'Scenario not found' });
    return res.json(scenario);
  } catch (err) {
    return res.status(500).json({ message: 'Server error' });
  }
};

export const createScenario = async (req, res) => {
  try {
    const { title, description, steps } = req.body;
    if (!title?.ru && !title?.en) return res.status(400).json({ message: 'Title required' });
    const scenario = await Scenario.create({ title, description, steps: steps || [] });
    return res.status(201).json(scenario);
  } catch (err) {
    console.error('[Scenario] createScenario error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

export const updateScenario = async (req, res) => {
  try {
    const { title, description, steps } = req.body;
    const scenario = await Scenario.findByIdAndUpdate(
      req.params.id,
      { title, description, steps },
      { new: true, runValidators: true }
    );
    if (!scenario) return res.status(404).json({ message: 'Scenario not found' });
    return res.json(scenario);
  } catch (err) {
    console.error('[Scenario] updateScenario error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

export const deleteScenario = async (req, res) => {
  try {
    const scenario = await Scenario.findByIdAndDelete(req.params.id);
    if (!scenario) return res.status(404).json({ message: 'Scenario not found' });
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ message: 'Server error' });
  }
};
