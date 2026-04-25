import { formatReadableDate, formatTime, getEffectiveTime } from './utils.js?v=2026042504'

const BIN_WIDTH_OPTIONS = Object.freeze([
    { label: '1:00', ms: 60000 },
    { label: '30s', ms: 30000 },
    { label: '10s', ms: 10000 },
    { label: '5s', ms: 5000 },
    { label: '2s', ms: 2000 },
    { label: '1s', ms: 1000 },
    { label: '0.5s', ms: 500 },
    { label: '0.2s', ms: 200 },
    { label: '0.1s', ms: 100 },
])

const PREFS_KEY = 'ukratimer_distribution_prefs_v2'
const EXPORT_SIZE = Object.freeze({ width: 1600, height: 900 })
const touchPrimaryQuery = window.matchMedia('(hover: none) and (pointer: coarse)')

let _overlay = null
let _copyImageButton = null
let _copyTextButton = null
let _closeButton = null
let _modalBox = null
let _canvasShell = null
let _canvas = null
let _tooltip = null
let _tooltipRange = null
let _tooltipCount = null
let _tooltipShare = null
let _emptyState = null
let _header = null
let _toolbar = null
let _sessionEl = null
let _copyActions = null
let _rangeMinInput = null
let _rangeMaxInput = null
let _rangeResetButton = null
let _binWidthSelect = null
let _binCoarserButton = null
let _binFinerButton = null
let _legendToggleButton = null
let _escapeHandlerBound = false
let _resizeObserver = null

let _state = null
let _hoveredBinIndex = -1
let _touchFocusedBinIndex = -1
let _activeTouchPointerId = null
let _binHitAreas = []
let _plotBounds = null
let _prefs = {
    binWidthIndex: null,
    customMin: null,
    customMax: null,
    legendVisible: true,
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value))
}

function isTouchLikePointer(pointerType) {
    return pointerType === 'touch' || pointerType === 'pen'
}

function shouldUseTouchInteraction(pointerType = null) {
    if (pointerType === 'mouse') return false
    if (isTouchLikePointer(pointerType)) return true
    return touchPrimaryQuery.matches
}

function loadPreferences() {
    try {
        const raw = localStorage.getItem(PREFS_KEY)
        if (!raw) return
        const parsed = JSON.parse(raw)
        _prefs = {
            binWidthIndex: Number.isInteger(parsed?.binWidthIndex) ? clamp(parsed.binWidthIndex, 0, BIN_WIDTH_OPTIONS.length - 1) : null,
            customMin: Number.isFinite(parsed?.customMin) ? Math.max(0, parsed.customMin) : null,
            customMax: Number.isFinite(parsed?.customMax) ? Math.max(0, parsed.customMax) : null,
            legendVisible: parsed?.legendVisible !== false,
        }
    } catch {
        _prefs = {
            binWidthIndex: null,
            customMin: null,
            customMax: null,
            legendVisible: true,
        }
    }
}

function savePreferences() {
    const nextPrefs = {
        binWidthIndex: _state ? _state.binWidthIndex : _prefs.binWidthIndex,
        customMin: _state ? _state.customMin : _prefs.customMin,
        customMax: _state ? _state.customMax : _prefs.customMax,
        legendVisible: _state ? _state.legendVisible : _prefs.legendVisible,
    }
    _prefs = nextPrefs

    try {
        localStorage.setItem(PREFS_KEY, JSON.stringify(nextPrefs))
    } catch {
    }
}

function getThemeColors() {
    const styles = getComputedStyle(document.documentElement)
    const readVar = (name, fallback) => styles.getPropertyValue(name).trim() || fallback

    return {
        grid: readVar('--graph-grid', '#21262d'),
        axis: readVar('--surface-border', '#30363d'),
        text: readVar('--text-secondary', '#8b949e'),
        textMuted: readVar('--text-tertiary', '#6e7681'),
        surfaceStrong: readVar('--bg-primary', '#0d1117'),
        legendBg: readVar('--distribution-legend-bg', 'rgba(13, 17, 23, 0.92)'),
        legendBorder: readVar('--distribution-legend-border', 'rgba(255, 255, 255, 0.12)'),
        leftBar: readVar('--stat-best', '#41b36d'),
        rightBar: readVar('--stat-ao5', '#f0a11c'),
        median: readVar('--distribution-median', '#ef4444'),
        selectedStroke: readVar('--distribution-selected-stroke', '#ffd580'),
    }
}

function hexToRgb(hex) {
    const normalized = hex.replace('#', '')
    const value = normalized.length === 3
        ? normalized.split('').map((char) => char + char).join('')
        : normalized

    return {
        r: Number.parseInt(value.slice(0, 2), 16),
        g: Number.parseInt(value.slice(2, 4), 16),
        b: Number.parseInt(value.slice(4, 6), 16),
    }
}

function interpolateColor(startHex, endHex, ratio) {
    const start = hexToRgb(startHex)
    const end = hexToRgb(endHex)
    const t = clamp(ratio, 0, 1)
    const channel = (a, b) => Math.round(a + ((b - a) * t))
    return `rgb(${channel(start.r, end.r)}, ${channel(start.g, end.g)}, ${channel(start.b, end.b)})`
}

function getMedian(sortedTimes) {
    if (!sortedTimes.length) return null
    const mid = Math.floor(sortedTimes.length / 2)
    if (sortedTimes.length % 2 === 1) return sortedTimes[mid]
    return (sortedTimes[mid - 1] + sortedTimes[mid]) / 2
}

function getDisplayDigits(step) {
    if (step < 1000) return 2
    if (step < 10000) return 1
    return 0
}

function getAxisLabelDigits(step) {
    return step < 1000 ? 1 : 0
}

function trimFormattedTime(text) {
    return String(text)
        .replace(/(\.\d*?[1-9])0+$/, '$1')
        .replace(/\.0+$/, '')
}

function isWholeSecond(ms) {
    return Math.round(ms) % 1000 === 0
}

function formatRangeLabel(start, end, digits) {
    if (start === end) return trimFormattedTime(formatTime(start, digits))
    return `${trimFormattedTime(formatTime(start, digits))} - ${trimFormattedTime(formatTime(end, digits))}`
}

