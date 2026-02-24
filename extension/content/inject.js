/**
 * Content script: 在页面注入浮动按钮，点击后打开 AgentStudio 侧边栏；图标可拖动并记住位置。
 */
(function () {
  const ROOT_ID = 'agentstudio-floating-root';
  const STORAGE_KEY = 'agentstudio_floating_pos';
  const BTN_SIZE = 48;
  const PADDING = 8;
  const DRAG_THRESHOLD = 5;

  if (document.getElementById(ROOT_ID)) return;

  function clamp(val, min, max) {
    return Math.max(min, Math.min(max, val));
  }

  function getDefaultPosition() {
    return {
      left: window.innerWidth - BTN_SIZE - 24,
      top: window.innerHeight - BTN_SIZE - 24,
    };
  }

  function loadPosition() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return getDefaultPosition();
      const { left, top } = JSON.parse(raw);
      if (typeof left !== 'number' || typeof top !== 'number') return getDefaultPosition();
      return {
        left: clamp(left, PADDING, window.innerWidth - BTN_SIZE - PADDING),
        top: clamp(top, PADDING, window.innerHeight - BTN_SIZE - PADDING),
      };
    } catch {
      return getDefaultPosition();
    }
  }

  function savePosition(left, top) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ left, top }));
    } catch (_) {}
  }

  function applyPosition(el, left, top) {
    const L = clamp(left, PADDING, window.innerWidth - BTN_SIZE - PADDING);
    const T = clamp(top, PADDING, window.innerHeight - BTN_SIZE - PADDING);
    el.style.left = L + 'px';
    el.style.top = T + 'px';
    return { left: L, top: T };
  }

  const root = document.createElement('div');
  root.id = ROOT_ID;
  const pos = loadPosition();
  root.style.left = pos.left + 'px';
  root.style.top = pos.top + 'px';

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.setAttribute('aria-label', 'Open AgentStudio');
  btn.className = 'agentstudio-floating-btn';
  btn.innerHTML = `
    <svg class="agentstudio-floating-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v18m0 0h10a2 2 0 0 0 2-2V9M9 21H5a2 2 0 0 1-2-2V9m0 0h18"/>
    </svg>
  `;

  let dragState = null;

  btn.addEventListener('mousedown', function (e) {
    if (e.button !== 0) return;
    e.preventDefault();
    const rect = root.getBoundingClientRect();
    dragState = {
      startX: e.clientX,
      startY: e.clientY,
      startLeft: rect.left,
      startTop: rect.top,
      moved: false,
    };
  });

  document.addEventListener('mousemove', function (e) {
    if (!dragState) return;
    const dx = e.clientX - dragState.startX;
    const dy = e.clientY - dragState.startY;
    if (!dragState.moved && (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD)) {
      dragState.moved = true;
    }
    if (!dragState.moved) return;
    const { left, top } = applyPosition(root, dragState.startLeft + dx, dragState.startTop + dy);
    dragState.savedLeft = left;
    dragState.savedTop = top;
  });

  document.addEventListener('mouseup', function (e) {
    if (e.button !== 0 || !dragState) return;
    if (dragState.moved) {
      savePosition(dragState.savedLeft ?? dragState.startLeft, dragState.savedTop ?? dragState.startTop);
    } else {
      chrome.runtime.sendMessage({ action: 'openSidePanel', openToRecent: true }).catch(() => {});
    }
    dragState = null;
  });

  window.addEventListener('resize', function () {
    const rect = root.getBoundingClientRect();
    const { left, top } = applyPosition(root, rect.left, rect.top);
    savePosition(left, top);
  });

  root.appendChild(btn);
  document.body.appendChild(root);
})();
