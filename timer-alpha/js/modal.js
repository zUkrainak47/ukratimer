import { formatTime, formatSolveTime, formatReadableDate, formatDateTime, getEffectiveTime } from './utils.js?v=2026042504';
import { sessionManager } from './session.js?v=2026042504';

let _overlay = null;
let _textarea = null;
let _commentInput = null;
let _commentTools = null;
let _modalActions = null;
let _statNav = null;
let _mobileSummary = null;
let _mobileSummaryValue = null;
let _mobileSummaryMetaLabel = null;
let _mobileShareActions = null;
let _mobileCopyScrambleButton = null;
let _mobileCopyButton = null;
let _mobileShareButton = null;
let _mobileListPanel = null;
let _mobileList = null;
let _mobileExportToast = null;
let _secondaryMobileExportToast = null;
let _copyOptionIncludeCommentsBtn = null;
let _copyOptionIncludeDateBtn = null;
let _copyOptionIncludeAbsoluteIndexBtn = null;
let _copyOptionCompactAverageBtn = null;
let _secondaryCopyOptionIncludeCommentsBtn = null;
let _secondaryCopyOptionIncludeDateBtn = null;
let _secondaryCopyOptionIncludeAbsoluteIndexBtn = null;
let _secondaryCopyOptionCompactAverageBtn = null;
let _desktopMoveSessionMenu = null;
let _desktopMoveSessionButton = null;
let _desktopMoveSessionDropdown = null;
let _mobileMoveSessionMenu = null;
let _mobileMoveSessionButton = null;
let _mobileMoveSessionDropdown = null;
let _secondaryLayer = null;
let _secondaryTitle = null;
let _secondaryTextarea = null;
let _secondaryStatNav = null;
let _secondaryMobileSummary = null;
let _secondaryMobileSummaryValue = null;
let _secondaryMobileSummaryMetaLabel = null;
let _secondaryMobileShareActions = null;
let _secondaryMobileCopyScrambleButton = null;
let _secondaryMobileCopyButton = null;
let _secondaryMobileShareButton = null;
let _secondaryMobileListPanel = null;
let _secondaryMobileList = null;
let _secondaryCurrentSolveIndex = null;
let _secondarySelectedStatContext = null;
let _secondaryDetailPayload = null;
let _secondaryModalSource = null;
let _currentSolveIndex = null;
let _selectedStatContext = null;
let _onStatNavigate = null;
let _currentDetailPayload = null;
let _currentModalSource = null;
let _ghostClickGuardCleanup = null;
let _ghostClickGuardTimeout = null;
let _mobileExportToastTimeout = null;
let _secondaryMobileExportToastTimeout = null;
let _isMovingSolve = false;
let _floatingMoveSessionContext = null;
const mobileDetailQuery = window.matchMedia('(max-width: 1100px), (pointer: coarse)');
const MODAL_GHOST_CLICK_GUARD_MS = 450;
const MODAL_GHOST_CLICK_RADIUS_PX = 42;
const MODAL_LAYER_PRIMARY = 'primary';
const MODAL_LAYER_SECONDARY = 'secondary';
const MODAL_COPY_OPTIONS_STORAGE_KEY = 'ukratimer_modal_copy_options_v1';
const SUMMARY_TIMESTAMP_DISPLAY_OFF = 'off';
const SUMMARY_TIMESTAMP_DISPLAY_DATE_TIME = 'date-time';
const SUMMARY_TIMESTAMP_DISPLAY_TIME = 'time';
const modalCopyOptions = {
    includeComments: false,
    scrambleTimestampDisplay: SUMMARY_TIMESTAMP_DISPLAY_OFF,
    includeAbsoluteIndex: false,
    compactAverageSummary: false,
};

function isSecondaryModalActive() {
    return Boolean(_secondaryLayer && !_secondaryLayer.hidden && _secondaryModalSource);
}

function getActiveModalLayer() {
    return isSecondaryModalActive() ? MODAL_LAYER_SECONDARY : MODAL_LAYER_PRIMARY;
}

function isAverageSummaryModal(source = _currentModalSource) {
    return source?.type === 'average';
}

function isCompactAverageSummaryEnabled(source = _currentModalSource) {
    return isAverageSummaryModal(source) && modalCopyOptions.compactAverageSummary;
}

function parseSummaryTimestampDisplay(value) {
    switch (value) {
        case SUMMARY_TIMESTAMP_DISPLAY_OFF:
        case SUMMARY_TIMESTAMP_DISPLAY_DATE_TIME:
        case SUMMARY_TIMESTAMP_DISPLAY_TIME:
            return value;
        default:
            return null;
    }
}

function getNextSummaryTimestampDisplay(value) {
    switch (value) {
        case SUMMARY_TIMESTAMP_DISPLAY_DATE_TIME:
            return SUMMARY_TIMESTAMP_DISPLAY_TIME;
        case SUMMARY_TIMESTAMP_DISPLAY_TIME:
            return SUMMARY_TIMESTAMP_DISPLAY_OFF;
        default:
            return SUMMARY_TIMESTAMP_DISPLAY_DATE_TIME;
    }
}

function formatTimestampTimeOnly(timestamp) {
    const date = new Date(timestamp);
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    return `${hours}:${minutes}:${seconds}`;
}

function formatSummaryTimestamp(timestamp) {
    switch (modalCopyOptions.scrambleTimestampDisplay) {
        case SUMMARY_TIMESTAMP_DISPLAY_DATE_TIME:
            return formatDateTime(timestamp);
        case SUMMARY_TIMESTAMP_DISPLAY_TIME:
            return formatTimestampTimeOnly(timestamp);
        default:
            return '';
    }
}

function formatMobilePreviewTimestamp(timestamp) {
    if (!timestamp) return '';
    return formatDateTime(timestamp);
}

function getSummaryTimestampButtonState() {
    switch (modalCopyOptions.scrambleTimestampDisplay) {
        case SUMMARY_TIMESTAMP_DISPLAY_DATE_TIME:
            return {
                title: 'Show time only',
                ariaLabel: 'Summary timestamp shows date and time. Click to show time only.',
                ariaPressed: 'true',
            };
        case SUMMARY_TIMESTAMP_DISPLAY_TIME:
            return {
                title: 'Hide date and time',
                ariaLabel: 'Summary timestamp shows time only. Click to turn it off.',
                ariaPressed: 'mixed',
            };
        default:
            return {
                title: 'Show date and time',
                ariaLabel: 'Summary timestamp is off. Click to show date and time.',
                ariaPressed: 'false',
            };
    }
}

function getSummaryTimestampToastMessage() {
    switch (modalCopyOptions.scrambleTimestampDisplay) {
        case SUMMARY_TIMESTAMP_DISPLAY_DATE_TIME:
            return 'Date and time will now be included in summary.';
        case SUMMARY_TIMESTAMP_DISPLAY_TIME:
            return 'Only the time will now be included in summary.';
        default:
            return 'Date and time will no longer be included in summary.';
    }
}

function loadModalCopyOptions() {
    try {
        const raw = localStorage.getItem(MODAL_COPY_OPTIONS_STORAGE_KEY);
        if (!raw) return;
        const parsed = JSON.parse(raw);
        const parsedTimestampDisplay = parseSummaryTimestampDisplay(parsed?.scrambleTimestampDisplay);
        modalCopyOptions.includeComments = Boolean(parsed?.includeComments);
        modalCopyOptions.scrambleTimestampDisplay = parsedTimestampDisplay
            || (parsed?.includeScrambleDate ? SUMMARY_TIMESTAMP_DISPLAY_DATE_TIME : SUMMARY_TIMESTAMP_DISPLAY_OFF);
        modalCopyOptions.includeAbsoluteIndex = Boolean(parsed?.includeAbsoluteIndex);
        modalCopyOptions.compactAverageSummary = Boolean(parsed?.compactAverageSummary);
    } catch {
        modalCopyOptions.includeComments = false;
        modalCopyOptions.scrambleTimestampDisplay = SUMMARY_TIMESTAMP_DISPLAY_OFF;
        modalCopyOptions.includeAbsoluteIndex = false;
        modalCopyOptions.compactAverageSummary = false;
    }
}

function saveModalCopyOptions() {
    try {
        localStorage.setItem(MODAL_COPY_OPTIONS_STORAGE_KEY, JSON.stringify({
            includeComments: modalCopyOptions.includeComments,
            scrambleTimestampDisplay: modalCopyOptions.scrambleTimestampDisplay,
            includeAbsoluteIndex: modalCopyOptions.includeAbsoluteIndex,
            compactAverageSummary: modalCopyOptions.compactAverageSummary,
        }));
    } catch {
    }
}

function renderCopyOptionButtonSet({
    source,
    includeCommentsBtn,
    includeDateBtn,
    includeAbsoluteIndexBtn,
    compactBtn,
}) {
    const isAverageSummary = isAverageSummaryModal(source);
    const isCompactSummary = isCompactAverageSummaryEnabled(source);

    if (includeCommentsBtn) {
        includeCommentsBtn.classList.toggle('active-toggle', modalCopyOptions.includeComments);
        includeCommentsBtn.setAttribute('aria-pressed', String(modalCopyOptions.includeComments));
    }
    if (includeDateBtn) {
        const buttonState = isCompactSummary
            ? {
                title: 'Summary timestamp unavailable in compact mode',
                ariaLabel: 'Summary timestamp is unavailable in compact mode.',
                ariaPressed: 'false',
            }
            : getSummaryTimestampButtonState();
        const hasTimestamp = !isCompactSummary && modalCopyOptions.scrambleTimestampDisplay !== SUMMARY_TIMESTAMP_DISPLAY_OFF;
        const isTimeOnly = !isCompactSummary && modalCopyOptions.scrambleTimestampDisplay === SUMMARY_TIMESTAMP_DISPLAY_TIME;
        includeDateBtn.classList.toggle('active-toggle', hasTimestamp);
        includeDateBtn.classList.toggle('time-only-toggle', isTimeOnly);
        includeDateBtn.dataset.state = modalCopyOptions.scrambleTimestampDisplay;
        includeDateBtn.setAttribute('aria-pressed', buttonState.ariaPressed);
        includeDateBtn.setAttribute('aria-label', buttonState.ariaLabel);
        includeDateBtn.title = buttonState.title;
        includeDateBtn.disabled = isCompactSummary;
    }
    if (includeAbsoluteIndexBtn) {
        const isAbsoluteIndexActive = isAverageSummary && !isCompactSummary && modalCopyOptions.includeAbsoluteIndex;
        includeAbsoluteIndexBtn.classList.toggle('active-toggle', isAbsoluteIndexActive);
        includeAbsoluteIndexBtn.setAttribute('aria-pressed', String(isAbsoluteIndexActive));
        includeAbsoluteIndexBtn.disabled = isCompactSummary;
        includeAbsoluteIndexBtn.setAttribute(
            'aria-label',
            isCompactSummary ? 'Absolute index is unavailable in compact mode.' : 'Include absolute index'
        );
        includeAbsoluteIndexBtn.title = isCompactSummary
            ? 'Absolute index unavailable in compact mode'
            : 'Include absolute index';
    }
    if (compactBtn) {
        compactBtn.classList.toggle('active-toggle', modalCopyOptions.compactAverageSummary);
        compactBtn.setAttribute('aria-pressed', String(modalCopyOptions.compactAverageSummary));
        compactBtn.setAttribute(
            'aria-label',
            modalCopyOptions.compactAverageSummary
                ? 'Compact mode is on. Click to show the full time list.'
                : 'Compact mode is off. Click to show a compact summary.'
        );
        compactBtn.title = modalCopyOptions.compactAverageSummary
            ? 'Show full time list'
            : 'Show compact summary';
    }
}

