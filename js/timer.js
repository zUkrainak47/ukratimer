import { settings } from './settings.js?v=2026041801';
import { EventEmitter, formatTime, truncateTimeDisplay } from './utils.js?v=2026041801';

const State = {
    IDLE: 'idle',
    HOLDING: 'holding',
    READY: 'ready',
    INSPECTION_PRIMED: 'inspection-primed',
    INSPECTING: 'inspecting',
    INSPECTION_HOLDING: 'inspection-holding',
    INSPECTION_READY: 'inspection-ready',
    RUNNING: 'running',
    STOPPED: 'stopped',
};

const GHOST_CLICK_GUARD_MS = 450;
const GHOST_CLICK_GUARD_RADIUS_PX = 42;
const BACKGROUND_POINTER_EXCLUDE_SELECTOR = [
    '#timer-info',
    '#inspection-voice-unlock-wrap',
    '.panel',
    '.custom-select-dropdown',
    '.scramble-type-dropdown',
].join(', ');

class Timer extends EventEmitter {
    constructor() {
        super();
        this.state = State.IDLE;
        this.startTime = 0;
        this.elapsed = 0;
        this._inspectionStartTime = 0;
        this._inspectionElapsed = 0;
        this._pendingPenalty = null;
        this._inspectionSnapshot = null;
        this._inspectionAlertsFired = new Set();
        this._holdTimer = null;
        this._holdToken = 0;
        this._rafId = null;
        this._displayEl = null;
        this._interactionEls = [];
        this._spaceDown = false;
        this._leftDown = false;
        this._rightDown = false;
        this._leftAltDown = false;
        this._rightAltDown = false;
        this._activePointerId = null;
        this._ghostClickGuardExpiresAt = 0;
        this._ghostClickGuardOrigin = null;
        this._ghostClickGuardTimeout = null;
        this._typingInspectionTimeout = null;
        this._cachedViewport = { width: 0, height: 0 };

        this._onKeyDown = this._onKeyDown.bind(this);
        this._onKeyUp = this._onKeyUp.bind(this);
        this._onWindowBlur = this._onWindowBlur.bind(this);
        this._onVisibilityChange = this._onVisibilityChange.bind(this);
        this._onPointerDown = this._onPointerDown.bind(this);
        this._onPointerUp = this._onPointerUp.bind(this);
        this._onPointerCancel = this._onPointerCancel.bind(this);
        this._onDocumentPointerDown = this._onDocumentPointerDown.bind(this);
        this._onCapturedClick = this._onCapturedClick.bind(this);
        this._tick = this._tick.bind(this);
        this.refreshDisplayRules = this.refreshDisplayRules.bind(this);
    }

    init(displayEl, interactionEls = [displayEl]) {
        this._displayEl = displayEl;
        this._interactionEls = Array.from(new Set(interactionEls.filter(Boolean)));
        this._cachedViewport.width = window.innerWidth || document.documentElement.clientWidth;
        this._cachedViewport.height = window.innerHeight || document.documentElement.clientHeight;
        document.addEventListener('keydown', this._onKeyDown);
        document.addEventListener('keyup', this._onKeyUp);
        window.addEventListener('blur', this._onWindowBlur);
        document.addEventListener('visibilitychange', this._onVisibilityChange);
        document.addEventListener('pointerdown', this._onDocumentPointerDown);
        document.addEventListener('pointerup', this._onPointerUp);
        document.addEventListener('pointercancel', this._onPointerCancel);
        document.addEventListener('click', this._onCapturedClick, true);
        window.addEventListener('resize', this.refreshDisplayRules);
        this._interactionEls.forEach((el) => {
            el.addEventListener('pointerdown', this._onPointerDown);
            el.addEventListener('pointerup', this._onPointerUp);
            el.addEventListener('pointercancel', this._onPointerCancel);
        });
        this._updateDisplay('0.00');
        this._setColor(State.IDLE);
    }

