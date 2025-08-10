const mongoose = require('mongoose');

const waiverSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  signature: {
    type: String,
    required: true
  },
  signedAt: {
    type: Date,
    required: true
  },
  status: {
    type: String,
    enum: ['signed', 'expired'],
    default: 'signed'
  },
  expiresAt: {
    type: Date,
    required: true,
    default: () => new Date(+new Date() + 365*24*60*60*1000) // Expires in 1 year
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Waiver', waiverSchema); 