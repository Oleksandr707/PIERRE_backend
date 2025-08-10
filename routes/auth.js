const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const User = require('../models/User');

// Register new user
router.post('/register', async (req, res) => {
  try {
    const {
      email,
      password
    } = req.body;

    console.log('=== Registration Attempt ===');
    console.log('Request body:', { email });

    if (!email || !password) {
      console.log('Missing required fields');
      return res.status(400).json({ 
        message: 'Missing required fields',
        received: { email: !!email, password: !!password }
      });
    }

    // Check if email exists
    const existingEmail = await User.findOne({ email });
    console.log('Email check result:', existingEmail ? 'Email exists' : 'Email available');
    
    if (existingEmail) {
      return res.status(400).json({ message: 'Email already registered' });
    }

    // Create new user
    const user = new User({
      email,
      password,
      level: 1,
      xp: 0,
      spark: 0
    });

    console.log('Attempting to save user...');
    const savedUser = await user.save();
    console.log('User saved successfully:', { 
      id: savedUser._id,
      email: savedUser.email
    });

    // Create JWT token
    const token = jwt.sign(
      { userId: savedUser._id },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.status(201).json({
      token,
      user: {
        id: savedUser._id,
        email: savedUser.email,
        username: savedUser.username,
        role: savedUser.role,
        membershipType: savedUser.membershipType,
        membershipStatus: savedUser.membershipStatus,
        level: savedUser.level,
        xp: savedUser.xp,
        spark: savedUser.spark,
        guild: savedUser.guild,
        guildRole: savedUser.guildRole
      }
    });
  } catch (error) {
    console.error('=== Registration Error ===');
    console.error('Error details:', error);
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);
    res.status(500).json({ 
      message: 'Server error', 
      error: error.message,
      details: error.toString()
    });
  }
});

// Login user
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    // Check if user exists
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    // Check password
    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    // Create JWT token
    const token = jwt.sign(
      { userId: user._id },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({
      token,
      user: {
        id: user._id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        membershipType: user.membershipType,
        membershipStatus: user.membershipStatus,
        level: user.level,
        xp: user.xp,
        spark: user.spark,
        guild: user.guild,
        guildRole: user.guildRole
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Setup username
router.post('/setup-username', async (req, res) => {
  try {
    const { username } = req.body;
    const token = req.header('Authorization')?.replace('Bearer ', '');

    if (!token) {
      return res.status(401).json({ message: 'No token, authorization denied' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.userId);

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Check if username is taken
    const existingUsername = await User.findOne({ username });
    if (existingUsername) {
      return res.status(400).json({ message: 'Username already taken' });
    }

    user.username = username;
    await user.save();

    res.json({ message: 'Username set successfully' });
  } catch (error) {
    console.error('Username setup error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Setup climbing level
router.post('/setup-level', async (req, res) => {
  try {
    const { climbingLevel } = req.body;
    const token = req.header('Authorization')?.replace('Bearer ', '');

    if (!token) {
      return res.status(401).json({ message: 'No token, authorization denied' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.userId);

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    user.climbingLevel = climbingLevel;
    await user.save();

    res.json({ message: 'Climbing level set successfully' });
  } catch (error) {
    console.error('Level setup error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router; 