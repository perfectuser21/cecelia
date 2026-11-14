import pool from './db.js';

async function getDailyReports(date = 'today', type = 'all') {
  const targetDate = date === 'today' ? new Date().toISOString().split('T')[0] : date;

  let query = `
    SELECT dl.*, NULL::text as project_name
    FROM daily_logs dl
    WHERE dl.date = $1
  `;
  const params = [targetDate];

  if (type !== 'all') {
    query += ' AND dl.type = $2';
    params.push(type);
  }

  query += ' ORDER BY dl.type DESC';

  const result = await pool.query(query, params);
  return result.rows;
}

export { getDailyReports };