function formatDurationHms(ms, fractionDigits = 2, trimTrailingZeros = true) {
    const totalSeconds = ms / 1000
    const hours = Math.floor(totalSeconds / 3600)
    const minutes = Math.floor((totalSeconds % 3600) / 60)
    const rawSeconds = (totalSeconds % 60).toFixed(fractionDigits)
    const seconds = trimTrailingZeros ? rawSeconds.replace(/\.?0+$/, '') : rawSeconds
    const parts = []
    if (hours > 0) parts.push(`${hours}h`)
    if (minutes > 0 || hours > 0) parts.push(`${minutes}m`)
    parts.push(`${seconds}s`)
    return parts.join(' ')
}

function formatDataRange(min, max) {
    return `${formatDurationHms(min)} - ${formatDurationHms(max)}`
}

function formatTimeSpan(ms) {
    const option = BIN_WIDTH_OPTIONS.find((entry) => entry.ms === ms)
    if (option) return option.label
    return formatTime(ms, getDisplayDigits(ms))
}

function formatRangeInputValue(ms) {
    return trimFormattedTime(formatTime(ms, 1))
}

function formatAxisTick(ms, step) {
    const roundedMs = Math.round(ms)
    const needsDecimal = roundedMs % 1000 !== 0
    const digits = needsDecimal ? 1 : getAxisLabelDigits(step)
    return trimFormattedTime(formatTime(roundedMs, digits))
}

function formatTimeRange(timestamps) {
    if (!Array.isArray(timestamps) || timestamps.length === 0) return '—'

    const sorted = [...timestamps].filter(Number.isFinite).sort((a, b) => a - b)
    if (!sorted.length) return '—'

    const start = new Date(sorted[0])
    const end = new Date(sorted[sorted.length - 1])
    const sameDay = start.getFullYear() === end.getFullYear()
        && start.getMonth() === end.getMonth()
        && start.getDate() === end.getDate()

    const sameYear = start.getFullYear() === end.getFullYear()
    const dateFmt = new Intl.DateTimeFormat('en-US', sameYear
        ? { month: 'short', day: 'numeric' }
        : { month: 'short', day: 'numeric', year: 'numeric' })
    const timeFmt = new Intl.DateTimeFormat('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
    })

    if (sameDay) {
        return `${timeFmt.format(start)} - ${timeFmt.format(end)}`
    }

    return `${dateFmt.format(start)} - ${dateFmt.format(end)}`
}

function usesBinRangeDecimals(bins) {
    return bins.some((bin) => !isWholeSecond(bin.start) || !isWholeSecond(bin.end))
}

function formatSummaryRangeLabel(start, end, digits) {
    if (start === end) return formatTime(start, digits)
    return `${formatTime(start, digits)} - ${formatTime(end, digits)}`
}

function formatSummaryDuration(ms, digits) {
    return formatDurationHms(ms, digits, digits === 0)
}

function formatCountPercentage(count, total) {
    if (!Number.isFinite(total) || total <= 0) return '0%'
    const percentage = (count / total) * 100
    if (Math.abs(percentage - Math.round(percentage)) < 0.05) {
        return `${Math.round(percentage)}%`
    }
    return `${percentage.toFixed(1)}%`
}

function sanitizeRangeInputText(value) {
    const text = String(value ?? '')
    const filtered = text.replace(/[^\d:.,]/g, '').replace(',', '.')
    if (!filtered) return ''

    if (filtered.includes(':')) {
        const [rawMinutes, ...rest] = filtered.split(':')
        const rawSeconds = rest.join('')
        const minutes = rawMinutes.replace(/\D/g, '')
        const [secWholeRaw = '', secFracRaw = ''] = rawSeconds.split('.')
        const secWhole = secWholeRaw.replace(/\D/g, '').slice(0, 2)
        const secFrac = secFracRaw.replace(/\D/g, '').slice(0, 1)
        return `${minutes}:${secWhole}${rawSeconds.includes('.') ? `.${secFrac}` : ''}`
    }

    const [wholeRaw = '', fracRaw = ''] = filtered.split('.')
    const whole = wholeRaw.replace(/\D/g, '')
    const frac = fracRaw.replace(/\D/g, '').slice(0, 1)
    return `${whole}${filtered.includes('.') ? `.${frac}` : ''}`
}

function parseRangeInput(value) {
    const text = String(value ?? '').trim().replace(',', '.')
    if (!text) return null

    if (text.includes(':')) {
        const parts = text.split(':')
        if (parts.length !== 2) return NaN
        const minutes = Number.parseInt(parts[0], 10)
        const seconds = Number.parseFloat(parts[1])
        if (!Number.isFinite(minutes) || !Number.isFinite(seconds) || minutes < 0 || seconds < 0) return NaN
        return Math.round(((minutes * 60) + seconds) * 1000)
    }

    const seconds = Number.parseFloat(text)
    if (!Number.isFinite(seconds) || seconds < 0) return NaN
    return Math.round(seconds * 1000)
}

function getDefaultBinWidthIndex(validTimes) {
    if (validTimes.length < 2) return 5

    const sorted = [...validTimes].sort((a, b) => a - b)
    const target = Math.max((sorted[sorted.length - 1] - sorted[0]) / 14, 100)
    let bestIndex = BIN_WIDTH_OPTIONS.length - 1
    let bestDistance = Infinity

    BIN_WIDTH_OPTIONS.forEach((option, index) => {
        const distance = Math.abs(option.ms - target)
        if (distance < bestDistance) {
            bestDistance = distance
            bestIndex = index
        }
    })

    return bestIndex
}

function getAutoRange(validTimes, binWidthMs) {
    if (!validTimes.length) {
        return { min: 0, max: binWidthMs }
    }

    const sorted = [...validTimes].sort((a, b) => a - b)
    const min = Math.max(0, Math.floor(sorted[0] / binWidthMs) * binWidthMs)
    const max = Math.max(min + binWidthMs, Math.ceil(sorted[sorted.length - 1] / binWidthMs) * binWidthMs)
    return { min, max }
}

