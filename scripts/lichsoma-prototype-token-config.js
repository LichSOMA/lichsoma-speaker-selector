/**
 * 프로토타입 토큰 설정(PrototypeTokenConfig) Appearance 탭 — Chat Portrait Token 미리보기·앵커·스케일
 */

const MODULE_ID = 'lichsoma-speaker-selector';

const CP_SCALE_MIN = 1;
const CP_SCALE_MAX = 3;
const CP_SCALE_STEP = 0.05;
const CP_ANCHOR_STEP = 0.01;

/** 앵커는 0.01 단위(소수 둘째 자리) — number input step 검증과 맞춤 */
function roundAnchor2(v) {
  return Math.round(Math.min(1, Math.max(0, Number(v))) * 100) / 100;
}

function getHtmlElement(html) {
  if (!html) return null;
  if (html instanceof HTMLElement) return html;
  if (html.jquery && html[0]) return html[0];
  return html;
}

function chatPortraitTokenLegend() {
  return game.i18n.localize('SPEAKERSELECTOR.ChatPortraitToken.Title');
}

function previewAltText() {
  return game.i18n.localize('SPEAKERSELECTOR.ChatPortraitToken.PreviewAlt');
}

function labelScale() {
  return game.i18n.localize('SPEAKERSELECTOR.ChatPortraitToken.Scale');
}

function labelAnchorX() {
  return game.i18n.localize('SPEAKERSELECTOR.ChatPortraitToken.AnchorX');
}

function labelAnchorY() {
  return game.i18n.localize('SPEAKERSELECTOR.ChatPortraitToken.AnchorY');
}

function findAppearancePanel(element) {
  if (!element?.querySelector) return null;
  return (
    element.querySelector('[data-application-part="appearance"]') ||
    element.querySelector('section.tab.appearance') ||
    element.querySelector('.tab.appearance') ||
    element.querySelector('[data-tab="appearance"]')
  );
}

function findImagePathFormGroup(appearance) {
  const nameEl = appearance.querySelector('[name="texture.src"]');
  if (!nameEl) return null;
  return nameEl.closest('.form-group');
}

function readTextureSrcFromAppearance(appearance, app) {
  const fp = appearance.querySelector('file-picker[name="texture.src"]');
  if (fp) {
    let v = '';
    if (typeof fp.value === 'string' && fp.value.trim()) v = fp.value.trim();
    if (!v) {
      const inp = fp.querySelector('input.image, input[type="text"]');
      if (inp?.value) v = inp.value.trim();
    }
    if (v) return v;
  }
  const altSel = appearance.querySelector('select[name="alternateImages"], select.alternate-images');
  if (altSel?.value) return String(altSel.value).trim();
  const src = app.token?.texture?.src;
  return typeof src === 'string' ? src.trim() : '';
}

function resolveTexturePathForPreview(path) {
  if (!path || typeof path !== 'string') return '';
  const trimmed = path.trim();
  if (!trimmed) return '';
  if (/^(https?:|blob:|data:)/i.test(trimmed)) return trimmed;
  return foundry.utils.getRoute(trimmed);
}

function readChatPortraitState(token, actor) {
  const fromToken = token?.flags?.[MODULE_ID];
  const fromActor = actor?.prototypeToken?.flags?.[MODULE_ID];
  const f = { ...fromActor, ...fromToken };
  let scale = Number(f.chatPortraitScale);
  if (!Number.isFinite(scale)) scale = 1;
  scale = Math.min(CP_SCALE_MAX, Math.max(CP_SCALE_MIN, scale));
  let ax = Number(f.chatPortraitAnchorX);
  let ay = Number(f.chatPortraitAnchorY);
  if (!Number.isFinite(ax)) ax = 0.5;
  if (!Number.isFinite(ay)) ay = 0.5;
  ax = roundAnchor2(ax);
  ay = roundAnchor2(ay);
  return { scale, ax, ay };
}

function patchPreviewTokenFlags(app, patch) {
  const t = app._preview ?? app.token;
  if (!t) return;
  if (!t.flags) t.flags = {};
  const cur = t.flags[MODULE_ID] ?? {};
  t.flags[MODULE_ID] = { ...cur, ...patch };
}

