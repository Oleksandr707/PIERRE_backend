const mongoose = require('mongoose');

const doorAccessSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  location: {
    id: {
      type: String,
      required: true
    },
    name: {
      type: String,
      required: true
    },
    ip: {
      type: String,
      required: true
    }
  },
  userLocation: {
    latitude: {
      type: Number,
      required: false
    },
    longitude: {
      type: Number,
      required: false
    },
    accuracy: {
      type: Number,
      required: false
    }
  },
  accessTime: {
    type: Date,
    default: Date.now,
    required: true
  },
  status: {
    type: String,
    enum: ['success', 'failed', 'timeout', 'denied'],
    default: 'success'
  },
  sessionId: {
    type: String, // For tracking if multiple people enter together
    required: false
  }
}, {
  timestamps: true
});

// Index for efficient querying
doorAccessSchema.index({ accessTime: -1 });
doorAccessSchema.index({ user: 1, accessTime: -1 });
doorAccessSchema.index({ 'location.id': 1, accessTime: -1 });

module.exports = mongoose.model('DoorAccess', doorAccessSchema); 