function buildDistribution(times, binWidthMs, customMin, customMax) {
    const sortedTimes = [...times].sort((a, b) => a - b)
    const autoRange = getAutoRange(sortedTimes, binWidthMs)

    if (!sortedTimes.length) {
        return {
            validTimes: [],
            visibleTimes: [],
            median: null,
            bins: [],
            binWidth: binWidthMs,
            min: null,
            max: null,
            autoMin: autoRange.min,
            autoMax: autoRange.max,
            domainMin: autoRange.min,
            domainMax: autoRange.max,
            filterMax: autoRange.max,
            maxCount: 0,
            visibleCount: 0,
        }
    }

    const min = sortedTimes[0]
    const max = sortedTimes[sortedTimes.length - 1]
    const median = getMedian(sortedTimes)

    let domainMin = Number.isFinite(customMin) ? Math.max(0, customMin) : autoRange.min
    let filterMax = Number.isFinite(customMax) ? Math.max(0, customMax) : autoRange.max

    if (filterMax <= domainMin) {
        domainMin = autoRange.min
        filterMax = autoRange.max
    }
    if ((filterMax - domainMin) < binWidthMs) {
        filterMax = domainMin + binWidthMs
    }

    const binCount = Math.max(1, Math.ceil((filterMax - domainMin) / binWidthMs))
    const domainMax = domainMin + (binCount * binWidthMs)
    const bins = Array.from({ length: binCount }, (_, index) => ({
        start: domainMin + (index * binWidthMs),
        end: domainMin + ((index + 1) * binWidthMs),
        count: 0,
    }))

    const visibleTimes = []

    sortedTimes.forEach((time) => {
        if (time < domainMin || time > filterMax) return
        const rawIndex = time === filterMax
            ? binCount - 1
            : Math.floor((time - domainMin) / binWidthMs)
        const index = clamp(rawIndex, 0, binCount - 1)
        bins[index].count += 1
        visibleTimes.push(time)
    })

    return {
        validTimes: sortedTimes,
        visibleTimes,
        median,
        bins,
        binWidth: binWidthMs,
        min,
        max,
        autoMin: autoRange.min,
        autoMax: autoRange.max,
        domainMin,
        domainMax,
        filterMax,
        maxCount: Math.max(...bins.map((bin) => bin.count), 0),
        visibleCount: visibleTimes.length,
    }
}

function buildDistributionTextSummary() {
    if (!_state) return ''

    const distribution = _state.distribution
    if (!distribution.validTimes.length) {
        return [
            `Generated by UkraTimer on ${formatReadableDate(Date.now())}`,
            `Time distribution for ${_state.sessionName} (${formatTimeRange(_state.solveTimestamps)})`,
            '',
            'No valid solves available for a distribution.',
        ].join('\n')
    }

    const activeBins = distribution.bins.filter((bin) => bin.count > 0)
    const binDigits = usesBinRangeDecimals(activeBins) ? 1 : 0
    const peak = Math.max(...distribution.bins.map((bin) => bin.count), 1)
    const bins = activeBins
        .map((bin) => {
            const barLength = Math.max(1, Math.round((bin.count / peak) * 24))
            return `${formatSummaryRangeLabel(bin.start, bin.end, binDigits).padEnd(22)} | ${'█'.repeat(barLength)} ${bin.count}`
        })

    return [
        `Generated by UkraTimer on ${formatReadableDate(Date.now())}`,
        `Time distribution for ${_state.sessionName} (${formatTimeRange(_state.solveTimestamps)})`,
        '',
        `${distribution.visibleCount}/${distribution.validTimes.length} solves shown`,
        `Range: ${formatSummaryDuration(distribution.min, 2)} - ${formatSummaryDuration(distribution.max, 2)}`,
        `Median: ${formatSummaryDuration(distribution.median, 2)}`,
        '',
        ...bins,
    ].join('\n')
}

function setButtonFeedback(button, label, errorClass = null) {
    if (!button) return
    const originalLabel = button.dataset.originalLabel || button.textContent
    if (!button.dataset.originalLabel) button.dataset.originalLabel = originalLabel
    button.textContent = label
    if (errorClass) {
        button.classList.add(errorClass)
    }
    window.clearTimeout(button._feedbackTimeout)
    button._feedbackTimeout = window.setTimeout(() => {
        button.textContent = button.dataset.originalLabel || originalLabel
        if (errorClass) {
            button.classList.remove(errorClass)
        }
    }, 1400)
}

function canvasToBlob(canvas) {
    return new Promise((resolve) => {
        canvas.toBlob(resolve, 'image/png')
    })
}

function hideTooltip() {
    if (!_tooltip) return
    _tooltip.hidden = true
}

function getActiveBinIndex() {
    return _touchFocusedBinIndex >= 0 ? _touchFocusedBinIndex : _hoveredBinIndex
}

function positionTooltip(index, point = null) {
    if (!_tooltip || !_canvasShell || index < 0 || !_binHitAreas[index]) return

    const area = _binHitAreas[index]
    const shellRect = _canvasShell.getBoundingClientRect()
    const localX = point?.x ?? (area.x + (area.width / 2))
    const localY = point?.y ?? area.y

    _tooltip.hidden = false
    const tooltipWidth = _tooltip.offsetWidth || 180
    const tooltipHeight = _tooltip.offsetHeight || 72
    const left = clamp(localX, 10 + (tooltipWidth / 2), shellRect.width - 10 - (tooltipWidth / 2))
    const top = clamp(localY, tooltipHeight + 16, shellRect.height - 10)

    _tooltip.style.left = `${left}px`
    _tooltip.style.top = `${top}px`
}

function showTooltipForBin(index, point = null) {
    if (!_tooltip || !_tooltipRange || !_tooltipCount || !_tooltipShare || !_state || index < 0) {
        hideTooltip()
        return
    }

    const distribution = _state.distribution
    const bin = distribution.bins[index]
    if (!bin) {
        hideTooltip()
        return
    }

    const digits = getDisplayDigits(distribution.binWidth)
    const share = distribution.visibleCount > 0 ? (bin.count / distribution.visibleCount) * 100 : 0

    _tooltipRange.textContent = formatRangeLabel(bin.start, bin.end, digits)
    _tooltipCount.textContent = `${bin.count} solve${bin.count === 1 ? '' : 's'}, ${share.toFixed(1)}% in this bin`
    _tooltipShare.textContent = ''
    _tooltipShare.hidden = true
    positionTooltip(index, point)
}

function updateTooltipVisibility() {
    const activeIndex = getActiveBinIndex()
    if (activeIndex < 0) {
        hideTooltip()
        return
    }
    showTooltipForBin(activeIndex)
}

