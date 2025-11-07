const express = require('express');
const path = require('path');
const bodyParser = require('body-parser');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const pgp = require('pg-promise')();
const fs = require('fs');

const handlebars = require('express-handlebars');
const Handlebars = require('handlebars');
const weatherService = require('./services/weather');

const app = express();

const hbs = handlebars.create({
  extname: 'hbs',
  layoutsDir: __dirname + '/views/layouts',
  partialsDir: __dirname + '/views/partials',
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

  const sampleLocations = ['Boulder', 'Boston', 'Boise', 'Baltimore', 'Bangkok'];
  for (const loc of sampleLocations) {
    await db.none('INSERT INTO locations(name) VALUES($1) ON CONFLICT DO NOTHING', [loc]);
  }
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
  })
);

// Static views directory for HTML pages
const viewsDir = path.join(__dirname, 'views');

// Routes
app.get('/', (req, res) => {
  res.redirect('/login');
});

app.get('/welcome', (req, res) => {
  res.json({status: 'success', message: 'Welcome!'});
});

app.get('/login', (req, res) => {
  res.render('pages/login', { layout: 'main' });
});

app.post('/login', async (req, res) => {
    const query = 'SELECT * FROM users WHERE username = $1';
    try {
        const user = await db.one(query, [req.body.username]);
        const match = await bcrypt.compare(req.body.password, user.password);
        if (match) {
            req.session.user = user;
            req.session.save(); 
            return res.redirect('/home');
        }
        return res.status(401).render('pages/login', { layout: 'main', message: 'Invalid username or password.', error: true });
    } 
    catch (error) {
        console.error('Error fetching user:', error); 
        return res.status(500).redirect('/register');
    }
});

app.get('/register', (req, res) => {
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

app.get('/home', (req, res) => {
  res.render('pages/home', {
    layout: 'main',
    username: req.session.user.username,
    posts: [],
  });
});

app.get('/logout', async (req, res) => {
    req.session.destroy()
    res.render('pages/logout', {layout: 'main', message: 'Logged out Successfully', error:false})
})

// Simple auth guard
const auth = (req, res, next) => {
  if (!req.session.user) {
    return res.redirect('/login');
  }
  next();
};

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


