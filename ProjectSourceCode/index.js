const express = require('express');
const path = require('path');
const bodyParser = require('body-parser');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const pgp = require('pg-promise')();
const fs = require('fs');
const multer = require('multer');
const crypto = require('crypto');

const handlebars = require('express-handlebars');
const Handlebars = require('handlebars');
const weatherService = require('./services/weather');

const app = express();

const hbs = handlebars.create({
  extname: 'hbs',
  layoutsDir: __dirname + '/views/layouts',
  partialsDir: __dirname + '/views/partials',
  helpers: {
    formatDate: function(date) {
      if (!date) return '';
      const d = new Date(date);
      return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
    },
    json: function(context) {
      return JSON.stringify(context);
    }
  }
});

// Database configuration (from environment; docker compose provides these)
const dbConfig = {
  host: process.env.POSTGRES_HOST || 'db',
  port: Number(process.env.POSTGRES_PORT || 5432),
  database: process.env.POSTGRES_DB,
  user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
};

const db = pgp(dbConfig);

// Configure multer for file uploads
const uploadsDir = path.join(__dirname, 'uploads');

// Create uploads directory if it doesn't exist
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Configure multer storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    // Generate unique filename: timestamp-randomstring-originalname
    const uniqueSuffix = Date.now() + '-' + crypto.randomBytes(6).toString('hex');
    const ext = path.extname(file.originalname);
    const basename = path.basename(file.originalname, ext);
    cb(null, `${basename}-${uniqueSuffix}${ext}`);
  }
});

// File filter to only accept images
const fileFilter = (req, file, cb) => {
  // Accept common image file types
  const allowedMimeTypes = [
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/gif',
    'image/webp',
    'image/bmp',
    'image/tiff',
    'image/svg+xml',
    'image/x-icon'
  ];
  
  // Also accept any mimetype that starts with 'image/' as a fallback
  if (file.mimetype.startsWith('image/') || allowedMimeTypes.includes(file.mimetype.toLowerCase())) {
    cb(null, true);
  } else {
    cb(new Error('Only image files are allowed! Supported formats: JPEG, JPG, PNG, GIF, WebP, BMP, TIFF, SVG, ICO'), false);
  }
};

// Initialize multer with the storage configuration
const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  },
  fileFilter: fileFilter
});

