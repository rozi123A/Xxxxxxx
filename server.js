const express = require('express');
const path = require('path');
const app = express();

app.use(express.json());
app.use(express.static(__dirname));

app.post('/api/check-faucetpay', async (req, res) => {
  const { email } = req.body;

  if (!email || !email.includes('@')) {
    return res.status(400).json({ valid: false, message: 'Invalid email format' });
  }

  const apiKey = process.env.FAUCETPAY_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ valid: false, message: 'API key not configured' });
  }

  try {
    const params = new URLSearchParams({ api_key: apiKey, address: email });
    const response = await fetch('https://faucetpay.io/api/v1/checkaddress', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString()
    });

    const data = await response.json();

    if (data.status === 200) {
      res.json({ valid: true, message: 'Account found' });
    } else {
      res.json({ valid: false, message: 'No FaucetPay account found for this email.' });
    }
  } catch (e) {
    res.status(502).json({ valid: false, message: 'Could not reach FaucetPay. Try again.' });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Server running on port', PORT));
