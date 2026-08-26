const viewport = document.querySelector('.canvas__viewport');
let notes = document.querySelectorAll('.note');

// Place notes at their world coordinates (data-x / data-y, set in HTML).
notes.forEach((note) => {
  note.style.left = `${note.dataset.x}px`;
  note.style.top = `${note.dataset.y}px`;
});

// Center the viewport's camera on a cluster of notes, based on their
// actual positions and the viewport's own size - not a fixed offset, so
// it stays centered regardless of window size or which notes are shown.
function centerViewportOn(noteList, { smooth = true } = {}) {
  if (!noteList.length || !viewport) return;
  const centers = noteList.map((n) => ({
    x: parseFloat(n.style.left) + n.offsetWidth / 2,
    y: parseFloat(n.style.top) + n.offsetHeight / 2,
  }));
  const cx = centers.reduce((sum, p) => sum + p.x, 0) / centers.length;
  const cy = centers.reduce((sum, p) => sum + p.y, 0) / centers.length;
  viewport.scrollTo({
    left: cx - viewport.clientWidth / 2,
    top: cy - viewport.clientHeight / 2,
    behavior: smooth ? 'smooth' : 'auto',
  });
}

// Center the initial scroll on the note cluster so the board opens
// centered on the archived sessions, even though they live inside a
// 5000x5000 scrollable world.
centerViewportOn([...notes], { smooth: false });

// --- Drag notes around the board (a plain click with no movement opens
// that archived session's recap instead) ---
let dragTarget = null;
let dragOffsetX = 0;
let dragOffsetY = 0;
let dragStartClientX = 0;
let dragStartClientY = 0;
let dragMoved = false;

function pointerToWorld(e) {
  const rect = viewport.getBoundingClientRect();
  return {
    x: e.clientX - rect.left + viewport.scrollLeft,
    y: e.clientY - rect.top + viewport.scrollTop,
  };
}

function onPointerDown(e) {
  const note = e.currentTarget;
  const p = pointerToWorld(e);
  dragTarget = note;
  dragOffsetX = p.x - parseFloat(note.style.left);
  dragOffsetY = p.y - parseFloat(note.style.top);
  dragStartClientX = e.clientX;
  dragStartClientY = e.clientY;
  dragMoved = false;
  note.classList.add('is-dragging');
  try {
    note.setPointerCapture(e.pointerId);
  } catch {
    // no active pointer with this id (e.g. a synthetic/replayed event) -
    // dragging still works fine without capture, just don't let it throw
    // and skip the rest of the interaction (including opening on click).
  }
  e.stopPropagation();
}

function onPointerMove(e) {
  if (!dragTarget) return;
  if (!dragMoved && Math.hypot(e.clientX - dragStartClientX, e.clientY - dragStartClientY) > 4) {
    dragMoved = true;
  }
  const p = pointerToWorld(e);
  const x = p.x - dragOffsetX;
  const y = p.y - dragOffsetY;
  dragTarget.style.left = `${x}px`;
  dragTarget.style.top = `${y}px`;
  dragTarget.dataset.x = x;
  dragTarget.dataset.y = y;
}

function onPointerUp(e) {
  if (!dragTarget) return;
  const note = dragTarget;
  dragTarget.classList.remove('is-dragging');
  try {
    dragTarget.releasePointerCapture(e.pointerId);
  } catch {
    // capture may already be gone - nothing to release, and this must not
    // stop the click-to-open-archive logic below.
  }
  dragTarget = null;
  if (!dragMoved) openArchiveSession(note);
}

notes.forEach((note) => {
  note.addEventListener('pointerdown', onPointerDown);
  note.addEventListener('pointermove', onPointerMove);
  note.addEventListener('pointerup', onPointerUp);
});

// --- Folder switching: filter the board's notes by folder, like tabs ---
let folderButtons = document.querySelectorAll('.folder[data-folder]');
const canvasTitle = document.querySelector('.canvas__title');

function selectFolder(key) {
  const wasAlreadyActive = [...folderButtons].some(
    (b) => b.dataset.folder === key && b.classList.contains('folder--active')
  );

  folderButtons.forEach((btn) => {
    btn.classList.toggle('folder--active', btn.dataset.folder === key);
  });

  const activeBtn = [...folderButtons].find((b) => b.dataset.folder === key);
  if (canvasTitle && activeBtn) {
    canvasTitle.textContent = activeBtn.querySelector('.folder__name').textContent;
  }

  // Play the "folder opens, papers spring out" animation whenever a
  // different folder becomes active (skip if re-clicking the same one).
  if (activeBtn && !wasAlreadyActive) {
    activeBtn.classList.remove('folder--just-activated');
    // Force reflow so the animation restarts even if it was mid-play.
    void activeBtn.offsetWidth;
    activeBtn.classList.add('folder--just-activated');
    // The button and its papers run several staggered animations at once
    // (last one ends around 0.51s) - a fixed timeout removes the class
    // once ALL of them are done, instead of racing individual animationend
    // events (which bubble from children and would cut the rest short).
    setTimeout(() => activeBtn.classList.remove('folder--just-activated'), 550);
  }

  const visibleNotes = [];
  notes.forEach((note) => {
    const show = key === 'all' || note.dataset.folder === key;
    note.style.display = show ? '' : 'none';
    if (show) visibleNotes.push(note);
  });

  centerViewportOn(visibleNotes);
}

folderButtons.forEach((btn) => {
  btn.addEventListener('click', () => selectFolder(btn.dataset.folder));
});

// --- "New folder" modal: adds a real, working folder to the sidebar ---
const folderModal = document.getElementById('folder-modal');
const folderNewBtn = document.getElementById('folder-new-btn');
const folderTitleInput = document.getElementById('folder-title-input');
const folderCreateBtn = document.getElementById('folder-create-btn');
const folderList = document.querySelector('.folder-list');
const folderMoveField = document.getElementById('folder-move-field');
const folderMovePill = document.getElementById('folder-move-pill');
const folderMoveList = document.getElementById('folder-move-list');
let folderCount = folderButtons.length;
let moveListOpen = false;

// The events list is the board's real session data - both the hardcoded
// upcoming events and any auto-saved drafts (see syncDraftCard) live there.
function getMovableSessions() {
  return [...document.querySelectorAll('.events__list .event')];
}

function sessionTitle(el) {
  return el.querySelector('h2, h3')?.textContent.trim() || 'Untitled session';
}

function setMoveListOpen(open) {
  if (!folderMoveList || !folderMovePill) return;
  const reallyOpen = open && !folderMovePill.disabled;
  moveListOpen = reallyOpen;
  folderMoveList.hidden = !reallyOpen;
  folderMovePill.classList.toggle('is-open', reallyOpen);
  if (reallyOpen) {
    const sessions = getMovableSessions();
    folderMoveList.innerHTML = sessions
      .map((el, i) => `
        <label class="modal__move-row">
          <input type="checkbox" data-session-index="${i}">
          <span></span>
        </label>
      `)
      .join('');
    // textContent, not innerHTML, so a session title can't inject markup.
    folderMoveList.querySelectorAll('.modal__move-row span').forEach((span, i) => {
      span.textContent = sessionTitle(sessions[i]);
    });
    folderMoveList._sessions = sessions;
  }
}