    destroy() {
        document.removeEventListener('keydown', this._onKeyDown);
        document.removeEventListener('keyup', this._onKeyUp);
        window.removeEventListener('blur', this._onWindowBlur);
        document.removeEventListener('visibilitychange', this._onVisibilityChange);
        document.removeEventListener('pointerdown', this._onDocumentPointerDown);
        document.removeEventListener('pointerup', this._onPointerUp);
        document.removeEventListener('pointercancel', this._onPointerCancel);
        document.removeEventListener('click', this._onCapturedClick, true);
        window.removeEventListener('resize', this.refreshDisplayRules);
        this._interactionEls.forEach((el) => {
            el.removeEventListener('pointerdown', this._onPointerDown);
            el.removeEventListener('pointerup', this._onPointerUp);
            el.removeEventListener('pointercancel', this._onPointerCancel);
        });
        this._interactionEls = [];
        this._clearGhostClickGuard();
        this._cancelHold();
        this._cancelRaf();
        this._cancelTypingInspectionAutoTimeout();
    }

    _onKeyDown(e) {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') {
            // In typing+inspection mode, let Space through even from the manual time input
            const isTypingInspectionSpace = this._isDesktopTypingEntryMode()
                && this._inspectionEnabled()
                && e.code === 'Space'
                && e.target.id === 'manual-time-hidden-input';
            if (!isTypingInspectionSpace) return;
        }
        if (this._hasBlockingOverlayOpen()) return;
        if (this._isManualTimeEntryActive() && !(this._isDesktopTypingEntryMode() && this._inspectionEnabled())) return;

        const isStackmatKey = this._isStackmatKey(e);
        const isEscape = e.code === 'Escape' || e.key === 'Escape' || e.keyCode === 27;
        const isDnfKey = isEscape || e.code === 'Backspace' || e.key === 'Backspace' || e.keyCode === 8 || e.code === 'Delete' || e.key === 'Delete' || e.keyCode === 46;

        if (this._isDesktopTypingEntryMode()) {
            // In typing mode with inspection: allow Space to arm inspection from idle/stopped,
            // allow any key to dismiss active inspection, and allow Escape to cancel primed inspection.
            if (this._inspectionEnabled()) {
                if (this._isInspectionTickingState(this.state)) {
                    // Any key dismisses typing inspection.
                    // Numeric keys should pass through so the first typed digit is kept.
                    const isDigitKey = /^\d$/.test(e.key);
                    if (!isDigitKey) {
                        e.preventDefault();
                        e.stopImmediatePropagation();
                    }
                    this._endTypingInspection();
                    return;
                }

                if (isEscape && this.state === State.INSPECTION_PRIMED) {
                    e.preventDefault();
                    e.stopImmediatePropagation();
                    this._spaceDown = false;
                    this._cancelInspection();
                    this.emit('typingInspectionDone');
                    return;
                }

                if (e.code === 'Space' && (this.state === State.IDLE || this.state === State.STOPPED)) {
                    e.preventDefault();
                    if (this._spaceDown) return;
                    this._spaceDown = true;
                    this._handleStartPress();
                    return;
                }
            }

            if (e.code === 'Space') this._spaceDown = false;
            if (isStackmatKey) this._setStackmatFlag(e.code, false);
            return;
        }

        if ((e.ctrlKey || e.metaKey) && !isStackmatKey && !isEscape) return;

        if (isDnfKey && this.state === State.RUNNING) {
            this._stopTimer('DNF', this._getEventTimestamp(e));
            e.preventDefault();
            e.stopImmediatePropagation();
            return;
        }

        if (isEscape && this._isInspectionPreSolveState(this.state)) {
            this._cancelInspection();
            e.preventDefault();
            e.stopImmediatePropagation();
            return;
        }

        if (isEscape && (this.state === State.HOLDING || this.state === State.READY)) {
            this._cancelHold();
            this._setState(State.IDLE);
            this._setColor(State.IDLE);
            e.preventDefault();
            e.stopImmediatePropagation();
            return;
        }

        if (this.state === State.RUNNING) {
            e.preventDefault();
            e.stopImmediatePropagation();
            this._stopTimer(null, this._getEventTimestamp(e));
            return;
        }

        if (e.code === 'Space') {
            e.preventDefault();
            if (this._spaceDown) return;
            this._spaceDown = true;
            this._handleStartPress();
            return;
        }

        if (!isStackmatKey) return;

