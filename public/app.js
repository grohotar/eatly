const app = document.querySelector('#app');
const appVersion = '0.1.32';

const state = {
  user: null,
  meals: [],
  analysis: null,
  editingMealId: null,
  editDraft: null,
  selectedDateKey: '',
  previewUrls: [],
  imageDataUrls: [],
  busy: false,
  message: ''
};

init();

async function init() {
  lockViewportZoom();
  registerServiceWorker();
  await loadMe();
  render();
}

async function loadMe() {
  try {
    const payload = await api('/api/me');
    state.user = payload.user;
    await loadMeals();
  } catch {
    state.user = null;
  }
}

async function loadMeals() {
  const payload = await api('/api/meals');
  state.meals = payload.meals || [];
  ensureSelectedDate();
}

function render() {
  app.innerHTML = state.user ? renderShell() : renderLogin();
  bindEvents();
}

function renderLogin() {
  return `
    <main class="login-view">
      <section class="login-panel">
        <div class="brand-mark" aria-hidden="true">E</div>
        <h1>Eatly</h1>
        <form id="login-form" class="stack">
          <label>
            <span>Логин</span>
            <input name="username" autocomplete="username" placeholder="Логин" required>
          </label>
          <label>
            <span>Пароль</span>
            <input name="password" type="password" autocomplete="current-password" placeholder="Пароль" required>
          </label>
          <button class="primary" type="submit">Войти</button>
        </form>
        ${state.message ? `<p class="form-message">${escapeHtml(state.message)}</p>` : ''}
      </section>
    </main>
  `;
}

function renderShell() {
  const isEditing = Boolean(state.editingMealId);
  const formValues = state.editDraft || {};
  const dailyStats = getDailyStats();
  const selectedDay = dailyStats.find((day) => day.key === state.selectedDateKey) || dailyStats[0];
  const selectedMeals = selectedDay
    ? state.meals.filter((meal) => getDateKey(meal.createdAt) === selectedDay.key)
    : [];

  return `
    <header class="topbar">
      <div class="topbar-content">
        <div class="topline">
          <p class="eyebrow">Eatly</p>
          <div class="user-box">
            <span>${escapeHtml(state.user.username)}</span>
            <button id="logout-button" class="logout-button" type="button">Выйти</button>
          </div>
        </div>
        <h1>Дневник питания</h1>
      </div>
    </header>
    <main class="layout">
      <section class="entry-panel">
        <div class="${isEditing ? 'section-head section-head-stacked' : 'section-head'}">
          <h2>${isEditing ? 'Редактирование' : 'Новая запись'}</h2>
          <span class="muted">${isEditing ? 'можно поправить детали' : new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' }).format(new Date())}</span>
        </div>
        <form id="meal-form" class="stack">
          ${isEditing ? '' : `
            <label class="photo-drop">
              <input id="photo-input" name="photo" type="file" accept="image/*" multiple>
              ${
                state.previewUrls.length
                  ? `<div class="photo-preview-grid">${state.previewUrls.map((url, index) => `<img src="${url}" alt="Выбранное изображение ${index + 1}">`).join('')}</div>`
                  : '<span class="camera-icon" aria-hidden="true">□</span><strong>Фото, скриншот или галерея</strong>'
              }
            </label>
            <label>
              <span>Комментарий к фото</span>
              <textarea name="photoNote" rows="2" placeholder="Опиши еду или уточни фото: 1 куриное филе, 3 яйца скрэмбл без масла, 2 тоста"></textarea>
            </label>
            <div class="actions-row photo-actions">
              <button id="analyze-button" class="secondary" type="button" ${state.busy ? 'disabled' : ''}>
                ${state.busy ? 'Считаю...' : 'Посчитать'}
              </button>
              <button id="clear-photo-button" class="ghost" type="button" ${state.busy ? 'disabled' : ''}>Очистить</button>
            </div>
          `}
          ${state.analysis ? renderAnalysis() : ''}
          <div class="field-grid">
            <label>
              <span>Название</span>
              <input name="title" value="${escapeAttr(state.analysis?.title || formValues.title || '')}" placeholder="Блюдо или продукт" required>
            </label>
          </div>
          <div class="field-grid calories-grid">
            <label>
              <span>Ккал от</span>
              <input name="caloriesMin" inputmode="numeric" value="${state.analysis?.caloriesMin || formValues.caloriesMin || ''}" placeholder="ккал от">
            </label>
            <label>
              <span>Ккал до</span>
              <input name="caloriesMax" inputmode="numeric" value="${state.analysis?.caloriesMax || formValues.caloriesMax || ''}" placeholder="ккал до">
            </label>
          </div>
          <label>
            <span>Ингредиенты</span>
            <input name="ingredients" value="${escapeAttr((state.analysis?.ingredients || formValues.ingredients || []).join(', '))}" placeholder="Ингредиенты через запятую">
          </label>
          <label>
            <span>Заметка</span>
            <textarea name="note" rows="3" placeholder="Заметка к приёму пищи">${escapeHtml(formValues.note || '')}</textarea>
          </label>
          <label class="hidden-field">
            <span>portionNote</span>
            <textarea name="portionNote">${escapeHtml(state.analysis?.portionNote || formValues.portionNote || '')}</textarea>
          </label>
          <label class="hidden-field">
            <span>gentleComment</span>
            <textarea name="gentleComment">${escapeHtml(state.analysis?.gentleComment || formValues.gentleComment || '')}</textarea>
          </label>
          <div class="actions-row submit-actions">
            <button class="primary" type="submit">${isEditing ? 'Сохранить изменения' : 'Сохранить'}</button>
            ${isEditing ? '<button id="cancel-edit-button" class="ghost" type="button">Отмена</button>' : ''}
          </div>
        </form>
      </section>
      <section class="diary-panel">
        <div class="section-head">
          <h2>История</h2>
        </div>
        ${dailyStats.length ? renderDailyHistory(dailyStats, selectedDay) : ''}
        <div class="meal-list">
          ${selectedMeals.length ? selectedMeals.map(renderMeal).join('') : '<p class="empty">Пока нет записей.</p>'}
        </div>
      </section>
    </main>
    <footer class="app-version">Eatly v${appVersion}</footer>
    <div id="toast" class="${state.message ? 'toast is-visible' : 'toast'}">${escapeHtml(state.message)}</div>
  `;
}

