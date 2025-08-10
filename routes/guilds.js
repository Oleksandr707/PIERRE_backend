const express = require('express');
const router = express.Router();
const Guild = require('../models/Guild');
const User = require('../models/User');
const auth = require('../middleware/auth');

// Create a new guild
router.post('/', auth, async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ message: 'Guild name required' });
    // Check if name taken
    if (await Guild.findOne({ name })) return res.status(400).json({ message: 'Guild name already exists' });
    const guild = new Guild({ name, members: [req.userId], invites: [] });
    await guild.save();
    // Update user
    const user = await User.findById(req.userId);
    user.guild = guild._id;
    user.guildRole = 'owner';
    await user.save();
    res.status(201).json(guild);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// Join a guild
router.post('/:id/join', auth, async (req, res) => {
  try {
    const guild = await Guild.findById(req.params.id);
    if (!guild) return res.status(404).json({ message: 'Guild not found' });
    if (guild.members.includes(req.userId)) return res.status(400).json({ message: 'Already a member' });
    guild.members.push(req.userId);
    guild.invites = guild.invites.filter(id => id.toString() !== req.userId);
    await guild.save();
    // Update user
    const user = await User.findById(req.userId);
    user.guild = guild._id;
    user.guildRole = 'member';
    await user.save();
    res.json(guild);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// Invite a user to a guild
router.post('/:id/invite', auth, async (req, res) => {
  try {
    const { userId } = req.body;
    const guild = await Guild.findById(req.params.id);
    if (!guild) return res.status(404).json({ message: 'Guild not found' });
    if (!userId) return res.status(400).json({ message: 'userId required' });
    if (guild.invites.includes(userId) || guild.members.includes(userId)) return res.status(400).json({ message: 'User already invited or member' });
    guild.invites.push(userId);
    await guild.save();
    res.json({ message: 'User invited' });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// Leave a guild
router.post('/:id/leave', auth, async (req, res) => {
  try {
    const guild = await Guild.findById(req.params.id);
    if (!guild) return res.status(404).json({ message: 'Guild not found' });
    guild.members = guild.members.filter(id => id.toString() !== req.userId);
    await guild.save();
    // Update user
    const user = await User.findById(req.userId);
    user.guild = null;
    user.guildRole = null;
    await user.save();
    res.json({ message: 'Left guild' });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// Get a guild (with members and invites)
router.get('/:id', auth, async (req, res) => {
  try {
    const guild = await Guild.findById(req.params.id)
      .populate('members', 'username level xp spark')
      .populate('invites', 'username');
    if (!guild) return res.status(404).json({ message: 'Guild not found' });
    res.json(guild);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// List/search guilds
router.get('/', auth, async (req, res) => {
  try {
    const { q } = req.query;
    let query = {};
    if (q) query = { name: { $regex: q, $options: 'i' } };
    const guilds = await Guild.find(query).limit(20);
    res.json(guilds);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

module.exports = router; 