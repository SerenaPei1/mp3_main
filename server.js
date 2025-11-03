// -------------------- Imports & Setup --------------------
const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
require('dotenv').config();

const app = express();

// Use Render's port or fallback for local dev
const PORT = process.env.PORT || 3000;

// (Optional) silence old mongoose deprecations you were setting
mongoose.set('useCreateIndex', true);
mongoose.set('useFindAndModify', false);

// -------------------- DB Connection --------------------
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
});

mongoose.connection.on('connected', () => {
  console.log(' MongoDB connected successfully');
});
mongoose.connection.on('error', err => {
  console.error(' MongoDB connection failed:', err.message);
  process.exit(1);
});
mongoose.connection.on('disconnected', () => {
  console.log('MongoDB disconnected');
});

// -------------------- Middlewares --------------------
const allowCrossDomain = (req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'X-Requested-With, X-HTTP-Method-Override, Content-Type, Accept');
  res.header('Access-Control-Allow-Methods', 'POST, GET, PUT, DELETE, OPTIONS');
  next();
};
app.use(allowCrossDomain);

// body parsing
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// -------------------- Health & Root (must be after app is created) --------------------
app.get('/', (req, res) => {
  res.send('Backend is running ✔️');
});

app.get('/healthz', (req, res) => {
  res.status(200).send('OK');
});

// -------------------- Routes --------------------
const router = express.Router();
require('./routes')(app, router);

// -------------------- Start Server --------------------
app.listen(PORT, () => {
  console.log(`Running on ${PORT}`);
});