function updateFolderMoveState() {
  if (!folderMoveField || !folderMovePill) return;
  const hasSessions = getMovableSessions().length > 0;
  folderMoveField.classList.toggle('is-disabled', !hasSessions);
  folderMovePill.disabled = !hasSessions;
  folderMoveField.title = hasSessions ? '' : 'Nothing to move yet - the board has no sessions';
  if (!hasSessions) setMoveListOpen(false);
}

const folderModalTitle = folderModal?.querySelector('.modal__title');
let editingFolderBtn = null;

function openFolderModal(folderToEdit = null) {
  if (!folderModal) return;
  editingFolderBtn = folderToEdit;

  if (folderModalTitle) folderModalTitle.textContent = editingFolderBtn ? 'Rename folder' : 'New folder';
  if (folderCreateBtn) folderCreateBtn.textContent = editingFolderBtn ? 'Save' : 'Create folder';
  if (folderMoveField) folderMoveField.hidden = !!editingFolderBtn;
  if (folderTitleInput) {
    folderTitleInput.value = editingFolderBtn?.querySelector('.folder__name')?.textContent || '';
  }
  updateFolderCreateState();

  folderModal.hidden = false;
  void folderModal.offsetWidth;
  folderModal.classList.add('is-open');
  updateFolderMoveState();
  folderTitleInput?.focus();
  folderTitleInput?.select();
}

function closeFolderModal() {
  if (!folderModal) return;
  folderModal.classList.remove('is-open');
  setTimeout(() => {
    folderModal.hidden = true;
    // A folder can't be created without a title, so a blank field is the
    // only sane state to hand back the next time this modal opens.
    if (folderTitleInput) folderTitleInput.value = '';
    editingFolderBtn = null;
    if (folderModalTitle) folderModalTitle.textContent = 'New folder';
    if (folderCreateBtn) folderCreateBtn.textContent = 'Create folder';
    if (folderMoveField) folderMoveField.hidden = false;
    updateFolderCreateState();
    setMoveListOpen(false);
  }, 200);
}

function submitFolderModal() {
  const title = folderTitleInput.value.trim();
  if (!title) return;
  if (editingFolderBtn) {
    editingFolderBtn.querySelector('.folder__name').textContent = title;
    if (canvasTitle && editingFolderBtn.classList.contains('folder--active')) {
      canvasTitle.textContent = title;
    }
  } else {
    createFolder(title);
  }
  closeFolderModal();
}

function updateFolderCreateState() {
  if (!folderCreateBtn || !folderTitleInput) return;
  folderCreateBtn.disabled = folderTitleInput.value.trim().length === 0;
}

function createFolder(rawTitle) {
  const title = rawTitle.trim();
  if (!title || !folderList) return;

  const key = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || `folder-${Date.now()}`;
  folderCount += 1;

  // Tag whichever sessions were checked in the "move existing sessions"
  // list with the new folder's key - doesn't move them visually yet (the
  // events list isn't folder-filtered), but the data is there for when it is.
  const checkedSessions = folderMoveList?.querySelectorAll('input[type="checkbox"]:checked') || [];
  const sessions = folderMoveList?._sessions || [];
  checkedSessions.forEach((cb) => {
    const el = sessions[Number(cb.dataset.sessionIndex)];
    if (el) el.dataset.folder = key;
  });

  const item = document.createElement('div');
  item.className = 'folder-item';
  item.innerHTML = `
    <button class="folder" data-folder="${key}">
      <div class="folder__stack"></div>
      <div class="folder__papers"></div>
      <div class="folder__base"></div>
      <span class="folder__num">${String(folderCount).padStart(2, '0')}</span>
      <span class="folder__name"></span>
      <img class="folder__arrow" src="assets/img/icon-arrow-up-right.svg" alt="">
    </button>
  `;
  const btn = item.querySelector('.folder');
  btn.querySelector('.folder__name').textContent = title;
  btn.addEventListener('click', () => selectFolder(btn.dataset.folder));
  attachFolderMenu(item, btn);

  folderList.appendChild(item);
  // Refresh the snapshot selectFolder() loops over, same reason as
  // eventCards above - it was captured once and won't see new buttons.
  folderButtons = document.querySelectorAll('.folder[data-folder]');

  selectFolder(key);
}

folderNewBtn?.addEventListener('click', () => openFolderModal());
folderModal?.querySelectorAll('[data-folder-modal-close]').forEach((el) => {
  el.addEventListener('click', closeFolderModal);
});
folderMovePill?.addEventListener('click', () => setMoveListOpen(!moveListOpen));
folderTitleInput?.addEventListener('input', updateFolderCreateState);
folderTitleInput?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !folderCreateBtn.disabled) submitFolderModal();
});
folderCreateBtn?.addEventListener('click', () => {
  if (folderCreateBtn.disabled) return;
  submitFolderModal();
});
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && folderModal && !folderModal.hidden) closeFolderModal();
});

// --- Confirm dialog: an in-site-styled replacement for window.confirm /
// window.alert, sharing the same modal shell as "New folder". Resolves
// true on Confirm, false on Cancel/close. Pass cancelText: null for an
// alert-only (single button) dialog. ---
const confirmModal = document.getElementById('confirm-modal');
const confirmModalTitle = document.getElementById('confirm-modal-title');
const confirmModalMessage = document.getElementById('confirm-modal-message');
const confirmModalCancelBtn = document.getElementById('confirm-modal-cancel');
const confirmModalConfirmBtn = document.getElementById('confirm-modal-confirm');

function showConfirmDialog({ title, message, confirmText = 'Confirm', cancelText = 'Cancel' }) {
  return new Promise((resolve) => {
    if (!confirmModal) {
      resolve(window.confirm([title, message].filter(Boolean).join('\n')));
      return;
    }

    confirmModalTitle.textContent = title;
    confirmModalMessage.textContent = message;
    confirmModalConfirmBtn.textContent = confirmText;
    confirmModalCancelBtn.hidden = cancelText === null;
    confirmModalCancelBtn.textContent = cancelText || '';

    let settled = false;
    function finish(result) {
      if (settled) return;
      settled = true;
      confirmModal.classList.remove('is-open');
      setTimeout(() => {
        confirmModal.hidden = true;
      }, 200);
      cleanup();
      resolve(result);
    }
    function onConfirm() { finish(true); }
    function onCancel() { finish(false); }
    function onKeydown(e) {
      if (e.key === 'Escape') onCancel();
    }
    function cleanup() {
      confirmModalConfirmBtn.removeEventListener('click', onConfirm);
      confirmModalCancelBtn.removeEventListener('click', onCancel);
      confirmModal.querySelector('.modal__overlay')?.removeEventListener('click', onCancel);
      confirmModal.querySelector('.modal__close')?.removeEventListener('click', onCancel);
      window.removeEventListener('keydown', onKeydown);
    }

    confirmModalConfirmBtn.addEventListener('click', onConfirm);
    confirmModalCancelBtn.addEventListener('click', onCancel);
    confirmModal.querySelector('.modal__overlay')?.addEventListener('click', onCancel);
    confirmModal.querySelector('.modal__close')?.addEventListener('click', onCancel);
    window.addEventListener('keydown', onKeydown);

    confirmModal.hidden = false;
    void confirmModal.offsetWidth;
    confirmModal.classList.add('is-open');
    confirmModalConfirmBtn.focus();
  });
}

