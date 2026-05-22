import express from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '127.0.0.1';
const dataDir = process.env.EATLY_DATA_DIR || path.join(__dirname, 'data');
const dataFile = path.join(dataDir, 'eatly.json');
const publicDir = path.join(__dirname, 'public');
const cookieName = 'eatly_session';
const sessionTtlMs = 1000 * 60 * 60 * 24 * 30;
const sessionSecret = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const geminiApiKey = process.env.GEMINI_API_KEY || '';
const geminiModel = process.env.GEMINI_MODEL || 'gemini-flash-latest';
const isProduction = process.env.NODE_ENV === 'production';

let db = { users: [], meals: [] };
let writeQueue = Promise.resolve();
const analyzeAttempts = new Map();

if (!process.env.SESSION_SECRET) {
  console.warn('SESSION_SECRET is not set; sessions will reset after restart.');
}

app.set('trust proxy', 1);
app.use(express.json({ limit: '8mb' }));

await loadDb();

app.get('/api/health', (req, res) => {
  res.json({ ok: true, app: 'Eatly' });
});

app.post('/api/login', async (req, res) => {
  const username = normalizeUsername(req.body?.username);
  const password = String(req.body?.password || '');
  const user = db.users.find((item) => item.username === username);

  if (!user || !verifyPassword(password, user.passwordHash)) {
    return res.status(401).json({ error: 'Неверный логин или пароль.' });
  }

  setSessionCookie(res, user);
  res.json({ user: publicUser(user) });
});

app.post('/api/logout', (req, res) => {
  res.clearCookie(cookieName, cookieOptions(0));
  res.json({ ok: true });
});

app.get('/api/me', requireUser, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

app.get('/api/meals', requireUser, (req, res) => {
  const meals = db.meals
    .filter((meal) => meal.userId === req.user.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  res.json({ meals });
});

app.post('/api/meals', requireUser, async (req, res) => {
  const body = req.body || {};
  const now = new Date().toISOString();
  const meal = {
    id: crypto.randomUUID(),
    userId: req.user.id,
    createdAt: now,
    updatedAt: now,
    title: cleanText(body.title, 90) || 'Приём пищи',
    ingredients: cleanStringArray(body.ingredients, 12, 40),
    caloriesMin: cleanNumber(body.caloriesMin, 0, 5000),
    caloriesMax: cleanNumber(body.caloriesMax, 0, 5000),
    confidence: cleanEnum(body.confidence, ['low', 'medium', 'high'], 'medium'),
    portionNote: cleanText(body.portionNote, 220),
    gentleComment: cleanText(body.gentleComment, 220),
    portionSize: cleanText(body.portionSize, 80),
    mood: cleanText(body.mood, 80),
    note: cleanText(body.note, 500)
  };

  if (meal.caloriesMin && meal.caloriesMax && meal.caloriesMin > meal.caloriesMax) {
    [meal.caloriesMin, meal.caloriesMax] = [meal.caloriesMax, meal.caloriesMin];
  }

  db.meals.push(meal);
  await saveDb();
  res.status(201).json({ meal });
});

app.delete('/api/meals/:id', requireUser, async (req, res) => {
  const before = db.meals.length;
  db.meals = db.meals.filter((meal) => !(meal.id === req.params.id && meal.userId === req.user.id));

  if (db.meals.length === before) {
    return res.status(404).json({ error: 'Запись не найдена.' });
  }

  await saveDb();
  res.json({ ok: true });
});

app.post('/api/analyze-food', requireUser, async (req, res) => {
  if (!geminiApiKey) {
    return res.status(500).json({ error: 'Gemini API key не настроен на сервере.' });
  }

  if (!allowAnalyze(req.user.id)) {
    return res.status(429).json({ error: 'Слишком много анализов подряд. Попробуй через минуту.' });
  }

  const imageDataUrl = String(req.body?.imageDataUrl || '');
  const match = imageDataUrl.match(/^data:(image\/(?:jpeg|jpg|png|webp));base64,([a-zA-Z0-9+/=]+)$/);
  if (!match) {
    return res.status(400).json({ error: 'Нужно отправить фото в формате JPEG, PNG или WebP.' });
  }

  const mimeType = match[1] === 'image/jpg' ? 'image/jpeg' : match[1];
  const base64 = match[2];
  const byteLength = Math.floor((base64.length * 3) / 4);
  if (byteLength > 4_500_000) {
    return res.status(413).json({ error: 'Фото слишком большое. Попробуй выбрать или снять фото поменьше.' });
  }

  try {
    const analysis = await analyzeWithGemini({ mimeType, base64 });
    res.json({ analysis });
  } catch (error) {
    console.error('Gemini analysis failed:', error);
    res.status(502).json({ error: 'Не получилось проанализировать фото. Можно добавить запись вручную.' });
  }
});

app.use('/api', (req, res) => {
  res.status(404).json({ error: 'API endpoint не найден.' });
});

app.use(express.static(publicDir, {
  extensions: ['html'],
  maxAge: 0
}));

app.get('*', (req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

app.listen(port, host, () => {
  console.log(`Eatly is listening on ${host}:${port}`);
});

async function analyzeWithGemini({ mimeType, base64 }) {
  const prompt = [
    'Ты бережный ассистент для дневника питания. Пользователь может иметь РПП, поэтому отвечай без оценки, давления, стыда и диетической риторики.',
    'Проанализируй фото еды. Вес порции по фото неизвестен, поэтому калории оценивай только диапазоном и явно учитывай неопределённость.',
    'Верни только JSON без markdown.',
    'Схема:',
    '{"title":"короткое название","ingredients":["ингредиент"],"caloriesMin":0,"caloriesMax":0,"confidence":"low|medium|high","portionNote":"коротко про порцию и неопределённость","gentleComment":"мягкий нейтральный комментарий"}',
    'Если еда не распознана, поставь confidence="low", caloriesMin=0, caloriesMax=0 и попроси описать блюдо вручную.'
  ].join('\n');

  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-goog-api-key': geminiApiKey
    },
    body: JSON.stringify({
      contents: [
        {
          role: 'user',
          parts: [
            { text: prompt },
            { inlineData: { mimeType, data: base64 } }
          ]
        }
      ],
      generationConfig: {
        temperature: 0.2,
        responseMimeType: 'application/json'
      }
    })
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.error?.message || `Gemini HTTP ${response.status}`);
  }

  const text = payload?.candidates?.[0]?.content?.parts
    ?.map((part) => part.text || '')
    .join('\n')
    .trim();

  if (!text) {
    throw new Error('Gemini returned empty response');
  }

  const parsed = parseJsonText(text);
  return normalizeAnalysis(parsed);
}

function normalizeAnalysis(value) {
  const analysis = value && typeof value === 'object' ? value : {};
  let caloriesMin = cleanNumber(analysis.caloriesMin, 0, 5000);
  let caloriesMax = cleanNumber(analysis.caloriesMax, 0, 5000);

  if (caloriesMin && caloriesMax && caloriesMin > caloriesMax) {
    [caloriesMin, caloriesMax] = [caloriesMax, caloriesMin];
  }

  return {
    title: cleanText(analysis.title, 90) || 'Приём пищи',
    ingredients: cleanStringArray(analysis.ingredients, 12, 40),
    caloriesMin,
    caloriesMax,
    confidence: cleanEnum(analysis.confidence, ['low', 'medium', 'high'], 'medium'),
    portionNote: cleanText(analysis.portionNote, 220) || 'Оценка по фото примерная, порцию лучше уточнить вручную.',
    gentleComment: cleanText(analysis.gentleComment, 220) || 'Можно сохранить как ориентир и поправить детали под себя.'
  };
}

function parseJsonText(text) {
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('No JSON in Gemini response');
    return JSON.parse(match[0]);
  }
}

