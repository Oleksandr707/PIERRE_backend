const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Waiver = require('../models/Waiver');
const { authenticateToken } = require('../middleware/authMiddleware');

// Get user profile
router.get('/profile', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id || req.user._id;
    const user = await User.findById(userId).select('-password');
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    // Map _id to id for frontend compatibility
    const userResponse = {
      id: user._id,
      email: user.email,
      username: user.username,
      firstName: user.firstName,
      lastName: user.lastName,
      phoneNumber: user.phoneNumber,
      address: user.address,
      city: user.city,
      state: user.state,
      zipCode: user.zipCode,
      profilePhoto: user.profilePhoto,
      emergencyContact: user.emergencyContact,
      climbingLevel: user.climbingLevel,
      membershipType: user.membershipType,
      membershipStatus: user.membershipStatus,
      membershipStartDate: user.membershipStartDate,
      membershipEndDate: user.membershipEndDate,
      level: user.level,
      xp: user.xp,
      spark: user.spark,
      guild: user.guild,
      guildRole: user.guildRole,
      waiverStatus: user.waiverStatus,
      waiverSignedAt: user.waiverSignedAt
    };
    
    res.json(userResponse);
  } catch (error) {
    console.error('Profile fetch error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Update user profile
router.put('/profile', authenticateToken, async (req, res) => {
  try {
    const {
      firstName,
      lastName,
      phoneNumber,
      address,
      city,
      state,
      zipCode,
      profilePhoto,
      emergencyContact,
      climbingLevel
    } = req.body;

    const userId = req.user.userId || req.user.id || req.user._id;
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Update fields
    if (firstName) user.firstName = firstName;
    if (lastName) user.lastName = lastName;
    if (phoneNumber) user.phoneNumber = phoneNumber;
    if (address) user.address = address;
    if (city) user.city = city;
    if (state) user.state = state;
    if (zipCode) user.zipCode = zipCode;
    if (profilePhoto) user.profilePhoto = profilePhoto;
    if (emergencyContact) user.emergencyContact = emergencyContact;
    if (climbingLevel) user.climbingLevel = climbingLevel;

    user.updatedAt = Date.now();
    await user.save();

    res.json({
      message: 'Profile updated successfully',
      user: {
        id: user._id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        phoneNumber: user.phoneNumber,
        address: user.address,
        city: user.city,
        state: user.state,
        zipCode: user.zipCode,
        profilePhoto: user.profilePhoto,
        emergencyContact: user.emergencyContact,
        climbingLevel: user.climbingLevel,
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
    console.error('Profile update error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Update membership status (admin only)
router.put('/membership/:userId', authenticateToken, async (req, res) => {
  try {
    const { membershipType, membershipStatus, membershipStartDate, membershipEndDate } = req.body;
    
    const user = await User.findById(req.params.userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Check if the requesting user is an admin
    const requestingUser = await User.findById(req.userId);
    if (requestingUser.role !== 'admin') {
      return res.status(403).json({ message: 'Not authorized' });
    }

    // Update membership details
    if (membershipType) user.membershipType = membershipType;
    if (membershipStatus) user.membershipStatus = membershipStatus;
    if (membershipStartDate) user.membershipStartDate = membershipStartDate;
    if (membershipEndDate) user.membershipEndDate = membershipEndDate;

    user.updatedAt = Date.now();
    await user.save();

    res.json({
      message: 'Membership updated successfully',
      user: {
        id: user._id,
        email: user.email,
        membershipType: user.membershipType,
        membershipStatus: user.membershipStatus,
        membershipStartDate: user.membershipStartDate,
        membershipEndDate: user.membershipEndDate
      }
    });
  } catch (error) {
    console.error('Membership update error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Sign waiver
router.post('/sign-waiver', authenticateToken, async (req, res) => {
  try {
    console.log('=== WAIVER SIGNING REQUEST ===');
    console.log('Request body:', req.body);
    console.log('User from auth:', req.user);
    
    const { 
      signature, 
      signedAt,
      // Profile information from setup flow
      firstName,
      lastName,
      address,
      city,
      state,
      zipCode,
      phoneNumber,
      age,
      profilePhoto,
      emergencyName,
      emergencyPhone,
      emergencyRelationship
    } = req.body;

    if (!signature || !signedAt) {
      console.log('Missing signature or signedAt');
      return res.status(400).json({ message: 'Signature and signing date are required' });
    }

    const userId = req.user.userId || req.user.id || req.user._id;
    console.log('Using user ID:', userId);

    // Create new waiver
    const waiver = new Waiver({
      user: userId,
      signature,
      signedAt: new Date(signedAt),
      expiresAt: new Date(+new Date() + 365*24*60*60*1000) // Expires in 1 year
    });

    await waiver.save();
    console.log('Waiver saved:', waiver._id);

    // Update user's waiver status and profile information
    const user = await User.findById(userId);
    if (!user) {
      console.log('User not found:', userId);
      return res.status(404).json({ message: 'User not found' });
    }
    
    // Update waiver status
    user.waiverStatus = 'signed';
    user.waiverSignedAt = new Date(signedAt);
    user.waiver = waiver._id;

    // Update profile information if provided
    if (firstName) user.firstName = firstName;
    if (lastName) user.lastName = lastName;
    if (address) user.address = address;
    if (city) user.city = city;
    if (state) user.state = state;
    if (zipCode) user.zipCode = zipCode;
    if (phoneNumber) user.phoneNumber = phoneNumber;
    if (profilePhoto) user.profilePhoto = profilePhoto;
    
    // Update emergency contact if provided
    if (emergencyName || emergencyPhone || emergencyRelationship) {
      user.emergencyContact = {
        name: emergencyName || user.emergencyContact?.name || '',
        phone: emergencyPhone || user.emergencyContact?.phone || '',
        relationship: emergencyRelationship || user.emergencyContact?.relationship || '',
      };
    }

    user.updatedAt = Date.now();
    await user.save();
    console.log('User updated with waiver status and profile info');

    // Return updated user data
    const updatedUser = await User.findById(userId)
      .select('-password')
      .populate('waiver', 'signedAt expiresAt status');

    console.log('Waiver signing successful');
    res.json({
      message: 'Waiver signed successfully',
      user: updatedUser
    });
  } catch (error) {
    console.error('Waiver signing error:', error);
    res.status(500).json({ message: 'Server error while signing waiver', error: error.message });
  }
});

// Get waiver status
router.get('/waiver-status', authenticateToken, async (req, res) => {
  try {
    console.log('=== WAIVER STATUS REQUEST ===');
    console.log('req.user:', req.user);
    
    const userId = req.user.userId || req.user.id || req.user._id;
    console.log('Extracted userId:', userId);
    
    const user = await User.findById(userId)
      .select('waiverStatus waiverSignedAt')
      .populate('waiver', 'signedAt expiresAt status');

    if (!user) {
      console.log('User not found with ID:', userId);
      return res.status(404).json({ message: 'User not found' });
    }

    console.log('User found:', { 
      id: user._id, 
      waiverStatus: user.waiverStatus,
      waiverSignedAt: user.waiverSignedAt 
    });

    res.json({
      status: user.waiverStatus || 'pending',
      signedAt: user.waiverSignedAt,
      waiver: user.waiver
    });
  } catch (error) {
    console.error('Waiver status error:', error);
    res.status(500).json({ message: 'Server error while fetching waiver status' });
  }
});

// Add this endpoint after the existing routes
router.post('/update-membership', authenticateToken, async (req, res) => {
  try {
    console.log('=== MEMBERSHIP UPDATE REQUEST ===');
    console.log('User:', req.user);

    const userId = req.user.userId || req.user.id || req.user._id;
    
    // Update user membership status
    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { 
        membershipStatus: 'active',
        membershipType: 'premium'
      },
      { new: true, runValidators: true }
    );

    if (!updatedUser) {
      return res.status(404).json({ message: 'User not found' });
    }

    console.log('Membership updated successfully:', {
      userId: updatedUser._id,
      email: updatedUser.email,
      membershipStatus: updatedUser.membershipStatus,
      membershipType: updatedUser.membershipType
    });

    res.json({
      success: true,
      message: 'Membership updated successfully',
      user: {
        id: updatedUser._id,
        email: updatedUser.email,
        membershipStatus: updatedUser.membershipStatus,
        membershipType: updatedUser.membershipType
      }
    });

  } catch (error) {
    console.error('Membership update error:', error);
    res.status(500).json({ 
      message: 'Server error while updating membership', 
      error: error.message 
    });
  }
});

module.exports = router; 