const api = require('../lib/api');

module.exports = async (req, res) => {
  const url = new URL(
    req.url,
    `https://${req.headers.host || 'localhost'}`
  );

  try {
    const handled = await api.handle(req, res, url);

    if (!handled && !res.headersSent) {
      res.statusCode = 404;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'No such endpoint.' }));
    }
  } catch (err) {
    console.error('[api]', err);

    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'Server error.' }));
    }
  }
};
