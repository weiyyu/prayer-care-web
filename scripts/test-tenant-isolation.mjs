import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';

function readEnv(path) {
  if (!fs.existsSync(path)) return {};
  return Object.fromEntries(
    fs.readFileSync(path, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#') && line.includes('='))
      .map((line) => {
        const index = line.indexOf('=');
        const value = line.slice(index + 1).trim().replace(/^(?:"(.*)"|'(.*)')$/, '$1$2');
        return [line.slice(0, index).trim(), value];
      }),
  );
}

const env = {
  ...readEnv('.env.local'),
  ...readEnv('.env.isolation.local'),
  ...process.env,
};
const url = env.VITE_SUPABASE_URL;
const key = env.VITE_SUPABASE_PUBLISHABLE_KEY ?? env.VITE_SUPABASE_ANON_KEY;
const accounts = [
  { label: 'A', email: env.ISOLATION_A_EMAIL, password: env.ISOLATION_A_PASSWORD },
  { label: 'B', email: env.ISOLATION_B_EMAIL, password: env.ISOLATION_B_PASSWORD },
];
const tables = ['care_people', 'care_visits', 'prayer_items'];

if (!url || !key || accounts.some(({ email, password }) => !email || !password)) {
  console.error('設定缺少欄位。請準備 .env.local 與 .env.isolation.local，參考 .env.isolation.example。');
  process.exit(2);
}

async function signIn(account) {
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data, error } = await client.auth.signInWithPassword({
    email: account.email,
    password: account.password,
  });
  if (error || !data.user) throw new Error(`帳號 ${account.label} 登入失敗；請確認密碼及信箱驗證狀態。`);
  return { client, userId: data.user.id };
}

async function readOwnedRows(client, table) {
  const rows = [];
  for (let start = 0; ; start += 1000) {
    const { data, error } = await client.from(table).select('id, owner_id').range(start, start + 999);
    if (error) throw new Error(`${table} 唯讀查詢失敗：${error.message}`);
    rows.push(...data);
    if (data.length < 1000) return rows;
  }
}

async function readIds(client, table, ids) {
  const visible = new Set();
  if (ids.length === 0) return visible;
  for (let start = 0; start < ids.length; start += 200) {
    const batch = ids.slice(start, start + 200);
    const { data, error } = await client.from(table).select('id').in('id', batch);
    if (error) throw new Error(`${table} 跨帳號唯讀查詢失敗：${error.message}`);
    data.forEach(({ id }) => visible.add(id));
  }
  return visible;
}

try {
  const [a, b] = await Promise.all(accounts.map(signIn));
  if (a.userId === b.userId) throw new Error('A、B 登入到同一個帳號，請使用兩個不同的測試帳號。');

  let conclusive = true;
  for (const table of tables) {
    const [rowsA, rowsB] = await Promise.all([
      readOwnedRows(a.client, table),
      readOwnedRows(b.client, table),
    ]);
    const ownershipValid = rowsA.every((row) => row.owner_id === a.userId)
      && rowsB.every((row) => row.owner_id === b.userId);
    const [aSeesB, bSeesA] = await Promise.all([
      readIds(a.client, table, rowsB.map(({ id }) => id)),
      readIds(b.client, table, rowsA.map(({ id }) => id)),
    ]);
    const isolated = aSeesB.size === 0 && bSeesA.size === 0;
    const populated = rowsA.length > 0 && rowsB.length > 0;
    conclusive &&= ownershipValid && isolated && populated;
    console.log(`${table}: A=${rowsA.length} 筆，B=${rowsB.length} 筆；${ownershipValid && isolated ? '跨帳號不可見' : '隔離失敗'}${populated ? '' : '；資料不足，需兩帳號各有測試資料'}`);
  }

  await Promise.all([a.client.auth.signOut(), b.client.auth.signOut()]);
  if (!conclusive) process.exitCode = 1;
  else console.log('通過：三張表雙向隔離確認。全程只有登入與 SELECT，沒有變更雲端資料。');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
