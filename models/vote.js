const mongoose = require('mongoose');

const voteSchema = new mongoose.Schema({
  problemId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Problem',
    required: true,
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  grade: {
    type: Number,
    required: true,
  },
}, { timestamps: true });

module.exports = mongoose.model('Vote', voteSchema); 