function clearTouchFocus() {
    _touchFocusedBinIndex = -1
    _activeTouchPointerId = null
    updateTooltipVisibility()
}

function getCanvasPointerPosition(event) {
    const rect = _canvas.getBoundingClientRect()
    return {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
    }
}

function getBinIndexAtPoint(x, y) {
    if (!_plotBounds) return -1
    if (x < _plotBounds.left || x > _plotBounds.right || y < _plotBounds.top || y > _plotBounds.bottom) return -1

    return _binHitAreas.findIndex((area) => (
        x >= area.x &&
        x <= area.x + area.width &&
        y >= area.hitTop &&
        y <= area.hitBottom
    ))
}

function getCanvasSize() {
    if (!_canvasShell) return { width: 640, height: 360 }
    return {
        width: Math.max(320, Math.floor(_canvasShell.clientWidth)),
        height: Math.max(240, Math.floor(_canvasShell.clientHeight)),
    }
}

function drawRoundedRect(ctx, x, y, width, height, radius) {
    const rr = Math.min(radius, width / 2, height / 2)
    ctx.beginPath()
    ctx.moveTo(x + rr, y)
    ctx.arcTo(x + width, y, x + width, y + height, rr)
    ctx.arcTo(x + width, y + height, x, y + height, rr)
    ctx.arcTo(x, y + height, x, y, rr)
    ctx.arcTo(x, y, x + width, y, rr)
    ctx.closePath()
}

function niceIntegerStep(maxValue, maxTicks = 4) {
    if (maxValue <= 1) return 1
    const rough = maxValue / maxTicks
    const magnitude = 10 ** Math.floor(Math.log10(rough))
    const normalized = rough / magnitude
    if (normalized <= 1) return magnitude
    if (normalized <= 2) return 2 * magnitude
    if (normalized <= 5) return 5 * magnitude
    return 10 * magnitude
}

function getXAxisStep(domainRange, plotWidth) {
    const steps = [100, 200, 500, 1000, 2000, 5000, 10000, 15000, 30000, 60000, 120000, 300000]
    const maxTickCount = clamp(Math.floor(plotWidth / 38), 4, 24)
    const maxIntervals = Math.max(1, maxTickCount - 1)
    for (const step of steps) {
        if ((domainRange / step) <= maxIntervals) return step
    }
    return steps[steps.length - 1]
}

function drawLegend(ctx, plotLeft, plotTop, plotWidth, distribution, colors, interactive, medianX = null) {
    const line1 = `Range: ${formatDataRange(distribution.min, distribution.max)}`
    const line2 = `${distribution.visibleCount}/${distribution.validTimes.length} solves on graph`
    const line3 = `Time range: ${formatTimeRange(_state.solveTimestamps)}`
    const metrics = interactive
        ? { paddingX: 12, paddingY: 10, titleSize: 12, bodySize: 12, line2Y: 22, line3Y: 40, minWidth: 220, height: 72, radius: 12 }
        : { paddingX: 12, paddingY: 10, titleSize: 15, bodySize: 14, line2Y: 26, line3Y: 50, minWidth: 220, height: 86, radius: 12 }
    const titleFont = `600 ${metrics.titleSize}px Inter, system-ui, sans-serif`
    const bodyFont = `${metrics.bodySize}px Inter, system-ui, sans-serif`

    ctx.font = titleFont
    const line1Width = ctx.measureText(line1).width
    const line2Width = ctx.measureText(line2).width
    ctx.font = bodyFont
    const line3Width = ctx.measureText(line3).width
    const naturalWidth = Math.max(metrics.minWidth, Math.ceil(Math.max(line1Width, line2Width, line3Width) + (metrics.paddingX * 2)))
    const maxWidth = Math.max(140, Math.floor(plotWidth * 0.4))
    const scale = naturalWidth > maxWidth ? (maxWidth / naturalWidth) : 1
    const boxWidth = naturalWidth * scale
    const boxHeight = metrics.height * scale

    const sliceLength = Math.max(1, Math.floor(distribution.bins.length / 3))
    const leftPeak = Math.max(...distribution.bins.slice(0, sliceLength).map((bin) => bin.count), 0)
    const rightPeak = Math.max(...distribution.bins.slice(-sliceLength).map((bin) => bin.count), 0)
    const x = !interactive
        ? plotLeft + plotWidth - boxWidth - 10
        : leftPeak <= rightPeak
            ? plotLeft + 10
            : plotLeft + plotWidth - boxWidth - 10
    let y = plotTop + 10

    if (medianX != null) {
        const medianLabel = `Median ${formatTime(distribution.median)}`
        const medianFont = interactive ? '600 12px Inter, system-ui, sans-serif' : '600 17px Inter, system-ui, sans-serif'
        const labelOnRight = medianX > plotLeft + (plotWidth * 0.62)
        ctx.save()
        ctx.font = medianFont
        const labelWidth = ctx.measureText(medianLabel).width
        ctx.restore()

        const labelHeight = interactive ? 14 : 19
        const labelTop = plotTop + (interactive ? 8 : 10)
        const labelBottom = labelTop + labelHeight
        const labelLeft = labelOnRight ? medianX - 8 - labelWidth : medianX + 8
        const labelRight = labelOnRight ? medianX - 8 : medianX + 8 + labelWidth
        const overlapsMedianLabel = x < labelRight + 8
            && (x + boxWidth) > labelLeft - 8
            && y < labelBottom + 8

        if (overlapsMedianLabel) {
            y = labelBottom + (interactive ? 14 : 18)
        }
    }

    ctx.save()
    ctx.translate(x, y)
    ctx.scale(scale, scale)

    ctx.fillStyle = colors.legendBg
    ctx.strokeStyle = colors.legendBorder
    ctx.lineWidth = 1
    drawRoundedRect(ctx, 0, 0, naturalWidth, metrics.height, metrics.radius)
    ctx.fill()
    ctx.stroke()

    ctx.fillStyle = colors.text
    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'
    ctx.font = titleFont
    ctx.fillText(line1, metrics.paddingX, metrics.paddingY)
    ctx.fillStyle = colors.textMuted
    ctx.font = bodyFont
    ctx.fillText(line2, metrics.paddingX, metrics.paddingY + metrics.line2Y)
    ctx.fillText(line3, metrics.paddingX, metrics.paddingY + metrics.line3Y)
    ctx.restore()
}

