const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true
  },
  password: {
    type: String,
    required: true
  },
  username: {
    type: String,
    unique: true,
    trim: true,
    sparse: true
  },
  firstName: {
    type: String,
    trim: true
  },
  lastName: {
    type: String,
    trim: true
  },
  role: {
    type: String,
    enum: ['customer', 'admin', 'staff'],
    default: 'customer'
  },
  membershipType: {
    type: String,
    enum: ['basic', 'premium', 'vip'],
    default: 'basic'
  },
  membershipStatus: {
    type: String,
    enum: ['active', 'inactive', 'expired'],
    default: 'inactive'
  },
  membershipStartDate: {
    type: Date
  },
  membershipEndDate: {
    type: Date
  },
  phoneNumber: {
    type: String,
    trim: true
  },
  // Address fields
  address: {
    type: String,
    trim: true
  },
  city: {
    type: String,
    trim: true
  },
  state: {
    type: String,
    trim: true
  },
  zipCode: {
    type: String,
    trim: true
  },
  // Profile photo
  profilePhoto: {
    type: String, // Base64 encoded image or file path
    default: null
  },
  emergencyContact: {
    name: String,
    phone: String,
    relationship: String
  },
  climbingLevel: {
    type: String,
    enum: ['beginner', 'intermediate', 'advanced', 'expert'],
    default: 'beginner'
  },
  // Gamification fields
  level: {
    type: Number,
    default: 1
  },
  xp: {
    type: Number,
    default: 0
  },
  spark: {
    type: Number,
    default: 0
  },
  // Guild fields
  guild: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Guild',
    default: null
  },
  guildRole: {
    type: String,
    enum: ['member', 'admin', 'owner', null],
    default: null
  },
  // Waiver fields
  waiverStatus: {
    type: String,
    enum: ['pending', 'signed', 'expired'],
    default: 'pending'
  },
  waiverSignedAt: {
    type: Date
  },
  waiver: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Waiver'
  },
  // Stripe fields
  stripeCustomerId: {
    type: String,
    default: null
  },
  subscriptionId: {
    type: String,
    default: null
  },
  subscriptionStatus: {
    type: String,
    enum: ['active', 'past_due', 'canceled', 'unpaid', 'incomplete', 'incomplete_expired', 'trialing', null],
    default: null
  },
  subscriptionCurrentPeriodEnd: {
    type: Date,
    default: null
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Hash password before saving
userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  
  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

// Method to compare password
userSchema.methods.comparePassword = async function(candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

module.exports = mongoose.model('User', userSchema); 