function showAlertDialog({ title, message, okText = 'OK' }) {
  return showConfirmDialog({ title, message, confirmText: okText, cancelText: null });
}

// --- Small "…" dropdown menus (folder options, move-session-to-folder) -
// shared close-all-open-menus bookkeeping so opening one closes any other,
// and an outside click/Escape closes whichever is open. ---
const closeOpenMenuFns = [];

function closeAllOpenMenus() {
  closeOpenMenuFns.forEach((close) => close());
}

document.addEventListener('click', closeAllOpenMenus);
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeAllOpenMenus();
});

async function deleteFolder(item, btn) {
  const key = btn.dataset.folder;
  const name = btn.querySelector('.folder__name')?.textContent || 'this folder';

  const confirmed = await showConfirmDialog({
    title: `Delete "${name}"?`,
    message: 'Deleting this folder will delete its contents. This can’t be undone.',
    confirmText: 'Delete',
    cancelText: 'Keep',
  });
  if (!confirmed) return;

  // Any folder can be deleted, empty or not - it takes its notes and
  // sessions down with it, per the warning above.
  document.querySelectorAll(`.note[data-folder="${key}"]`).forEach((n) => n.remove());
  notes = document.querySelectorAll('.note');
  document.querySelectorAll(`.events__list .event[data-folder="${key}"]`).forEach((e) => e.remove());
  eventCards = document.querySelectorAll('.event');

  const wasActive = btn.classList.contains('folder--active');
  item.remove();
  folderButtons = document.querySelectorAll('.folder[data-folder]');
  if (wasActive) selectFolder('all');
}

function attachFolderMenu(item, btn) {
  if (btn.dataset.folder === 'all') return;

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'folder-menu-trigger';
  trigger.title = 'Folder options';
  trigger.textContent = '⋯';

  const dropdown = document.createElement('div');
  dropdown.className = 'folder-menu-dropdown';
  dropdown.hidden = true;
  dropdown.innerHTML = `
    <button type="button" data-action="rename">Rename</button>
    <button type="button" data-action="delete">Delete</button>
  `;

  function closeMenu() {
    dropdown.hidden = true;
    trigger.classList.remove('is-open');
  }
  closeOpenMenuFns.push(closeMenu);

  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    const willOpen = dropdown.hidden;
    closeAllOpenMenus();
    dropdown.hidden = !willOpen;
    trigger.classList.toggle('is-open', willOpen);
  });

  dropdown.addEventListener('click', (e) => e.stopPropagation());
  dropdown.querySelector('[data-action="rename"]').addEventListener('click', () => {
    closeMenu();
    openFolderModal(btn);
  });
  dropdown.querySelector('[data-action="delete"]').addEventListener('click', () => {
    closeMenu();
    deleteFolder(item, btn);
  });

  item.appendChild(trigger);
  item.appendChild(dropdown);
}

document.querySelectorAll('.folder-item').forEach((item) => {
  const btn = item.querySelector('.folder[data-folder]');
  if (btn) attachFolderMenu(item, btn);
});

// --- "…" menu: move a session (a calendar/draft event card, or an
// archived session note on the board) into a folder, or clear it back to
// none. `onChange` lets a caller react to the move (e.g. a note updating
// its visible folder badge text) - the event cards don't need one. ---
function attachFolderMoveMenu(el, { onChange } = {}) {
  if (el.querySelector(':scope > .event-menu-trigger')) return; // already attached

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'event-menu-trigger';
  trigger.title = 'Move to folder';
  trigger.textContent = '⋯';
  // Stops a note's own drag-start handler (also bound on pointerdown) from
  // firing when the trigger sitting inside it is pressed.
  trigger.addEventListener('pointerdown', (e) => e.stopPropagation());

  const dropdown = document.createElement('div');
  dropdown.className = 'event-menu-dropdown';
  dropdown.hidden = true;
  dropdown.addEventListener('pointerdown', (e) => e.stopPropagation());

  function closeMenu() {
    dropdown.hidden = true;
    trigger.classList.remove('is-open');
  }
  closeOpenMenuFns.push(closeMenu);

  function renderDropdown() {
    const currentFolder = el.dataset.folder || '';
    const realFolders = [...folderButtons].filter((b) => b.dataset.folder !== 'all');
    const rows = realFolders.map((b) => {
      const key = b.dataset.folder;
      const name = b.querySelector('.folder__name')?.textContent || key;
      const current = key === currentFolder ? ' is-current' : '';
      return `<button type="button" class="${current.trim()}" data-folder-key="${key}" data-folder-name="${name}">${name}</button>`;
    });
    dropdown.innerHTML = `
      <span class="event-menu-dropdown__label">Move to folder</span>
      ${rows.join('') || '<span class="event-menu-dropdown__label">No folders yet</span>'}
      ${currentFolder ? '<button type="button" data-folder-key="">No folder</button>' : ''}
    `;
    dropdown.querySelectorAll('[data-folder-key]').forEach((row) => {
      row.addEventListener('click', () => {
        const key = row.dataset.folderKey;
        if (key) el.dataset.folder = key;
        else delete el.dataset.folder;
        closeMenu();
        onChange?.(key, row.dataset.folderName || '');
      });
    });
  }

  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    const willOpen = dropdown.hidden;
    closeAllOpenMenus();
    if (willOpen) renderDropdown();
    dropdown.hidden = !willOpen;
    trigger.classList.toggle('is-open', willOpen);
  });
  dropdown.addEventListener('click', (e) => e.stopPropagation());

  el.appendChild(trigger);
  el.appendChild(dropdown);
}

document.querySelectorAll('.events__list .event').forEach((el) => attachFolderMoveMenu(el));

// Archived session notes on the board get the same menu - moving one also
// updates its visible folder badge text, since that's separate from the
// data-folder attribute the board's folder filter actually reads.
notes.forEach((note) => {
  attachFolderMoveMenu(note, {
    onChange(key, name) {
      const badge = note.querySelector('.badge');
      if (badge) badge.textContent = key ? name : 'No folder';
    },
  });
});

