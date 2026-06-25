const express = require('express');
const path = require('path');
const { Pool } = require('pg');

const app = express();
app.use(express.json());
app.use(express.static(__dirname));

// ======== DATABASE ========
const pool = process.env.DATABASE_URL ? new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
}) : null;

async function setupDb() {
  if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_data (
      email TEXT PRIMARY KEY,
      data JSONB NOT NULL,
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);
  console.log('Database ready');
}
setupDb().catch(e => console.error('DB setup error:', e.message));

// ======== API: FaucetPay verify ========
app.post('/api/check-faucetpay', async (req, res) => {
  const { email } = req.body;
  if (!email || !email.includes('@'))
    return res.status(400).json({ valid: false, message: 'Invalid email format' });

  const apiKey = process.env.FAUCETPAY_API_KEY;
  if (!apiKey)
    return res.status(500).json({ valid: false, message: 'API key not configured' });

  try {
    const params = new URLSearchParams({ api_key: apiKey, address: email });
    const response = await fetch('https://faucetpay.io/api/v1/checkaddress', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString()
    });
    const data = await response.json();
    if (data.status === 200)
      res.json({ valid: true, message: 'Account found' });
    else
      res.json({ valid: false, message: 'No FaucetPay account found for this email.' });
  } catch {
    res.status(502).json({ valid: false, message: 'Could not reach FaucetPay. Try again.' });
  }
});

// ======== API: Load user data ========
app.get('/api/user-data', async (req, res) => {
  const { email } = req.query;
  if (!email) return res.status(400).json({ found: false });

  if (!pool) return res.json({ found: false });

  try {
    const result = await pool.query('SELECT data FROM user_data WHERE email = $1', [email]);
    if (result.rows.length > 0)
      res.json({ found: true, data: result.rows[0].data });
    else
      res.json({ found: false });
  } catch (e) {
    res.status(500).json({ found: false, error: e.message });
  }
});

// ======== API: Save user data ========
app.post('/api/user-data', async (req, res) => {
  const { email, data } = req.body;
  if (!email || !data) return res.status(400).json({ ok: false });

  if (!pool) return res.json({ ok: false, reason: 'No database' });

  try {
    await pool.query(
      `INSERT INTO user_data (email, data) VALUES ($1, $2)
       ON CONFLICT (email) DO UPDATE SET data = $2, updated_at = NOW()`,
      [email, JSON.stringify(data)]
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ======== API: Withdrawal via FaucetPay ========
app.post('/api/withdraw', async (req, res) => {
  const { email, amount, currency } = req.body;
  const apiKey = process.env.FAUCETPAY_API_KEY;

  if (!apiKey) return res.status(500).json({ ok: false, error: 'API key not configured' });
  if (!email || !amount || !currency) return res.status(400).json({ ok: false, error: 'Missing parameters' });

  try {
    // FaucetPay Send API requires amount in satoshis for some coins or decimal for others
    // We'll send it as the provided amount
    // FaucetPay API requires amount in SATOSHIS (amount * 10^8)
    // We convert the decimal amount back to an integer satoshi value
    const satoshiAmount = Math.round(parseFloat(amount) * 100000000);

    const params = new URLSearchParams({
      api_key: apiKey,
      amount: satoshiAmount,
      currency: currency,
      to: email,
      referral: 'false'
    });

    const response = await fetch('https://faucetpay.io/api/v1/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString()
    });

    const result = await response.json();
    if (result.status === 200) {
      res.json({ ok: true, message: result.message });
    } else {
      res.status(400).json({ ok: false, error: result.message || 'FaucetPay error' });
    }
  } catch (e) {
    res.status(502).json({ ok: false, error: 'Failed to connect to FaucetPay' });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  
  // Anti-sleep mechanism: Ping itself every 10 minutes
  const siteUrl = 'https://farwit.onrender.com';
  setInterval(() => {
    fetch(siteUrl)
      .then(res => console.log(`Self-ping successful: ${res.status}`))
      .catch(err => console.error(`Self-ping failed: ${err.message}`));
  }, 10 * 60 * 1000); // 10 minutes
});
