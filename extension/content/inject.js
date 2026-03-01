/**
 * Content script: 在页面注入浮动按钮，点击后打开 AgentStudio 侧边栏；图标可拖动并记住位置。
 */
(function () {
  const ROOT_ID = 'agentstudio-floating-root';
  const STORAGE_KEY = 'agentstudio_floating_pos';
  const BTN_SIZE = 36;
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
    <svg class="agentstudio-floating-icon" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M18 12h64a10 10 0 0 1 10 10v56a10 10 0 0 1-10 10H30L14 98V22a10 10 0 0 1 10-10z" fill="#fff" stroke="#b8a99a" stroke-width="5" stroke-linejoin="round"/>
      <g transform="translate(52,50)" stroke="#e0784f" stroke-width="4.2" stroke-linecap="round">
        <line x1="0" y1="0" x2="0" y2="-22"/>
        <line x1="0" y1="0" x2="15.6" y2="-15.6"/>
        <line x1="0" y1="0" x2="22" y2="0"/>
        <line x1="0" y1="0" x2="15.6" y2="15.6"/>
        <line x1="0" y1="0" x2="0" y2="22"/>
        <line x1="0" y1="0" x2="-15.6" y2="15.6"/>
        <line x1="0" y1="0" x2="-22" y2="0"/>
        <line x1="0" y1="0" x2="-15.6" y2="-15.6"/>
        <line x1="0" y1="0" x2="-8" y2="-20"/>
        <line x1="0" y1="0" x2="8" y2="-20"/>
        <line x1="0" y1="0" x2="20" y2="-8"/>
        <line x1="0" y1="0" x2="20" y2="8"/>
        <line x1="0" y1="0" x2="8" y2="20"/>
        <line x1="0" y1="0" x2="-8" y2="20"/>
        <line x1="0" y1="0" x2="-20" y2="8"/>
        <line x1="0" y1="0" x2="-20" y2="-8"/>
      </g>
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