async function persistChatPortraitFlags(actor, patch) {
  const existing = actor.prototypeToken.flags?.[MODULE_ID] ?? {};
  const merged = { ...existing, ...patch };
  const flags = { ...(actor.prototypeToken.flags ?? {}) };
  flags[MODULE_ID] = merged;
  await actor.update({ prototypeToken: { flags } });
}

function bindChatPortraitPreview(appearance, fieldset, app) {
  const img = fieldset.querySelector('.lichsoma-chat-portrait-token-preview');
  const wrap = fieldset.querySelector('.lichsoma-chat-portrait-token-preview-wrap');
  const viewport = fieldset.querySelector('.lichsoma-chat-portrait-token-viewport');
  const inpScale = fieldset.querySelector('input[data-lichsoma-cp="scale"]');
  const inpAx = fieldset.querySelector('input[data-lichsoma-cp="anchorX"]');
  const inpAy = fieldset.querySelector('input[data-lichsoma-cp="anchorY"]');
  if (!img || !wrap || !viewport || !inpScale || !inpAx || !inpAy) return;

  const actor = app.actor;
  if (!actor) return;

  let state = readChatPortraitState(app.token, actor);
  let persistTimer = null;
  let dragActive = false;
  /** @type {{ ax: number; ay: number } | null} */
  let dragAnchorStart = null;
  /** @type {{ x: number; y: number } | null} */
  let dragClientStart = null;

  const schedulePersist = () => {
    clearTimeout(persistTimer);
    persistTimer = setTimeout(async () => {
      persistTimer = null;
      try {
        await persistChatPortraitFlags(actor, {
          chatPortraitScale: state.scale,
          chatPortraitAnchorX: state.ax,
          chatPortraitAnchorY: state.ay
        });
        patchPreviewTokenFlags(app, {
          chatPortraitScale: state.scale,
          chatPortraitAnchorX: state.ax,
          chatPortraitAnchorY: state.ay
        });
      } catch (e) {
        console.error(`${MODULE_ID} | Chat Portrait 플래그 저장 실패`, e);
      }
    }, 200);
  };

  const applyPreviewTransform = () => {
    const px = `${state.ax * 100}%`;
    const py = `${state.ay * 100}%`;
    img.style.setProperty('--lichsoma-cp-anchor-x', px);
    img.style.setProperty('--lichsoma-cp-anchor-y', py);
    img.style.setProperty('--lichsoma-cp-scale', String(state.scale));
  };

  const syncInputsFromState = () => {
    inpScale.value = String(state.scale);
    inpAx.value = String(roundAnchor2(state.ax));
    inpAy.value = String(roundAnchor2(state.ay));
  };

  const updateTexture = () => {
    const path = readTextureSrcFromAppearance(appearance, app);
    if (!path) {
      img.removeAttribute('src');
      img.alt = previewAltText();
      wrap.classList.add('lichsoma-preview-empty');
      return;
    }
    wrap.classList.remove('lichsoma-preview-empty');
    img.alt = previewAltText();
    img.src = resolveTexturePathForPreview(path);
  };

  img.addEventListener('error', () => {
    img.removeAttribute('src');
    wrap.classList.add('lichsoma-preview-empty');
  });

  inpScale.addEventListener('input', () => {
    state.scale = Math.min(CP_SCALE_MAX, Math.max(CP_SCALE_MIN, Number(inpScale.value) || 1));
    applyPreviewTransform();
    schedulePersist();
  });

  const onAnchorInput = (which) => {
    const inp = which === 'x' ? inpAx : inpAy;
    const raw = inp.value.trim();
    if (raw === '' || raw === '-' || raw === '.' || raw === '-.') return;
    const v = parseFloat(raw);
    if (!Number.isFinite(v)) return;
    const clamped = roundAnchor2(Math.min(1, Math.max(0, v)));
    if (which === 'x') state.ax = clamped;
    else state.ay = clamped;
    applyPreviewTransform();
    schedulePersist();
  };
  inpAx.addEventListener('input', () => onAnchorInput('x'));
  inpAy.addEventListener('input', () => onAnchorInput('y'));

  viewport.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      e.stopPropagation();
      const delta = e.deltaY > 0 ? -CP_SCALE_STEP : CP_SCALE_STEP;
      state.scale = Math.min(CP_SCALE_MAX, Math.max(CP_SCALE_MIN, state.scale + delta));
      syncInputsFromState();
      applyPreviewTransform();
      schedulePersist();
    },
    { passive: false }
  );

  viewport.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    dragActive = true;
    dragAnchorStart = { ax: state.ax, ay: state.ay };
    dragClientStart = { x: e.clientX, y: e.clientY };
    viewport.setPointerCapture(e.pointerId);
  });

  viewport.addEventListener('pointermove', (e) => {
    if (!dragActive || !dragAnchorStart || !dragClientStart) return;
    const r = viewport.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return;
    const dx = (e.clientX - dragClientStart.x) / r.width;
    const dy = (e.clientY - dragClientStart.y) / r.height;
    /* X·Y 모두 화면에서 드래그한 방향과 이미지가 같이 움직이도록 델타를 빼서 적용 */
    state.ax = roundAnchor2(dragAnchorStart.ax - dx);
    state.ay = roundAnchor2(dragAnchorStart.ay - dy);
    syncInputsFromState();
    applyPreviewTransform();
    schedulePersist();
  });

  const endDrag = (e) => {
    if (!dragActive) return;
    dragActive = false;
    dragAnchorStart = null;
    dragClientStart = null;
    try {
      viewport.releasePointerCapture(e.pointerId);
    } catch {
      /* noop */
    }
  };
  viewport.addEventListener('pointerup', endDrag);
  viewport.addEventListener('pointercancel', endDrag);

  appearance.addEventListener('input', updateTexture);
  appearance.addEventListener('change', updateTexture);

  viewport.setAttribute('title', game.i18n.localize('SPEAKERSELECTOR.ChatPortraitToken.PreviewInteractHint'));

  syncInputsFromState();
  applyPreviewTransform();
  requestAnimationFrame(() => updateTexture());
}