function renderChart(targetCanvas, width, height, { interactive = false, activeIndex = -1 } = {}) {
    const ctx = targetCanvas.getContext('2d')
    if (!ctx || !_state) return

    const dpr = interactive ? (window.devicePixelRatio || 1) : 1
    targetCanvas.width = Math.max(1, Math.floor(width * dpr))
    targetCanvas.height = Math.max(1, Math.floor(height * dpr))
    if (interactive) {
        targetCanvas.style.width = `${width}px`
        targetCanvas.style.height = `${height}px`
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, width, height)

    if (interactive) {
        _binHitAreas = []
        _plotBounds = null
    }

    const distribution = _state.distribution
    if (!distribution.validTimes.length) return

    const colors = getThemeColors()
    const tickFont = interactive ? '12px Inter, system-ui, sans-serif' : '14px Inter, system-ui, sans-serif'
    const padding = {
        top: 22,
        right: interactive ? 58 : 66,
        bottom: 44,
        left: 52,
    }
    const plotWidth = Math.max(40, width - padding.left - padding.right)
    const plotHeight = Math.max(40, height - padding.top - padding.bottom)
    const plotLeft = padding.left
    const plotTop = padding.top
    const plotBottom = plotTop + plotHeight
    const plotRight = plotLeft + plotWidth

    if (interactive) {
        _plotBounds = {
            left: plotLeft,
            right: plotRight,
            top: plotTop,
            bottom: plotBottom,
        }
    }

    ctx.fillStyle = colors.surfaceStrong
    drawRoundedRect(ctx, plotLeft, plotTop, plotWidth, plotHeight, 16)
    ctx.fill()

    const maxCount = Math.max(1, distribution.maxCount)
    const visibleCount = Math.max(0, distribution.visibleCount)
    const yStep = niceIntegerStep(maxCount, 7)
    ctx.font = tickFont
    ctx.textBaseline = 'middle'
    ctx.strokeStyle = colors.grid
    ctx.fillStyle = colors.textMuted
    ctx.lineWidth = 1

    for (let value = 0; value <= maxCount; value += yStep) {
        const y = plotBottom - ((value / maxCount) * plotHeight)
        ctx.beginPath()
        ctx.moveTo(plotLeft, y)
        ctx.lineTo(plotRight, y)
        ctx.stroke()
        ctx.textAlign = 'right'
        ctx.fillText(String(value), plotLeft - 8, y)
        ctx.textAlign = 'left'
        ctx.fillText(formatCountPercentage(value, visibleCount), plotRight + 8, y)
    }

    const stepWidth = plotWidth / Math.max(distribution.bins.length, 1)
    const barGap = stepWidth >= 6 ? 1 : 0
    const barWidth = Math.max(1, stepWidth - barGap)

    distribution.bins.forEach((bin, index) => {
        const x = plotLeft + (index * stepWidth)
        const barHeight = bin.count <= 0 ? 0 : Math.max(2, (bin.count / maxCount) * plotHeight)
        const y = plotBottom - barHeight
        const ratio = distribution.bins.length <= 1 ? 0 : index / (distribution.bins.length - 1)
        const fillColor = interpolateColor(colors.leftBar, colors.rightBar, ratio)

        if (interactive) {
            _binHitAreas.push({
                index,
                x,
                y,
                width: Math.max(stepWidth, barWidth),
                height: barHeight,
                hitTop: plotTop,
                hitBottom: plotBottom,
            })
        }

        if (barHeight > 0) {
            ctx.fillStyle = fillColor
            if (barWidth < 3 || barHeight < 3) {
                ctx.fillRect(x, y, barWidth, barHeight)
            } else {
                drawRoundedRect(ctx, x, y, barWidth, barHeight, Math.min(6, barWidth / 2))
                ctx.fill()
            }
        }
    })

    const domainRange = Math.max(1, distribution.domainMax - distribution.domainMin)
    const medianInsideRange = distribution.median >= distribution.domainMin && distribution.median <= distribution.domainMax
    const medianX = medianInsideRange
        ? plotLeft + (((distribution.median - distribution.domainMin) / domainRange) * plotWidth)
        : null

    const xStep = getXAxisStep(domainRange, plotWidth)
    ctx.font = tickFont
    ctx.textBaseline = 'top'
    ctx.fillStyle = colors.text
    ctx.strokeStyle = colors.axis

    for (let value = distribution.domainMin; value <= distribution.domainMax + 1; value += xStep) {
        const ratio = (value - distribution.domainMin) / domainRange
        const x = plotLeft + (ratio * plotWidth)
        ctx.beginPath()
        ctx.moveTo(x, plotBottom)
        ctx.lineTo(x, plotBottom + 5)
        ctx.stroke()

        if (x <= plotLeft + 16) ctx.textAlign = 'left'
        else if (x >= plotRight - 16) ctx.textAlign = 'right'
        else ctx.textAlign = 'center'

        ctx.fillText(formatAxisTick(value, xStep), x, plotBottom + 8)
    }

    ctx.beginPath()
    ctx.moveTo(plotLeft, plotBottom)
    ctx.lineTo(plotRight, plotBottom)
    ctx.strokeStyle = colors.axis
    ctx.stroke()

    if (activeIndex >= 0 && distribution.bins[activeIndex]) {
        const activeBin = distribution.bins[activeIndex]
        const ratio = distribution.bins.length <= 1 ? 0 : activeIndex / (distribution.bins.length - 1)
        const fillColor = interpolateColor(colors.leftBar, colors.rightBar, ratio)
        const outlineX = plotLeft + (activeIndex * stepWidth)
        const outlineHeight = activeBin.count <= 0
            ? 2
            : Math.max(2, (activeBin.count / maxCount) * plotHeight)
        const outlineY = plotBottom - outlineHeight

        ctx.save()
        ctx.fillStyle = fillColor
        if (barWidth < 3 || outlineHeight < 3) {
            ctx.fillRect(outlineX, outlineY, barWidth, outlineHeight)
        } else {
            drawRoundedRect(ctx, outlineX, outlineY, barWidth, outlineHeight, Math.min(6, barWidth / 2))
            ctx.fill()
        }

        ctx.strokeStyle = colors.selectedStroke
        ctx.lineWidth = 2
        if (barWidth < 3 || outlineHeight < 3) {
            ctx.strokeRect(outlineX, outlineY, barWidth, outlineHeight)
        } else {
            drawRoundedRect(
                ctx,
                outlineX + 1,
                outlineY + 1,
                Math.max(1, barWidth - 2),
                Math.max(1, outlineHeight - 2),
                Math.min(6, Math.max(1, (barWidth - 2) / 2)),
            )
            ctx.stroke()
        }
        ctx.restore()
    }

    if (_state.legendVisible) {
        drawLegend(ctx, plotLeft, plotTop, plotWidth, distribution, colors, interactive, medianX)
    }

    if (medianInsideRange) {
        ctx.save()
        ctx.setLineDash([6, 5])
        ctx.strokeStyle = colors.median
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.moveTo(medianX, plotTop)
        ctx.lineTo(medianX, plotBottom)
        ctx.stroke()
        ctx.restore()

        ctx.font = interactive ? '600 12px Inter, system-ui, sans-serif' : '600 17px Inter, system-ui, sans-serif'
        ctx.textAlign = medianX > plotLeft + (plotWidth * 0.62) ? 'right' : 'left'
        ctx.textBaseline = 'top'
        ctx.fillStyle = colors.median
        ctx.fillText(
            `Median ${formatTime(distribution.median)}`,
            medianX > plotLeft + (plotWidth * 0.62) ? medianX - 8 : medianX + 8,
            plotTop + (interactive ? 8 : 10),
        )
    }

    if (interactive) {
        _canvas.setAttribute(
            'aria-label',
            `Distribution of ${distribution.visibleCount} visible solves. Median ${formatTime(distribution.median)}.`
        )
        updateTooltipVisibility()
    }
}

