import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, '..');
const dataDir = process.env.EATLY_DATA_DIR || path.join(rootDir, 'data');
const dataFile = path.join(dataDir, 'eatly.json');
const args = process.argv.slice(2);

if (args.length === 0) {
  console.error('Usage: npm run seed:users -- --random grohotar anita masha');
  console.error('   or: npm run seed:users -- grohotar=password anita=password masha=password');
  process.exit(1);
}

const randomMode = args[0] === '--random';
const entries = randomMode
  ? args.slice(1).map((username) => [username, randomPassword()])
  : args.map((pair) => {
      const index = pair.indexOf('=');
      if (index === -1) {
        throw new Error(`Expected username=password, got "${pair}"`);
      }
      return [pair.slice(0, index), pair.slice(index + 1)];
    });

if (entries.length === 0) {
  throw new Error('No users provided');
}

const db = await loadDb();
const credentials = [];

for (const [rawUsername, password] of entries) {
  const username = normalizeUsername(rawUsername);
  if (!username) {
    throw new Error(`Invalid username "${rawUsername}"`);
  }
  if (!password || password.length < 8) {
    throw new Error(`Password for ${username} must be at least 8 characters`);
  }

  const existing = db.users.find((user) => user.username === username);
  if (existing) {
    existing.passwordHash = hashPassword(password);
    existing.updatedAt = new Date().toISOString();
  } else {
    db.users.push({
      id: crypto.randomUUID(),
      username,
      passwordHash: hashPassword(password),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
  }
  credentials.push({ username, password });
}

await saveDb(db);

console.log('Users seeded:');
for (const item of credentials) {
  console.log(`${item.username}: ${item.password}`);
}

async function loadDb() {
  await fs.mkdir(dataDir, { recursive: true });
  try {
    const content = await fs.readFile(dataFile, 'utf8');
    const parsed = JSON.parse(content);
    return {
      users: Array.isArray(parsed.users) ? parsed.users : [],
      meals: Array.isArray(parsed.meals) ? parsed.meals : []
    };
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return { users: [], meals: [] };
  }
}

async function saveDb(db) {
  const tmpFile = `${dataFile}.${process.pid}.tmp`;
  await fs.writeFile(tmpFile, `${JSON.stringify(db, null, 2)}\n`, 'utf8');
  await fs.rename(tmpFile, dataFile);
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('base64url')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('base64url');
  return `scrypt:${salt}:${hash}`;
}

function randomPassword() {
  return crypto.randomBytes(9).toString('base64url');
}

function normalizeUsername(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 40);
}