function renderDailyHistory(days, selectedDay) {
  return `
    <div class="daily-history">
      <div class="day-strip" aria-label="История по дням">
        ${days.map((day) => `
          <button class="${day.key === selectedDay.key ? 'day-chip is-active' : 'day-chip'}" type="button" data-date="${day.key}">
            <span>${escapeHtml(day.shortLabel)}</span>
            <strong>${escapeHtml(formatCaloriesRange(day.caloriesMin, day.caloriesMax))}</strong>
          </button>
        `).join('')}
      </div>
    </div>
  `;
}

function renderAnalysis() {
  const analysis = state.analysis;
  return `
    <div class="analysis-box">
      <div class="analysis-head">
        <strong>${escapeHtml(analysis.title)}</strong>
      </div>
      <p>${escapeHtml(analysis.portionNote || '')}</p>
      ${analysis.ingredients?.length ? `<div class="chips">${analysis.ingredients.map((item) => `<span>${escapeHtml(item)}</span>`).join('')}</div>` : ''}
    </div>
  `;
}

function renderMeal(meal) {
  const date = new Date(meal.createdAt);
  const calories = meal.caloriesMin || meal.caloriesMax
    ? `${meal.caloriesMin || '?'}-${meal.caloriesMax || '?'} ккал`
    : 'без оценки';

  return `
    <article class="meal-card">
      <div class="meal-main">
        <div>
          <time>${new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(date)}</time>
          <h3>${escapeHtml(meal.title)}</h3>
        </div>
        <div class="meal-actions">
          <button class="edit-button edit-meal" type="button" data-id="${meal.id}" aria-label="Редактировать">✎</button>
          <button class="icon-button delete-meal" type="button" data-id="${meal.id}" aria-label="Удалить">×</button>
        </div>
      </div>
      <div class="meal-meta">
        <span>${escapeHtml(calories)}</span>
      </div>
      ${meal.ingredients?.length ? `<div class="chips">${meal.ingredients.map((item) => `<span>${escapeHtml(item)}</span>`).join('')}</div>` : ''}
      ${meal.note ? `<p>${escapeHtml(meal.note)}</p>` : ''}
    </article>
  `;
}

