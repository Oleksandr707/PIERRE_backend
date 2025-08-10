const mongoose = require('mongoose');

const problemSchema = new mongoose.Schema({
  creator: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  name: {
    type: String,
    required: true
  },
  description: {
    type: String,
    default: ''
  },
  numberOfMoves: {
    type: String,
    default: ''
  },
  style: {
    type: String,
    enum: ['crimpy', 'slopey', 'juggy', 'technical', 'powerful', 'dynamic', 'balancy'],
    default: 'crimpy'
  },
  image: {
    type: String,
    required: true
  },
  wallImage: {
    type: String,
    required: true
  },
  holds: [{
    xPercent: Number,
    yPercent: Number,
    type: {
      type: String,
      enum: ['start', 'startBoth', 'finish', 'feet', 'normal'],
      default: 'normal'
    }
  }],
  grade: {
    type: String,
    enum: ['V0', 'V1', 'V2', 'V3', 'V4', 'V5', 'V6', 'V7', 'V8', 'V9', 'V10', 'V11', 'V12'],
    required: true
  },
  sends: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    date: {
      type: Date,
      default: Date.now
    },
    instagramUrl: String
  }],
  likes: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  comments: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    text: String,
    date: {
      type: Date,
      default: Date.now
    }
  }],
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('Problem', problemSchema); 