function renderModalCopyOptionButtons() {
    renderCopyOptionButtonSet({
        source: _currentModalSource,
        includeCommentsBtn: _copyOptionIncludeCommentsBtn,
        includeDateBtn: _copyOptionIncludeDateBtn,
        includeAbsoluteIndexBtn: _copyOptionIncludeAbsoluteIndexBtn,
        compactBtn: _copyOptionCompactAverageBtn,
    });
    renderCopyOptionButtonSet({
        source: _secondaryModalSource,
        includeCommentsBtn: _secondaryCopyOptionIncludeCommentsBtn,
        includeDateBtn: _secondaryCopyOptionIncludeDateBtn,
        includeAbsoluteIndexBtn: _secondaryCopyOptionIncludeAbsoluteIndexBtn,
        compactBtn: _secondaryCopyOptionCompactAverageBtn,
    });
}

function updateCopyOptionVisibilityForSource(source, includeAbsoluteIndexBtn, compactBtn) {
    const shouldShowAverageOptions = isAverageSummaryModal(source);
    if (includeAbsoluteIndexBtn) {
        includeAbsoluteIndexBtn.style.display = shouldShowAverageOptions ? '' : 'none';
    }
    if (compactBtn) {
        compactBtn.style.display = shouldShowAverageOptions ? '' : 'none';
    }
}

function updateModalCopyOptionVisibility() {
    updateCopyOptionVisibilityForSource(_currentModalSource, _copyOptionIncludeAbsoluteIndexBtn, _copyOptionCompactAverageBtn);
    updateCopyOptionVisibilityForSource(_secondaryModalSource, _secondaryCopyOptionIncludeAbsoluteIndexBtn, _secondaryCopyOptionCompactAverageBtn);
}

function getCommentSuffix(solve) {
    const comment = String(solve?.comment ?? '').trim();
    if (!modalCopyOptions.includeComments || !comment) return '';
    return ` [${comment}]`;
}

function getScrambleDateSuffix(solve) {
    const timestampText = formatSummaryTimestamp(solve.timestamp);
    if (!timestampText) return '';
    return `  |  ${timestampText}`;
}

function getAbsoluteSolveIndex(solve, fallbackIndex = null) {
    if (solve?.id) {
        const solveSessionSolves = sessionManager.getSessionById(solve.sessionId)?.solves || [];
        const absoluteIndex = solveSessionSolves.findIndex((entry) => entry.id === solve.id);
        if (absoluteIndex >= 0) return absoluteIndex + 1;
    }

    return Number.isInteger(fallbackIndex) ? fallbackIndex + 1 : null;
}

function buildSolveShareText(singleLabel, solveIndex, timeStr, solve) {
    const displayIndex = getAbsoluteSolveIndex(solve, solveIndex);
    return [
        `Generated by UkraTimer on ${formatReadableDate(Date.now())}`,
        `${singleLabel}: ${timeStr}`,
        '',
        `${displayIndex ?? (solveIndex + 1)}. ${timeStr}${getCommentSuffix(solve)}    ${solve.scramble}${getScrambleDateSuffix(solve)}`,
    ].join('\n');
}

function buildAverageShareContent(label, valueStr, solves, trim = 1) {
    const times = solves.map(s => getEffectiveTime(s));
    const sorted = [...times].map((t, i) => ({ time: t, index: i }))
        .sort((a, b) => a.time - b.time);
    const bestIndices = trim > 0 ? new Set(sorted.slice(0, trim).map(s => s.index)) : new Set();
    const worstIndices = trim > 0 ? new Set(sorted.slice(-trim).map(s => s.index)) : new Set();
    const isCompactSummary = modalCopyOptions.compactAverageSummary;
    const shouldUseAbsoluteIndex = modalCopyOptions.includeAbsoluteIndex && !isCompactSummary;
    const activeSessionSolves = sessionManager.getActiveSession()?.solves || [];
    const absoluteIndexById = new Map(activeSessionSolves.map((solve, index) => [solve.id, index + 1]));
    const displayIndices = solves.map((solve, index) => {
        if (!shouldUseAbsoluteIndex) return index + 1;
        return absoluteIndexById.get(solve.id) || (index + 1);
    });
    const compactValues = [];
    const mobileEntries = [];
    solves.forEach((solve, i) => {
        const tStr = formatSolveTime(solve);
        const displayIndex = displayIndices[i];
        const isBest = bestIndices.has(i);
        const isWorst = worstIndices.has(i);
        const display = (isBest || isWorst) ? `(${tStr})` : tStr;
        const lineTime = `${display}${getCommentSuffix(solve)}`;
        if (isCompactSummary) {
            compactValues.push(lineTime);
        }
        mobileEntries.push({
            position: displayIndex,
            time: display,
            scramble: solve.scramble,
            date: isCompactSummary ? '' : formatMobilePreviewTimestamp(solve.timestamp),
            comment: modalCopyOptions.includeComments ? String(solve?.comment ?? '').trim() : '',
            solveId: solve.id,
            sessionId: solve.sessionId,
            compact: isCompactSummary,
            trimmed: isBest || isWorst,
        });
    });

    if (isCompactSummary) {
        return {
            shareText: [
                `Generated by UkraTimer on ${formatReadableDate(Date.now())}`,
                `${label}: ${valueStr}  =  ${compactValues.join(', ')}`,
            ].join('\n'),
            mobileEntries,
        };
    }

    const indexPadWidth = String(Math.max(...displayIndices, 1)).length;
    const lines = [
        `Generated by UkraTimer on ${formatReadableDate(Date.now())}`,
        `${label}: ${valueStr}`,
        '',
        'Time List:',
    ];

    solves.forEach((solve, i) => {
        const tStr = formatSolveTime(solve);
        const displayIndex = displayIndices[i];
        const isBest = bestIndices.has(i);
        const isWorst = worstIndices.has(i);
        const display = (isBest || isWorst) ? `(${tStr})` : tStr;
        const lineTime = `${display}${getCommentSuffix(solve)}`;
        const lineScramble = `${solve.scramble}${getScrambleDateSuffix(solve)}`;
        lines.push(`${String(displayIndex).padStart(indexPadWidth)}. ${lineTime}    ${lineScramble}`);
    });

    return {
        shareText: lines.join('\n'),
        mobileEntries,
    };
}

function showMobileExportToast(message, targetLayer = getActiveModalLayer()) {
    if (!isMobileDetailLayout() || !_overlay?.classList.contains('active')) return;

    const toast = targetLayer === MODAL_LAYER_SECONDARY ? _secondaryMobileExportToast : _mobileExportToast;
    if (!toast) return;

    toast.textContent = message;
    toast.classList.add('visible');
    if (targetLayer === MODAL_LAYER_SECONDARY) {
        window.clearTimeout(_secondaryMobileExportToastTimeout);
        _secondaryMobileExportToastTimeout = window.setTimeout(() => {
            _secondaryMobileExportToast?.classList.remove('visible');
        }, 1700);
        return;
    }

    window.clearTimeout(_mobileExportToastTimeout);
    _mobileExportToastTimeout = window.setTimeout(() => {
        _mobileExportToast?.classList.remove('visible');
    }, 1700);
}

function clearModalGhostClickGuard() {
    _ghostClickGuardCleanup?.();
    _ghostClickGuardCleanup = null;

    if (_ghostClickGuardTimeout !== null) {
        clearTimeout(_ghostClickGuardTimeout);
        _ghostClickGuardTimeout = null;
    }
}

function ensureMoveSessionDropdownScroll(dropdownEl) {
    if (!(dropdownEl instanceof HTMLElement)) return null;

    let scrollEl = Array.from(dropdownEl.children).find((child) => child.classList.contains('custom-select-dropdown-scroll'));
    if (!(scrollEl instanceof HTMLElement)) {
        scrollEl = document.createElement('div');
        scrollEl.className = 'custom-select-dropdown-scroll';
        scrollEl.append(...Array.from(dropdownEl.childNodes));
        dropdownEl.replaceChildren(scrollEl);
    }

    return scrollEl;
}

function attachMoveSessionDropdownToOverlay(dropdownEl) {
    if (!(dropdownEl instanceof HTMLElement) || !_overlay) return;
    ensureMoveSessionDropdownScroll(dropdownEl);
    dropdownEl.classList.add('floating-move-session-dropdown');
    if (dropdownEl.parentElement !== _overlay) {
        _overlay.appendChild(dropdownEl);
    }
}