function bindEvents() {
  document.querySelector('#login-form')?.addEventListener('submit', onLogin);
  document.querySelector('#logout-button')?.addEventListener('click', onLogout);
  document.querySelector('#photo-input')?.addEventListener('change', onPhotoChange);
  document.querySelector('#analyze-button')?.addEventListener('click', onAnalyze);
  document.querySelector('#clear-photo-button')?.addEventListener('click', clearEntryInput);
  document.querySelector('#meal-form')?.addEventListener('submit', onSaveMeal);
  document.querySelector('#cancel-edit-button')?.addEventListener('click', cancelEdit);
  document.querySelectorAll('.day-chip').forEach((button) => {
    button.addEventListener('click', () => {
      state.selectedDateKey = button.dataset.date;
      render();
    });
  });
  document.querySelectorAll('.delete-meal').forEach((button) => {
    button.addEventListener('click', async () => {
      await api(`/api/meals/${button.dataset.id}`, { method: 'DELETE' });
      await loadMeals();
      flash('Запись удалена.');
    });
  });
  document.querySelectorAll('.edit-meal').forEach((button) => {
    button.addEventListener('click', () => startEdit(button.dataset.id));
  });
}

async function onLogin(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  try {
    const payload = await api('/api/login', {
      method: 'POST',
      body: {
        username: form.get('username'),
        password: form.get('password')
      }
    });
    state.user = payload.user;
    state.message = '';
    await loadMeals();
    render();
  } catch (error) {
    flash(error.message);
  }
}

async function onLogout() {
  await api('/api/logout', { method: 'POST' });
  state.user = null;
  state.meals = [];
  state.analysis = null;
  state.editingMealId = null;
  state.editDraft = null;
  clearPhoto(false);
  render();
}

async function onPhotoChange(event) {
  const files = [...(event.target.files || [])].slice(0, 4);
  if (!files.length) return;
  try {
    const compressed = await Promise.all(files.map(compressImage));
    state.imageDataUrls = compressed;
    state.previewUrls = compressed;
    state.analysis = null;
    render();
  } catch {
    flash('Не получилось открыть одно из изображений.');
  }
}

async function onAnalyze() {
  const photoNote = new FormData(document.querySelector('#meal-form')).get('photoNote');
  const hasText = Boolean(String(photoNote || '').trim());
  const hasImages = state.imageDataUrls.length > 0;
  if (!hasImages && !hasText) {
    flash('Добавь фото, скриншот или опиши приём пищи текстом.');
    return;
  }
  state.busy = true;
  state.message = '';
  render();
  try {
    const payload = await api(hasImages ? '/api/analyze-food' : '/api/analyze-text', {
      method: 'POST',
      body: hasImages
        ? { imageDataUrls: state.imageDataUrls, photoNote }
        : { description: photoNote },
      retries: 1,
      timeoutMs: 70000
    });
    state.analysis = payload.analysis;
    flash('Анализ готов.');
  } catch (error) {
    flash(error.message);
  } finally {
    state.busy = false;
    render();
  }
}