function injectAppearanceFields(app, html) {
  const root = getHtmlElement(html);
  const appearance = findAppearancePanel(root);
  if (!appearance || appearance.querySelector('.lichsoma-prototype-token-appearance')) return;

  const idBase = `lichsoma-cp-${app.id ?? 'pt'}`;

  const fieldset = document.createElement('fieldset');
  fieldset.className = 'lichsoma-prototype-token-appearance';
  fieldset.innerHTML = `
    <legend>${chatPortraitTokenLegend()}</legend>
    <div class="lichsoma-chat-portrait-token-row">
      <div class="lichsoma-chat-portrait-token-controls">
        <div class="form-group slim">
          <label for="${idBase}-scale">${labelScale()}</label>
          <div class="form-fields">
            <input type="range" id="${idBase}-scale" data-lichsoma-cp="scale" min="${CP_SCALE_MIN}" max="${CP_SCALE_MAX}" step="${CP_SCALE_STEP}" />
          </div>
        </div>
        <div class="form-group slim">
          <label for="${idBase}-ax">${labelAnchorX()}</label>
          <div class="form-fields">
            <input type="number" id="${idBase}-ax" data-lichsoma-cp="anchorX" min="0" max="1" step="${CP_ANCHOR_STEP}" />
          </div>
        </div>
        <div class="form-group slim">
          <label for="${idBase}-ay">${labelAnchorY()}</label>
          <div class="form-fields">
            <input type="number" id="${idBase}-ay" data-lichsoma-cp="anchorY" min="0" max="1" step="${CP_ANCHOR_STEP}" />
          </div>
        </div>
      </div>
      <div class="lichsoma-chat-portrait-token-preview-wrap lichsoma-preview-empty">
        <div class="lichsoma-chat-portrait-token-viewport">
          <img class="lichsoma-chat-portrait-token-preview" alt="" />
        </div>
      </div>
    </div>
  `;

  const imagePathGroup = findImagePathFormGroup(appearance);
  if (imagePathGroup) imagePathGroup.insertAdjacentElement('afterend', fieldset);
  else appearance.appendChild(fieldset);

  bindChatPortraitPreview(appearance, fieldset, app);
}

Hooks.on('init', () => {
  Hooks.on('renderApplicationV2', (app, html) => {
    if (app.constructor?.name !== 'PrototypeTokenConfig') return;
    injectAppearanceFields(app, html);
  });
});