function positionFloatingMoveSessionDropdown() {
    if (!_floatingMoveSessionContext) return;

    const { buttonEl, dropdownEl } = _floatingMoveSessionContext;
    if (!(buttonEl instanceof HTMLButtonElement) || !(dropdownEl instanceof HTMLElement)) return;

    const buttonRect = buttonEl.getBoundingClientRect();
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
    const viewportPadding = 12;
    const gap = 8;
    const availableBelow = Math.max(120, viewportHeight - buttonRect.bottom - gap - viewportPadding);

    dropdownEl.style.minWidth = `${Math.ceil(buttonRect.width)}px`;
    dropdownEl.style.maxWidth = `calc(100vw - ${viewportPadding * 2}px)`;
    dropdownEl.style.setProperty('--custom-select-dropdown-max-height-resolved', `${Math.min(320, availableBelow)}px`);
    dropdownEl.style.left = `${viewportPadding}px`;
    dropdownEl.style.top = `${Math.round(buttonRect.bottom + gap)}px`;

    const dropdownRect = dropdownEl.getBoundingClientRect();
    const clampedLeft = Math.min(
        Math.max(viewportPadding, buttonRect.left),
        Math.max(viewportPadding, viewportWidth - dropdownRect.width - viewportPadding)
    );

    dropdownEl.style.left = `${Math.round(clampedLeft)}px`;
    dropdownEl.style.top = `${Math.round(buttonRect.bottom + gap)}px`;
}

function openFloatingMoveSessionDropdown(menuEl, buttonEl) {
    const dropdownEl = menuEl === _desktopMoveSessionMenu
        ? _desktopMoveSessionDropdown
        : menuEl === _mobileMoveSessionMenu
            ? _mobileMoveSessionDropdown
            : null;
    if (!(menuEl instanceof HTMLElement) || !(buttonEl instanceof HTMLButtonElement) || !(dropdownEl instanceof HTMLElement) || !_overlay) {
        return;
    }

    _floatingMoveSessionContext = { buttonEl, dropdownEl };
    dropdownEl.classList.add('open');
    positionFloatingMoveSessionDropdown();
}

export function closeMoveSessionMenus() {
    [_desktopMoveSessionMenu, _mobileMoveSessionMenu].forEach((menuEl) => {
        menuEl?.classList.remove('open');
        menuEl?.querySelector('.custom-select-btn')?.setAttribute('aria-expanded', 'false');
    });

    if (_floatingMoveSessionContext?.dropdownEl instanceof HTMLElement) {
        const { dropdownEl } = _floatingMoveSessionContext;
        dropdownEl.classList.remove('open');
    }

    _floatingMoveSessionContext = null;
}

function setMoveSessionMenuState(menuEl, buttonEl, shouldOpen) {
    if (!(menuEl instanceof HTMLElement) || !(buttonEl instanceof HTMLButtonElement)) return;
    menuEl.classList.toggle('open', shouldOpen);
    buttonEl.setAttribute('aria-expanded', String(shouldOpen));
    if (shouldOpen) {
        openFloatingMoveSessionDropdown(menuEl, buttonEl);
    } else {
        closeMoveSessionMenus();
    }
}

function getMoveSessionTargetOptions() {
    const currentSolveSessionId = getCurrentSingleSolveSessionId();
    return sessionManager.getSessions().filter((session) => session.id !== currentSolveSessionId);
}

function syncMoveSessionMenu(menuEl, buttonEl, dropdownEl) {
    if (!(menuEl instanceof HTMLElement) || !(buttonEl instanceof HTMLButtonElement) || !(dropdownEl instanceof HTMLElement)) return;

    const labelEl = buttonEl.querySelector('.custom-select-label');
    const currentSessionName = getSessionName(getCurrentSingleSolveSessionId());
    const options = getMoveSessionTargetOptions();
    const scrollEl = ensureMoveSessionDropdownScroll(dropdownEl);

    if (!(labelEl instanceof HTMLElement) || !(scrollEl instanceof HTMLElement)) return;

    labelEl.textContent = currentSessionName;
    buttonEl.title = currentSessionName;
    buttonEl.setAttribute('aria-label', `Move solve to another session. Current session: ${currentSessionName}`);
    buttonEl.disabled = !_currentModalSource || _currentModalSource.type !== 'single' || options.length === 0 || _isMovingSolve;

    const fragment = document.createDocumentFragment();
    options.forEach((session) => {
        const optionButton = document.createElement('button');
        optionButton.type = 'button';
        optionButton.className = 'custom-select-option';
        optionButton.dataset.sessionId = session.id;
        optionButton.setAttribute('role', 'option');
        optionButton.setAttribute('aria-selected', 'false');
        optionButton.textContent = `${session.name} (${session.solveCount})`;
        fragment.appendChild(optionButton);
    });

    scrollEl.replaceChildren(fragment);
}

function syncMoveSessionMenus() {
    syncMoveSessionMenu(_desktopMoveSessionMenu, _desktopMoveSessionButton, _desktopMoveSessionDropdown);
    syncMoveSessionMenu(_mobileMoveSessionMenu, _mobileMoveSessionButton, _mobileMoveSessionDropdown);
}

async function handleMoveSolveToSession(targetSessionId) {
    if (_isMovingSolve) return;
    if (_currentModalSource?.type !== 'single') return;

    const solveId = _currentModalSource.solveId;
    if (!solveId || !targetSessionId || targetSessionId === getCurrentSingleSolveSessionId()) {
        closeMoveSessionMenus();
        return;
    }

    _isMovingSolve = true;
    syncMoveSessionMenus();

    try {
        const movedSolve = await sessionManager.moveSolve(solveId, targetSessionId);
        const targetSession = await sessionManager.ensureSessionSolvesLoaded(targetSessionId);
        closeMoveSessionMenus();

        const filteredTargetSolves = sessionManager.getFilteredSolvesForSessionId(targetSessionId);
        const filteredIndex = filteredTargetSolves.findIndex((solve) => solve.id === solveId);
        const targetSessionSolves = targetSession?.solves || [];
        const nextSolve = targetSessionSolves.find((solve) => solve.id === solveId) || movedSolve;
        const nextIndex = filteredIndex >= 0
            ? filteredIndex
            : targetSessionSolves.findIndex((solve) => solve.id === solveId);

        if (nextSolve && nextIndex >= 0) {
            showSolveDetail(nextSolve, nextIndex, null, {
                enableStatNavigation: filteredIndex >= 0,
            });
        }
    } catch {
        showMobileExportToast('Move failed.');
        syncMoveSessionMenus();
    } finally {
        _isMovingSolve = false;
        syncMoveSessionMenus();
    }
}

export function armModalGhostClickGuard(point = null) {
    clearModalGhostClickGuard();

    const expiresAt = performance.now() + MODAL_GHOST_CLICK_GUARD_MS;
    const origin = point && Number.isFinite(point.x) && Number.isFinite(point.y)
        ? { x: point.x, y: point.y }
        : null;

    const handleCapturedClick = (event) => {
        if (!event.isTrusted) return;

        if (performance.now() > expiresAt) {
            clearModalGhostClickGuard();
            return;
        }

        if (origin) {
            const dx = event.clientX - origin.x;
            const dy = event.clientY - origin.y;
            if ((dx * dx) + (dy * dy) > MODAL_GHOST_CLICK_RADIUS_PX ** 2) return;
        }

        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        clearModalGhostClickGuard();
    };

    document.addEventListener('click', handleCapturedClick, true);
    _ghostClickGuardCleanup = () => {
        document.removeEventListener('click', handleCapturedClick, true);
    };
    _ghostClickGuardTimeout = window.setTimeout(clearModalGhostClickGuard, MODAL_GHOST_CLICK_GUARD_MS);
}