// --- Star: one consistent toggle everywhere (event cards, notes) instead
// of a star hardcoded on a single "featured" card and a flag on the rest. ---
const CARD_STAR_PATH = 'M18.1033 10.8166C18.4701 10.0735 19.5299 10.0735 19.8967 10.8166L21.8576 14.7891C22.0031 15.0839 22.2843 15.2884 22.6096 15.336L26.9962 15.9771C27.8161 16.097 28.1429 17.1048 27.5493 17.683L24.3768 20.773C24.1409 21.0027 24.0333 21.3339 24.0889 21.6584L24.8374 26.0226C24.9775 26.8396 24.12 27.4626 23.3864 27.0767L19.4655 25.0148C19.1741 24.8615 18.8259 24.8615 18.5345 25.0148L14.6136 27.0767C13.88 27.4626 13.0225 26.8396 13.1626 26.0226L13.9111 21.6584C13.9667 21.3339 13.8591 21.0027 13.6232 20.773L10.4507 17.683C9.85708 17.1048 10.1839 16.097 11.0038 15.9771L15.3904 15.336C15.7157 15.2884 15.9969 15.0839 16.1424 14.7891L18.1033 10.8166Z';
const CARD_STAR_ICON = `
  <svg class="card-star__outline" viewBox="0 0 38 38" width="16" height="16" fill="none">
    <path d="${CARD_STAR_PATH}" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
  </svg>
  <svg class="card-star__filled" viewBox="0 0 38 38" width="16" height="16" fill="none" hidden>
    <path d="${CARD_STAR_PATH}" fill="currentColor"/>
  </svg>
`;

function setCardStarState(btn, starred) {
  btn.classList.toggle('is-starred', starred);
  btn.setAttribute('aria-pressed', String(starred));
  btn.querySelector('.card-star__outline').hidden = starred;
  btn.querySelector('.card-star__filled').hidden = !starred;
}

function initCardStar(slot) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'card-star';
  btn.title = 'Star';
  btn.innerHTML = CARD_STAR_ICON;

  // The one card built with the special "up next" blue treatment: its
  // star IS what puts it in that state, not just a fill color - un-star
  // it and it settles back to looking like every other card.
  const card = slot.closest('.event');
  const controlsFeatured = card?.classList.contains('event--featured') ?? false;

  setCardStarState(btn, slot.dataset.starred === 'true');
  // Same reasons as the folder-move trigger: don't let this bubble into a
  // note's own drag/click handling or an event card's "open New session".
  btn.addEventListener('pointerdown', (e) => e.stopPropagation());
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const starred = !btn.classList.contains('is-starred');
    setCardStarState(btn, starred);
    if (controlsFeatured) card.classList.toggle('event--featured', starred);
  });
  slot.replaceWith(btn);
}

document.querySelectorAll('.card-star-slot').forEach(initCardStar);

// --- Event tabs: clicking filters the events list by date, single-select ---
const eventTabs = document.querySelectorAll('.events__tab');
let eventCards = document.querySelectorAll('.event');

function selectEventTab(key) {
  eventTabs.forEach((t) => {
    t.classList.toggle('events__tab--active', t.dataset.tab === key);
  });
  eventCards.forEach((card) => {
    const show = key === 'all' || card.dataset.tab === key;
    card.style.display = show ? '' : 'none';
  });
}

eventTabs.forEach((tab) => {
  tab.addEventListener('click', () => selectEventTab(tab.dataset.tab));
});

// --- Tools: "select" (default, always clicks) vs "pan" (hand tool, opt-in) ---
let activeTool = 'select';
let spaceHeld = false;

const toolButtons = document.querySelectorAll('.toolbar__tool');

function setTool(tool) {
  activeTool = tool;
  spaceHeld = false; // switching tools always clears any stuck "space held" state
  toolButtons.forEach((btn) => {
    btn.classList.toggle('toolbar__tool--active', btn.dataset.tool === tool);
  });
  if (viewport) {
    viewport.classList.toggle('is-hand-tool', tool === 'pan');
  }
}

toolButtons.forEach((btn) => {
  btn.addEventListener('click', () => setTool(btn.dataset.tool));
});

function isTypingTarget(el) {
  return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
}

window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') {
    // Let Space type a normal space in text fields (title, message, etc.)
    // instead of hijacking it for the board's hand-tool pan shortcut.
    if (isTypingTarget(document.activeElement)) return;
    // Always prevent the browser's default "page down" scroll, on every
    // repeated keydown while held, not just the first press.
    e.preventDefault();
    if (!e.repeat) {
      spaceHeld = true;
      viewport?.classList.add('is-hand-tool');
    }
  }
});

window.addEventListener('keyup', (e) => {
  if (e.code === 'Space') {
    spaceHeld = false;
    if (activeTool !== 'pan') viewport?.classList.remove('is-hand-tool');
  }
});

// Safety net: if the window/tab loses focus while Space is held (alt-tab,
// clicking outside the browser), no keyup ever fires and spaceHeld would
// otherwise stay stuck true forever, silently keeping pan mode alive even
// after switching back to the select tool.
window.addEventListener('blur', () => {
  spaceHeld = false;
  if (activeTool !== 'pan') viewport?.classList.remove('is-hand-tool');
});

// Panning is opt-in: the hand tool is active, Space is held, or the
// middle mouse button is used. Plain left-click stays a normal click
// (select tool), and the board still pans via wheel/trackpad scroll.
function canPan(e) {
  return e.button === 1 || activeTool === 'pan' || spaceHeld;
}

// --- Hand tool: drag empty board space to pan around, like in Figma ---
let panTarget = null;
let panStartX = 0;
let panStartY = 0;
let panScrollLeft = 0;
let panScrollTop = 0;

function onPanStart(e) {
  if (dragTarget) return; // a note is being dragged, don't also pan
  if (!canPan(e)) return;
  panTarget = viewport;
  panStartX = e.clientX;
  panStartY = e.clientY;
  panScrollLeft = viewport.scrollLeft;
  panScrollTop = viewport.scrollTop;
  viewport.classList.add('is-panning');
  viewport.setPointerCapture(e.pointerId);
  e.preventDefault();
}

function onPanMove(e) {
  if (!panTarget) return;
  viewport.scrollLeft = panScrollLeft - (e.clientX - panStartX);
  viewport.scrollTop = panScrollTop - (e.clientY - panStartY);
}

function onPanEnd(e) {
  if (!panTarget) return;
  panTarget = null;
  viewport.classList.remove('is-panning');
  try {
    viewport.releasePointerCapture(e.pointerId);
  } catch {
    // capture may already be gone (e.g. lost on blur) - nothing to release
  }
}

if (viewport) {
  viewport.addEventListener('pointerdown', onPanStart);
  viewport.addEventListener('pointermove', onPanMove);
  viewport.addEventListener('pointerup', onPanEnd);
  viewport.addEventListener('pointercancel', onPanEnd);
  // Extra safety: if the pointer is released anywhere else (outside the
  // viewport, e.g. capture got lost), still end the pan instead of leaving
  // it stuck mid-drag.
  window.addEventListener('pointerup', onPanEnd);
  window.addEventListener('blur', onPanEnd);
}