function drawChart() {
    if (!_canvas || !_state) return
    const { width, height } = getCanvasSize()
    renderChart(_canvas, width, height, { interactive: true, activeIndex: getActiveBinIndex() })
}

function renderRangeInputs() {
    if (!_state || !_rangeMinInput || !_rangeMaxInput) return
    const distribution = _state.distribution
    _rangeMinInput.value = formatRangeInputValue(Number.isFinite(_state.customMin) ? _state.customMin : distribution.autoMin)
    _rangeMaxInput.value = formatRangeInputValue(Number.isFinite(_state.customMax) ? _state.customMax : distribution.autoMax)
}

function syncControls() {
    if (!_state || !_binWidthSelect || !_binCoarserButton || !_binFinerButton || !_legendToggleButton) return
    _binWidthSelect.value = String(_state.binWidthIndex)
    _binCoarserButton.disabled = _state.binWidthIndex >= BIN_WIDTH_OPTIONS.length - 1
    _binFinerButton.disabled = _state.binWidthIndex <= 0
    _legendToggleButton.setAttribute('aria-pressed', String(_state.legendVisible))
    renderRangeInputs()
}

function renderDistribution() {
    if (!_state || !_emptyState || !_canvasShell || !_sessionEl || !_copyActions || !_header || !_toolbar || !_modalBox) return

    _sessionEl.textContent = _state.sessionName

    const hasData = _state.distribution.validTimes.length > 0
    _modalBox.classList.toggle('distribution-empty-only', !hasData)
    _header.hidden = !hasData
    _toolbar.hidden = !hasData
    _emptyState.hidden = hasData
    _canvasShell.hidden = !hasData
    _copyActions.hidden = !hasData

    if (!hasData) {
        _binHitAreas = []
        _plotBounds = null
        hideTooltip()
    }

    syncControls()
    drawChart()
}

function rebuildDistribution() {
    if (!_state) return
    const binWidth = BIN_WIDTH_OPTIONS[_state.binWidthIndex].ms
    _state.distribution = buildDistribution(_state.validTimes, binWidth, _state.customMin, _state.customMax)

    const activeIndex = getActiveBinIndex()
    if (activeIndex >= _state.distribution.bins.length) {
        _hoveredBinIndex = -1
        _touchFocusedBinIndex = -1
    }

    savePreferences()
    renderDistribution()
}

function setBinWidthIndex(nextIndex) {
    if (!_state) return
    const clamped = clamp(nextIndex, 0, BIN_WIDTH_OPTIONS.length - 1)
    if (clamped === _state.binWidthIndex) return
    _state.binWidthIndex = clamped
    rebuildDistribution()
}

function applyRangeInputs() {
    if (!_state || !_rangeMinInput || !_rangeMaxInput) return

    const minRaw = _rangeMinInput.value.trim()
    const maxRaw = _rangeMaxInput.value.trim()
    const parsedMin = parseRangeInput(minRaw)
    const parsedMax = parseRangeInput(maxRaw)

    if ((minRaw && Number.isNaN(parsedMin)) || (maxRaw && Number.isNaN(parsedMax))) {
        renderRangeInputs()
        return
    }

    const nextMin = minRaw ? parsedMin : null
    const nextMax = maxRaw ? parsedMax : null
    if (Number.isFinite(nextMin) && Number.isFinite(nextMax) && nextMax <= nextMin) {
        renderRangeInputs()
        return
    }

    _state.customMin = Number.isFinite(nextMin) ? nextMin : null
    _state.customMax = Number.isFinite(nextMax) ? nextMax : null
    rebuildDistribution()
}

function resetRangeInputs() {
    if (!_state) return
    _state.customMin = null
    _state.customMax = null
    rebuildDistribution()
}

function toggleLegend() {
    if (!_state) return
    _state.legendVisible = !_state.legendVisible
    savePreferences()
    renderDistribution()
}