export function initModal() {
    _overlay = document.getElementById('modal-overlay');
    _secondaryLayer = document.getElementById('modal-secondary-layer');
    _textarea = document.getElementById('modal-textarea');
    _secondaryTitle = document.getElementById('modal-secondary-title');
    _secondaryTextarea = document.getElementById('modal-secondary-textarea');
    _commentInput = document.getElementById('modal-solve-comment');
    _commentTools = document.getElementById('modal-solve-tools');
    _modalActions = document.getElementById('modal-actions');
    _statNav = document.getElementById('modal-stat-nav');
    _secondaryStatNav = document.getElementById('modal-secondary-stat-nav');
    _mobileSummary = document.getElementById('modal-mobile-summary');
    _mobileSummaryValue = document.getElementById('modal-mobile-value');
    _mobileSummaryMetaLabel = document.getElementById('modal-mobile-meta-label');
    _mobileShareActions = document.getElementById('modal-mobile-share-actions');
    _mobileCopyScrambleButton = document.getElementById('modal-copy-scramble');
    _mobileCopyButton = document.getElementById('modal-copy-detail');
    _mobileShareButton = document.getElementById('modal-share-detail');
    _mobileListPanel = document.getElementById('modal-mobile-list-panel');
    _mobileList = document.getElementById('modal-mobile-list');
    _secondaryMobileSummary = document.getElementById('modal-secondary-mobile-summary');
    _secondaryMobileSummaryValue = document.getElementById('modal-secondary-mobile-value');
    _secondaryMobileSummaryMetaLabel = document.getElementById('modal-secondary-mobile-meta-label');
    _secondaryMobileShareActions = document.getElementById('modal-secondary-mobile-share-actions');
    _secondaryMobileCopyScrambleButton = document.getElementById('modal-secondary-copy-scramble');
    _secondaryMobileCopyButton = document.getElementById('modal-secondary-copy-detail');
    _secondaryMobileShareButton = document.getElementById('modal-secondary-share-detail');
    _secondaryMobileListPanel = document.getElementById('modal-secondary-mobile-list-panel');
    _secondaryMobileList = document.getElementById('modal-secondary-mobile-list');
    _mobileExportToast = document.getElementById('modal-mobile-export-toast');
    _secondaryMobileExportToast = document.getElementById('modal-secondary-mobile-export-toast');
    _copyOptionIncludeCommentsBtn = document.getElementById('modal-option-include-comments');
    _copyOptionIncludeDateBtn = document.getElementById('modal-option-include-date');
    _copyOptionIncludeAbsoluteIndexBtn = document.getElementById('modal-option-include-absolute-index');
    _copyOptionCompactAverageBtn = document.getElementById('modal-option-compact-average');
    _secondaryCopyOptionIncludeCommentsBtn = document.getElementById('modal-secondary-option-include-comments');
    _secondaryCopyOptionIncludeDateBtn = document.getElementById('modal-secondary-option-include-date');
    _secondaryCopyOptionIncludeAbsoluteIndexBtn = document.getElementById('modal-secondary-option-include-absolute-index');
    _secondaryCopyOptionCompactAverageBtn = document.getElementById('modal-secondary-option-compact-average');
    _desktopMoveSessionMenu = document.getElementById('modal-solve-session-menu');
    _desktopMoveSessionButton = document.getElementById('modal-solve-session-btn');
    _desktopMoveSessionDropdown = document.getElementById('modal-solve-session-dropdown');
    _mobileMoveSessionMenu = document.getElementById('modal-mobile-session-menu');
    _mobileMoveSessionButton = document.getElementById('modal-mobile-session-btn');
    _mobileMoveSessionDropdown = document.getElementById('modal-mobile-session-dropdown');
    attachMoveSessionDropdownToOverlay(_desktopMoveSessionDropdown);
    attachMoveSessionDropdownToOverlay(_mobileMoveSessionDropdown);

    loadModalCopyOptions();
    renderModalCopyOptionButtons();
    updateModalCopyOptionVisibility();

    let _overlayMouseDownTarget = null;
    let _overlayMouseUpTarget = null;
    _overlay.addEventListener('mousedown', (e) => { _overlayMouseDownTarget = e.target; });
    _overlay.addEventListener('mouseup', (e) => { _overlayMouseUpTarget = e.target; });
    _overlay.addEventListener('click', (e) => {
        if (_overlayMouseDownTarget === _overlay && _overlayMouseUpTarget === _overlay) closeModal();
        _overlayMouseDownTarget = null;
        _overlayMouseUpTarget = null;
    });

    let _secondaryMouseDownTarget = null;
    let _secondaryMouseUpTarget = null;
    _secondaryLayer?.addEventListener('mousedown', (e) => { _secondaryMouseDownTarget = e.target; });
    _secondaryLayer?.addEventListener('mouseup', (e) => { _secondaryMouseUpTarget = e.target; });
    _secondaryLayer?.addEventListener('click', (e) => {
        if (_secondaryMouseDownTarget === _secondaryLayer && _secondaryMouseUpTarget === _secondaryLayer) closeSecondaryModal();
        _secondaryMouseDownTarget = null;
        _secondaryMouseUpTarget = null;
    });

    const closeBtn = _overlay.querySelector('.modal-close');
    if (closeBtn) {
        closeBtn.addEventListener('click', closeModal);
    }

    document.getElementById('modal-secondary-close')?.addEventListener('click', () => {
        closeSecondaryModal();
    });

    document.addEventListener('keydown', (e) => {
        // Ignore Escape if the confirm modal is active so it doesn't close both
        const isConfirmActive = document.getElementById('confirm-overlay').classList.contains('active');
        const isMoveSessionMenuOpen = Boolean(_floatingMoveSessionContext);
        if (e.code === 'Escape' && isMoveSessionMenuOpen) {
            e.preventDefault();
            e.stopImmediatePropagation();
            closeMoveSessionMenus();
            return;
        }
        if (e.code === 'Escape' && isSecondaryModalActive()) {
            e.preventDefault();
            e.stopImmediatePropagation();
            closeSecondaryModal();
            return;
        }
        if (e.code === 'Escape' && _overlay.classList.contains('active') && !isConfirmActive) {
            e.preventDefault();
            e.stopImmediatePropagation();
            closeModal();
        }
    });

    // Delegate modal action buttons
    document.getElementById('modal-btn-plus2').onclick = () => {
        const id = _modalActions.dataset.solveId;
        if (id) {
            sessionManager.togglePenalty(id, '+2');
            if (_currentSolveIndex !== null) {
                const solve = sessionManager.getActiveSession().solves.find(s => s.id === id);
                if (solve) showSolveDetail(solve, _currentSolveIndex);
            }
        }
    };
    document.getElementById('modal-btn-dnf').onclick = () => {
        const id = _modalActions.dataset.solveId;
        if (id) {
            sessionManager.togglePenalty(id, 'DNF');
            if (_currentSolveIndex !== null) {
                const solve = sessionManager.getActiveSession().solves.find(s => s.id === id);
                if (solve) showSolveDetail(solve, _currentSolveIndex);
            }
        }
    };
    document.getElementById('modal-btn-delete').onclick = async () => {
        const id = _modalActions.dataset.solveId;
        if (id && await customConfirm('Are you sure you want to delete this solve?')) {
            sessionManager.deleteSolve(id);
            closeModal();
        }
    };

    _commentInput.addEventListener('change', (e) => {
        const id = _modalActions.dataset.solveId;
        if (id) {
            const nextComment = String(e.target.value ?? '').trim();
            sessionManager.setSolveComment(id, nextComment);
            refreshSingleSolveSharePreview();
        }
    });

    _commentInput.addEventListener('input', () => {
        autoResizeTextarea(_commentInput);
        refreshSingleSolveSharePreview();
    });

    // Make enter key in comment input also blur to save
    _commentInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            _commentInput.blur();
        }
    });

    _statNav?.addEventListener('click', (e) => {
        const button = e.target.closest('button[data-stat-type]');
        if (!button || button.disabled || typeof _onStatNavigate !== 'function') return;
        _onStatNavigate(button.dataset.statType);
    });

    _secondaryStatNav?.addEventListener('click', (e) => {
        const button = e.target.closest('button[data-stat-type]');
        if (!button || button.disabled || typeof _onStatNavigate !== 'function') return;
        _onStatNavigate(button.dataset.statType);
    });

    _mobileCopyButton?.addEventListener('click', () => {
        copyCurrentDetailToClipboard();
    });

    _mobileCopyScrambleButton?.addEventListener('click', () => {
        copyTextWithFeedback(
            _currentDetailPayload?.scrambleText,
            _mobileCopyScrambleButton,
            'Copied'
        );
    });

    _mobileShareButton?.addEventListener('click', () => {
        shareCurrentDetail();
    });

    _secondaryMobileCopyButton?.addEventListener('click', () => {
        copySecondaryDetailToClipboard();
    });

    _secondaryMobileCopyScrambleButton?.addEventListener('click', () => {
        copyTextWithFeedback(
            _secondaryDetailPayload?.scrambleText,
            _secondaryMobileCopyScrambleButton,
            'Copied'
        );
    });

    _secondaryMobileShareButton?.addEventListener('click', () => {
        shareSecondaryDetail();
    });

    [_desktopMoveSessionButton, _mobileMoveSessionButton].forEach((buttonEl) => {
        buttonEl?.addEventListener('click', (event) => {
            const menuEl = buttonEl === _desktopMoveSessionButton ? _desktopMoveSessionMenu : _mobileMoveSessionMenu;
            event.stopPropagation();

            if (buttonEl.disabled) return;

            const shouldOpen = !menuEl?.classList.contains('open');
            closeMoveSessionMenus();
            document.querySelectorAll('.custom-select-menu').forEach((customMenuEl) => {
                customMenuEl.classList.remove('open');
                customMenuEl.querySelector('.custom-select-btn')?.setAttribute('aria-expanded', 'false');
            });
            setMoveSessionMenuState(menuEl, buttonEl, shouldOpen);
        });
    });

    [_desktopMoveSessionDropdown, _mobileMoveSessionDropdown].forEach((dropdownEl) => {
        dropdownEl?.addEventListener('click', (event) => {
            const optionButton = event.target instanceof Element
                ? event.target.closest('.custom-select-option[data-session-id]')
                : null;

            if (!(optionButton instanceof HTMLButtonElement)) return;
            void handleMoveSolveToSession(optionButton.dataset.sessionId || '');
        });
    });

    _copyOptionIncludeCommentsBtn?.addEventListener('click', () => {
        modalCopyOptions.includeComments = !modalCopyOptions.includeComments;
        saveModalCopyOptions();
        renderModalCopyOptionButtons();
        rerenderCurrentModalSource();
        showMobileExportToast(
            modalCopyOptions.includeComments
                ? 'Comments will now be included in summary.'
                : 'Comments will no longer be included in summary.'
        );
    });

    _secondaryCopyOptionIncludeCommentsBtn?.addEventListener('click', () => {
        modalCopyOptions.includeComments = !modalCopyOptions.includeComments;
        saveModalCopyOptions();
        renderModalCopyOptionButtons();
        rerenderSecondaryModalSource();
        showMobileExportToast(
            modalCopyOptions.includeComments
                ? 'Comments will now be included in summary.'
                : 'Comments will no longer be included in summary.',
            MODAL_LAYER_SECONDARY
        );
    });

    _copyOptionIncludeDateBtn?.addEventListener('click', () => {
        modalCopyOptions.scrambleTimestampDisplay = getNextSummaryTimestampDisplay(modalCopyOptions.scrambleTimestampDisplay);
        saveModalCopyOptions();
        renderModalCopyOptionButtons();
        rerenderCurrentModalSource();
        showMobileExportToast(getSummaryTimestampToastMessage());
    });

    _secondaryCopyOptionIncludeDateBtn?.addEventListener('click', () => {
        modalCopyOptions.scrambleTimestampDisplay = getNextSummaryTimestampDisplay(modalCopyOptions.scrambleTimestampDisplay);
        saveModalCopyOptions();
        renderModalCopyOptionButtons();
        rerenderSecondaryModalSource();
        showMobileExportToast(getSummaryTimestampToastMessage(), MODAL_LAYER_SECONDARY);
    });

    _copyOptionIncludeAbsoluteIndexBtn?.addEventListener('click', () => {
        modalCopyOptions.includeAbsoluteIndex = !modalCopyOptions.includeAbsoluteIndex;
        saveModalCopyOptions();
        renderModalCopyOptionButtons();
        rerenderCurrentModalSource();
        showMobileExportToast(
            modalCopyOptions.includeAbsoluteIndex
                ? 'Absolute index will now be included in summary.'
                : 'Absolute index will no longer be included in summary.'
        );
    });

    _secondaryCopyOptionIncludeAbsoluteIndexBtn?.addEventListener('click', () => {
        modalCopyOptions.includeAbsoluteIndex = !modalCopyOptions.includeAbsoluteIndex;
        saveModalCopyOptions();
        renderModalCopyOptionButtons();
        rerenderSecondaryModalSource();
        showMobileExportToast(
            modalCopyOptions.includeAbsoluteIndex
                ? 'Absolute index will now be included in summary.'
                : 'Absolute index will no longer be included in summary.',
            MODAL_LAYER_SECONDARY
        );
    });

    _copyOptionCompactAverageBtn?.addEventListener('click', () => {
        modalCopyOptions.compactAverageSummary = !modalCopyOptions.compactAverageSummary;
        saveModalCopyOptions();
        renderModalCopyOptionButtons();
        rerenderCurrentModalSource();
        showMobileExportToast(
            modalCopyOptions.compactAverageSummary
                ? 'Compact mode is now enabled for stat summaries.'
                : 'Compact mode is now disabled for stat summaries.'
        );
    });

    _secondaryCopyOptionCompactAverageBtn?.addEventListener('click', () => {
        modalCopyOptions.compactAverageSummary = !modalCopyOptions.compactAverageSummary;
        saveModalCopyOptions();
        renderModalCopyOptionButtons();
        rerenderSecondaryModalSource();
        showMobileExportToast(
            modalCopyOptions.compactAverageSummary
                ? 'Compact mode is now enabled for stat summaries.'
                : 'Compact mode is now disabled for stat summaries.',
            MODAL_LAYER_SECONDARY
        );
    });

    const handleMobileDetailViewportChange = () => {
        if (_overlay?.classList.contains('active')) {
            renderMobileDetail(_currentDetailPayload);
            renderSecondaryMobileDetail(_secondaryDetailPayload);
        }
    };

    const syncFloatingMoveSessionDropdownPosition = () => {
        if (_floatingMoveSessionContext) {
            positionFloatingMoveSessionDropdown();
        }
    };

    if (typeof mobileDetailQuery.addEventListener === 'function') {
        mobileDetailQuery.addEventListener('change', handleMobileDetailViewportChange);
    } else {
        mobileDetailQuery.addListener(handleMobileDetailViewportChange);
    }

    window.addEventListener('resize', syncFloatingMoveSessionDropdownPosition);
    window.addEventListener('scroll', syncFloatingMoveSessionDropdownPosition, true);
    window.visualViewport?.addEventListener?.('resize', syncFloatingMoveSessionDropdownPosition);
}