        e.preventDefault();
        const wasStackmatReady = this._isStackmatActive();
        this._setStackmatFlag(e.code, true);
        if (!wasStackmatReady && this._isStackmatActive()) {
            this._handleStartPress();
        }
    }

    _onKeyUp(e) {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') {
            const isTypingInspectionSpace = this._isDesktopTypingEntryMode()
                && this._inspectionEnabled()
                && e.code === 'Space'
                && e.target.id === 'manual-time-hidden-input';
            if (!isTypingInspectionSpace) return;
        }
        const isStackmatKey = this._isStackmatKey(e);

        if (this._isManualTimeEntryActive() || this._isDesktopTypingEntryMode()) {
            // In typing mode with inspection: allow Space release to start inspection from primed state
            if (this._isDesktopTypingEntryMode() && this._inspectionEnabled() && e.code === 'Space') {
                this._spaceDown = false;
                if (this.state === State.INSPECTION_PRIMED) {
                    e.preventDefault();
                    this._handleStartRelease(e);
                    return;
                }
            }
            if (e.code === 'Space') this._spaceDown = false;
            if (isStackmatKey) this._setStackmatFlag(e.code, false);
            return;
        }

        if (this._hasBlockingOverlayOpen()) {
            if (e.code === 'Space') this._spaceDown = false;
            if (isStackmatKey) this._setStackmatFlag(e.code, false);
            return;
        }

        if ((e.ctrlKey || e.metaKey) && !isStackmatKey) return;

        if (e.code === 'Space') {
            e.preventDefault();
            this._spaceDown = false;
            this._handleStartRelease(e);
            return;
        }

        if (!isStackmatKey) return;

        e.preventDefault();
        const wasStackmatReady = this._isStackmatActive();
        this._setStackmatFlag(e.code, false);
        if (wasStackmatReady && !this._isStackmatActive()) {
            this._handleStartRelease(e);
        }
    }

    _onWindowBlur() {
        this._resetKeyboardStartState({ cancelPendingStart: true });
    }

    _onVisibilityChange() {
        if (document.visibilityState !== 'hidden') return;
        this._resetKeyboardStartState({ cancelPendingStart: true });
    }

    _onPointerDown(e) {
        if (!this._isTouchPointer(e)) return;
        if (this._hasBlockingOverlayOpen()) return;
        if (this._isManualTimeEntryActive()) return;
        if (this._isInteractivePointerTarget(e.target)) return;
        if (this._isScrambleBarTarget(e.target) && !this._isMobileTimerViewActive()) return;

        if (this.state === State.RUNNING) {
            this._consumeStopPointerDown(e);
            return;
        }

        if (this._activePointerId != null) return;

        e.preventDefault();
        this._claimActivePointer(e);
        this._handleStartPress();
    }

    _onDocumentPointerDown(e) {
        if (this._hasBlockingOverlayOpen()) return;
        if (this._isManualTimeEntryActive()) return;
        if (this._backgroundSpacebarEnabled() && this._isPrimaryPointerDown(e) && this._isBackgroundPointerTarget(e.target)) {
            const canUseBackgroundPress = this.state === State.RUNNING
                || this.state === State.IDLE
                || this.state === State.STOPPED
                || this.state === State.INSPECTING;
            if (!canUseBackgroundPress) return;

            if (this.state === State.RUNNING) {
                this._consumeStopPointerDown(e);
                return;
            }

            if (this._activePointerId != null) return;

            e.preventDefault();
            this._claimActivePointer(e);
            this._handleStartPress();
            return;
        }

        if (!this._isTouchPointer(e)) return;
        if (!this._isMobileTimerViewActive()) return;
        if (this._isInteractivePointerTarget(e.target)) return;

        if (this._isInspectionTickingState(this.state)) {
            if (this._isInspectionCancelTarget(e.target)) return;
            if (this._activePointerId != null) return;

            e.preventDefault();
            this._claimActivePointer(e);
            this._handleStartPress();
            return;
        }

        if (this.state === State.RUNNING) {
            if (this._isWithinInteractionArea(e.target)) return;

            this._consumeStopPointerDown(e);
            return;
        }

        if (!this._shouldStartFromZenDocumentArea(e.target)) return;
        if (this._activePointerId != null) return;

        e.preventDefault();
        this._claimActivePointer(e);
        this._handleStartPress();
    }

    _onCapturedClick(e) {
        if (!e.isTrusted) return;
        if (this._ghostClickGuardExpiresAt === 0) return;

        if (performance.now() > this._ghostClickGuardExpiresAt) {
            this._clearGhostClickGuard();
            return;
        }

        const origin = this._ghostClickGuardOrigin;
        if (origin) {
            const dx = e.clientX - origin.x;
            const dy = e.clientY - origin.y;
            if ((dx * dx) + (dy * dy) > GHOST_CLICK_GUARD_RADIUS_PX ** 2) return;
        }

        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        this._clearGhostClickGuard();
    }

    _onPointerUp(e) {
        if (e.pointerId !== this._activePointerId) return;
        e.preventDefault();
        this._releaseActivePointer(e.pointerId);
        this._handleStartRelease(e);
    }

    _onPointerCancel(e) {
        if (e.pointerId !== this._activePointerId) return;
        this._releaseActivePointer(e.pointerId);
        this._cancelHold();

        if (this.state === State.HOLDING || this.state === State.READY) {
            this._setState(State.IDLE);
            this._setColor(State.IDLE);
            return;
        }

        if (this.state === State.INSPECTION_PRIMED) {
            this._cancelInspection();
            return;
        }

        if (this.state === State.INSPECTION_HOLDING || this.state === State.INSPECTION_READY) {
            this._setState(State.INSPECTING);
            this._setColor(State.INSPECTING);
        }
    }

    _handleStartPress() {
        if (this.state === State.IDLE || this.state === State.STOPPED) {
            if (this._inspectionEnabled()) {
                this._armInspection();
            } else {
                this._startHold();
            }
            return;
        }

        if (this.state === State.INSPECTING) {
            this._startInspectionHold();
        }
    }

    _handleStartRelease(releaseEvent) {
        if (this.state === State.HOLDING) {
            this._cancelHold();
            this._setState(State.IDLE);
            this._setColor(State.IDLE);
            return;
        }

        if (this.state === State.READY) {
            this._startTimer(releaseEvent);
            return;
        }

        if (this.state === State.INSPECTION_PRIMED) {
            this._startInspection();
            return;
        }

        if (this.state === State.INSPECTION_HOLDING) {
            this._cancelHold();
            this._setState(State.INSPECTING);
            this._setColor(State.INSPECTING);
            return;
        }

        if (this.state === State.INSPECTION_READY) {
            this._startTimer(releaseEvent);
        }
    }

    _startHold() {
        this._setState(State.HOLDING);
        this._setColor(State.HOLDING);

        const holdDuration = settings.get('holdDuration');
        const holdToken = ++this._holdToken;
        this._holdTimer = setTimeout(() => {
            if (holdToken !== this._holdToken) return;
            if (this.state !== State.HOLDING) return;
            this._holdTimer = null;
            this._setState(State.READY);
            this._setColor(State.READY);
        }, holdDuration);
    }

    _armInspection() {
        if (!this._inspectionSnapshot) {
            this._inspectionSnapshot = {
                state: this.state,
                text: this._displayEl ? this._displayEl.textContent : '0.00',
            };
        }

        this._pendingPenalty = null;
        this._setState(State.INSPECTION_PRIMED);
        this._setColor(State.INSPECTION_PRIMED);
    }

    _startInspection() {
        this._cancelHold();
        this._cancelRaf();
        this._inspectionStartTime = performance.now();
        this._inspectionElapsed = 0;
        this._inspectionAlertsFired.clear();
        this._pendingPenalty = null;

        this._setState(State.INSPECTING);
        this._setColor(State.INSPECTING);

        if (this._shouldShowInspectionCount()) {
            this._updateDisplay('0');
        } else {
            this._updateDisplay('Inspect');
        }

        // In typing mode, auto-end inspection after 15s
        if (this._isDesktopTypingEntryMode()) {
            this._startTypingInspectionAutoTimeout();
        }

        this._tick();
    }

    _startInspectionHold() {
        this._setState(State.INSPECTION_HOLDING);
        this._setColor(State.INSPECTION_HOLDING);

        const holdDuration = settings.get('holdDuration');
        const holdToken = ++this._holdToken;
        this._holdTimer = setTimeout(() => {
            if (holdToken !== this._holdToken) return;
            if (this.state !== State.INSPECTION_HOLDING) return;
            this._holdTimer = null;
            this._setState(State.INSPECTION_READY);
            this._setColor(State.INSPECTION_READY);
        }, holdDuration);
    }

    _cancelInspection() {
        this._cancelHold();
        this._cancelRaf();
        this._cancelTypingInspectionAutoTimeout();
        this._inspectionStartTime = 0;
        this._inspectionElapsed = 0;
        this._pendingPenalty = null;
        this._inspectionAlertsFired.clear();

        const snapshot = this._inspectionSnapshot;
        this._inspectionSnapshot = null;

        if (snapshot) {
            this._updateDisplay(snapshot.text);
            this._setState(snapshot.state);
            this._setColor(snapshot.state);
            return;
        }

        this._setState(State.STOPPED);
        this._setColor(State.STOPPED);
    }

    _cancelHold() {
        this._holdToken += 1;
        if (this._holdTimer) {
            clearTimeout(this._holdTimer);
            this._holdTimer = null;
        }
    }

    _startTimer(releaseEvent) {
        const fromInspection = this._isInspectionTickingState(this.state);

        this._cancelHold();
        this._cancelRaf();

        if (!fromInspection) {
            this._pendingPenalty = null;
        }

        this._inspectionSnapshot = null;
        this._inspectionStartTime = 0;
        this._inspectionElapsed = 0;
        this._inspectionAlertsFired.clear();

        this._setState(State.RUNNING);
        this._setColor(State.RUNNING);
        const now = performance.now();
        const eventTs = releaseEvent ? this._getEventTimestamp(releaseEvent) : null;
        const hasUsableStartTimestamp = Number.isFinite(eventTs)
            && eventTs <= now
            && eventTs >= now - 500;
        this.startTime = hasUsableStartTimestamp ? eventTs : now;
        this.elapsed = 0;

        if (!this._shouldShowRunningTime()) {
            this._updateDisplay('...');
        }

        this.emit('started', this._pendingPenalty);
        this._tick();
    }

    _tick() {
        if (this.state === State.RUNNING) {
            this.elapsed = performance.now() - this.startTime;

            if (this._shouldShowRunningTime()) {
                let displayTime = this.elapsed;
                let digits = 2;
                const updateMode = settings.get('timerUpdate');
                if (updateMode === '1s') {
                    displayTime = Math.floor(displayTime / 1000) * 1000;
                    digits = 0;
                } else if (updateMode === '0.1s') {
                    displayTime = Math.floor(displayTime / 100) * 100;
                    digits = 1;
                }
                this._updateDisplay(formatTime(displayTime, digits));
            }

            this._rafId = requestAnimationFrame(this._tick);
            return;
        }

        if (!this._isInspectionTickingState(this.state)) {
            this._rafId = null;
            return;
        }

        this._inspectionElapsed = performance.now() - this._inspectionStartTime;
        this._pendingPenalty = this._getInspectionPenalty(this._inspectionElapsed);

        this._emitInspectionAlert(8, 8000);
        this._emitInspectionAlert(12, 12000);

        if (this._shouldShowInspectionCount()) {
            this._updateDisplay(this._formatInspectionDisplay(this._inspectionElapsed));
        }

        this._rafId = requestAnimationFrame(this._tick);
    }

    _emitInspectionAlert(seconds, thresholdMs) {
        if (this._inspectionAlertsFired.has(seconds) || this._inspectionElapsed < thresholdMs) return;
        this._inspectionAlertsFired.add(seconds);
        this.emit('inspectionAlert', seconds);
    }

    _stopTimer(penaltyOverride = null, stopTimestamp = null) {
        this._cancelRaf();
        const now = performance.now();
        // Some mobile hardware-keyboard events (notably on WebKit/iPadOS) can
        // report a timestamp from the wrong clock origin or as 0. If the stop
        // timestamp is outside this solve's lifetime, fall back to "now" so we
        // don't collapse the solve to 0.00.
        const hasUsableStopTimestamp = Number.isFinite(stopTimestamp)
            && stopTimestamp >= this.startTime
            && stopTimestamp <= now;
        const resolvedStopTime = hasUsableStopTimestamp ? stopTimestamp : now;
        this.elapsed = resolvedStopTime - this.startTime;

        const finalPenalty = penaltyOverride ?? this._pendingPenalty ?? null;

        this._setState(State.STOPPED);
        this._setColor(State.STOPPED);
        this._updateDisplay(this._formatStoppedDisplay(this.elapsed, finalPenalty));

        this._pendingPenalty = null;
        this._inspectionSnapshot = null;
        this.emit('stopped', this.elapsed, finalPenalty);
    }

    _getEventTimestamp(event) {
        if (!event || !Number.isFinite(event.timeStamp)) return null;

        const timestamp = event.timeStamp;
        if (timestamp > 1e12) {
            const perfOrigin = Number.isFinite(performance.timeOrigin)
                ? performance.timeOrigin
                : Date.now() - performance.now();
            return timestamp - perfOrigin;
        }

        return timestamp;
    }

    _cancelRaf() {
        if (this._rafId) {
            cancelAnimationFrame(this._rafId);
            this._rafId = null;
        }
    }

    _endTypingInspection() {
        this._cancelHold();
        this._cancelRaf();
        this._cancelTypingInspectionAutoTimeout();
        this._inspectionStartTime = 0;
        this._inspectionElapsed = 0;
        this._pendingPenalty = null;
        this._inspectionAlertsFired.clear();
        this._inspectionSnapshot = null;

        this._setState(State.STOPPED);
        this._setColor(State.STOPPED);
        this._updateDisplay('0.00');
        this.emit('typingInspectionDone');
    }

    _startTypingInspectionAutoTimeout() {
        this._cancelTypingInspectionAutoTimeout();
        this._typingInspectionTimeout = setTimeout(() => {
            this._typingInspectionTimeout = null;
            if (this._isInspectionTickingState(this.state)) {
                this._endTypingInspection();
            }
        }, 15000);
    }

    _cancelTypingInspectionAutoTimeout() {
        if (this._typingInspectionTimeout) {
            clearTimeout(this._typingInspectionTimeout);
            this._typingInspectionTimeout = null;
        }
    }

    _inspectionEnabled() {
        return settings.get('inspectionTime') === '15s';
    }

    _shouldShowInspectionCount() {
        return settings.get('timerUpdate') !== 'none';
    }

    _shouldShowRunningTime() {
        const updateMode = settings.get('timerUpdate');
        return updateMode !== 'none' && updateMode !== 'inspection';
    }

    _getInspectionPenalty(elapsed) {
        if (elapsed >= 17000) return 'DNF';
        if (elapsed >= 15000) return '+2';
        return null;
    }

    _formatInspectionDisplay(elapsed) {
        const penalty = this._getInspectionPenalty(elapsed);
        if (penalty) return penalty;
        return String(Math.floor(elapsed / 1000));
    }

    _formatStoppedDisplay(elapsed, penalty) {
        if (penalty === 'DNF') return formatTime(elapsed);

        let display = formatTime(penalty === '+2' ? elapsed + 2000 : elapsed);
        if (penalty === '+2') display += '+';
        return display;
    }

    _isInspectionTickingState(state) {
        return state === State.INSPECTING
            || state === State.INSPECTION_HOLDING
            || state === State.INSPECTION_READY;
    }

    _isInspectionPreSolveState(state) {
        return state === State.INSPECTION_PRIMED || this._isInspectionTickingState(state);
    }

    _hasBlockingOverlayOpen() {
        return Boolean(document.querySelector('.modal-overlay.active, .settings-overlay.active'));
    }

    _isManualTimeEntryActive() {
        return document.body.classList.contains('manual-time-entry-active');
    }

    _isDesktopTypingEntryMode() {
        return settings.get('timeEntryMode') === 'typing' && !document.body.classList.contains('mobile-viewport');
    }

    _isInteractivePointerTarget(target) {
        return target instanceof Element
            && Boolean(target.closest('button, input, textarea, select, a, [data-no-timer-start]'));
    }

    _isWithinInteractionArea(target) {
        return target instanceof Node
            && this._interactionEls.some((el) => el instanceof Element && el.contains(target));
    }

    _isScrambleBarTarget(target) {
        if (target instanceof Element) return Boolean(target.closest('#scramble-bar'));
        return target instanceof Node && target.parentElement instanceof Element
            ? Boolean(target.parentElement.closest('#scramble-bar'))
            : false;
    }

    _isMobileTimerViewActive() {
        return document.body.classList.contains('mobile-viewport')
            && document.body.dataset.mobilePanel === 'timer';
    }

    _shouldStartFromZenDocumentArea(target) {
        if (!document.body.classList.contains('zen')) return false;
        if (this.state !== State.IDLE && this.state !== State.STOPPED) return false;
        return !this._isWithinInteractionArea(target);
    }

    _armGhostClickGuard(e) {
        this._clearGhostClickGuard();
        this._ghostClickGuardExpiresAt = performance.now() + GHOST_CLICK_GUARD_MS;
        this._ghostClickGuardOrigin = Number.isFinite(e.clientX) && Number.isFinite(e.clientY)
            ? { x: e.clientX, y: e.clientY }
            : null;
        this._ghostClickGuardTimeout = window.setTimeout(() => {
            this._clearGhostClickGuard();
        }, GHOST_CLICK_GUARD_MS);
    }

    _consumeStopPointerDown(e) {
        e.preventDefault();
        // The timer listens on nested interaction regions (for example, the
        // timer display inside the center panel). Consume the stop press so the
        // same touch can't bubble into a second start action after we enter the
        // stopped state.
        e.stopPropagation();
        this._releaseActivePointer(this._activePointerId);
        this._armGhostClickGuard(e);
        this._stopTimer(null, this._getEventTimestamp(e));
    }

    _clearGhostClickGuard() {
        this._ghostClickGuardExpiresAt = 0;
        this._ghostClickGuardOrigin = null;
        if (this._ghostClickGuardTimeout !== null) {
            clearTimeout(this._ghostClickGuardTimeout);
            this._ghostClickGuardTimeout = null;
        }
    }

    _claimActivePointer(e) {
        this._activePointerId = e.pointerId;

        if (this._displayEl?.setPointerCapture) {
            try {
                this._displayEl.setPointerCapture(e.pointerId);
            } catch {
                // Ignore pointer capture failures on browsers that reject it for synthetic events.
            }
        }
    }

    _releaseActivePointer(pointerId) {
        if (!this._displayEl || pointerId == null) {
            this._activePointerId = null;
            return;
        }

        if (this._displayEl.releasePointerCapture) {
            try {
                this._displayEl.releasePointerCapture(pointerId);
            } catch {
                // Ignore capture release failures when the browser already released the pointer.
            }
        }
        this._activePointerId = null;
    }

    _isTouchPointer(e) {
        return e.pointerType === 'touch' || e.pointerType === 'pen';
    }

    _isPrimaryPointerDown(e) {
        if (e.isPrimary === false) return false;
        if (typeof e.button === 'number' && e.button !== 0) return false;
        return true;
    }

    _backgroundSpacebarEnabled() {
        return settings.get('backgroundSpacebarEnabled') === true
            && !this._isDesktopTypingEntryMode();
    }

    _isBackgroundPointerTarget(target) {
        const targetEl = target instanceof Element
            ? target
            : target instanceof Node && target.parentElement instanceof Element
                ? target.parentElement
                : null;
        if (!targetEl) return false;
        if (this._isInteractivePointerTarget(targetEl)) return false;
        if (targetEl.closest(BACKGROUND_POINTER_EXCLUDE_SELECTOR)) return false;
        return targetEl === document.documentElement || document.body.contains(targetEl);
    }

    _isInspectionCancelTarget(target) {
        if (target instanceof Element) {
            return Boolean(target.closest('#inspection-cancel-wrap, #inspection-cancel-btn'));
        }

        return target instanceof Node && target.parentElement instanceof Element
            ? Boolean(target.parentElement.closest('#inspection-cancel-wrap, #inspection-cancel-btn'))
            : false;
    }

    _resetKeyboardStartState({ cancelPendingStart = false } = {}) {
        const hadKeyboardStartInput = this._spaceDown || this._hasAnyStackmatKeyDown();

        this._spaceDown = false;
        this._leftDown = false;
        this._rightDown = false;
        this._leftAltDown = false;
        this._rightAltDown = false;

        if (!cancelPendingStart || !hadKeyboardStartInput) return;
        this.cancelPendingStart();
    }

    _hasAnyStackmatKeyDown() {
        return this._leftDown || this._rightDown || this._leftAltDown || this._rightAltDown;
    }

    _isStackmatKey(e) {
        return e.code === 'ControlLeft'
            || e.code === 'ControlRight'
            || e.code === 'MetaLeft'
            || e.code === 'MetaRight'
            || e.code === 'AltLeft'
            || e.code === 'AltRight';
    }

    _isStackmatActive() {
        const isBothCtrlCmd = this._leftDown && this._rightDown;
        const isBothAltOpt = this._leftAltDown && this._rightAltDown;
        return isBothCtrlCmd || isBothAltOpt;
    }

    _setStackmatFlag(code, isDown) {
        if (code === 'ControlLeft' || code === 'MetaLeft') this._leftDown = isDown;
        if (code === 'ControlRight' || code === 'MetaRight') this._rightDown = isDown;
        if (code === 'AltLeft') this._leftAltDown = isDown;
        if (code === 'AltRight') this._rightAltDown = isDown;
    }

    _setState(state) {
        this.state = state;
        this.emit('stateChange', state);
    }

    _setColor(state) {
        if (!this._displayEl) return;
        this._displayEl.dataset.timerState = state;
    }

    refreshDisplayRules() {
        this._cachedViewport.width = window.innerWidth || document.documentElement.clientWidth;
        this._cachedViewport.height = window.innerHeight || document.documentElement.clientHeight;
        if (this._lastFullText) {
            this._updateDisplay(this._lastFullText);
        }
    }

    _updateDisplay(text) {
        this._lastFullText = text;
        if (!this._displayEl) return;

        let displayStr = text;
        const width = this._cachedViewport.width;
        const height = this._cachedViewport.height;
        const isDesktop = width > 1100;
        const isZen = document.body.classList.contains('zen');
        const isMobilePortrait = width <= 1100 && height > width;

        if (!isZen || isMobilePortrait) {
            if (!text.includes('DNF') && !text.includes('Inspect')) {
                let maxChars = null;

                if (isDesktop) {
                    const minViewportHeight = 50;
                    const maxViewportHeight = 850;
                    const clampedRatio = Math.min(1, Math.max(0, (height - minViewportHeight) / (maxViewportHeight - minViewportHeight)));
                    const scale = 0.25 + (0.75 * clampedRatio);
                    const effectiveWidth = width + (1000 * (1 - scale));

                    if (text.length > 5) {
                        maxChars = effectiveWidth < 1200 ? 5 : 6 + Math.floor((effectiveWidth - 1200) / 70);
                    }
                } else if (isMobilePortrait) {
                    maxChars = width < 360 ? 7 : 8;
                }

                if (maxChars !== null) {
                    displayStr = truncateTimeDisplay(text, maxChars);
                }
            }
        }

        if (this._displayEl.textContent !== displayStr) {
            this._displayEl.textContent = displayStr;
        }
    }

    setDisplay(text) {
        this._updateDisplay(text);
    }

    cancelPendingStart() {
        this._cancelHold();
        this._releaseActivePointer(this._activePointerId);

        if (this.state === State.HOLDING || this.state === State.READY) {
            this._setState(State.IDLE);
            this._setColor(State.IDLE);
            return;
        }

        if (this.state === State.INSPECTION_PRIMED) {
            this._cancelInspection();
            return;
        }

        if (this.state === State.INSPECTION_HOLDING || this.state === State.INSPECTION_READY) {
            this._setState(State.INSPECTING);
            this._setColor(State.INSPECTING);
        }
    }

    cancelInspection() {
        if (this._isInspectionPreSolveState(this.state)) {
            this._cancelInspection();
        }
    }

    resetDisplay() {
        this._updateDisplay('0.00');
        this._setColor(State.IDLE);
        this._setState(State.IDLE);
    }

    stop(penalty = null) {
        if (this.state === State.RUNNING) {
            this._stopTimer(penalty);
        }
    }

    getState() {
        return this.state;
    }
}

export const timer = new Timer();