// --- "Create new session" modal ---
const sessionModal = document.getElementById('session-modal');
const ctaButton = document.querySelector('.cta');
const modalTitleInput = document.getElementById('modal-title-input');
const modalMessageInput = document.getElementById('modal-message-input');
const modalPeopleInput = document.getElementById('modal-people-input');
const modalContinueBtn = document.getElementById('modal-continue-btn');

function updateContinueState() {
  const ready = modalTitleInput.value.trim().length > 0 && modalMessageInput.value.trim().length > 0;
  modalContinueBtn.classList.toggle('is-ready', ready);
  modalContinueBtn.disabled = !ready;
}

function openModal({ focusTitle = true } = {}) {
  sessionModal.hidden = false;
  // Force reflow so the opacity/transform transition actually plays
  // instead of jumping straight to the open state.
  void sessionModal.offsetWidth;
  sessionModal.classList.add('is-open');
  if (focusTitle) modalTitleInput?.focus();
}

function closeModal() {
  sessionModal.classList.remove('is-open');
  setTimeout(() => {
    sessionModal.hidden = true;
  }, 200);
}

ctaButton?.addEventListener('click', openModal);

function closeModalAndReset() {
  closeModal();
  // Only the "Compare" recap screen ends the session for good - closing from
  // there should land back on a fresh "Prepare" step next time it's opened.
  if (modalRecap && !modalRecap.hidden) setTimeout(resetToBeforeScreen, 200);
}

sessionModal?.querySelectorAll('[data-modal-close]').forEach((el) => {
  el.addEventListener('click', closeModalAndReset);
});

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !sessionModal.hidden) closeModalAndReset();
});

// --- "Pick date" pill: toggles the "Upcoming events" side panel (same
// agenda as the main board), used to pick a date/event for the session. ---
const datePill = document.getElementById('modal-date-pill');
const calendarPanel = document.getElementById('modal-calendar');
const calendarEvents = calendarPanel?.querySelectorAll('.modal__cal-event');

function setCalendarOpen(open) {
  if (open) {
    // Only one side panel at a time - they share the same slot next to the card.
    if (!peoplePanel?.hidden) setPeoplePanelOpen(false);
    calendarPanel.hidden = false;
    void calendarPanel.offsetWidth; // force reflow so the transition plays
    calendarPanel.classList.add('is-open');
  } else {
    calendarPanel.classList.remove('is-open');
    setTimeout(() => {
      calendarPanel.hidden = true;
    }, 350);
  }
  if (!datePill.classList.contains('has-value')) {
    datePill.textContent = open ? 'Close calendar' : 'Pick date';
  }
}

datePill?.addEventListener('click', () => {
  if (!calendarPanel) return;
  setCalendarOpen(calendarPanel.hidden);
});

const NAME_POOL = ['Olivia Chen', 'Mark Evans', 'Marina Kim', 'Sophia Reed'];
let selectedCalendarEvent = null;

function pickCalendarEvent(event) {
  if (selectedCalendarEvent && selectedCalendarEvent !== event) {
    selectedCalendarEvent.classList.remove('modal__cal-event--selected');
    const prevAdd = selectedCalendarEvent.querySelector('.modal__cal-add');
    if (prevAdd) prevAdd.textContent = 'Add';
  }
  selectedCalendarEvent = event;
  event.classList.add('modal__cal-event--selected');
  const addBtn = event.querySelector('.modal__cal-add');
  if (addBtn) addBtn.textContent = 'Remove';

  // Date, shown on the "Pick date" pill.
  datePill.dataset.day = event.dataset.day;
  datePill.dataset.month = event.dataset.month;

  // Title.
  if (modalTitleInput) {
    modalTitleInput.value = event.dataset.title || '';
    updateContinueState();
  }

  // Participants: one name per avatar shown on the event card (a 1:1
  // event with a single avatar adds just that one person).
  if (modalPeopleInput) {
    const avatarCount = event.querySelectorAll('.avatar-stack .avatar').length || 1;
    setSelectedNames(NAME_POOL.slice(0, avatarCount));
  }

  setCalendarOpen(false);
  datePill.textContent = `${event.dataset.day} ${event.dataset.month}`;
  datePill.classList.add('has-value');
  updatePeoplePillState();
  syncDraftCard();
}

// Clicking an upcoming event card on the board itself (not the calendar
// panel inside the modal) opens "New session" pre-filled with that
// event's title and people - a quick way to start the session it's for.
function pickBoardEvent(eventEl) {
  // Open first - setSelectedNames measures the people textarea's height
  // via scrollHeight, which reads as 0 while the modal is still
  // display:none, leaving the field looking blank even though it has a
  // value.
  openModal({ focusTitle: false });

  const title = eventEl.querySelector('h2, h3')?.textContent.trim() || '';

  // The board's event list and the modal's own calendar panel are two
  // separate copies of the same events - if this one also exists there,
  // reuse pickCalendarEvent so the date gets set and that card shows as
  // added too, instead of drifting out of sync with what we just filled in.
  const matchingCalEvent = calendarEvents
    ? [...calendarEvents].find((ce) => ce.dataset.title === title)
    : null;
  if (matchingCalEvent) {
    pickCalendarEvent(matchingCalEvent);
    return;
  }

  if (modalTitleInput) {
    modalTitleInput.value = title;
    updateContinueState();
  }

  const avatarCount = eventEl.querySelectorAll('.avatar-stack .avatar').length || 1;
  setSelectedNames(NAME_POOL.slice(0, avatarCount));
  syncDraftCard();
}

document.querySelector('.events__list')?.addEventListener('click', (e) => {
  const card = e.target.closest('.event');
  if (!card || card.classList.contains('event--draft')) return;
  pickBoardEvent(card);
});

function clearCalendarSelection() {
  if (!selectedCalendarEvent) return;
  selectedCalendarEvent.classList.remove('modal__cal-event--selected');
  const addBtn = selectedCalendarEvent.querySelector('.modal__cal-add');
  if (addBtn) addBtn.textContent = 'Add';
  selectedCalendarEvent = null;

  datePill.textContent = 'Pick date';
  datePill.classList.remove('has-value');
  if (modalTitleInput) {
    modalTitleInput.value = '';
    updateContinueState();
  }
  setSelectedNames([]);
  updatePeoplePillState();
}

calendarEvents?.forEach((event) => {
  event.addEventListener('click', () => pickCalendarEvent(event));
  event.querySelector('.modal__cal-add')?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (event === selectedCalendarEvent) clearCalendarSelection();
    else pickCalendarEvent(event);
  });
  attachFolderMoveMenu(event);
});

// --- "Select people" side panel: same open/close pattern as the calendar ---
const peoplePill = document.getElementById('modal-people-pill');
const peoplePanel = document.getElementById('modal-people-panel');
const personRows = peoplePanel?.querySelectorAll('.modal__person');

function getSelectedNames() {
  return modalPeopleInput.value.split(',').map((n) => n.trim()).filter(Boolean);
}