export function setModalStatNavigator(callback) {
    _onStatNavigate = callback;
}

export function setModalStatButtons(buttons) {
    if (!_statNav && !_secondaryStatNav) return;

    const normalized = Array.isArray(buttons) ? buttons : [];
    const markup = normalized.map((button) => {
        const statType = String(button.statType ?? '');
        const minIndex = Number.isInteger(button.minIndex) ? button.minIndex : 0;
        const label = String(button.label ?? statType);
        const title = String(button.title ?? label);
        return `<button class="btn-action" data-stat-type="${statType}" data-min-index="${minIndex}" title="${title}">${label}</button>`;
    }).join('');
    if (_statNav) _statNav.innerHTML = markup;
    if (_secondaryStatNav) _secondaryStatNav.innerHTML = markup;
}

function expandReadableStatLabel(rawLabel) {
    return String(rawLabel ?? '').replace(/\b(mo|ao)([1-9]\d*)\b/gi, (_, kind, n) => (
        kind.toLowerCase() === 'mo' ? `Mean of ${n}` : `Average of ${n}`
    ));
}

/**
 * Custom async confirm modal matching the application aesthetics.
 * Returns a Promise that resolves to true (OK) or false (Cancel).
 */
export function customConfirm(message) {
    return new Promise((resolve) => {
        const overlay = document.getElementById('confirm-overlay');
        const msgEl = document.getElementById('confirm-message');
        const btnOk = document.getElementById('confirm-btn-ok');
        const btnCancel = document.getElementById('confirm-btn-cancel');
        const btnClose = document.getElementById('confirm-btn-close');

        // Set message
        msgEl.textContent = message;

        if (!window.history.state?.isBackIntercepted) {
            window.history.pushState({ isBackIntercepted: true }, '');
        }

        // Cleanup function
        let confirmMouseDownTarget = null;
        let confirmMouseUpTarget = null;
        const onOverlayMouseDown = (e) => { confirmMouseDownTarget = e.target; };
        const onOverlayMouseUp = (e) => { confirmMouseUpTarget = e.target; };
        const cleanup = () => {
            overlay.classList.remove('active');
            btnOk.removeEventListener('click', onOk);
            btnCancel.removeEventListener('click', onCancel);
            btnClose.removeEventListener('click', onCancel);
            overlay.removeEventListener('mousedown', onOverlayMouseDown);
            overlay.removeEventListener('mouseup', onOverlayMouseUp);
            overlay.removeEventListener('click', onOverlayClick);
            document.removeEventListener('keydown', onKeydown, true);
            if (document.activeElement) document.activeElement.blur();
        };

        // Handlers
        const onOk = () => { cleanup(); resolve(true); };
        const onCancel = () => { cleanup(); resolve(false); };
        const onOverlayClick = (e) => {
            if (confirmMouseDownTarget === overlay && confirmMouseUpTarget === overlay) onCancel();
            confirmMouseDownTarget = null;
            confirmMouseUpTarget = null;
        };
        const onKeydown = (e) => {
            if (!overlay.classList.contains('active')) return;
            if (e.key === 'Escape') {
                e.stopImmediatePropagation();
                e.preventDefault();
                onCancel();
            }
            if (e.key === 'Enter') onOk();
            e.stopPropagation();
        };

        // Attach listeners
        btnOk.addEventListener('click', onOk);
        btnCancel.addEventListener('click', onCancel);
        btnClose.addEventListener('click', onCancel);
        overlay.addEventListener('mousedown', onOverlayMouseDown);
        overlay.addEventListener('mouseup', onOverlayMouseUp);
        overlay.addEventListener('click', onOverlayClick);
        // Capture Escape before other document-level handlers can dismiss UI
        // underneath the confirm overlay.
        document.addEventListener('keydown', onKeydown, true);

        // Show modal and wait for user interaction
        overlay.classList.add('active');

        // Focus OK button for enter key support
        requestAnimationFrame(() => btnOk.focus());
    });
}

/**
 * Custom async prompt modal matching the application aesthetics.
 * Returns a Promise that resolves to the input value (string) or null (Cancel).
 */
export function customPrompt(message, defaultValue = '', maxLength = 100, title = 'Session name', placeholder = '', onInputCb = null) {
    return new Promise((resolve) => {
        const overlay = document.getElementById('prompt-overlay');
        const titleEl = document.getElementById('prompt-title');
        const msgEl = document.getElementById('prompt-message');
        const inputEl = document.getElementById('prompt-input');
        const btnOk = document.getElementById('prompt-btn-ok');
        const btnCancel = document.getElementById('prompt-btn-cancel');
        const btnClose = document.getElementById('prompt-btn-close');

        // Set title, message and default value
        titleEl.textContent = title;
        msgEl.textContent = message;
        msgEl.style.display = message ? 'block' : 'none';
        inputEl.value = String(defaultValue ?? '');
        inputEl.maxLength = maxLength;
        inputEl.placeholder = placeholder;

        if (!window.history.state?.isBackIntercepted) {
            window.history.pushState({ isBackIntercepted: true }, '');
        }

        let promptMouseDownTarget = null;
        let promptMouseUpTarget = null;
        const onPromptOverlayMouseDown = (e) => { promptMouseDownTarget = e.target; };
        const onPromptOverlayMouseUp = (e) => { promptMouseUpTarget = e.target; };
        const cleanup = () => {
            overlay.classList.remove('active');
            btnOk.removeEventListener('click', onOk);
            btnCancel.removeEventListener('click', onDiscard);
            btnClose.removeEventListener('click', onCancel);
            overlay.removeEventListener('mousedown', onPromptOverlayMouseDown);
            overlay.removeEventListener('mouseup', onPromptOverlayMouseUp);
            overlay.removeEventListener('click', onOverlayClick);
            document.removeEventListener('keydown', onKeydown, true);
            inputEl.removeEventListener('input', onInput);
            if (document.activeElement) document.activeElement.blur();
        };

        // Handlers
        const onOk = () => { cleanup(); resolve(inputEl.value); };
        const onDiscard = () => { cleanup(); resolve(null); };
        const onCancel = () => { cleanup(); resolve(inputEl.value); };
        const onOverlayClick = (e) => {
            if (promptMouseDownTarget === overlay && promptMouseUpTarget === overlay) onCancel();
            promptMouseDownTarget = null;
            promptMouseUpTarget = null;
        };
        const onInput = () => {
            autoResizeTextarea(inputEl);
            if (onInputCb) onInputCb(inputEl.value);
        };
        const onKeydown = (e) => {
            if (!overlay.classList.contains('active')) return;
            if (e.key === 'Escape') {
                e.stopImmediatePropagation();
                e.preventDefault();
                onCancel();
            }
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                onOk();
            }
            e.stopPropagation();
        };

        // Attach listeners
        btnOk.addEventListener('click', onOk);
        btnCancel.addEventListener('click', onDiscard);
        btnClose.addEventListener('click', onCancel);
        overlay.addEventListener('mousedown', onPromptOverlayMouseDown);
        overlay.addEventListener('mouseup', onPromptOverlayMouseUp);
        overlay.addEventListener('click', onOverlayClick);
        document.addEventListener('keydown', onKeydown, true);
        inputEl.addEventListener('input', onInput);

        // Show modal and wait for user interaction
        overlay.classList.add('active');

        // Focus input and move cursor to end, and trigger initial resize
        requestAnimationFrame(() => {
            inputEl.focus();
            inputEl.setSelectionRange(inputEl.value.length, inputEl.value.length);
            autoResizeTextarea(inputEl);
        });
    });
}



function autoResizeTextarea(el) {
    const modalBody = el.closest('.modal-body');
    const scrollTop = modalBody ? modalBody.scrollTop : 0;

    // Use screen height on mobile to prevent the textarea from shrinking when the virtual keyboard pops up
    const isMobile = window.matchMedia('(max-width: 1100px), (pointer: coarse)').matches;
    const referenceHeight = isMobile ? (window.screen.availHeight || window.innerHeight) : window.innerHeight;
    const maxHeight = referenceHeight * 0.4;

    el.style.height = 'auto';
    const sHeight = el.scrollHeight;

    if (sHeight > maxHeight) {
        el.style.height = maxHeight + 'px';
        el.style.overflowY = 'auto';
    } else {
        el.style.height = sHeight + 'px';
        el.style.overflowY = 'hidden';
    }

    // Restore scroll position to prevent layout jumping
    if (modalBody && modalBody.scrollTop !== scrollTop) {
        modalBody.scrollTop = scrollTop;
    }
}

