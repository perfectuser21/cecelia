export async function closePgPool(pool) {
  await pool.end();
}