async function copyChartImage(button = _copyImageButton) {
    try {
        if (!_state?.distribution.validTimes.length) throw new Error('No chart')
        if (typeof window.ClipboardItem === 'undefined' || !navigator.clipboard?.write) throw new Error('Image copy unsupported')

        const exportCanvas = document.createElement('canvas')
        renderChart(exportCanvas, EXPORT_SIZE.width, EXPORT_SIZE.height, {
            interactive: false,
            activeIndex: -1,
        })

        const blob = await canvasToBlob(exportCanvas)
        if (!blob) throw new Error('No image blob')

        await navigator.clipboard.write([
            new ClipboardItem({
                'image/png': blob,
            }),
        ])
        setButtonFeedback(button, 'Copied image')
    } catch {
        // Try to show image in modal for manual copy
        try {
            const exportCanvas = document.createElement('canvas')
            renderChart(exportCanvas, EXPORT_SIZE.width, EXPORT_SIZE.height, {
                interactive: false,
                activeIndex: -1,
            })

            const dataUrl = exportCanvas.toDataURL('image/png')
            const chartImage = document.getElementById('chart-image')
            const chartImageOverlay = document.getElementById('chart-image-overlay')
            const chartImageInstructions = chartImageOverlay?.querySelector('.chart-image-instructions')

            if (chartImage && chartImageOverlay && dataUrl) {
                chartImage.src = dataUrl

                // Update instruction text based on pointer type
                if (chartImageInstructions) {
                    chartImageInstructions.textContent = touchPrimaryQuery.matches
                        ? 'Long press to copy the image'
                        : 'Right-click to copy the image'
                }

                chartImageOverlay.classList.add('active')
                // setButtonFeedback(button, 'Copy failed')
                return
            }
        } catch {
            // If modal fails, fall through to text copy
        }

        // Fallback to text copy
        if (!navigator.clipboard?.writeText) {
            setButtonFeedback(button, 'Copy failed', 'btn-error')
            return
        }

        try {
            await navigator.clipboard.writeText(buildDistributionTextSummary())
            setButtonFeedback(button, 'Copied text')
        } catch {
            setButtonFeedback(button, 'Copy failed', 'btn-error')
        }
    }
}

async function copyDistributionText(button = _copyTextButton) {
    try {
        if (!navigator.clipboard?.writeText) throw new Error('Text copy unsupported')
        await navigator.clipboard.writeText(buildDistributionTextSummary())
        setButtonFeedback(button, 'Copied text')
    } catch {
        setButtonFeedback(button, 'Copy failed', 'btn-error')
    }
}

export function isTimeDistributionModalOpen() {
    return Boolean(_overlay?.classList.contains('active'))
}

export function refreshTimeDistributionTheme() {
    if (!isTimeDistributionModalOpen()) return
    renderDistribution()
}

export function closeTimeDistributionModal({ isPopState = false } = {}) {
    if (!_overlay?.classList.contains('active')) return
    applyRangeInputs()
    if (!isPopState && window.history.state?.isBackIntercepted) {
        window.history.back()
    }
    _overlay.classList.remove('active')
    _hoveredBinIndex = -1
    _touchFocusedBinIndex = -1
    _activeTouchPointerId = null
    hideTooltip()
    if (document.activeElement) document.activeElement.blur()
}

function setDistributionState(solves, { sessionName = 'Session' } = {}) {
    const validTimes = solves
        .map((solve) => getEffectiveTime(solve))
        .filter((time) => Number.isFinite(time))

    const dnfCount = solves.length - validTimes.length
    const nextBinWidthIndex = _prefs.binWidthIndex ?? getDefaultBinWidthIndex(validTimes)

    _state = {
        sessionName,
        solveCount: solves.length,
        dnfCount,
        validTimes,
        solveTimestamps: solves.map((solve) => solve.timestamp).filter(Number.isFinite),
        binWidthIndex: nextBinWidthIndex,
        customMin: _prefs.customMin,
        customMax: _prefs.customMax,
        legendVisible: _prefs.legendVisible,
        distribution: buildDistribution(validTimes, BIN_WIDTH_OPTIONS[nextBinWidthIndex].ms, _prefs.customMin, _prefs.customMax),
    }
}

export function showTimeDistributionModal(solves, { sessionName = 'Session' } = {}) {
    if (!_overlay) return

    setDistributionState(solves, { sessionName })

    if (!window.history.state?.isBackIntercepted) {
        window.history.pushState({ isBackIntercepted: true }, '')
    }

    _overlay.classList.add('active')
    requestAnimationFrame(() => {
        renderDistribution()
        _copyImageButton?.focus()
    })
}

export function refreshTimeDistributionData(solves, { sessionName = 'Session' } = {}) {
    if (!_overlay?.classList.contains('active')) return
    setDistributionState(solves, { sessionName })
    requestAnimationFrame(() => {
        renderDistribution()
    })
}

function bindCanvasInteractions() {
    if (!_canvas || !_canvasShell) return

    _canvas.addEventListener('mousemove', (event) => {
        if (shouldUseTouchInteraction()) return
        const point = getCanvasPointerPosition(event)
        const index = getBinIndexAtPoint(point.x, point.y)
        const changed = index !== _hoveredBinIndex
        _hoveredBinIndex = index
        if (changed) drawChart()
        if (index >= 0) showTooltipForBin(index, point)
        else updateTooltipVisibility()
    })

    _canvas.addEventListener('mouseleave', () => {
        const hadHover = _hoveredBinIndex >= 0
        _hoveredBinIndex = -1
        if (hadHover) drawChart()
        updateTooltipVisibility()
    })

    _canvas.addEventListener('pointerdown', (event) => {
        if (!shouldUseTouchInteraction(event.pointerType)) return
        if (!isTouchLikePointer(event.pointerType)) return
        if (event.button !== undefined && event.button !== 0) return

        const point = getCanvasPointerPosition(event)
        const index = getBinIndexAtPoint(point.x, point.y)
        if (index < 0) {
            const hadTouchFocus = _touchFocusedBinIndex >= 0
            clearTouchFocus()
            if (hadTouchFocus) drawChart()
            return
        }

        _activeTouchPointerId = event.pointerId
        _touchFocusedBinIndex = index
        _hoveredBinIndex = -1
        _canvas.setPointerCapture?.(event.pointerId)
        showTooltipForBin(index, point)
        drawChart()
        event.preventDefault()
    })

    _canvas.addEventListener('pointermove', (event) => {
        if (_activeTouchPointerId !== event.pointerId) return
        const point = getCanvasPointerPosition(event)
        const index = getBinIndexAtPoint(point.x, point.y)
        if (index >= 0) {
            _touchFocusedBinIndex = index
            showTooltipForBin(index, point)
            drawChart()
        }
        event.preventDefault()
    })

    const finishTouchInteraction = (event) => {
        if (_activeTouchPointerId !== event.pointerId) return
        _canvas.releasePointerCapture?.(event.pointerId)
        _activeTouchPointerId = null
    }

    _canvas.addEventListener('pointerup', finishTouchInteraction)
    _canvas.addEventListener('pointercancel', finishTouchInteraction)

    document.addEventListener('pointerdown', (event) => {
        if (_touchFocusedBinIndex < 0) return
        if (!(event.target instanceof Node)) return
        if (_canvasShell.contains(event.target)) return
        clearTouchFocus()
        drawChart()
    })
}

