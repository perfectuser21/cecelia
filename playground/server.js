import express from 'express';

const app = express();
const PORT = process.env.PLAYGROUND_PORT || 3000;

app.get('/health', (req, res) => {
  res.json({ ok: true });
});

if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => console.log(`playground listening on ${PORT}`));
}

export default app;