async function onSaveMeal(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const ingredients = String(form.get('ingredients') || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  try {
    const mealPayload = {
      title: form.get('title'),
      ingredients,
      caloriesMin: form.get('caloriesMin'),
      caloriesMax: form.get('caloriesMax'),
      portionNote: form.get('portionNote'),
      gentleComment: form.get('gentleComment'),
      portionSize: '',
      note: form.get('note')
    };
    const isEditing = Boolean(state.editingMealId);

    await api(isEditing ? `/api/meals/${state.editingMealId}` : '/api/meals', {
      method: isEditing ? 'PUT' : 'POST',
      body: mealPayload
    });
    state.analysis = null;
    state.editingMealId = null;
    state.editDraft = null;
    clearPhoto(false);
    await loadMeals();
    flash(isEditing ? 'Запись обновлена.' : 'Запись сохранена.');
  } catch (error) {
    flash(error.message);
  }
}

function startEdit(mealId) {
  const meal = state.meals.find((item) => item.id === mealId);
  if (!meal) return;
  state.editingMealId = meal.id;
  state.editDraft = {
    title: meal.title,
    ingredients: meal.ingredients || [],
    caloriesMin: meal.caloriesMin || '',
    caloriesMax: meal.caloriesMax || '',
    portionNote: meal.portionNote || '',
    gentleComment: meal.gentleComment || '',
    portionSize: '',
    note: meal.note || ''
  };
  state.analysis = null;
  clearPhoto(false);
  render();
  document.querySelector('.entry-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function cancelEdit() {
  state.editingMealId = null;
  state.editDraft = null;
  state.analysis = null;
  clearPhoto(false);
  render();
}

function clearPhoto(shouldRender = true) {
  state.previewUrls = [];
  state.imageDataUrls = [];
  state.analysis = null;
  if (shouldRender) render();
}

function clearEntryInput() {
  clearPhoto(false);
  render();
}

function ensureSelectedDate() {
  const keys = [...new Set(state.meals.map((meal) => getDateKey(meal.createdAt)))];
  if (!keys.length) {
    state.selectedDateKey = '';
    return;
  }
  if (!state.selectedDateKey || !keys.includes(state.selectedDateKey)) {
    state.selectedDateKey = keys[0];
  }
}

function getDailyStats() {
  const stats = new Map();
  state.meals.forEach((meal) => {
    const key = getDateKey(meal.createdAt);
    const current = stats.get(key) || {
      key,
      date: new Date(meal.createdAt),
      caloriesMin: 0,
      caloriesMax: 0,
      count: 0
    };
    const calories = getMealCaloriesRange(meal);
    current.caloriesMin += calories.min;
    current.caloriesMax += calories.max;
    current.count += 1;
    stats.set(key, current);
  });

  return [...stats.values()]
    .sort((a, b) => b.key.localeCompare(a.key))
    .map((day) => ({
      ...day,
      label: formatDayLabel(day.date),
      shortLabel: formatShortDayLabel(day.date)
    }));
}

function getMealCaloriesRange(meal) {
  const min = Number(meal.caloriesMin || 0);
  const max = Number(meal.caloriesMax || 0);
  if (min && max) return { min, max };
  if (min) return { min, max: min };
  if (max) return { min: max, max };
  return { min: 0, max: 0 };
}

function formatCaloriesRange(min, max) {
  if (!min && !max) return 'без оценки';
  if (min === max) return `${min} ккал`;
  return `${min}-${max} ккал`;
}

function getDateKey(value) {
  const date = new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatDayLabel(date) {
  const today = getDateKey(new Date());
  const yesterdayDate = new Date();
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  const key = getDateKey(date);
  if (key === today) return 'Сегодня';
  if (key === getDateKey(yesterdayDate)) return 'Вчера';
  return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' }).format(date);
}

function formatShortDayLabel(date) {
  return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' }).format(date);
}

async function api(url, options = {}) {
  const attempts = Number(options.retries || 0) + 1;
  let lastError;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const controller = options.timeoutMs ? new AbortController() : null;
      const timeout = controller
        ? window.setTimeout(() => controller.abort(), options.timeoutMs)
        : null;

      const response = await fetch(url, {
        method: options.method || 'GET',
        headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal: controller?.signal
      });

      if (timeout) window.clearTimeout(timeout);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || 'Что-то пошло не так.');
      }
      return payload;
    } catch (error) {
      lastError = error;
      if (attempt < attempts - 1) {
        await delay(700);
      }
    }
  }

  throw normalizeNetworkError(lastError);
}

function normalizeNetworkError(error) {
  if (error?.name === 'AbortError') {
    return new Error('Анализ занял слишком много времени. Попробуй ещё раз или сохрани запись вручную.');
  }

  const message = String(error?.message || '');
  if (error instanceof TypeError || /load failed|failed to fetch|network/i.test(message)) {
    return new Error('Связь с анализом сорвалась. Я уже попробовал ещё раз, но не получилось. Повтори позже или сохрани запись вручную.');
  }

  return error instanceof Error ? error : new Error('Что-то пошло не так.');
}

function delay(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function lockViewportZoom() {
  document.addEventListener('gesturestart', preventGesture, { passive: false });
  document.addEventListener('gesturechange', preventGesture, { passive: false });
  document.addEventListener('gestureend', preventGesture, { passive: false });
  document.addEventListener('touchmove', (event) => {
    if (event.scale && event.scale !== 1) {
      event.preventDefault();
    }
  }, { passive: false });
}

function preventGesture(event) {
  event.preventDefault();
}

function flash(message) {
  state.message = message;
  render();
  window.clearTimeout(flash.timer);
  flash.timer = window.setTimeout(() => {
    state.message = '';
    render();
  }, 2800);
}

function compressImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const image = new Image();
      image.onerror = reject;
      image.onload = () => {
        const maxSide = 1400;
        const ratio = Math.min(1, maxSide / Math.max(image.width, image.height));
        const width = Math.round(image.width * ratio);
        const height = Math.round(image.height * ratio);
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d');
        context.drawImage(image, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.76));
      };
      image.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
}

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll('`', '&#096;');
}