function resizePeopleInput() {
  modalPeopleInput.style.height = 'auto';
  modalPeopleInput.style.height = `${modalPeopleInput.scrollHeight}px`;
}

function syncPersonRows(names) {
  personRows?.forEach((row) => {
    const added = names.includes(row.dataset.name);
    row.classList.toggle('is-added', added);
    const addBtn = row.querySelector('.modal__cal-add');
    if (addBtn) addBtn.textContent = added ? 'Remove' : 'Add';
  });
}

function setSelectedNames(names) {
  modalPeopleInput.value = names.join(', ');
  resizePeopleInput();
  syncPersonRows(names);
}

// Manual typing works too - just keep the panel's "Add" state and the
// field's height in sync with whatever the person actually typed.
modalPeopleInput?.addEventListener('input', () => {
  resizePeopleInput();
  syncPersonRows(getSelectedNames());
});

function setPeoplePanelOpen(open) {
  if (open) {
    // Only one side panel at a time - they share the same slot next to the card.
    if (!calendarPanel?.hidden) setCalendarOpen(false);
    peoplePanel.hidden = false;
    void peoplePanel.offsetWidth;
    peoplePanel.classList.add('is-open');
  } else {
    peoplePanel.classList.remove('is-open');
    setTimeout(() => {
      peoplePanel.hidden = true;
    }, 350);
  }
  peoplePill.textContent = open ? 'Close' : 'Select people';
}

// People selection used to require a date to be picked first, but that
// gate had no real functional reason and just got in the way (e.g. a
// board event card fills in people with no date at all). Left as a
// no-op function since other code still calls it after changing the
// date/people state.
function updatePeoplePillState() {}

peoplePill?.addEventListener('click', () => {
  if (!peoplePanel) return;
  setPeoplePanelOpen(peoplePanel.hidden);
});

personRows?.forEach((row) => {
  row.addEventListener('click', () => {
    const names = getSelectedNames();
    const i = names.indexOf(row.dataset.name);
    if (i === -1) names.push(row.dataset.name);
    else names.splice(i, 1);
    setSelectedNames(names);
  });
});

modalTitleInput?.addEventListener('input', updateContinueState);
modalMessageInput?.addEventListener('input', updateContinueState);

// --- Draft auto-save: closing the modal (X / overlay click / Escape) must
// never silently destroy work. As soon as both the title and the message
// are filled in, the session is saved as a "Draft" card in the same
// events list real upcoming sessions live in - no separate draft store. ---
const eventsList = document.querySelector('.events__list');
let draftCard = null;

function draftDateLabel() {
  if (datePill?.classList.contains('has-value')) {
    return `${datePill.dataset.day} ${datePill.dataset.month}`;
  }
  return 'No date yet';
}

function removeDraftCard() {
  draftCard?.remove();
  draftCard = null;
  if (eventsList) eventCards = document.querySelectorAll('.event');
}

function syncDraftCard() {
  const title = modalTitleInput?.value.trim() || '';
  const message = modalMessageInput?.value.trim() || '';

  if (!title || !message) {
    removeDraftCard();
    return;
  }

  // This session already IS an existing calendar event (picked from the
  // calendar panel, or from a board event card that matched one) - it has
  // its own real card in the list already, so a draft here would just be
  // a confusing duplicate with the same title.
  if (selectedCalendarEvent) {
    removeDraftCard();
    return;
  }

  if (!draftCard) {
    draftCard = document.createElement('article');
    draftCard.className = 'event event--draft';
    draftCard.dataset.tab = 'all';
    draftCard.innerHTML = `
      <div class="event__head">
        <h3></h3>
        <span class="event__draft-badge">Draft</span>
      </div>
      <p class="event__desc"></p>
      <div class="event__footer">
        <div class="event__tags">
          <span class="tag tag--draft">Draft</span>
          <span class="tag event__draft-date"></span>
        </div>
      </div>
    `;
    eventsList?.prepend(draftCard);
    eventCards = document.querySelectorAll('.event');
    attachFolderMoveMenu(draftCard);
  }

  draftCard.querySelector('h3').textContent = title;
  draftCard.querySelector('.event__desc').textContent = message;
  draftCard.querySelector('.event__draft-date').textContent = draftDateLabel();
}

modalTitleInput?.addEventListener('input', syncDraftCard);
modalMessageInput?.addEventListener('input', syncDraftCard);

// --- "Meeting" screen: swaps in once the "before" form is submitted ---
const modalStepLabel = document.getElementById('modal-step-label');
const modalBefore = document.getElementById('modal-before');
const modalMeet = document.getElementById('modal-meet');
const modalIntentionText = document.getElementById('modal-intention-text');
const modalWaveformBlob = document.querySelector('.modal__waveform-blob');
const modalWaveformPause = document.getElementById('modal-waveform-pause');
const modalWaveformIconPause = document.getElementById('modal-waveform-icon-pause');
const modalWaveformIconPlay = document.getElementById('modal-waveform-icon-play');
const modalTimerEl = document.getElementById('modal-timer');
const modalMinimizeBtn = document.getElementById('modal-minimize-btn');
const modalEndBtn = document.getElementById('modal-end-btn');
const modalStartBtn = document.getElementById('modal-start-btn');
const modalMeetActions = document.getElementById('modal-meet-actions');

let meetTimerId = null;
let meetSeconds = 0;
let meetPaused = false;