function bindRangeInput(input) {
    if (!input) return

    input.addEventListener('focus', () => {
        input.select()
    })

    input.addEventListener('input', () => {
        const sanitized = sanitizeRangeInputText(input.value)
        if (sanitized !== input.value) input.value = sanitized
    })

    input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault()
            applyRangeInputs()
            input.blur()
        }
    })

    input.addEventListener('blur', () => {
        applyRangeInputs()
    })
}

export function initTimeDistributionModal() {
    _overlay = document.getElementById('distribution-overlay')
    _modalBox = _overlay?.querySelector('.distribution-modal-box') || null
    _copyImageButton = document.getElementById('distribution-copy-image')
    _copyTextButton = document.getElementById('distribution-copy-text')
    _closeButton = document.getElementById('distribution-close')
    _canvasShell = document.getElementById('distribution-chart-shell')
    _canvas = document.getElementById('distribution-canvas')
    _tooltip = document.getElementById('distribution-tooltip')
    _tooltipRange = document.getElementById('distribution-tooltip-range')
    _tooltipCount = document.getElementById('distribution-tooltip-count')
    _tooltipShare = document.getElementById('distribution-tooltip-share')
    _emptyState = document.getElementById('distribution-empty-state')
    _header = _overlay.querySelector('.distribution-modal-header')
    _toolbar = _overlay.querySelector('.distribution-toolbar')
    _sessionEl = document.getElementById('distribution-session-name')
    _copyActions = document.getElementById('distribution-copy-actions')
    _rangeMinInput = document.getElementById('distribution-range-min')
    _rangeMaxInput = document.getElementById('distribution-range-max')
    _rangeResetButton = document.getElementById('distribution-range-reset')
    _binWidthSelect = document.getElementById('distribution-bin-width-select')
    _binCoarserButton = document.getElementById('distribution-bin-coarser')
    _binFinerButton = document.getElementById('distribution-bin-finer')
    _legendToggleButton = document.getElementById('distribution-legend-toggle')

    if (!_overlay) return

    if (_tooltipShare) _tooltipShare.hidden = true

    loadPreferences()

    let _distributionMouseDownTarget = null;
    let _distributionMouseUpTarget = null;
    _overlay.addEventListener('mousedown', (event) => {
        _distributionMouseDownTarget = event.target;
    });
    _overlay.addEventListener('mouseup', (event) => {
        _distributionMouseUpTarget = event.target;
    });
    _overlay.addEventListener('click', (event) => {
        if (_distributionMouseDownTarget === _overlay && _distributionMouseUpTarget === _overlay) closeTimeDistributionModal();
        _distributionMouseDownTarget = null;
        _distributionMouseUpTarget = null;
    })

    _closeButton?.addEventListener('click', () => {
        closeTimeDistributionModal()
    })

    // Chart image modal close handlers
    const chartImageClose = document.getElementById('chart-image-close')
    const chartImageOverlay = document.getElementById('chart-image-overlay')

    chartImageClose?.addEventListener('click', () => {
        chartImageOverlay?.classList.remove('active')
    })

    let _chartImageMouseDownTarget = null;
    let _chartImageMouseUpTarget = null;
    chartImageOverlay?.addEventListener('mousedown', (event) => {
        _chartImageMouseDownTarget = event.target;
    });
    chartImageOverlay?.addEventListener('mouseup', (event) => {
        _chartImageMouseUpTarget = event.target;
    });
    chartImageOverlay?.addEventListener('click', (event) => {
        if (_chartImageMouseDownTarget === chartImageOverlay && _chartImageMouseUpTarget === chartImageOverlay) {
            chartImageOverlay.classList.remove('active')
        }
        _chartImageMouseDownTarget = null;
        _chartImageMouseUpTarget = null;
    })

    // Escape key handler for chart image modal
    document.addEventListener('keydown', (event) => {
        if (event.code !== 'Escape') return
        if (!chartImageOverlay?.classList.contains('active')) return
        event.preventDefault()
        event.stopImmediatePropagation()
        chartImageOverlay.classList.remove('active')
    })

    _copyImageButton?.addEventListener('click', () => {
        void copyChartImage(_copyImageButton)
    })

    _copyTextButton?.addEventListener('click', () => {
        void copyDistributionText(_copyTextButton)
    })

    _binWidthSelect?.addEventListener('change', (event) => {
        const nextIndex = Number.parseInt(event.target.value, 10)
        setBinWidthIndex(Number.isFinite(nextIndex) ? nextIndex : 5)
    })

    _binCoarserButton?.addEventListener('click', () => {
        setBinWidthIndex((_state?.binWidthIndex ?? 5) + 1)
    })

    _binFinerButton?.addEventListener('click', () => {
        setBinWidthIndex((_state?.binWidthIndex ?? 5) - 1)
    })

    _legendToggleButton?.addEventListener('click', () => {
        toggleLegend()
    })

    _rangeResetButton?.addEventListener('click', () => {
        resetRangeInputs()
    })

    bindRangeInput(_rangeMinInput)
    bindRangeInput(_rangeMaxInput)
    bindCanvasInteractions()

    if (!_escapeHandlerBound) {
        document.addEventListener('keydown', (event) => {
            if (event.code !== 'Escape') return
            if (!isTimeDistributionModalOpen()) return
            if (document.getElementById('confirm-overlay')?.classList.contains('active')) return
            event.preventDefault()
            event.stopImmediatePropagation()
            closeTimeDistributionModal()
        })
        _escapeHandlerBound = true
    }

    if (_canvasShell && typeof ResizeObserver !== 'undefined') {
        _resizeObserver?.disconnect?.()
        _resizeObserver = new ResizeObserver(() => {
            if (isTimeDistributionModalOpen()) drawChart()
        })
        _resizeObserver.observe(_canvasShell)
    }
}