function isMobileDetailLayout() {
    return mobileDetailQuery.matches;
}

function getSessionName(sessionId = sessionManager.getActiveSessionId()) {
    return sessionManager.getSessionById(sessionId)?.name || 'Session';
}

function getCurrentSingleSolveSessionId() {
    if (_currentModalSource?.type === 'single' && _currentModalSource.sessionId) {
        return _currentModalSource.sessionId;
    }

    return sessionManager.getActiveSessionId();
}

function getCurrentSingleSolveSession() {
    return sessionManager.getSessionById(getCurrentSingleSolveSessionId());
}

function setActionButtonFeedback(button, label) {
    if (!button) return;
    const originalLabel = button.dataset.originalLabel || button.textContent;
    if (!button.dataset.originalLabel) button.dataset.originalLabel = originalLabel;
    button.textContent = label;
    window.clearTimeout(button._feedbackTimeout);
    button._feedbackTimeout = window.setTimeout(() => {
        button.textContent = button.dataset.originalLabel || originalLabel;
    }, 1200);
}

function refreshSingleSolveSharePreview() {
    if (!_overlay?.classList.contains('active')) return;
    if (_currentModalSource?.type !== 'single') return;

    const solveSession = getCurrentSingleSolveSession();
    const fallbackSolve = _currentModalSource.solve;
    const solve = solveSession?.solves?.find(s => s.id === _currentModalSource.solveId) || fallbackSolve;
    if (!solve) return;

    const singleLabel = _currentModalSource.isBest ? 'Best single' : 'Single';
    const timeStr = formatSolveTime(solve);
    const previewSolve = {
        ...solve,
        comment: String(_commentInput?.value ?? solve.comment ?? '').trim(),
    };

    const nextShareText = buildSolveShareText(singleLabel, _currentModalSource.index, timeStr, previewSolve);
    _textarea.value = nextShareText;

    if (_currentDetailPayload) {
        _currentDetailPayload.shareText = nextShareText;
    }
}

function rerenderCurrentModalSource() {
    if (!_overlay?.classList.contains('active') || !_currentModalSource) return;

    if (_currentModalSource.type === 'single') {
        const solveSession = getCurrentSingleSolveSession();
        const fallbackSolve = _currentModalSource.solve;
        const solve = solveSession?.solves?.find(s => s.id === _currentModalSource.solveId) || fallbackSolve;
        if (!solve) return;
        showSolveDetail(solve, _currentModalSource.index, _currentModalSource.isBest, {
            enableStatNavigation: _currentModalSource.enableStatNavigation !== false,
        });
        return;
    }

    if (_currentModalSource.type === 'average') {
        showAverageDetail(
            _currentModalSource.label,
            _currentModalSource.value,
            _currentModalSource.solves,
            _currentModalSource.trim,
            _currentModalSource.selectionContext,
        );
    }
}

function rerenderSecondaryModalSource() {
    if (!_overlay?.classList.contains('active') || !_secondaryModalSource) return;

    if (_secondaryModalSource.type === 'single') {
        const solves = sessionManager.getFilteredSolvesForSessionId(_secondaryModalSource.sessionId);
        const solve = solves.find((entry) => entry.id === _secondaryModalSource.solveId) || _secondaryModalSource.solve;
        if (!solve) return;
        showSolveDetail(solve, _secondaryModalSource.index, _secondaryModalSource.isBest, {
            enableStatNavigation: false,
            targetLayer: MODAL_LAYER_SECONDARY,
        });
        return;
    }

    if (_secondaryModalSource.type === 'average') {
        showAverageDetail(
            _secondaryModalSource.label,
            _secondaryModalSource.value,
            _secondaryModalSource.solves,
            _secondaryModalSource.trim,
            _secondaryModalSource.selectionContext,
            { targetLayer: MODAL_LAYER_SECONDARY },
        );
    }
}

async function copyCurrentDetailToClipboard(feedbackButton = _mobileCopyButton) {
    if (!_currentDetailPayload?.shareText) return false;

    return copyTextWithFeedback(_currentDetailPayload.shareText, feedbackButton);
}

async function copyTextWithFeedback(text, feedbackButton, successLabel = 'Copied', failureLabel = 'Copy failed') {
    if (!text) return false;

    try {
        await navigator.clipboard.writeText(text);
        setActionButtonFeedback(feedbackButton, successLabel);
        return true;
    } catch {
        setActionButtonFeedback(feedbackButton, failureLabel);
        return false;
    }
}

async function shareCurrentDetail() {
    if (!_currentDetailPayload?.shareText) return;

    if (navigator.share) {
        try {
            await navigator.share({
                title: _currentDetailPayload.title,
                text: _currentDetailPayload.shareText,
            });
            return;
        } catch (error) {
            if (error?.name === 'AbortError') return;
        }
    }

    await copyCurrentDetailToClipboard(_mobileShareButton);
}

async function copySecondaryDetailToClipboard(feedbackButton = _secondaryMobileCopyButton) {
    if (!_secondaryDetailPayload?.shareText) return false;
    return copyTextWithFeedback(_secondaryDetailPayload.shareText, feedbackButton);
}

async function shareSecondaryDetail() {
    if (!_secondaryDetailPayload?.shareText) return;

    if (navigator.share) {
        try {
            await navigator.share({
                title: _secondaryDetailPayload.title,
                text: _secondaryDetailPayload.shareText,
            });
            return;
        } catch (error) {
            if (error?.name === 'AbortError') return;
        }
    }

    await copySecondaryDetailToClipboard(_secondaryMobileShareButton);
}

function clearMobileList() {
    if (_mobileList) _mobileList.replaceChildren();
}

function openSolveFromMobileEntry(entry) {
    const solveId = entry?.solveId;
    const sessionId = entry?.sessionId;
    if (!solveId || !sessionId) return;

    const solves = sessionManager.getFilteredSolvesForSessionId(sessionId);
    const solveIndex = solves.findIndex((solve) => solve.id === solveId);
    if (solveIndex < 0) return;

    showSolveDetail(solves[solveIndex], solveIndex, null, {
        enableStatNavigation: true,
        targetLayer: MODAL_LAYER_SECONDARY,
    });
}

function createMobileEntry(entry, { interactiveOverride = null } = {}) {
    const isInteractive = interactiveOverride == null
        ? Boolean(entry?.solveId && entry?.sessionId)
        : interactiveOverride;
    const item = document.createElement(isInteractive ? 'button' : 'div');
    item.className = 'modal-mobile-entry';
    if (isInteractive) {
        item.type = 'button';
        item.classList.add('clickable');
        item.setAttribute('aria-label', `Open solve ${entry.position}`);
        item.addEventListener('click', () => {
            openSolveFromMobileEntry(entry);
        });
    }
    if (entry.trimmed) item.classList.add('trimmed');
    if (entry.compact) item.classList.add('compact');

    const head = document.createElement('div');
    head.className = 'modal-mobile-entry-head';

    const timeBlock = document.createElement('div');
    timeBlock.className = 'modal-mobile-entry-time';

    const index = document.createElement('span');
    index.className = 'modal-mobile-entry-index';
    index.textContent = `${entry.position}.`;

    const time = document.createElement('span');
    time.textContent = entry.time;

    timeBlock.append(index, time);

    if (entry.compact) {
        const compactComment = document.createElement('div');
        compactComment.className = 'modal-mobile-entry-comment';
        compactComment.textContent = entry.comment || '';

        if (!entry.comment) {
            compactComment.hidden = true;
        }

        item.append(timeBlock, compactComment);
        return item;
    }

    const date = document.createElement('div');
    date.className = 'modal-mobile-entry-date';
    date.textContent = entry.date;

    const scramble = document.createElement('div');
    scramble.className = 'modal-mobile-entry-scramble';
    scramble.textContent = entry.scramble;

    head.append(timeBlock);
    if (entry.date) head.append(date);
    item.append(head, scramble);
    return item;
}

function getCompactGridMinColumnWidth(entries) {
    const maxTimeLength = entries.reduce((max, entry) => {
        const timeLength = String(entry?.time ?? '').length;
        return Math.max(max, timeLength);
    }, 0);
    const safeLength = Math.max(4, maxTimeLength);
    return `calc(${safeLength}ch + 2rem)`;
}

function renderMobileDetail(detailPayload) {
    if (!_overlay || !_mobileSummary || !_mobileShareActions || !_mobileListPanel) return;

    const shouldUseMobileDetail = Boolean(detailPayload) && isMobileDetailLayout();
    _overlay.classList.toggle('mobile-detail-active', shouldUseMobileDetail);
    _mobileSummary.hidden = !shouldUseMobileDetail;
    _mobileShareActions.hidden = !shouldUseMobileDetail;
    _mobileListPanel.hidden = !shouldUseMobileDetail;

    if (!shouldUseMobileDetail) {
        if (_mobileSummaryMetaLabel) _mobileSummaryMetaLabel.textContent = '';
        if (_mobileMoveSessionMenu) _mobileMoveSessionMenu.hidden = true;
        if (_mobileCopyScrambleButton) {
            _mobileCopyScrambleButton.hidden = true;
            _mobileCopyScrambleButton.style.display = 'none';
            _mobileCopyScrambleButton.setAttribute('aria-hidden', 'true');
        }
        _mobileList?.classList.remove('compact-grid');
        _mobileList?.style.removeProperty('--modal-compact-grid-min-col-width');
        clearMobileList();
        return;
    }

    _mobileSummaryValue.textContent = detailPayload.value;
    _mobileSummaryMetaLabel.textContent = detailPayload.metaLabel || detailPayload.meta || '';
    const shouldShowMobileMoveMenu = Boolean(detailPayload.canMoveSolve);
    _mobileMoveSessionMenu.hidden = !shouldShowMobileMoveMenu;
    if (shouldShowMobileMoveMenu) {
        syncMoveSessionMenus();
    } else {
        closeMoveSessionMenus();
    }
    _mobileCopyButton.textContent = detailPayload.copyLabel;
    _mobileCopyButton.dataset.originalLabel = detailPayload.copyLabel;
    _mobileShareButton.textContent = detailPayload.shareLabel;
    _mobileShareButton.dataset.originalLabel = detailPayload.shareLabel;
    if (_mobileCopyScrambleButton) {
        const shouldShowCopyScramble = _currentModalSource?.type === 'single'
            && Boolean(detailPayload.canCopyScramble && detailPayload.scrambleText);
        _mobileCopyScrambleButton.hidden = !shouldShowCopyScramble;
        _mobileCopyScrambleButton.style.display = shouldShowCopyScramble ? '' : 'none';
        _mobileCopyScrambleButton.setAttribute('aria-hidden', shouldShowCopyScramble ? 'false' : 'true');
        _mobileCopyScrambleButton.textContent = 'Copy Scramble';
        _mobileCopyScrambleButton.dataset.originalLabel = 'Copy Scramble';
    }

    const shouldUseCompactGrid = detailPayload.entries.some((entry) => entry.compact);
    _mobileList.classList.toggle('compact-grid', shouldUseCompactGrid);
    if (shouldUseCompactGrid) {
        _mobileList.style.setProperty(
            '--modal-compact-grid-min-col-width',
            getCompactGridMinColumnWidth(detailPayload.entries)
        );
    } else {
        _mobileList.style.removeProperty('--modal-compact-grid-min-col-width');
    }
    clearMobileList();
    _mobileList.append(...detailPayload.entries.map(createMobileEntry));
    _mobileList.scrollTop = 0;
}