// Ensure users table exists
async function ensureSchema() {
  await db.none(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  await db.none(`
    CREATE TABLE IF NOT EXISTS locations (
      id SERIAL PRIMARY KEY,
      name TEXT UNIQUE NOT NULL
    );
  `);
  await db.none(`
    CREATE TABLE IF NOT EXISTS user_saved_locations (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      location_text TEXT NOT NULL
    );
  `);
  await db.none(`
    CREATE TABLE IF NOT EXISTS posts (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      content TEXT,
      image_filename TEXT,
      location TEXT,
      latitude DECIMAL,
      longitude DECIMAL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  // Add unique constraint if it doesn't exist (for existing tables)
  try {
    await db.none(`
      DO $$ 
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint 
          WHERE conname = 'user_saved_locations_user_location_unique'
        ) THEN
          ALTER TABLE user_saved_locations 
          ADD CONSTRAINT user_saved_locations_user_location_unique 
          UNIQUE(user_id, location_text);
        END IF;
      END $$;
    `);
  } catch (error) {
    console.error('Error adding unique constraint:', error.message);
  }
  // const sampleLocations = ['Boulder', 'Boston', 'Boise', 'Baltimore'];
  // for (const loc of sampleLocations) {
  //   await db.none('INSERT INTO locations(name) VALUES($1) ON CONFLICT DO NOTHING', [loc]);
  // }
}

// Register `hbs` as our view engine using its bound `engine()` function.
app.engine('hbs', hbs.engine);
app.set('view engine', 'hbs');
app.set('views', path.join(__dirname, 'views'));
app.use(bodyParser.json()); // specify the usage of JSON for parsing request body.

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

app.use(
  session({
    secret: process.env.SESSION_SECRET || 'dev-secret',
    saveUninitialized: false,
    resave: false,
    name: 'we-ather.sid',
    cookie: {
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production', // Only use secure cookies in production
      sameSite: 'lax'
    }
  })
);

// Simple auth guard
const auth = (req, res, next) => {
  if (!req.session.user) {
    return res.redirect('/login');
  }
  next();
};

// Static views directory for HTML pages
const viewsDir = path.join(__dirname, 'views');

// Serve static files from uploads directory
app.use('/uploads', express.static(uploadsDir));

// Routes
app.get('/', (req, res) => {
  res.redirect('/login');
});

app.get('/welcome', (req, res) => {
  res.json({status: 'success', message: 'Welcome!'});
});

app.get('/login', (req, res) => {
  // If user is already logged in, redirect to home
  if (req.session.user) {
    return res.redirect('/home');
  }
  res.render('pages/login', { layout: 'main' });
});

app.post('/login', async (req, res) => {
    const query = 'SELECT * FROM users WHERE username = $1';
    try {
        const user = await db.one(query, [req.body.username]);
        const match = await bcrypt.compare(req.body.password, user.password);
        if (match) {
            req.session.user = user;
            // Save session and then redirect
            req.session.save((err) => {
                if (err) {
                    console.error('Error saving session:', err);
                    return res.status(500).render('pages/login', { layout: 'main', message: 'Error logging in. Please try again.', error: true });
                }
                return res.redirect('/home');
            });
            return;
        }
        return res.status(401).render('pages/login', { layout: 'main', message: 'Invalid username or password.', error: true });
    } 
    catch (error) {
        console.error('Error fetching user:', error); 
        return res.status(500).redirect('/register');
    }
});

app.get('/register', (req, res) => {
  // If user is already logged in, redirect to home
  if (req.session.user) {
    return res.redirect('/home');
  }
  res.render('pages/register', { layout: 'main' });
});

app.post('/register', async (req, res) => {
  if (!req.body.username || !req.body.password || req.body.username.trim() === '' || req.body.password.trim() === '') {
    return res.status(400).json({ message: 'Invalid input' });
  }

  const hash = await bcrypt.hash(req.body.password, 10);
    const insertQuery = 'INSERT INTO users (username, password) VALUES ($1, $2)';
    try {
      await db.none(insertQuery, [req.body.username, hash])
      return res.status(200).redirect('/login');
    } 
    catch (error) {
        console.error('Error inserting user:', error); 
        return res.status(500).redirect('/register');
    }
});

app.get('/home', auth, async (req, res) => {
  try {
    const posts = await db.any(`
      SELECT p.*, u.username 
      FROM posts p 
      JOIN users u ON p.user_id = u.id 
      ORDER BY p.created_at DESC 
      LIMIT 50
    `);
    res.render('pages/home', {
      layout: 'main',
      username: req.session.user.username,
      posts: posts,
    });
  } catch (error) {
    console.error('Error fetching posts:', error);
    res.render('pages/home', {
      layout: 'main',
      username: req.session.user.username,
      posts: [],
    });
  }
});

app.get('/posts', auth, (req, res) => {
  res.render('pages/posts', {
    layout: 'main',
    username: req.session.user.username
  });
});

app.get('/profile', auth, async (req, res) => {
  try {
    const posts = await db.any(`
      SELECT p.*, u.username 
      FROM posts p 
      JOIN users u ON p.user_id = u.id 
      WHERE p.user_id = $1
      ORDER BY p.created_at DESC
    `, [req.session.user.id]);
    // Add can_delete flag since these are the user's own posts
    const postsWithDelete = posts.map(post => ({
      ...post,
      can_delete: true
    }));
    res.render('pages/profile', {
      layout: 'main',
      username: req.session.user.username,
      posts: postsWithDelete
    });
  } catch (error) {
    console.error('Error fetching user posts:', error);
    res.render('pages/profile', {
      layout: 'main',
      username: req.session.user.username,
      posts: []
    });
  }
});

app.get('/logout', async (req, res) => {
    req.session.destroy()
    res.render('pages/logout', {layout: 'main', message: 'Logged out Successfully', error:false})
})

// Weather API route (protected by auth)
app.get('/api/weather', auth, async (req, res) => {
  const { lat, lon } = req.query;
  
  if (!lat || !lon) {
    return res.status(400).json({ error: 'Latitude and longitude are required' });
  }
  
  try {
    const weatherData = await weatherService.getWeatherData(parseFloat(lat), parseFloat(lon));
    res.json(weatherData);
  } catch (error) {
    console.error('Error fetching weather:', error.message);
    console.error('Stack:', error.stack);
    res.status(500).json({ 
      error: 'Failed to fetch weather data',
      message: error.message 
    });
  }
});

//autocomplete location names route (protected by auth)
app.get('/api/locations', auth, async (req, res) => {
  const { query } = req.query;

  if (!query) {
    return res.status(400).json({ error: 'Query parameter is required' });
  }

  try {
    const locations = await db.any('SELECT name FROM locations WHERE name ILIKE $1 LIMIT 10', [`%${query}%`]);
    res.json(locations.map(loc => loc.name));
  } catch (error) {
    console.error('Error fetching locations:', error.message);
    res.status(500).json({ error: 'Failed to fetch locations' });
  }
});

// Create a new post with image upload (protected by auth)
app.post('/api/posts', auth, (req, res, next) => {
  upload.single('image')(req, res, (err) => {
    // Handle multer errors
    if (err) {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({ error: 'File size too large. Maximum size is 10MB.' });
        }
        return res.status(400).json({ error: err.message });
      }
      if (err.message === 'Only image files are allowed!') {
        return res.status(400).json({ error: 'Only image files are allowed!' });
      }
      return res.status(400).json({ error: err.message });
    }
    next();
  });
}, async (req, res) => {
  try {
    const { content, location, latitude, longitude } = req.body;
    const userId = req.session.user.id;
    const imageFilename = req.file ? req.file.filename : null;

    if (!content && !imageFilename) {
      // If file was uploaded but no content, delete it
      if (req.file) {
        fs.unlinkSync(req.file.path);
      }
      return res.status(400).json({ error: 'Post must have either content or an image' });
    }

    const result = await db.one(`
      INSERT INTO posts (user_id, content, image_filename, location, latitude, longitude)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, created_at
    `, [
      userId,
      content || null,
      imageFilename,
      location || null,
      latitude ? parseFloat(latitude) : null,
      longitude ? parseFloat(longitude) : null
    ]);

    // Fetch the complete post with username
    const post = await db.one(`
      SELECT p.*, u.username 
      FROM posts p 
      JOIN users u ON p.user_id = u.id 
      WHERE p.id = $1
    `, [result.id]);

    res.status(201).json({ success: true, post: post });
  } catch (error) {
    console.error('Error creating post:', error);
    // Clean up uploaded file if post creation failed
    if (req.file) {
      try {
        fs.unlinkSync(req.file.path);
      } catch (unlinkError) {
        console.error('Error deleting file:', unlinkError);
      }
    }
    res.status(500).json({ error: 'Failed to create post' });
  }
});

// Get all posts (protected by auth)
app.get('/api/posts', auth, async (req, res) => {
  try {
    const { location, user_id } = req.query;
    let query = `
      SELECT p.*, u.username 
      FROM posts p 
      JOIN users u ON p.user_id = u.id 
      WHERE 1=1
    `;
    const params = [];
    let paramCount = 1;

    if (location) {
      query += ` AND p.location ILIKE $${paramCount}`;
      params.push(`%${location}%`);
      paramCount++;
    }

    if (user_id) {
      query += ` AND p.user_id = $${paramCount}`;
      params.push(parseInt(user_id));
      paramCount++;
    }

    query += ` ORDER BY p.created_at DESC LIMIT 50`;

    const posts = await db.any(query, params);
    // Add current user ID to each post so frontend knows which posts can be deleted
    const postsWithUser = posts.map(post => ({
      ...post,
      current_user_id: req.session.user.id,
      can_delete: post.user_id === req.session.user.id
    }));
    res.json(postsWithUser);
  } catch (error) {
    console.error('Error fetching posts:', error);
    res.status(500).json({ error: 'Failed to fetch posts' });
  }
});

// Delete a post (protected by auth, only post owner can delete)
app.delete('/api/posts/:id', auth, async (req, res) => {
  try {
    const postId = parseInt(req.params.id);
    const userId = req.session.user.id;

    // First, check if the post exists and belongs to the user
    const post = await db.oneOrNone('SELECT * FROM posts WHERE id = $1', [postId]);
    
    if (!post) {
      return res.status(404).json({ error: 'Post not found' });
    }

    if (post.user_id !== userId) {
      return res.status(403).json({ error: 'You can only delete your own posts' });
    }

    // Delete the associated image file if it exists
    if (post.image_filename) {
      const imagePath = path.join(uploadsDir, post.image_filename);
      try {
        if (fs.existsSync(imagePath)) {
          fs.unlinkSync(imagePath);
        }
      } catch (fileError) {
        console.error('Error deleting image file:', fileError);
        // Continue with post deletion even if file deletion fails
      }
    }

    // Delete the post from the database
    await db.none('DELETE FROM posts WHERE id = $1', [postId]);

    res.json({ success: true, message: 'Post deleted successfully' });
  } catch (error) {
    console.error('Error deleting post:', error);
    res.status(500).json({ error: 'Failed to delete post' });
  }
});

// Get user's saved locations (protected by auth)
app.get('/api/saved-locations', auth, async (req, res) => {
  try {
    const userId = req.session.user.id;
    const locations = await db.any(
      'SELECT location_text FROM user_saved_locations WHERE user_id = $1 ORDER BY location_text',
      [userId]
    );
    res.json(locations.map(loc => loc.location_text));
  } catch (error) {
    console.error('Error fetching saved locations:', error.message);
    res.status(500).json({ error: 'Failed to fetch saved locations' });
  }
});

// Save location to user's saved locations (protected by auth)
app.post('/api/saved-locations', auth, async (req, res) => {
  const { location_text } = req.body;
  if (!location_text || location_text.trim() === '') {
    return res.status(400).json({ error: 'Location text is required' });
  }
  try {
    const userId = req.session.user.id;
    await db.none(
      'INSERT INTO user_saved_locations (user_id, location_text) VALUES ($1, $2) ON CONFLICT (user_id, location_text) DO NOTHING',
      [userId, location_text.trim()]
    );
    res.json({ status: 'success', message: 'Location saved' });
  } catch (error) {
    console.error('Error saving location:', error.message);
    res.status(500).json({ error: 'Failed to save location' });
  }
});

// Delete location from user's saved locations (protected by auth)
app.delete('/api/saved-locations', auth, async (req, res) => {
  const { location_text } = req.body;
  if (!location_text || location_text.trim() === '') {
    return res.status(400).json({ error: 'Location text is required' });
  }
  try {
    const userId = req.session.user.id;
    const result = await db.result(
      'DELETE FROM user_saved_locations WHERE user_id = $1 AND location_text = $2',
      [userId, location_text.trim()]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Location not found' });
    }
    res.json({ status: 'success', message: 'Location deleted' });
  } catch (error) {
    console.error('Error deleting location:', error.message);
    res.status(500).json({ error: 'Failed to delete location' });
  }
});

// Verify table creation (protected by auth)
app.get('/api/verify-table', auth, async (req, res) => {
  try {
    const result = await db.any(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'user_saved_locations'
      ORDER BY ordinal_position;
    `);
    res.json({ 
      table_exists: result.length > 0,
      columns: result 
    });
  } catch (error) {
    console.error('Error verifying table:', error.message);
    res.status(500).json({ error: 'Failed to verify table' });
  }
});

app.use(auth);

// Export the app for testing
module.exports = app;

// Start server if this is the main module
if (require.main === module) {
  ensureSchema()
    .then(() => {
      app.listen(3000, () => console.log('Server listening on 3000'));
    })
    .catch((e) => {
      console.error('Failed to init schema:', e.message);
      process.exit(1);
    });
}


