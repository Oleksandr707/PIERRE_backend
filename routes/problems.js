const express = require('express');
const router = express.Router();
const Problem = require('../models/Problem');
const auth = require('../middleware/auth');

// Create a new problem
router.post('/', auth, async (req, res) => {
  try {
    const { name, image, holds, wallImage, grade, description, numberOfMoves, style } = req.body;

    console.log('📝 Creating problem with data:');
    console.log('  - name:', name);
    console.log('  - grade:', grade);
    console.log('  - description:', description);
    console.log('  - numberOfMoves:', numberOfMoves);
    console.log('  - style:', style);

    const problem = new Problem({
      creator: req.userId,
      name,
      image,
      wallImage,
      holds,
      grade,
      description: description || '',
      numberOfMoves: numberOfMoves || '',
      style: style || 'crimpy'
    });

    await problem.save();
    console.log('✅ Problem saved successfully:', problem._id);
    res.status(201).json(problem);
  } catch (error) {
    console.error('Problem creation error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get all problems (for feed)
router.get('/', auth, async (req, res) => {
  try {
    const problems = await Problem.find()
      .populate('creator', 'username')
      .sort({ createdAt: -1 });
    res.json(problems);
  } catch (error) {
    console.error('Problems fetch error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get a specific problem
router.get('/:id', auth, async (req, res) => {
  try {
    const problem = await Problem.findById(req.params.id)
      .populate('creator', 'username')
      .populate('comments.user', 'username')
      .populate('sends.user', 'username');
    
    if (!problem) {
      return res.status(404).json({ message: 'Problem not found' });
    }
    
    res.json(problem);
  } catch (error) {
    console.error('Problem fetch error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Add a comment to a problem
router.post('/:id/comments', auth, async (req, res) => {
  try {
    const problem = await Problem.findById(req.params.id);
    if (!problem) {
      return res.status(404).json({ message: 'Problem not found' });
    }

    problem.comments.unshift({
      user: req.userId,
      text: req.body.text
    });

    await problem.save();
    res.json(problem.comments);
  } catch (error) {
    console.error('Comment creation error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Add a send to a problem
router.post('/:id/sends', auth, async (req, res) => {
  try {
    const problem = await Problem.findById(req.params.id);
    if (!problem) {
      return res.status(404).json({ message: 'Problem not found' });
    }

    problem.sends.unshift({
      user: req.userId,
      instagramUrl: req.body.instagramUrl
    });

    await problem.save();
    res.json(problem.sends);
  } catch (error) {
    console.error('Send creation error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Like/Unlike a problem
router.put('/:id/like', auth, async (req, res) => {
  try {
    const problem = await Problem.findById(req.params.id);
    if (!problem) {
      return res.status(404).json({ message: 'Problem not found' });
    }

    const likeIndex = problem.likes.indexOf(req.userId);
    if (likeIndex === -1) {
      problem.likes.push(req.userId);
    } else {
      problem.likes.splice(likeIndex, 1);
    }

    await problem.save();
    res.json(problem.likes);
  } catch (error) {
    console.error('Like toggle error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router; 