function buildSolveDetailPayload(title, timeStr, solve, index, singleLabel, shareText) {
    return {
        title,
        value: timeStr,
        meta: `${getSessionName(solve.sessionId)} | ${singleLabel.toLowerCase()}`,
        metaLabel: singleLabel.toLowerCase(),
        canMoveSolve: true,
        canCopyScramble: true,
        copyLabel: 'Copy Solve',
        shareLabel: 'Share Solve',
        shareText,
        scrambleText: solve.scramble,
        entries: [{
            position: index + 1,
            time: timeStr,
            scramble: solve.scramble,
            date: formatMobilePreviewTimestamp(solve.timestamp),
            comment: '',
            compact: false,
            trimmed: false,
        }],
    };
}

function buildAverageDetailPayload(title, valueStr, label, entries, shareText, sessionId = sessionManager.getActiveSessionId()) {
    return {
        title,
        value: valueStr,
        meta: `${getSessionName(sessionId)} | ${label.toLowerCase()}`,
        metaLabel: `${getSessionName(sessionId)} | ${label.toLowerCase()}`,
        canMoveSolve: false,
        canCopyScramble: false,
        copyLabel: 'Copy Average',
        shareLabel: 'Share Average',
        shareText,
        scrambleText: '',
        entries,
    };
}

function updateSecondaryStatNavigation() {
    if (!_secondaryStatNav) return;

    if (!_secondarySelectedStatContext) {
        _secondaryStatNav.style.display = 'none';
        return;
    }

    const currentType = _secondarySelectedStatContext.statType || 'time';
    const endIndex = Number.isInteger(_secondarySelectedStatContext.endIndex) ? _secondarySelectedStatContext.endIndex : -1;

    _secondaryStatNav.style.display = 'flex';
    _secondaryStatNav.querySelectorAll('button[data-stat-type]').forEach((button) => {
        const statType = button.dataset.statType;
        const minIndex = parseInt(button.dataset.minIndex, 10) || 0;
        const isCurrent = statType === currentType;
        const isAvailable = endIndex >= minIndex;

        button.disabled = isCurrent || !isAvailable;
        button.setAttribute('aria-pressed', String(isCurrent));
    });
}

function renderSecondaryMobileDetail(detailPayload) {
    if (
        !_secondaryLayer
        || !_secondaryTextarea
        || !_secondaryMobileSummary
        || !_secondaryMobileShareActions
        || !_secondaryMobileListPanel
        || !_secondaryMobileList
    ) {
        return;
    }

    const shouldUseMobileDetail = Boolean(detailPayload) && isMobileDetailLayout();
    _secondaryLayer.classList.toggle('mobile-detail-active', shouldUseMobileDetail);
    _secondaryTextarea.style.display = shouldUseMobileDetail ? 'none' : '';
    _secondaryMobileSummary.hidden = true;
    _secondaryMobileShareActions.hidden = !shouldUseMobileDetail;
    _secondaryMobileListPanel.hidden = !shouldUseMobileDetail;

    if (!shouldUseMobileDetail) {
        _secondaryMobileList.classList.remove('compact-grid');
        _secondaryMobileList.style.removeProperty('--modal-compact-grid-min-col-width');
        _secondaryMobileList.replaceChildren();
        if (_secondaryMobileCopyScrambleButton) {
            _secondaryMobileCopyScrambleButton.hidden = true;
            _secondaryMobileCopyScrambleButton.style.display = 'none';
        }
        return;
    }

    _secondaryMobileCopyButton.textContent = detailPayload.copyLabel;
    _secondaryMobileCopyButton.dataset.originalLabel = detailPayload.copyLabel;
    _secondaryMobileShareButton.textContent = detailPayload.shareLabel;
    _secondaryMobileShareButton.dataset.originalLabel = detailPayload.shareLabel;

    if (_secondaryMobileCopyScrambleButton) {
        const shouldShowCopyScramble = _secondaryModalSource?.type === 'single'
            && Boolean(detailPayload.canCopyScramble && detailPayload.scrambleText);
        _secondaryMobileCopyScrambleButton.hidden = !shouldShowCopyScramble;
        _secondaryMobileCopyScrambleButton.style.display = shouldShowCopyScramble ? '' : 'none';
        _secondaryMobileCopyScrambleButton.textContent = 'Copy Scramble';
        _secondaryMobileCopyScrambleButton.dataset.originalLabel = 'Copy Scramble';
    }

    _secondaryMobileList.classList.remove('compact-grid');
    _secondaryMobileList.style.removeProperty('--modal-compact-grid-min-col-width');
    const secondaryEntry = detailPayload.entries[0] || null;
    _secondaryMobileList.replaceChildren(...(secondaryEntry ? [createMobileEntry(secondaryEntry, { interactiveOverride: false })] : []));
    _secondaryMobileList.scrollTop = 0;
}

function closeSecondaryModal({ restoreHistoryState = false } = {}) {
    if (!_secondaryLayer) return;

    _secondaryLayer.hidden = true;
    _overlay?.classList.remove('secondary-active');
    _secondaryCurrentSolveIndex = null;
    _secondarySelectedStatContext = null;
    _secondaryDetailPayload = null;
    _secondaryModalSource = null;
    updateModalCopyOptionVisibility();
    renderModalCopyOptionButtons();
    updateSecondaryStatNavigation();
    renderSecondaryMobileDetail(null);

    if (restoreHistoryState && _overlay?.classList.contains('active') && !window.history.state?.isBackIntercepted) {
        window.history.pushState({ isBackIntercepted: true }, '');
    }
}

export function closeModal({ isPopState = false } = {}) {
    if (isSecondaryModalActive()) {
        closeSecondaryModal({ restoreHistoryState: isPopState });
        return;
    }
    if (!isPopState && window.history.state?.isBackIntercepted) {
        window.history.back();
    }
    clearModalGhostClickGuard();
    closeMoveSessionMenus();
    _overlay.classList.remove('active');
    _overlay.classList.remove('stats-detail-active');
    closeSecondaryModal();
    _currentSolveIndex = null;
    _selectedStatContext = null;
    _currentDetailPayload = null;
    _currentModalSource = null;
    _isMovingSolve = false;
    _mobileExportToast?.classList.remove('visible');
    window.clearTimeout(_mobileExportToastTimeout);
    renderMobileDetail(null);
    if (document.activeElement) document.activeElement.blur();
}

export function getModalSelectionContext() {
    if (!_overlay?.classList.contains('active')) return null;
    return isSecondaryModalActive() ? _secondarySelectedStatContext : _selectedStatContext;
}

/**
 * Show a single solve detail.
 */
export function showSolveDetail(solve, index, isBest = null, { enableStatNavigation = true, targetLayer = MODAL_LAYER_PRIMARY } = {}) {
    if (targetLayer === MODAL_LAYER_SECONDARY) {
        _secondaryCurrentSolveIndex = index;
        _secondarySelectedStatContext = null;
    } else {
        _currentSolveIndex = index;
        _selectedStatContext = enableStatNavigation ? {
            statType: 'time',
            sessionId: solve.sessionId,
            endIndex: index,
            endSolveId: solve.id,
            layer: MODAL_LAYER_PRIMARY,
        } : null;
    }
    const timeStr = formatSolveTime(solve);
    const title = `Solve #${index + 1}`;

    if (isBest === null) {
        const solves = sessionManager.getFilteredSolvesForSessionId(solve.sessionId);
        let bestTime = Infinity;
        for (const currentSolve of solves) {
            const currentTime = getEffectiveTime(currentSolve);
            if (currentTime !== Infinity && currentTime < bestTime) {
                bestTime = currentTime;
            }
        }
        isBest = getEffectiveTime(solve) === bestTime && bestTime !== Infinity;
    }

    const singleLabel = isBest ? 'Best single' : 'Single';

    const modalSource = {
        type: 'single',
        solveId: solve.id,
        sessionId: solve.sessionId,
        solve,
        index,
        isBest,
        enableStatNavigation,
    };
    if (targetLayer === MODAL_LAYER_SECONDARY) {
        _secondaryModalSource = modalSource;
    } else {
        _currentModalSource = modalSource;
    }

    const text = buildSolveShareText(singleLabel, index, timeStr, solve);

    const detailPayload = buildSolveDetailPayload(title, timeStr, solve, index, singleLabel, text);
    if (targetLayer === MODAL_LAYER_SECONDARY) {
        _showSecondaryModal(title, text, solve, detailPayload);
    } else {
        _showModal(title, text, solve, detailPayload);
    }
}

/**
 * Show an average detail (ao5, ao12, etc).
 * @param {string} label - e.g. "ao5" or "Best ao5"
 * @param {number} value - the average value
 * @param {object[]} solves - the solves in this average window
 * @param {number} trim - how many best/worst to mark
 * @param {{ statType?: string, endIndex?: number, endSolveId?: string } | null} selectionContext
 */
