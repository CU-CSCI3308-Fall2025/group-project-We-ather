const express = require('express');
const path = require('path');
const bodyParser = require('body-parser');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const pgp = require('pg-promise')();

const app = express();

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
}

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

// Simple auth guard
function auth(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  next();
}

// Static views directory for HTML pages
const viewsDir = path.join(__dirname, 'views');

// Routes
app.get('/', (_req, res) => res.redirect('/login'));

app.get('/login', (_req, res) => {
  res.sendFile(path.join(viewsDir, 'login.html'));
});

app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const user = await db.oneOrNone('SELECT * FROM users WHERE username = $1', [username]);
    if (!user) return res.redirect('/register');

    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.redirect('/login');

    req.session.user = { id: user.id, username: user.username };
    req.session.save(() => res.redirect('/home'));
  } catch (e) {
    console.error('Login error:', e.message);
    res.redirect('/login');
  }
});

app.get('/register', (_req, res) => {
  res.sendFile(path.join(viewsDir, 'register.html'));
});

app.post('/register', async (req, res) => {
  const { username, password } = req.body;
  try {
    const hash = await bcrypt.hash(password, 10);
    await db.none('INSERT INTO users(username, password) VALUES($1, $2)', [username, hash]);
    res.redirect('/login');
  } catch (e) {
    console.error('Registration error:', e.message);
    res.redirect('/register');
  }
});

app.get('/home', auth, (req, res) => {
  res.send(
    `<div style="font-family:system-ui;padding:24px;">
      <h1>Welcome, ${req.session.user.username}</h1>
      <p>You are logged in. <a href="/logout">Logout</a></p>
    </div>`
  );
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

// Start
ensureSchema()
  .then(() => {
    app.listen(3000, () => console.log('Server listening on 3000'));
  })
  .catch((e) => {
    console.error('Failed to init schema:', e.message);
    process.exit(1);
  });