function formatTimerShort(totalSeconds) {
  const m = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
  const s = (totalSeconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

function formatTimerLong(totalSeconds) {
  const h = Math.floor(totalSeconds / 3600).toString().padStart(2, '0');
  const m = Math.floor((totalSeconds % 3600) / 60).toString().padStart(2, '0');
  const s = (totalSeconds % 60).toString().padStart(2, '0');
  return `${h}:${m}:${s}`;
}

function startMeetTimer() {
  stopMeetTimer();
  meetTimerId = setInterval(() => {
    if (meetPaused) return;
    meetSeconds += 1;
    if (modalTimerEl) modalTimerEl.textContent = formatTimerShort(meetSeconds);
    if (miniPlayerTimer) miniPlayerTimer.textContent = formatTimerLong(meetSeconds);
  }, 1000);
}

function stopMeetTimer() {
  if (meetTimerId) clearInterval(meetTimerId);
  meetTimerId = null;
}

function setMeetPaused(paused) {
  meetPaused = paused;
  modalWaveformBlob?.classList.toggle('is-paused', paused);
  miniPlayerBlob?.classList.toggle('is-paused', paused);
  window.voiceOrbs?.modal.setPaused(paused);
  window.voiceOrbs?.mini.setPaused(paused);

  // Button shows Play while stopped/paused, Pause once actually recording.
  if (modalWaveformIconPause) modalWaveformIconPause.hidden = paused;
  if (modalWaveformIconPlay) modalWaveformIconPlay.hidden = !paused;
  if (miniPlayerPauseIcon) miniPlayerPauseIcon.src = paused ? 'assets/img/icon-play-cream.svg' : 'assets/img/icon-pause-cream.svg';

  // Mic access is only requested the first time recording actually starts,
  // not just from opening the Meeting step.
  if (!paused) window.voiceOrbs?.start();
}

// A single requestAnimationFrame (or the orb's own ResizeObserver) isn't
// reliably catching the container's FINAL size right after it becomes
// visible - it sometimes fires mid-transition and locks in a wrong/stale
// canvas size (non-square, off-center orb). Calling resize() again on
// each of the next several frames is cheap and self-corrects once layout
// has actually settled, instead of gambling on catching it in one shot.
function resizeOrbSoon(orb, framesLeft = 12) {
  if (!orb || framesLeft <= 0) return;
  orb.resize();
  requestAnimationFrame(() => resizeOrbSoon(orb, framesLeft - 1));
}

function enterMeetingScreen() {
  // Close any open side panel (calendar / select people) - it belongs to
  // the "Prepare" step and shouldn't linger once we move past it.
  if (calendarPanel && !calendarPanel.hidden) setCalendarOpen(false);
  if (peoplePanel && !peoplePanel.hidden) setPeoplePanelOpen(false);

  // The session is actually starting now - it's no longer just a draft.
  removeDraftCard();

  if (modalStepLabel) modalStepLabel.textContent = 'Meeting';
  if (modalIntentionText) modalIntentionText.textContent = modalMessageInput?.value.trim() || '';
  if (modalBefore) modalBefore.hidden = true;
  if (modalMeet) modalMeet.hidden = false;
  // The orb's container was 0x0 while hidden - now that it's visible, give
  // it a real size over the next several frames (see resizeOrbSoon above).
  resizeOrbSoon(window.voiceOrbs?.modal);

  meetSeconds = 0;
  modalTimerEl.textContent = '00:00';
  if (miniPlayerTimer) miniPlayerTimer.textContent = '00:00:00';
  // Nothing is recording yet - the step is open, but the user still has to
  // press "Start session" before the timer and waveform actually start. Until
  // then it's just the intention text and a static (unanimated but
  // visible) orb - no pause button, no minimize/end-session row yet.
  setMeetPaused(true);
  startMeetTimer();
  if (modalStartBtn) modalStartBtn.hidden = false;
  if (modalWaveformPause) modalWaveformPause.hidden = true;
  if (modalMeetActions) modalMeetActions.hidden = true;
}

function resetToBeforeScreen() {
  stopMeetTimer();
  if (modalStepLabel) modalStepLabel.textContent = 'Prepare';
  if (modalBefore) modalBefore.hidden = false;
  if (modalMeet) modalMeet.hidden = true;
  if (modalRecap) modalRecap.hidden = true;
  modalCard?.classList.remove('is-recap');
  setMiniPlayerOpen(false);
}

// --- "Compare" screen: recap chat / transcript, shown once a session ends ---
const modalCard = document.querySelector('#session-modal .modal__card');
const modalRecap = document.getElementById('modal-recap');
const modalRecapTitle = document.getElementById('modal-recap-title');
const recapTabs = document.querySelectorAll('.modal__recap-tab');
const recapPanes = {
  chat: document.getElementById('recap-pane-chat'),
  transcript: document.getElementById('recap-pane-transcript'),
};
const recapAskRow = document.getElementById('recap-ask-row');
const recapSearchRow = document.getElementById('recap-search-row');

function setRecapTab(tab) {
  recapTabs.forEach((btn) => btn.classList.toggle('is-active', btn.dataset.recapTab === tab));
  Object.entries(recapPanes).forEach(([key, pane]) => {
    if (pane) pane.hidden = key !== tab;
  });
  if (recapAskRow) recapAskRow.hidden = tab !== 'chat';
  if (recapSearchRow) recapSearchRow.hidden = tab !== 'transcript';
}

recapTabs.forEach((btn) => {
  btn.addEventListener('click', () => setRecapTab(btn.dataset.recapTab));
});

function enterRecapScreen() {
  stopMeetTimer();
  window.voiceOrbs?.stop();
  if (modalStepLabel) modalStepLabel.textContent = 'Compare';
  if (modalRecapTitle) modalRecapTitle.textContent = modalTitleInput?.value.trim() || 'Product Roadmap Alignment';
  setRecapTab('chat');
  applyRecapContent(modalMessageInput?.value.trim() || '');
  if (modalMeet) modalMeet.hidden = true;
  if (modalRecap) modalRecap.hidden = false;
  modalCard?.classList.add('is-recap');
}

// --- Archived sessions: clicking a note on the board opens straight into
// its recap - no "Prepare"/"Meeting" steps, just Chat + Transcript. ---
function openArchiveSession(note) {
  const noteText = note.querySelector('.note__text')?.textContent.trim() || '';

  if (modalStepLabel) modalStepLabel.textContent = 'Archive';
  if (modalRecapTitle) modalRecapTitle.textContent = noteText || 'Archived session';
  setRecapTab('chat');
  applyRecapContent(noteText);

  if (modalBefore) modalBefore.hidden = true;
  if (modalMeet) modalMeet.hidden = true;
  if (modalRecap) modalRecap.hidden = false;
  modalCard?.classList.add('is-recap');

  openModal({ focusTitle: false });
}

// --- Chat pane: the quick-question chips and the "Ask about this session…"
// field both feed the same thread - canned answers, since there's no real
// assistant backing this practice project - in a real build these chips,
// the summary and the answers would all come from an LLM that actually
// read the transcript. Here they're derived with plain string heuristics
// from whatever the user typed (the session's intention, or an archived
// note's text), so at least they track the real content instead of
// showing the same fixed Figma placeholder every time. ---
const recapChatThread = document.getElementById('recap-chat-thread');
const recapSummaryEl = document.querySelector('.modal__recap-summary');
const recapChipsRow = document.getElementById('recap-chips');
const recapAskInput = document.getElementById('recap-ask-input');

let recapClauses = [];
let recapClauseRoles = {}; // clause (lowercase) -> 'main' | 'brief' | 'secondary'

// Strips leading filler so a raw clause like "I want to explain why the
// new navigation is simpler" becomes "why the new navigation is simpler"
// instead of dragging "I want to explain" into every chip/answer.
const RECAP_LEADING_INTENT_RE = /^(i want to|i'd like to|i plan to|i'm going to|i will|i need to|i'll)\s+/i;
const RECAP_FILLER_RE = /^(explain|discuss|share|present|cover|mention|talk about|walk (?:you |them )?through|plan(?:ned)? to)\s+(that\s+)?/i;
const RECAP_LEADING_CONJ_RE = /^(and|but)\s+/i;

function cleanClause(raw) {
  let c = raw.trim();
  c = c.replace(RECAP_LEADING_INTENT_RE, '');
  c = c.replace(RECAP_FILLER_RE, '');
  c = c.replace(RECAP_LEADING_CONJ_RE, '');
  return c.trim();
}

function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function splitIntoClauses(text) {
  return text
    .split(/\s*,\s*|\s+and\s+|\s+but\s+/i)
    .map(cleanClause)
    .filter((c) => c.length > 2);
}

function toQuestionLabel(clause) {
  const c = clause.replace(/[.?!]+$/, '');
  return `${c.charAt(0).toUpperCase()}${c.slice(1)}?`;
}

// Builds the recap summary paragraph + quick-question chips from whatever
// source text this session/note actually has, instead of hardcoded copy.
function applyRecapContent(sourceText) {
  // Drop any Q&A left over from whatever was open here before - a fresh
  // recap starts clean.
  recapChatThread?.querySelectorAll('.modal__recap-bubble').forEach((el) => el.remove());

  recapClauses = splitIntoClauses(sourceText);
  const highlights = recapClauses.slice(0, 3);
  recapClauseRoles = {};
  recapAnswerCounter = 0;

  if (recapSummaryEl) {
    if (sourceText && highlights.length) {
      const parts = highlights.map((c, i) => {
        const role = i === 0 ? 'main' : (i === highlights.length - 1 && highlights.length > 1 ? 'secondary' : 'brief');
        recapClauseRoles[c.toLowerCase()] = role;
        const span = `<span class="modal__recap-highlight" data-clause="${escapeHTML(c)}">${escapeHTML(c)}</span>`;
        if (role === 'main') return `focused mostly on ${span}`;
        if (role === 'secondary') return `presented ${span} as a secondary point`;
        return `mentioned ${span} only briefly`;
      });
      recapSummaryEl.innerHTML = `You planned to ${escapeHTML(sourceText)}. In the meeting, you ${parts.join(', ')}.`;
    } else {
      recapSummaryEl.textContent = sourceText
        ? `You planned to ${sourceText}.`
        : 'No intention was captured for this session.';
    }
  }

  renderRecapChips(recapClauses.slice(0, 4).map(toQuestionLabel));
}

function renderRecapChips(questions) {
  if (!recapChipsRow) return;
  recapChipsRow.innerHTML = '';
  questions.forEach((label) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'modal__recap-chip';
    chip.textContent = label;
    chip.addEventListener('click', () => {
      askRecapQuestion(label);
      chip.remove();
    });
    recapChipsRow.appendChild(chip);
  });
}

// Varied phrasing per clause "role" (how central it was to the session),
// so repeated or similar questions don't all get the same canned line back.
const RECAP_ANSWER_TEMPLATES = {
  main: [
    () => "That was the main focus - you spent most of the session there.",
    () => "Yes, that was front and center. It's what you spent the most time on.",
    () => "That one carried the meeting - everything else was secondary to it.",
  ],
  brief: [
    () => "That came up, but only briefly - it wasn't a major focus.",
    () => "It was mentioned, but didn't get much airtime.",
    () => "That one came up in passing rather than being dug into.",
  ],
  secondary: [
    () => "That was framed as a secondary point rather than the main argument.",
    () => "It was there, but more as a follow-up than the core message.",
    () => "That one took a back seat to the main point of the session.",
  ],
  fallback: [
    () => "That wasn't covered directly in this session, as far as this recap goes.",
    () => "Hard to say from this recap - it doesn't look like that came up.",
    () => "No mention of that here - might be worth asking about directly next time.",
  ],
};

let recapAnswerCounter = 0;

function recapAnswerFor(question) {
  const q = question.trim().toLowerCase().replace(/\?+$/, '');
  const match = recapClauses.find((c) => q.includes(c.toLowerCase()) || c.toLowerCase().includes(q));
  const role = match ? (recapClauseRoles[match.toLowerCase()] || 'brief') : 'fallback';
  const templates = RECAP_ANSWER_TEMPLATES[role];
  const answer = templates[recapAnswerCounter % templates.length](match || '');
  recapAnswerCounter += 1;
  return answer;
}

function askRecapQuestion(question) {
  const text = question.trim();
  if (!text || !recapChatThread) return;

  const userBubble = document.createElement('p');
  userBubble.className = 'modal__recap-bubble modal__recap-bubble--user';
  userBubble.textContent = text;
  recapChatThread.appendChild(userBubble);

  const answerBubble = document.createElement('p');
  answerBubble.className = 'modal__recap-bubble';
  answerBubble.textContent = recapAnswerFor(text);
  recapChatThread.appendChild(answerBubble);

  if (recapAskInput) recapAskInput.value = '';
  const body = recapChatThread.closest('.modal__recap-body');
  if (body) body.scrollTop = body.scrollHeight;
}

// Clicking a highlighted phrase in the summary asks about it, same as
// clicking the matching quick-question chip below it.
recapSummaryEl?.addEventListener('click', (e) => {
  const span = e.target.closest('.modal__recap-highlight');
  if (!span) return;
  askRecapQuestion(toQuestionLabel(span.dataset.clause));
});

recapAskInput?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    askRecapQuestion(recapAskInput.value);
  }
});