export function showAverageDetail(label, value, solves, trim = 1, selectionContext = null, { targetLayer = MODAL_LAYER_PRIMARY } = {}) {
    if (targetLayer === MODAL_LAYER_SECONDARY) {
        _secondaryCurrentSolveIndex = null;
        _secondarySelectedStatContext = null;
    } else {
        _currentSolveIndex = null;
        _selectedStatContext = selectionContext ? {
            ...selectionContext,
            endSolveId: selectionContext.endSolveId ?? solves[solves.length - 1]?.id ?? null,
            layer: MODAL_LAYER_PRIMARY,
        } : null;
    }
    const valueStr = formatTime(value);

    const modalSource = {
        type: 'average',
        label,
        value,
        solves,
        trim,
        selectionContext,
    };
    if (targetLayer === MODAL_LAYER_SECONDARY) {
        _secondaryModalSource = modalSource;
    } else {
        _currentModalSource = modalSource;
    }

    // Expand label for title: "Best ao5" -> "Best Average of 5"
    const title = expandReadableStatLabel(label);

    const { shareText, mobileEntries } = buildAverageShareContent(label, valueStr, solves, trim);
    const detailPayload = buildAverageDetailPayload(
        title,
        valueStr,
        label,
        mobileEntries,
        shareText,
        selectionContext?.sessionId ?? solves[solves.length - 1]?.sessionId ?? sessionManager.getActiveSessionId(),
    );
    if (targetLayer === MODAL_LAYER_SECONDARY) {
        _showSecondaryModal(title, shareText, null, detailPayload);
    } else {
        _showModal(title, shareText, null, detailPayload);
    }
}

function updateStatNavigation() {
    if (!_statNav) return;

    if (!_selectedStatContext) {
        _statNav.style.display = 'none';
        _overlay?.classList.remove('stats-detail-active');
        return;
    }

    const currentType = _selectedStatContext.statType || 'time';
    const endIndex = Number.isInteger(_selectedStatContext.endIndex) ? _selectedStatContext.endIndex : -1;

    _statNav.style.display = 'flex';
    _overlay?.classList.add('stats-detail-active');
    _statNav.querySelectorAll('button[data-stat-type]').forEach(button => {
        const statType = button.dataset.statType;
        const minIndex = parseInt(button.dataset.minIndex, 10) || 0;
        const isCurrent = statType === currentType;
        const isAvailable = endIndex >= minIndex;

        button.disabled = isCurrent || !isAvailable;
        button.setAttribute('aria-pressed', String(isCurrent));
    });
}

function parsePx(value) {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

function getTextareaHeightForRows(textareaEl, rowCount) {
    if (!(textareaEl instanceof HTMLTextAreaElement)) return;

    const computed = window.getComputedStyle(textareaEl);
    const lineHeight = parsePx(computed.lineHeight) || (parsePx(computed.fontSize) * 1.6);
    const paddingY = parsePx(computed.paddingTop) + parsePx(computed.paddingBottom);
    const borderY = parsePx(computed.borderTopWidth) + parsePx(computed.borderBottomWidth);
    const safeRowCount = Math.max(1, Number.isFinite(rowCount) ? rowCount : 1);
    return Math.ceil((lineHeight * safeRowCount) + paddingY + borderY);
}

function getTextareaVisualRowCount(textareaEl, text) {
    if (!(textareaEl instanceof HTMLTextAreaElement)) return 1;

    const computed = window.getComputedStyle(textareaEl);
    const lineHeight = parsePx(computed.lineHeight) || (parsePx(computed.fontSize) * 1.6);
    const paddingY = parsePx(computed.paddingTop) + parsePx(computed.paddingBottom);
    const previousValue = textareaEl.value;
    const previousRows = textareaEl.rows;
    const previousCssText = textareaEl.style.cssText;

    textareaEl.value = text;
    textareaEl.rows = 1;
    textareaEl.style.setProperty('height', '0px', 'important');
    textareaEl.style.setProperty('min-height', '0px', 'important');
    textareaEl.style.setProperty('overflow-y', 'hidden', 'important');

    const contentHeight = Math.max(0, textareaEl.scrollHeight - paddingY);
    // scrollHeight is integer-rounded, so allow a 1px tolerance to avoid reserving
    // a full extra row when the measured height lands just above an exact line multiple.
    const adjustedContentHeight = Math.max(0, contentHeight - 1);
    const visualRowCount = Math.max(1, Math.ceil(adjustedContentHeight / lineHeight));

    textareaEl.value = previousValue;
    textareaEl.rows = previousRows;
    textareaEl.style.cssText = previousCssText;

    return visualRowCount;
}

function syncTextareaRegularHeight(textareaEl, rowCount) {
    if (!(textareaEl instanceof HTMLTextAreaElement)) return;

    const measuredHeight = getTextareaHeightForRows(textareaEl, rowCount);

    if (measuredHeight > 0) {
        textareaEl.style.setProperty('--modal-textarea-regular-height', `${measuredHeight}px`);
    }
}

function _showModal(title, text, solveContext = null, detailPayload = null) {
    document.getElementById('modal-title').textContent = title;
    _textarea.value = text;
    _currentDetailPayload = detailPayload;
    updateModalCopyOptionVisibility();
    renderModalCopyOptionButtons();

    const visualRowCount = getTextareaVisualRowCount(_textarea, text);
    const targetRowCount = Math.min(Math.max(1, visualRowCount), 16);
    const isRowCountCapped = visualRowCount > 16;
    _textarea.rows = targetRowCount;

    if (!isRowCountCapped) {
        _textarea.style.height = 'auto';
        _textarea.style.minHeight = 'auto';
        // } else if (lineCount <= 7) {
        //     _textarea.rows = 7;
        //     _textarea.style.height = 'auto';
        //     _textarea.style.minHeight = 'auto';
        // } else if (lineCount <= 9) {
        //     _textarea.rows = 9;
        //     _textarea.style.height = 'auto';
        //     _textarea.style.minHeight = 'auto';
    } else {
        const cappedHeight = getTextareaHeightForRows(_textarea, targetRowCount);
        if (cappedHeight > 0) {
            const cappedHeightPx = `${cappedHeight}px`;
            _textarea.style.height = cappedHeightPx;
            _textarea.style.minHeight = cappedHeightPx;
        }
    }

    syncTextareaRegularHeight(_textarea, targetRowCount);

    const dateInfo = document.getElementById('modal-date-info');

    // Toggle actions visibility based on context
    if (solveContext) {
        _modalActions.style.display = 'flex';
        _modalActions.dataset.solveId = solveContext.id;

        // Show solve date/time in header
        if (dateInfo) {
            dateInfo.textContent = formatDateTime(solveContext.timestamp);
            dateInfo.style.display = 'block';
        }

        // Setup button states
        const btnPlus2 = document.getElementById('modal-btn-plus2');
        const btnDnf = document.getElementById('modal-btn-dnf');

        btnPlus2.classList.toggle('active-penalty', solveContext.penalty === '+2');
        btnDnf.classList.toggle('active-penalty', solveContext.penalty === 'DNF');
        btnPlus2.style.borderColor = '';
        btnPlus2.style.background = '';
        btnPlus2.style.color = '';
        btnDnf.style.borderColor = '';
        btnDnf.style.background = '';
        btnDnf.style.color = '';

        // Setup comment input
        _commentTools.dataset.mobileVisible = 'true';
        _commentTools.style.display = 'grid';
        _commentInput.style.display = 'block';
        _commentInput.value = solveContext.comment || '';
        _desktopMoveSessionMenu.hidden = false;
        syncMoveSessionMenus();
        requestAnimationFrame(() => autoResizeTextarea(_commentInput));
    } else {
        _modalActions.style.display = 'none';
        delete _modalActions.dataset.solveId;

        // Hide date info for non-solve modals (averages)
        if (dateInfo) {
            dateInfo.textContent = '';
            dateInfo.style.display = 'none';
        }
        delete _commentTools.dataset.mobileVisible;
        _commentTools.style.display = 'none';
        _commentInput.style.display = 'none';
        _desktopMoveSessionMenu.hidden = true;
        _mobileMoveSessionMenu.hidden = true;
        closeMoveSessionMenus();
    }

    updateStatNavigation();
    renderMobileDetail(detailPayload);

    if (!window.history.state?.isBackIntercepted) {
        window.history.pushState({ isBackIntercepted: true }, '');
    }

    _overlay.classList.add('active');

    if (!isMobileDetailLayout() || !detailPayload) {
        requestAnimationFrame(() => {
            _textarea.focus();
            _textarea.select();
        });
    }
}

function _showSecondaryModal(title, text, solveContext = null, detailPayload = null) {
    if (
        !_secondaryLayer
        || !_secondaryTitle
        || !(_secondaryTextarea instanceof HTMLTextAreaElement)
    ) {
        return;
    }

    _secondaryTitle.textContent = title;
    _secondaryTextarea.value = text;
    _secondaryDetailPayload = detailPayload;
    updateModalCopyOptionVisibility();
    renderModalCopyOptionButtons();

    const visualRowCount = getTextareaVisualRowCount(_secondaryTextarea, text);
    const targetRowCount = Math.min(Math.max(1, visualRowCount), 16);
    const isRowCountCapped = visualRowCount > 16;
    _secondaryTextarea.rows = targetRowCount;

    if (!isRowCountCapped) {
        _secondaryTextarea.style.height = 'auto';
        _secondaryTextarea.style.minHeight = 'auto';
    } else {
        const cappedHeight = getTextareaHeightForRows(_secondaryTextarea, targetRowCount);
        if (cappedHeight > 0) {
            const cappedHeightPx = `${cappedHeight}px`;
            _secondaryTextarea.style.height = cappedHeightPx;
            _secondaryTextarea.style.minHeight = cappedHeightPx;
        }
    }

    syncTextareaRegularHeight(_secondaryTextarea, targetRowCount);

    updateSecondaryStatNavigation();
    renderSecondaryMobileDetail(detailPayload);
    _secondaryLayer.hidden = false;
    _overlay?.classList.add('secondary-active');

    if (!isMobileDetailLayout() || !detailPayload) {
        requestAnimationFrame(() => {
            _secondaryTextarea.focus();
            _secondaryTextarea.select();
        });
    }
}
