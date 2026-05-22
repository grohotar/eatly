const app = document.querySelector('#app');
const appVersion = '0.1.3';

const state = {
  user: null,
  meals: [],
  analysis: null,
  editingMealId: null,
  editDraft: null,
  previewUrl: '',
  imageDataUrl: '',
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
            <input name="username" autocomplete="username" required>
          </label>
          <label>
            <span>Пароль</span>
            <input name="password" type="password" autocomplete="current-password" required>
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

  return `
    <header class="topbar">
      <div>
        <p class="eyebrow">Eatly</p>
        <h1>Дневник питания</h1>
      </div>
      <div class="user-box">
        <span>${escapeHtml(state.user.username)}</span>
        <button id="logout-button" class="logout-button" type="button" aria-label="Выйти">×</button>
      </div>
    </header>
    <main class="layout">
      <section class="entry-panel">
        <div class="section-head">
          <h2>${isEditing ? 'Редактирование' : 'Новая запись'}</h2>
          <span class="muted">${isEditing ? 'можно поправить детали' : new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' }).format(new Date())}</span>
        </div>
        <form id="meal-form" class="stack">
          ${isEditing ? '' : `
            <label class="photo-drop">
              <input id="photo-input" name="photo" type="file" accept="image/*" capture="environment">
              ${
                state.previewUrl
                  ? `<img src="${state.previewUrl}" alt="Выбранное фото">`
                  : '<span class="camera-icon" aria-hidden="true">□</span><strong>Фото еды</strong>'
              }
            </label>
            <label>
              <span>Комментарий к фото</span>
              <textarea name="photoNote" rows="2" placeholder="Например: тут половина порции, салат с маслом, суп в большой тарелке"></textarea>
            </label>
            <div class="actions-row">
              <button id="analyze-button" class="secondary" type="button" ${!state.imageDataUrl || state.busy ? 'disabled' : ''}>
                ${state.busy ? 'Анализ...' : 'Анализировать'}
              </button>
              <button id="clear-photo-button" class="ghost" type="button" ${!state.imageDataUrl ? 'disabled' : ''}>Очистить</button>
            </div>
          `}
          ${state.analysis ? renderAnalysis() : ''}
          <div class="field-grid">
            <label>
              <span>Название</span>
              <input name="title" value="${escapeAttr(state.analysis?.title || formValues.title || '')}" placeholder="Например, омлет с овощами" required>
            </label>
            <label>
              <span>Порция</span>
              <input name="portionSize" value="${escapeAttr(formValues.portionSize || '')}" placeholder="обычная, половина тарелки, 250 г">
            </label>
          </div>
          <div class="field-grid calories-grid">
            <label>
              <span>Ккал от</span>
              <input name="caloriesMin" inputmode="numeric" value="${state.analysis?.caloriesMin || formValues.caloriesMin || ''}">
            </label>
            <label>
              <span>Ккал до</span>
              <input name="caloriesMax" inputmode="numeric" value="${state.analysis?.caloriesMax || formValues.caloriesMax || ''}">
            </label>
          </div>
          <label>
            <span>Ингредиенты</span>
            <input name="ingredients" value="${escapeAttr((state.analysis?.ingredients || formValues.ingredients || []).join(', '))}" placeholder="через запятую">
          </label>
          <label>
            <span>Заметка</span>
            <textarea name="note" rows="3" placeholder="что важно помнить про этот приём пищи">${escapeHtml(formValues.note || '')}</textarea>
          </label>
          <label class="hidden-field">
            <span>portionNote</span>
            <textarea name="portionNote">${escapeHtml(state.analysis?.portionNote || formValues.portionNote || '')}</textarea>
          </label>
          <label class="hidden-field">
            <span>gentleComment</span>
            <textarea name="gentleComment">${escapeHtml(state.analysis?.gentleComment || formValues.gentleComment || '')}</textarea>
          </label>
          <div class="actions-row">
            <button class="primary" type="submit">${isEditing ? 'Сохранить изменения' : 'Сохранить'}</button>
            ${isEditing ? '<button id="cancel-edit-button" class="ghost" type="button">Отмена</button>' : ''}
          </div>
        </form>
      </section>
      <section class="diary-panel">
        <div class="section-head">
          <h2>История</h2>
          <button id="refresh-button" class="ghost" type="button">Обновить</button>
        </div>
        <div class="meal-list">
          ${state.meals.length ? state.meals.map(renderMeal).join('') : '<p class="empty">Пока нет записей.</p>'}
        </div>
      </section>
    </main>
    <footer class="app-version">Eatly v${appVersion}</footer>
    <div id="toast" class="${state.message ? 'toast is-visible' : 'toast'}">${escapeHtml(state.message)}</div>
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
      ${analysis.gentleComment ? `<p>${escapeHtml(analysis.gentleComment)}</p>` : ''}
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
        ${meal.portionSize ? `<span>${escapeHtml(meal.portionSize)}</span>` : ''}
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
  document.querySelector('#clear-photo-button')?.addEventListener('click', clearPhoto);
  document.querySelector('#meal-form')?.addEventListener('submit', onSaveMeal);
  document.querySelector('#cancel-edit-button')?.addEventListener('click', cancelEdit);
  document.querySelector('#refresh-button')?.addEventListener('click', async () => {
    await loadMeals();
    flash('История обновлена.');
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
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const compressed = await compressImage(file);
    state.imageDataUrl = compressed;
    state.previewUrl = compressed;
    state.analysis = null;
    render();
  } catch {
    flash('Не получилось открыть фото.');
  }
}

async function onAnalyze() {
  if (!state.imageDataUrl) return;
  const photoNote = new FormData(document.querySelector('#meal-form')).get('photoNote');
  state.busy = true;
  state.message = '';
  render();
  try {
    const payload = await api('/api/analyze-food', {
      method: 'POST',
      body: {
        imageDataUrl: state.imageDataUrl,
        photoNote
      },
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
      portionSize: form.get('portionSize'),
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
    portionSize: meal.portionSize || '',
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
  state.previewUrl = '';
  state.imageDataUrl = '';
  state.analysis = null;
  if (shouldRender) render();
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