async function loadDb() {
  await fs.mkdir(dataDir, { recursive: true });
  try {
    const content = await fs.readFile(dataFile, 'utf8');
    const parsed = JSON.parse(content);
    db = {
      users: Array.isArray(parsed.users) ? parsed.users : [],
      meals: Array.isArray(parsed.meals) ? parsed.meals : []
    };
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await saveDb();
  }
}

function saveDb() {
  writeQueue = writeQueue.then(async () => {
    const tmpFile = `${dataFile}.${process.pid}.tmp`;
    await fs.mkdir(dataDir, { recursive: true });
    await fs.writeFile(tmpFile, `${JSON.stringify(db, null, 2)}\n`, 'utf8');
    await fs.rename(tmpFile, dataFile);
  });
  return writeQueue;
}

function requireUser(req, res, next) {
  const token = parseCookies(req.headers.cookie || '')[cookieName];
  const payload = verifyToken(token);

  if (!payload) {
    return res.status(401).json({ error: 'Нужен вход в аккаунт.' });
  }

  const user = db.users.find((item) => item.id === payload.sub);
  if (!user) {
    return res.status(401).json({ error: 'Пользователь не найден.' });
  }

  req.user = user;
  next();
}

function setSessionCookie(res, user) {
  const token = signToken({
    sub: user.id,
    username: user.username,
    exp: Date.now() + sessionTtlMs
  });
  res.cookie(cookieName, token, cookieOptions(sessionTtlMs));
}

function cookieOptions(maxAge) {
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    path: '/',
    maxAge
  };
}

function signToken(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto
    .createHmac('sha256', sessionSecret)
    .update(body)
    .digest('base64url');
  return `${body}.${signature}`;
}

function verifyToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [body, signature] = token.split('.');
  const expected = crypto.createHmac('sha256', sessionSecret).update(body).digest('base64url');
  if (!safeEqual(signature, expected)) return null;

  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload.exp || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('base64url')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('base64url');
  return `scrypt:${salt}:${hash}`;
}

function verifyPassword(password, encoded) {
  const [, salt, expected] = String(encoded || '').split(':');
  if (!salt || !expected) return false;
  const actual = hashPassword(password, salt).split(':')[2];
  return safeEqual(actual, expected);
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ''));
  const rightBuffer = Buffer.from(String(right || ''));
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function parseCookies(header) {
  return Object.fromEntries(
    header
      .split(';')
      .map((chunk) => chunk.trim())
      .filter(Boolean)
      .map((chunk) => {
        const index = chunk.indexOf('=');
        if (index === -1) return [chunk, ''];
        return [chunk.slice(0, index), decodeURIComponent(chunk.slice(index + 1))];
      })
  );
}

function publicUser(user) {
  return {
    id: user.id,
    username: user.username
  };
}

function allowAnalyze(userId) {
  const now = Date.now();
  const windowMs = 60_000;
  const maxAttempts = 8;
  const attempts = (analyzeAttempts.get(userId) || []).filter((time) => now - time < windowMs);
  attempts.push(now);
  analyzeAttempts.set(userId, attempts);
  return attempts.length <= maxAttempts;
}

function normalizeUsername(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 40);
}

function cleanText(value, maxLength) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function cleanStringArray(value, maxItems, maxLength) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => cleanText(item, maxLength))
    .filter(Boolean)
    .slice(0, maxItems);
}

function cleanNumber(value, min, max) {
  const number = Math.round(Number(value));
  if (!Number.isFinite(number)) return 0;
  return Math.min(max, Math.max(min, number));
}

function cleanEnum(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

export { hashPassword };