modalContinueBtn?.addEventListener('click', () => {
  if (modalContinueBtn.disabled) return;
  enterMeetingScreen();
});

modalWaveformPause?.addEventListener('click', () => setMeetPaused(!meetPaused));

modalStartBtn?.addEventListener('click', () => {
  if (modalStartBtn) modalStartBtn.hidden = true;
  if (modalWaveformPause) modalWaveformPause.hidden = false;
  if (modalMeetActions) modalMeetActions.hidden = false;
  setMeetPaused(false);
});

// Minimizing closes the dark modal overlay but keeps the recording (timer,
// waveform) running in a small floating player over the page - no scrim.
const miniPlayer = document.getElementById('mini-player');
const miniPlayerRecap = document.getElementById('mini-player-recap');
const miniPlayerBlob = document.querySelector('.mini-player__blob');
const miniPlayerTimer = document.getElementById('mini-player-timer');
const miniPlayerPauseBtn = document.getElementById('mini-player-pause');
const miniPlayerPauseIcon = document.getElementById('mini-player-pause-icon');
const miniPlayerStopBtn = document.getElementById('mini-player-stop');

function setMiniPlayerOpen(open) {
  if (!miniPlayer) return;
  if (open) {
    miniPlayer.hidden = false;
    void miniPlayer.offsetWidth;
    miniPlayer.classList.add('is-open');
    resizeOrbSoon(window.voiceOrbs?.mini);
  } else {
    miniPlayer.classList.remove('is-open');
    setTimeout(() => {
      miniPlayer.hidden = true;
    }, 300);
  }
}

modalMinimizeBtn?.addEventListener('click', () => {
  closeModal();
  setMiniPlayerOpen(true);
});

miniPlayerRecap?.addEventListener('click', () => {
  setMiniPlayerOpen(false);
  openModal({ focusTitle: false });
});

miniPlayerPauseBtn?.addEventListener('click', () => setMeetPaused(!meetPaused));

function endSession() {
  setMiniPlayerOpen(false);
  enterRecapScreen();
  openModal({ focusTitle: false });
}

modalEndBtn?.addEventListener('click', endSession);
miniPlayerStopBtn?.addEventListener('click', endSession);

console.log('recap ready');
