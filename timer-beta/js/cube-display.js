/**
 * Canvas scramble preview renderers.
 * Supports NxN cube nets, Square-1, a flat pyraminx preview, a two-star megaminx net, and skewb.
 */

// Face indices: U=0, R=1, F=2, D=3, L=4, B=5
const U = 0, R = 1, F = 2, D = 3, L = 4, B = 5;

const DEFAULT_CUBE_COLORS = Object.freeze(['#FFF', '#F00', '#33CD32', '#FFFF05', '#FFA503', '#00F']);
const AXIS_INDEX = Object.freeze({ x: 0, y: 1, z: 2 });
const STICKER_GAP_TO_CELL_RATIO = 1 / 38;

const FACE_VECTORS = Object.freeze({
    [U]: Object.freeze({ normal: [0, 1, 0], right: [1, 0, 0], down: [0, 0, 1] }),
    [R]: Object.freeze({ normal: [1, 0, 0], right: [0, 0, -1], down: [0, -1, 0] }),
    [F]: Object.freeze({ normal: [0, 0, 1], right: [1, 0, 0], down: [0, -1, 0] }),
    [D]: Object.freeze({ normal: [0, -1, 0], right: [1, 0, 0], down: [0, 0, -1] }),
    [L]: Object.freeze({ normal: [-1, 0, 0], right: [0, 0, 1], down: [0, -1, 0] }),
    [B]: Object.freeze({ normal: [0, 0, -1], right: [-1, 0, 0], down: [0, -1, 0] }),
});

const NORMAL_TO_FACE = new Map(
    Object.entries(FACE_VECTORS).map(([face, meta]) => [meta.normal.join(','), Number(face)]),
);

const BASIC_MOVE_CONFIG = Object.freeze({
    U: Object.freeze({ axis: 'y', side: 1, baseQuarterTurns: 3 }),
    D: Object.freeze({ axis: 'y', side: -1, baseQuarterTurns: 1 }),
    R: Object.freeze({ axis: 'x', side: 1, baseQuarterTurns: 3 }),
    L: Object.freeze({ axis: 'x', side: -1, baseQuarterTurns: 1 }),
    F: Object.freeze({ axis: 'z', side: 1, baseQuarterTurns: 3 }),
    B: Object.freeze({ axis: 'z', side: -1, baseQuarterTurns: 1 }),
});

const ROTATION_MOVE_CONFIG = Object.freeze({
    X: Object.freeze({ axis: 'x', side: 1, baseQuarterTurns: 3 }),
    Y: Object.freeze({ axis: 'y', side: 1, baseQuarterTurns: 3 }),
    Z: Object.freeze({ axis: 'z', side: 1, baseQuarterTurns: 3 }),
});

const FACE_POSITIONS = Object.freeze({
    [U]: [1, 0],
    [L]: [0, 1],
    [F]: [1, 1],
    [R]: [2, 1],
    [B]: [3, 1],
    [D]: [1, 2],
});

// Pyraminx preview face order: left, front, right, bottom.
const PYRAMINX_FACE_SIZE = 3;
const DEFAULT_PYRAMINX_COLORS = Object.freeze(['#FFFF05', '#33CD32', '#F00', '#00F']);
const PYRAMINX_TRIANGLE_HEIGHT_RATIO = Math.sqrt(3) / 2;
const PYRAMINX_FACE_HORIZONTAL_STEP_RATIO = 0.58;
const PYRAMINX_FACE_VERTICAL_GAP_RATIO = 0.08;
const DEFAULT_PYRAMINX_STICKER_OUTLINE = 'rgba(0, 0, 0, 0.4)';
const PYRAMINX_VERTICES = Object.freeze({
    U: Object.freeze([1, 1, 1]),
    L: Object.freeze([-1, -1, 1]),
    R: Object.freeze([1, -1, -1]),
    B: Object.freeze([-1, 1, -1]),
});
const PYRAMINX_FACE_LAYOUT = Object.freeze([
    Object.freeze({ vertices: Object.freeze(['U', 'L', 'B']), opposite: 'R', color: 2 }),
    Object.freeze({ vertices: Object.freeze(['U', 'L', 'R']), opposite: 'B', color: 1 }),
    Object.freeze({ vertices: Object.freeze(['U', 'R', 'B']), opposite: 'L', color: 3 }),
    Object.freeze({ vertices: Object.freeze(['L', 'R', 'B']), opposite: 'U', color: 0 }),
]);
const PYRAMINX_FACE_DRAW_CONFIGS = Object.freeze([
    Object.freeze({ orientation: 'down', vertexOrder: Object.freeze([1, 2, 0]) }),
    Object.freeze({ orientation: 'up', vertexOrder: Object.freeze([2, 0, 1]) }),
    Object.freeze({ orientation: 'down', vertexOrder: Object.freeze([0, 2, 1]) }),
    Object.freeze({ orientation: 'down', vertexOrder: Object.freeze([0, 1, 2]) }),
]);

const MEGAMINX_FACE_SIZE = 11;
const DEFAULT_MEGAMINX_COLORS = Object.freeze([
    '#F8F8F5',
    '#F9C91C',
    '#FFF6B4',
    '#9C9C9C',
    '#EC1111',
    '#0A7F12',
    '#74FB00',
    '#FF9136',
    '#1223C8',
    '#8A28FF',
    '#E28DEE',
    '#8BD6F8',
]);
const MEGAMINX_FACE_NORMALS = Object.freeze([
    Object.freeze([0, 0.5257311121191336, 0.85065080835204]),
    Object.freeze([0, -0.5257311121191336, 0.85065080835204]),
    Object.freeze([0, 0.5257311121191336, -0.85065080835204]),
    Object.freeze([0, -0.5257311121191336, -0.85065080835204]),
    Object.freeze([0.5257311121191336, 0.85065080835204, 0]),
    Object.freeze([-0.5257311121191336, 0.85065080835204, 0]),
    Object.freeze([0.5257311121191336, -0.85065080835204, 0]),
    Object.freeze([-0.5257311121191336, -0.85065080835204, 0]),
    Object.freeze([0.85065080835204, 0, 0.5257311121191336]),
    Object.freeze([-0.85065080835204, 0, 0.5257311121191336]),
    Object.freeze([0.85065080835204, 0, -0.5257311121191336]),
    Object.freeze([-0.85065080835204, 0, -0.5257311121191336]),
]);
const MEGAMINX_FACE_NEIGHBORS = Object.freeze([
    Object.freeze([9, 1, 8, 4, 5]),
    Object.freeze([7, 6, 8, 0, 9]),
    Object.freeze([10, 3, 11, 5, 4]),
    Object.freeze([6, 7, 11, 2, 10]),
    Object.freeze([8, 10, 2, 5, 0]),
    Object.freeze([11, 9, 0, 4, 2]),
    Object.freeze([1, 7, 3, 10, 8]),
    Object.freeze([3, 6, 1, 9, 11]),
    Object.freeze([1, 6, 10, 4, 0]),
    Object.freeze([7, 1, 0, 5, 11]),
    Object.freeze([6, 3, 2, 4, 8]),
    Object.freeze([3, 7, 9, 5, 2]),
]);
const MEGAMINX_U_FACE = 0;
const MEGAMINX_D_FACE = 3;
const MEGAMINX_FRONT_FACE = 5;
const MEGAMINX_LEFT_FACE = 9;
const MEGAMINX_RIGHT_AXIS_FACE = 10;
const MEGAMINX_CENTER_WEIGHT = 3;
const MEGAMINX_LAYER_THRESHOLD = 0.58;
const MEGAMINX_FIFTH_TURN_RAD = (2 * Math.PI) / 5;
const DEFAULT_MEGAMINX_STICKER_OUTLINE = 'rgba(0, 0, 0, 0.45)';
const MEGAMINX_INNER_PENTAGON_SCALE = 0.54;
const MEGAMINX_EDGE_SPLIT_RATIO = 0.33;
const MEGAMINX_FACE_LAYOUT_SCALE = 0.96;
const MEGAMINX_STICKER_INSET_RATIO = 0.026;
const MEGAMINX_STICKER_INSET_MIN = 0.32;
const MEGAMINX_U_STAR_ROTATION = -Math.PI / 10;
const MEGAMINX_D_STAR_ROTATION = Math.PI / 10;
const MEGAMINX_U_STAR_EDGE_TO_FACE = Object.freeze([4, 5, 9, 1, 8]);
const MEGAMINX_D_STAR_EDGE_TO_FACE = Object.freeze([11, 2, 10, 6, 7]);
const MEGAMINX_LABEL_STYLE = Object.freeze({
    fill: 'rgba(42, 24, 18, 0.9)',
    stroke: 'rgba(255, 255, 255, 0.88)',
});
const DEFAULT_SQUARE1_COLORS = Object.freeze({
    U: '#ffff00',
    D: '#ffffff',
    F: '#ff0000',
    B: '#ff8800',
    L: '#0000ff',
    R: '#00ff00',
});
const SQUARE1_PIECE_LAYOUTS = Object.freeze([
    Object.freeze({ type: 'edge', faces: Object.freeze(['U', 'B']) }),
    Object.freeze({ type: 'corner', faces: Object.freeze(['U', 'B', 'R']) }),
    Object.freeze({ type: 'edge', faces: Object.freeze(['U', 'R']) }),
    Object.freeze({ type: 'corner', faces: Object.freeze(['U', 'R', 'F']) }),
    Object.freeze({ type: 'edge', faces: Object.freeze(['U', 'F']) }),
    Object.freeze({ type: 'corner', faces: Object.freeze(['U', 'F', 'L']) }),
    Object.freeze({ type: 'edge', faces: Object.freeze(['U', 'L']) }),
    Object.freeze({ type: 'corner', faces: Object.freeze(['U', 'L', 'B']) }),
    Object.freeze({ type: 'corner', faces: Object.freeze(['D', 'F', 'R']) }),
    Object.freeze({ type: 'edge', faces: Object.freeze(['D', 'R']) }),
    Object.freeze({ type: 'corner', faces: Object.freeze(['D', 'R', 'B']) }),
    Object.freeze({ type: 'edge', faces: Object.freeze(['D', 'B']) }),
    Object.freeze({ type: 'corner', faces: Object.freeze(['D', 'B', 'L']) }),
    Object.freeze({ type: 'edge', faces: Object.freeze(['D', 'L']) }),
    Object.freeze({ type: 'corner', faces: Object.freeze(['D', 'L', 'F']) }),
    Object.freeze({ type: 'edge', faces: Object.freeze(['D', 'F']) }),
]);
const SQUARE1_SOLVED_TOP = Object.freeze([1, 1, 2, 3, 3, 4, 5, 5, 6, 7, 7, 0]);
// Shifted by one bottom turn so imported Square-1 scrambles line up with the
// generator's reference orientation without requiring a manual "(0, 1)" prefix.
const SQUARE1_SOLVED_BOTTOM = Object.freeze([15, 8, 8, 9, 10, 10, 11, 12, 12, 13, 14, 14]);
const SQUARE1_TAN15 = 0.267949;
const SQUARE1_INNER_RADIUS = 0.65;
const SQUARE1_TOP_START_ANGLE = 75;
const SQUARE1_BOTTOM_START_ANGLE = 105;
const DEFAULT_SQUARE1_OUTLINE_COLOR = '#000000';
const SQUARE1_OUTLINE_WIDTH = 0.026;
const SQUARE1_MIDDLE_LAYER_WIDTH = 2.0;
const SQUARE1_MIDDLE_LAYER_HEIGHT = 0.3;
const SQUARE1_MIDDLE_LAYER_Y_OFFSET = -1.15;
const SQUARE1_MIDDLE_LAYER_LEFT_RATIO = 0.37;
const SQUARE1_TOP_FACE_CENTER = Object.freeze([-1.7, 0.06]);
const SQUARE1_BOTTOM_FACE_CENTER = Object.freeze([1.4, 0.06]);
const SQUARE1_SINGLE_FACE_CENTER = Object.freeze([0.3, 0.06]);
const SQUARE1_LAYOUT_MARGIN_RATIO = 0.08;
const SQUARE1_EDGE_BASE_POLYGONS = Object.freeze([
    Object.freeze([
        Object.freeze([0, 0]),
        Object.freeze([SQUARE1_INNER_RADIUS, -SQUARE1_INNER_RADIUS * SQUARE1_TAN15]),
        Object.freeze([SQUARE1_INNER_RADIUS, SQUARE1_INNER_RADIUS * SQUARE1_TAN15]),
    ]),
    Object.freeze([
        Object.freeze([SQUARE1_INNER_RADIUS, -SQUARE1_INNER_RADIUS * SQUARE1_TAN15]),
        Object.freeze([1, -SQUARE1_TAN15]),
        Object.freeze([1, SQUARE1_TAN15]),
        Object.freeze([SQUARE1_INNER_RADIUS, SQUARE1_INNER_RADIUS * SQUARE1_TAN15]),
    ]),
]);
const SQUARE1_CORNER_BASE_POLYGONS = Object.freeze([
    Object.freeze([
        Object.freeze([0, 0]),
        Object.freeze([SQUARE1_INNER_RADIUS, SQUARE1_INNER_RADIUS * SQUARE1_TAN15]),
        Object.freeze([SQUARE1_INNER_RADIUS, SQUARE1_INNER_RADIUS]),
        Object.freeze([SQUARE1_INNER_RADIUS * SQUARE1_TAN15, SQUARE1_INNER_RADIUS]),
    ]),
    Object.freeze([
        Object.freeze([SQUARE1_INNER_RADIUS * SQUARE1_TAN15, SQUARE1_INNER_RADIUS]),
        Object.freeze([SQUARE1_TAN15, 1]),
        Object.freeze([1, 1]),
        Object.freeze([SQUARE1_INNER_RADIUS, SQUARE1_INNER_RADIUS]),
    ]),
    Object.freeze([
        Object.freeze([SQUARE1_INNER_RADIUS, SQUARE1_INNER_RADIUS]),
        Object.freeze([1, 1]),
        Object.freeze([1, SQUARE1_TAN15]),
        Object.freeze([SQUARE1_INNER_RADIUS, SQUARE1_INNER_RADIUS * SQUARE1_TAN15]),
    ]),
]);

function getCanvasPixelRatio() {
    return window.devicePixelRatio || 1;
}

function getPreviewThemeStyles() {
    return window.getComputedStyle(document.documentElement);
}

function readPreviewThemeColor(styles, variableName, fallback) {
    const value = styles.getPropertyValue(variableName).trim();
    return value || fallback;
}

function getCubePreviewTheme(styles = getPreviewThemeStyles()) {
    return {
        colors: [
            readPreviewThemeColor(styles, '--preview-cube-white', DEFAULT_CUBE_COLORS[0]),
            readPreviewThemeColor(styles, '--preview-cube-red', DEFAULT_CUBE_COLORS[1]),
            readPreviewThemeColor(styles, '--preview-cube-green', DEFAULT_CUBE_COLORS[2]),
            readPreviewThemeColor(styles, '--preview-cube-yellow', DEFAULT_CUBE_COLORS[3]),
            readPreviewThemeColor(styles, '--preview-cube-orange', DEFAULT_CUBE_COLORS[4]),
            readPreviewThemeColor(styles, '--preview-cube-blue', DEFAULT_CUBE_COLORS[5]),
        ],
        outline: readPreviewThemeColor(styles, '--preview-cube-outline', 'rgba(0, 0, 0, 0.4)'),
    };
}

function getSkewbPreviewTheme(styles = getPreviewThemeStyles()) {
    return {
        colors: [
            readPreviewThemeColor(styles, '--preview-skewb-white', DEFAULT_CUBE_COLORS[0]),
            readPreviewThemeColor(styles, '--preview-skewb-red', DEFAULT_CUBE_COLORS[1]),
            readPreviewThemeColor(styles, '--preview-skewb-green', DEFAULT_CUBE_COLORS[2]),
            readPreviewThemeColor(styles, '--preview-skewb-yellow', DEFAULT_CUBE_COLORS[3]),
            readPreviewThemeColor(styles, '--preview-skewb-orange', DEFAULT_CUBE_COLORS[4]),
            readPreviewThemeColor(styles, '--preview-skewb-blue', DEFAULT_CUBE_COLORS[5]),
        ],
        outline: readPreviewThemeColor(styles, '--preview-skewb-outline', '#000000'),
    };
}

function getPyraminxPreviewTheme(styles = getPreviewThemeStyles()) {
    return {
        colors: [
            readPreviewThemeColor(styles, '--preview-pyraminx-yellow', DEFAULT_PYRAMINX_COLORS[0]),
            readPreviewThemeColor(styles, '--preview-pyraminx-green', DEFAULT_PYRAMINX_COLORS[1]),
            readPreviewThemeColor(styles, '--preview-pyraminx-red', DEFAULT_PYRAMINX_COLORS[2]),
            readPreviewThemeColor(styles, '--preview-pyraminx-blue', DEFAULT_PYRAMINX_COLORS[3]),
        ],
        outline: readPreviewThemeColor(styles, '--preview-pyraminx-outline', DEFAULT_PYRAMINX_STICKER_OUTLINE),
    };
}

function getMegaminxPreviewTheme(styles = getPreviewThemeStyles()) {
    return {
        colors: [
            readPreviewThemeColor(styles, '--preview-megaminx-face-1', DEFAULT_MEGAMINX_COLORS[0]),
            readPreviewThemeColor(styles, '--preview-megaminx-face-2', DEFAULT_MEGAMINX_COLORS[1]),
            readPreviewThemeColor(styles, '--preview-megaminx-face-3', DEFAULT_MEGAMINX_COLORS[2]),
            readPreviewThemeColor(styles, '--preview-megaminx-face-4', DEFAULT_MEGAMINX_COLORS[3]),
            readPreviewThemeColor(styles, '--preview-megaminx-face-5', DEFAULT_MEGAMINX_COLORS[4]),
            readPreviewThemeColor(styles, '--preview-megaminx-face-6', DEFAULT_MEGAMINX_COLORS[5]),
            readPreviewThemeColor(styles, '--preview-megaminx-face-7', DEFAULT_MEGAMINX_COLORS[6]),
            readPreviewThemeColor(styles, '--preview-megaminx-face-8', DEFAULT_MEGAMINX_COLORS[7]),
            readPreviewThemeColor(styles, '--preview-megaminx-face-9', DEFAULT_MEGAMINX_COLORS[8]),
            readPreviewThemeColor(styles, '--preview-megaminx-face-10', DEFAULT_MEGAMINX_COLORS[9]),
            readPreviewThemeColor(styles, '--preview-megaminx-face-11', DEFAULT_MEGAMINX_COLORS[10]),
            readPreviewThemeColor(styles, '--preview-megaminx-face-12', DEFAULT_MEGAMINX_COLORS[11]),
        ],
        outline: readPreviewThemeColor(styles, '--preview-megaminx-outline', DEFAULT_MEGAMINX_STICKER_OUTLINE),
    };
}

function getSquare1PreviewTheme(styles = getPreviewThemeStyles()) {
    return {
        colors: {
            U: readPreviewThemeColor(styles, '--preview-square1-up', DEFAULT_SQUARE1_COLORS.U),
            D: readPreviewThemeColor(styles, '--preview-square1-down', DEFAULT_SQUARE1_COLORS.D),
            F: readPreviewThemeColor(styles, '--preview-square1-front', DEFAULT_SQUARE1_COLORS.F),
            B: readPreviewThemeColor(styles, '--preview-square1-back', DEFAULT_SQUARE1_COLORS.B),
            L: readPreviewThemeColor(styles, '--preview-square1-left', DEFAULT_SQUARE1_COLORS.L),
            R: readPreviewThemeColor(styles, '--preview-square1-right', DEFAULT_SQUARE1_COLORS.R),
        },
        outline: readPreviewThemeColor(styles, '--preview-square1-outline', DEFAULT_SQUARE1_OUTLINE_COLOR),
    };
}

function createSquare1Pieces(colors) {
    return SQUARE1_PIECE_LAYOUTS.map((piece) => ({
        type: piece.type,
        colors: piece.faces.map((face) => colors[face]),
    }));
}

function getClockPreviewTheme(styles = getPreviewThemeStyles()) {
    return {
        body: readPreviewThemeColor(styles, '--preview-clock-body', '#000000'),
        frontFace: readPreviewThemeColor(styles, '--preview-clock-front-face', '#57c5f8'),
        backFace: readPreviewThemeColor(styles, '--preview-clock-back-face', '#315f9b'),
        frontDial: readPreviewThemeColor(styles, '--preview-clock-front-dial', '#315f9b'),
        backDial: readPreviewThemeColor(styles, '--preview-clock-back-dial', '#57c5f8'),
        handFill: readPreviewThemeColor(styles, '--preview-clock-hand-fill', '#FFD700'),
        handStroke: readPreviewThemeColor(styles, '--preview-clock-hand-stroke', '#FF0000'),
        pinUp: readPreviewThemeColor(styles, '--preview-clock-pin-up', '#FFEB3B'),
        pinDown: readPreviewThemeColor(styles, '--preview-clock-pin-down', '#7b4c20'),
    };
}

function getCanvasLogicalSize(canvas) {
    const pixelRatio = getCanvasPixelRatio();
    return {
        pixelRatio,
        width: canvas.width / pixelRatio,
        height: canvas.height / pixelRatio,
    };
}

function syncCanvasToDisplaySize(canvas) {
    const rect = canvas.getBoundingClientRect();
    const cssWidth = Math.max(0, rect.width);
    const cssHeight = Math.max(0, rect.height);
    if (cssWidth === 0 || cssHeight === 0) return false;

    const pixelRatio = getCanvasPixelRatio();
    const displayWidth = Math.max(1, Math.round(cssWidth * pixelRatio));
    const displayHeight = Math.max(1, Math.round(cssHeight * pixelRatio));

    if (canvas.width !== displayWidth) canvas.width = displayWidth;
    if (canvas.height !== displayHeight) canvas.height = displayHeight;

    const ctx = canvas.getContext('2d');
    ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    return true;
}

function normalizeCubeSize(size = 3) {
    const parsed = Number(size);
    if (!Number.isFinite(parsed)) return 3;
    return Math.max(2, Math.round(parsed));
}

function getFaceSize(face) {
    const length = Array.isArray(face) ? face.length : 9;
    return Math.max(2, Math.round(Math.sqrt(length)));
}

function getCoordinateValue(index, size) {
    return (index * 2) - (size - 1);
}

function dot(a, b) {
    return (a[0] * b[0]) + (a[1] * b[1]) + (a[2] * b[2]);
}

function addVectors(a, b) {
    return [
        a[0] + b[0],
        a[1] + b[1],
        a[2] + b[2],
    ];
}

function subtractVectors(a, b) {
    return [
        a[0] - b[0],
        a[1] - b[1],
        a[2] - b[2],
    ];
}

function scaleVector(vector, scalar) {
    return [
        vector[0] * scalar,
        vector[1] * scalar,
        vector[2] * scalar,
    ];
}

function sumVectors(...vectors) {
    return vectors.reduce(
        (total, vector) => addVectors(total, vector),
        [0, 0, 0],
    );
}

function cross(a, b) {
    return [
        (a[1] * b[2]) - (a[2] * b[1]),
        (a[2] * b[0]) - (a[0] * b[2]),
        (a[0] * b[1]) - (a[1] * b[0]),
    ];
}

function magnitude(vector) {
    return Math.sqrt(dot(vector, vector));
}

function normalizeVector(vector) {
    const length = magnitude(vector);
    if (!length) return [0, 0, 0];
    return scaleVector(vector, 1 / length);
}

function positiveModulo(value, divisor) {
    return ((value % divisor) + divisor) % divisor;
}

function averagePoints(points) {
    if (!Array.isArray(points) || points.length === 0) return [];

    const dimension = points[0].length;
    const sums = new Array(dimension).fill(0);

    points.forEach((point) => {
        for (let index = 0; index < dimension; index += 1) {
            sums[index] += point[index];
        }
    });

    return sums.map((value) => value / points.length);
}

function interpolateTrianglePoint(a, b, c, u, v, size = PYRAMINX_FACE_SIZE) {
    const uRatio = u / size;
    const vRatio = v / size;

    return a.map((coord, index) => (
        coord
        + ((b[index] - coord) * uRatio)
        + ((c[index] - coord) * vRatio)
    ));
}

function rotateVectorAroundAxis(vector, axis, angle) {
    const normalizedAxis = normalizeVector(axis);
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);

    return addVectors(
        addVectors(
            scaleVector(vector, cos),
            scaleVector(cross(normalizedAxis, vector), sin),
        ),
        scaleVector(normalizedAxis, dot(normalizedAxis, vector) * (1 - cos)),
    );
}

function distanceSquared(a, b) {
    return (
        ((a[0] - b[0]) ** 2)
        + ((a[1] - b[1]) ** 2)
        + ((a[2] - b[2]) ** 2)
    );
}

function distance2D(a, b) {
    return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

function createPyraminxTriangleDefinitions(size = PYRAMINX_FACE_SIZE) {
    const referenceA = [0, 0];
    const referenceB = [1, 0];
    const referenceC = [0.5, PYRAMINX_TRIANGLE_HEIGHT_RATIO];
    const definitions = [];

    const pushTriangle = (gridPoints) => {
        const centroid = averagePoints(
            gridPoints.map(([u, v]) => interpolateTrianglePoint(referenceA, referenceB, referenceC, u, v, size)),
        );
        definitions.push({ gridPoints, centroid });
    };

    for (let row = 0; row < size; row += 1) {
        for (let col = 0; col < size - row; col += 1) {
            pushTriangle([
                [row, col],
                [row + 1, col],
                [row, col + 1],
            ]);
        }
    }

    for (let row = 0; row < size - 1; row += 1) {
        for (let col = 0; col < size - 1 - row; col += 1) {
            pushTriangle([
                [row + 1, col],
                [row + 1, col + 1],
                [row, col + 1],
            ]);
        }
    }

    return definitions
        .sort((a, b) => {
            const verticalDelta = a.centroid[1] - b.centroid[1];
            if (Math.abs(verticalDelta) > 1e-9) return verticalDelta;
            return a.centroid[0] - b.centroid[0];
        })
        .map(({ gridPoints }) => gridPoints.map(([u, v]) => [u, v]));
}

const PYRAMINX_TRIANGLE_DEFINITIONS = Object.freeze(createPyraminxTriangleDefinitions());

function createPyraminxFaceMetas() {
    return PYRAMINX_FACE_LAYOUT.map((face, index) => {
        const vertices = face.vertices.map((vertex) => PYRAMINX_VERTICES[vertex]);
        let normal = normalizeVector(cross(
            subtractVectors(vertices[1], vertices[0]),
            subtractVectors(vertices[2], vertices[0]),
        ));

        if (dot(normal, PYRAMINX_VERTICES[face.opposite]) > 0) {
            normal = scaleVector(normal, -1);
        }

        const solvedSlots = PYRAMINX_TRIANGLE_DEFINITIONS.map((triangle) => averagePoints(
            triangle.map(([u, v]) => interpolateTrianglePoint(vertices[0], vertices[1], vertices[2], u, v)),
        ));

        return {
            index,
            color: face.color,
            normal,
            opposite: face.opposite,
            solvedSlots,
        };
    });
}

const PYRAMINX_FACE_METAS = Object.freeze(createPyraminxFaceMetas());

function rotateVectorQuarter(vector, axis) {
    const [x, y, z] = vector;

    switch (axis) {
        case 'x':
            return [x, -z, y];
        case 'y':
            return [z, y, -x];
        case 'z':
            return [-y, x, z];
        default:
            return [x, y, z];
    }
}

function createSolvedCubeState(size = 3) {
    const cubeSize = normalizeCubeSize(size);
    const max = cubeSize - 1;
    const stickers = [];

    for (let face = 0; face < 6; face += 1) {
        const meta = FACE_VECTORS[face];

        for (let row = 0; row < cubeSize; row += 1) {
            for (let col = 0; col < cubeSize; col += 1) {
                const horizontal = getCoordinateValue(col, cubeSize);
                const vertical = getCoordinateValue(row, cubeSize);
                stickers.push({
                    color: face,
                    position: [
                        (meta.normal[0] * max) + (meta.right[0] * horizontal) + (meta.down[0] * vertical),
                        (meta.normal[1] * max) + (meta.right[1] * horizontal) + (meta.down[1] * vertical),
                        (meta.normal[2] * max) + (meta.right[2] * horizontal) + (meta.down[2] * vertical),
                    ],
                    normal: [...meta.normal],
                });
            }
        }
    }

    return stickers;
}

function createSolvedCubeFaces(size = 3) {
    const cubeSize = normalizeCubeSize(size);
    return Array.from({ length: 6 }, (_, face) => new Array(cubeSize * cubeSize).fill(face));
}

function materializeCubeFaces(stickers, size = 3) {
    const cubeSize = normalizeCubeSize(size);
    const max = cubeSize - 1;
    const cube = createSolvedCubeFaces(cubeSize);

    stickers.forEach((sticker) => {
        const face = NORMAL_TO_FACE.get(sticker.normal.join(','));
        if (face == null) return;

        const meta = FACE_VECTORS[face];
        const col = Math.round((dot(sticker.position, meta.right) + max) / 2);
        const row = Math.round((dot(sticker.position, meta.down) + max) / 2);

        if (row < 0 || row >= cubeSize || col < 0 || col >= cubeSize) return;
        cube[face][(row * cubeSize) + col] = sticker.color;
    });

    return cube;
}

function rotateFace180(face, size) {
    const rotated = new Array(face.length);

    for (let row = 0; row < size; row += 1) {
        for (let col = 0; col < size; col += 1) {
            const sourceIndex = (row * size) + col;
            const targetIndex = ((size - 1 - row) * size) + (size - 1 - col);
            rotated[targetIndex] = face[sourceIndex];
        }
    }

    return rotated;
}

function orientCubeForDisplay(cube, orientation = 'standard') {
    const size = getFaceSize(cube?.[0]);

    if (orientation !== 'yellow-top') {
        return cube.map((face) => [...face]);
    }

    return [
        rotateFace180(cube[D], size),
        rotateFace180(cube[L], size),
        rotateFace180(cube[F], size),
        rotateFace180(cube[U], size),
        rotateFace180(cube[R], size),
        rotateFace180(cube[B], size),
    ];
}

function getModifierMultiplier(modifier = '') {
    if (modifier === '2') return 2;
    if (modifier === "'" || modifier === '\u2019') return 3;
    return 1;
}

function parseMoveToken(token, size = 3) {
    const normalized = String(token ?? '')
        .trim()
        .replace(/[`´‘’′]/g, "'");

    if (!normalized) return null;

    const rotationMatch = normalized.match(/^([xyzXYZ])([2']?)$/);
    if (rotationMatch) {
        const config = ROTATION_MOVE_CONFIG[rotationMatch[1].toUpperCase()];
        const quarterTurns = (config.baseQuarterTurns * getModifierMultiplier(rotationMatch[2])) % 4;

        return {
            axis: config.axis,
            side: config.side,
            layers: normalizeCubeSize(size),
            quarterTurns,
        };
    }

    const faceMatch = normalized.match(/^(?:(\d+))?([URFDLBurfdlb])(w)?([2']?)$/);
    if (!faceMatch) return null;

    const [, prefixText, rawFace, wideMarker, modifier] = faceMatch;
    const face = rawFace.toUpperCase();
    const config = BASIC_MOVE_CONFIG[face];
    if (!config) return null;

    const prefixLayers = prefixText ? Number.parseInt(prefixText, 10) : null;
    const isLowercaseWide = rawFace !== face;
    const isWideMove = Boolean(wideMarker) || isLowercaseWide || prefixLayers != null;
    const defaultLayers = isWideMove ? (prefixLayers ?? 2) : 1;
    const layers = Math.min(normalizeCubeSize(size), Math.max(1, defaultLayers));
    const quarterTurns = (config.baseQuarterTurns * getModifierMultiplier(modifier)) % 4;

    return {
        axis: config.axis,
        side: config.side,
        layers,
        quarterTurns,
    };
}

function shouldRotateSticker(sticker, axisIndex, side, threshold) {
    const axisValue = sticker.position[axisIndex];
    return side > 0 ? axisValue >= threshold : axisValue <= -threshold;
}

function applyParsedMove(stickers, parsedMove, size = 3) {
    if (!parsedMove || parsedMove.quarterTurns === 0) return;

    const cubeSize = normalizeCubeSize(size);
    const axisIndex = AXIS_INDEX[parsedMove.axis];
    const threshold = (cubeSize - 1) - ((Math.min(parsedMove.layers, cubeSize) - 1) * 2);
    const rotatingStickers = stickers.filter((sticker) => (
        shouldRotateSticker(sticker, axisIndex, parsedMove.side, threshold)
    ));

    for (let step = 0; step < parsedMove.quarterTurns; step += 1) {
        rotatingStickers.forEach((sticker) => {
            sticker.position = rotateVectorQuarter(sticker.position, parsedMove.axis);
            sticker.normal = rotateVectorQuarter(sticker.normal, parsedMove.axis);
        });
    }
}

export function applyScramble(scramble, orientation = 'standard', size = 3) {
    const cubeSize = normalizeCubeSize(size);
    const stickers = createSolvedCubeState(cubeSize);

    if (scramble) {
        const moves = String(scramble).trim().split(/\s+/);
        moves.forEach((token) => {
            const parsedMove = parseMoveToken(token, cubeSize);
            applyParsedMove(stickers, parsedMove, cubeSize);
        });
    }

    return orientCubeForDisplay(materializeCubeFaces(stickers, cubeSize), orientation);
}

function getPyraminxMoveTurns(modifier = '') {
    if (modifier === '2') return 2;
    if (modifier === "'" || modifier === '\u2019') return 2;
    return 1;
}

function parsePyraminxMoveToken(token) {
    const normalized = String(token ?? '')
        .trim()
        .replace(/[`´‘’′]/g, "'");

    if (!normalized) return null;

    const match = normalized.match(/^([ULRBulrb])([2']?)$/);
    if (!match) return null;

    const [, base, modifier] = match;

    return {
        axis: base.toUpperCase(),
        tipOnly: base !== base.toUpperCase(),
        turns: getPyraminxMoveTurns(modifier) % 3,
    };
}

function createSolvedPyraminxState() {
    const stickers = [];

    PYRAMINX_FACE_METAS.forEach((face) => {
        face.solvedSlots.forEach((position) => {
            stickers.push({
                color: face.color,
                position: [...position],
                normal: [...face.normal],
            });
        });
    });

    return stickers;
}

function getPyraminxVertexWeight(position, vertexKey) {
    return (dot(position, PYRAMINX_VERTICES[vertexKey]) + 1) / 4;
}

function applyPyraminxMove(stickers, move) {
    if (!move || move.turns === 0) return;

    const threshold = move.tipOnly ? (2 / 3) : (1 / 3);
    const axis = PYRAMINX_VERTICES[move.axis];
    const angle = -((2 * Math.PI) / 3) * move.turns;

    stickers.forEach((sticker) => {
        if (getPyraminxVertexWeight(sticker.position, move.axis) > threshold + 1e-9) {
            sticker.position = rotateVectorAroundAxis(sticker.position, axis, angle);
            sticker.normal = rotateVectorAroundAxis(sticker.normal, axis, angle);
        }
    });
}

function resolvePyraminxFaceIndex(normal) {
    let bestFaceIndex = 0;
    let bestDot = -Infinity;

    PYRAMINX_FACE_METAS.forEach((face) => {
        const similarity = dot(normal, face.normal);
        if (similarity > bestDot) {
            bestDot = similarity;
            bestFaceIndex = face.index;
        }
    });

    return bestFaceIndex;
}

function materializePyraminxFaces(stickers) {
    const faces = PYRAMINX_FACE_METAS.map((face) => new Array(PYRAMINX_TRIANGLE_DEFINITIONS.length).fill(face.color));
    const occupiedSlots = PYRAMINX_FACE_METAS.map(() => new Set());

    stickers.forEach((sticker) => {
        const faceIndex = resolvePyraminxFaceIndex(sticker.normal);
        const face = PYRAMINX_FACE_METAS[faceIndex];
        const slotCandidates = face.solvedSlots
            .map((slot, index) => ({ index, distance: distanceSquared(sticker.position, slot) }))
            .sort((a, b) => a.distance - b.distance);
        const nextSlot = slotCandidates.find(({ index }) => !occupiedSlots[faceIndex].has(index)) ?? slotCandidates[0];

        occupiedSlots[faceIndex].add(nextSlot.index);
        faces[faceIndex][nextSlot.index] = sticker.color;
    });

    return faces;
}

export function applyPyraminxScramble(scramble) {
    const stickers = createSolvedPyraminxState();

    if (scramble) {
        String(scramble)
            .trim()
            .split(/\s+/)
            .forEach((token) => {
                const parsedMove = parsePyraminxMoveToken(token);
                applyPyraminxMove(stickers, parsedMove);
            });
    }

    return materializePyraminxFaces(stickers);
}

function createMegaminxFaceMetas() {
    return MEGAMINX_FACE_NORMALS.map((normal, face) => {
        const neighbors = MEGAMINX_FACE_NEIGHBORS[face];
        const solvedSlots = [[...normal]];

        for (let index = 0; index < neighbors.length; index += 1) {
            const nextIndex = (index + 1) % neighbors.length;
            const currentNeighbor = MEGAMINX_FACE_NORMALS[neighbors[index]];
            const nextNeighbor = MEGAMINX_FACE_NORMALS[neighbors[nextIndex]];
            solvedSlots.push(normalizeVector(sumVectors(
                scaleVector(normal, MEGAMINX_CENTER_WEIGHT),
                currentNeighbor,
                nextNeighbor,
            )));
            solvedSlots.push(normalizeVector(addVectors(
                scaleVector(normal, MEGAMINX_CENTER_WEIGHT),
                nextNeighbor,
            )));
        }

        return {
            face,
            normal,
            neighbors,
            solvedSlots,
        };
    });
}

const MEGAMINX_FACE_METAS = Object.freeze(createMegaminxFaceMetas());

function parseMegaminxMoveToken(token) {
    const normalized = String(token ?? '')
        .trim()
        .replace(/[`´‘’′]/g, "'");

    if (!normalized) return null;

    const sliceMatch = normalized.match(/^([RD])(\+\+|--)$/i);
    if (sliceMatch) {
        return {
            kind: sliceMatch[1].toUpperCase(),
            turns: sliceMatch[2] === '++' ? 2 : -2,
        };
    }

    const upperMatch = normalized.match(/^U([2']?)$/i);
    if (!upperMatch) return null;

    const [, modifier] = upperMatch;

    return {
        kind: 'U',
        turns: modifier === '2'
            ? 2
            : modifier === "'"
                ? -1
                : 1,
    };
}

function createSolvedMegaminxState() {
    const stickers = [];

    MEGAMINX_FACE_METAS.forEach((face) => {
        face.solvedSlots.forEach((position) => {
            stickers.push({
                color: face.face,
                position: [...position],
                normal: [...face.normal],
            });
        });
    });

    return stickers;
}

function resolveMegaminxFaceIndex(normal) {
    let bestFaceIndex = 0;
    let bestDot = -Infinity;

    MEGAMINX_FACE_METAS.forEach((face) => {
        const similarity = dot(normal, face.normal);
        if (similarity > bestDot) {
            bestDot = similarity;
            bestFaceIndex = face.face;
        }
    });

    return bestFaceIndex;
}

function applyMegaminxMove(stickers, move) {
    if (!move || move.turns === 0) return;

    let axis = MEGAMINX_FACE_NORMALS[MEGAMINX_U_FACE];
    let shouldRotate = (sticker) => dot(sticker.position, axis) > MEGAMINX_LAYER_THRESHOLD;

    if (move.kind === 'D') {
        axis = MEGAMINX_FACE_NORMALS[MEGAMINX_D_FACE];
        shouldRotate = (sticker) => dot(sticker.position, MEGAMINX_FACE_NORMALS[MEGAMINX_U_FACE]) < MEGAMINX_LAYER_THRESHOLD;
    } else if (move.kind === 'R') {
        axis = MEGAMINX_FACE_NORMALS[MEGAMINX_RIGHT_AXIS_FACE];
        shouldRotate = (sticker) => dot(sticker.position, MEGAMINX_FACE_NORMALS[MEGAMINX_LEFT_FACE]) < MEGAMINX_LAYER_THRESHOLD;
    }

    const angle = move.turns * MEGAMINX_FIFTH_TURN_RAD;

    stickers.forEach((sticker) => {
        if (!shouldRotate(sticker)) return;
        sticker.position = rotateVectorAroundAxis(sticker.position, axis, angle);
        sticker.normal = rotateVectorAroundAxis(sticker.normal, axis, angle);
    });
}

function materializeMegaminxFaces(stickers) {
    const faces = MEGAMINX_FACE_METAS.map((face) => new Array(MEGAMINX_FACE_SIZE).fill(face.face));
    const occupiedSlots = MEGAMINX_FACE_METAS.map(() => new Set());

    stickers.forEach((sticker) => {
        const faceIndex = resolveMegaminxFaceIndex(sticker.normal);
        const face = MEGAMINX_FACE_METAS[faceIndex];
        const slotCandidates = face.solvedSlots
            .map((slot, index) => ({ index, distance: distanceSquared(sticker.position, slot) }))
            .sort((a, b) => a.distance - b.distance);
        const nextSlot = slotCandidates.find(({ index }) => !occupiedSlots[faceIndex].has(index)) ?? slotCandidates[0];

        occupiedSlots[faceIndex].add(nextSlot.index);
        faces[faceIndex][nextSlot.index] = sticker.color;
    });

    return faces;
}

export function applyMegaminxScramble(scramble) {
    const stickers = createSolvedMegaminxState();

    if (scramble) {
        String(scramble)
            .trim()
            .split(/\s+/)
            .forEach((token) => {
                const parsedMove = parseMegaminxMoveToken(token);
                applyMegaminxMove(stickers, parsedMove);
            });
    }

    return materializeMegaminxFaces(stickers);
}

function createSolvedSquare1State() {
    return {
        top: [...SQUARE1_SOLVED_TOP],
        bottom: [...SQUARE1_SOLVED_BOTTOM],
        mlFlipped: false,
    };
}

function rotateSquare1Slots(slots, amount) {
    const offset = positiveModulo(amount, slots.length);
    if (!offset) return [...slots];

    return [
        ...slots.slice(slots.length - offset),
        ...slots.slice(0, slots.length - offset),
    ];
}

function parseSquare1Scramble(scramble) {
    const moves = [];
    const normalized = String(scramble ?? '');
    const tokenPattern = /\((-?\d+)\s*,\s*(-?\d+)\)|\//g;
    let match = tokenPattern.exec(normalized);

    while (match) {
        if (match[0] === '/') {
            moves.push({ kind: 'slice' });
        } else {
            moves.push({
                kind: 'rotation',
                topTurns: Number(match[1]),
                bottomTurns: Number(match[2]),
            });
        }

        match = tokenPattern.exec(normalized);
    }

    return moves;
}

function applySquare1Rotation(state, topTurns, bottomTurns) {
    state.top = rotateSquare1Slots(state.top, topTurns);
    state.bottom = rotateSquare1Slots(state.bottom, bottomTurns);
}

function applySquare1Slice(state) {
    for (let index = 0; index < 6; index += 1) {
        const nextTop = state.top[index];
        state.top[index] = state.bottom[index];
        state.bottom[index] = nextTop;
    }

    state.mlFlipped = !state.mlFlipped;
}

export function applySquare1Scramble(scramble) {
    const state = createSolvedSquare1State();

    parseSquare1Scramble(scramble).forEach((move) => {
        if (move.kind === 'slice') {
            applySquare1Slice(state);
            return;
        }

        applySquare1Rotation(state, move.topTurns, move.bottomTurns);
    });

    return state;
}

// ──── Skewb ────────────────────────────────────────────────────────────────────
//
// State: flat array of 30 values (6 faces × 5 stickers).
// Face order: U=0, R=1, F=2, D=3, L=4, B=5
// Per-face sticker layout (looking directly at the face):
//
//     [1]  [2]         0 = center
//       [0]            1 = top-left corner
//     [4]  [3]         2 = top-right corner
//                      3 = bottom-right corner
//                      4 = bottom-left corner
//
// Vertex-to-sticker mapping:
//   UFR: U[3], F[2], R[1]       UFL: U[4], F[1], L[2]
//   UBR: U[2], B[1], R[2]       UBL: U[1], B[2], L[1]
//   DFR: D[2], F[3], R[4]       DFL: D[1], F[4], L[3]
//   DBR: D[3], B[4], R[3]       DBL: D[4], B[3], L[4]

const SKEWB_OUTLINE_RATIO = 0.025;

// Each move is a set of 3-cycles. Cycle [a, b, c]: new[a]=old[c], new[b]=old[a], new[c]=old[b].

const SKEWB_MOVE_R = Object.freeze([ // axis = DBR
    Object.freeze([5, 25, 15]),
    Object.freeze([24, 13, 2]), Object.freeze([19, 9, 26]), Object.freeze([28, 17, 7]),
    Object.freeze([8, 29, 18]),
]);

const SKEWB_MOVE_L = Object.freeze([ // axis = DFL
    Object.freeze([10, 15, 20]),
    Object.freeze([9, 28, 4]), Object.freeze([17, 24, 11]), Object.freeze([13, 19, 22]),
    Object.freeze([23, 14, 16]),
]);

const SKEWB_MOVE_U = Object.freeze([ // axis = UBL
    Object.freeze([0, 20, 25]),
    Object.freeze([24, 26, 4]), Object.freeze([19, 7, 11]), Object.freeze([28, 2, 22]),
    Object.freeze([21, 27, 1]),
]);

const SKEWB_MOVE_B = Object.freeze([ // axis = DBL
    Object.freeze([15, 25, 20]),
    Object.freeze([14, 8, 1]), Object.freeze([23, 18, 27]), Object.freeze([16, 29, 21]),
    Object.freeze([28, 24, 19]),
]);

const SKEWB_MOVES = Object.freeze({
    R: SKEWB_MOVE_R,
    L: SKEWB_MOVE_L,
    U: SKEWB_MOVE_U,
    B: SKEWB_MOVE_B,
});

function createSolvedSkewbState() {
    const state = new Array(30);
    for (let face = 0; face < 6; face += 1) {
        for (let sticker = 0; sticker < 5; sticker += 1) {
            state[(face * 5) + sticker] = face;
        }
    }
    return state;
}

function applySkewbCycles(state, cycles) {
    for (let cycleIdx = 0; cycleIdx < cycles.length; cycleIdx += 1) {
        const cycle = cycles[cycleIdx];
        const last = state[cycle[cycle.length - 1]];
        for (let i = cycle.length - 1; i > 0; i -= 1) {
            state[cycle[i]] = state[cycle[i - 1]];
        }
        state[cycle[0]] = last;
    }
}

function parseSkewbMoveToken(token) {
    const normalized = String(token ?? '')
        .trim()
        .replace(/[`´''′]/g, "'");

    if (!normalized) return null;

    const match = normalized.match(/^([RULB])([']?)$/i);
    if (!match) return null;

    const [, base, modifier] = match;

    return {
        face: base.toUpperCase(),
        inverse: modifier === "'",
    };
}

function skewbStateToFaces(state) {
    const faces = [];
    for (let face = 0; face < 6; face += 1) {
        faces.push(state.slice(face * 5, (face * 5) + 5));
    }
    return faces;
}

export function applySkewbScramble(scramble) {
    const state = createSolvedSkewbState();

    if (scramble) {
        String(scramble)
            .trim()
            .split(/\s+/)
            .forEach((token) => {
                const parsed = parseSkewbMoveToken(token);
                if (!parsed) return;

                const cycles = SKEWB_MOVES[parsed.face];
                if (!cycles) return;

                if (parsed.inverse) {
                    // Inverse = apply twice (120° × 2 = -120°)
                    applySkewbCycles(state, cycles);
                    applySkewbCycles(state, cycles);
                } else {
                    applySkewbCycles(state, cycles);
                }
            });
    }

    return skewbStateToFaces(state);
}

// ──── Skewb isometric renderer ────

const SKEWB_ISO_ANGLE = Math.PI / 6;

function drawSkewbRhombus(ctx, points, color, outlineWidth, outlineColor) {
    ctx.fillStyle = color;
    tracePolygon(ctx, points);
    ctx.fill();

    ctx.strokeStyle = outlineColor;
    ctx.lineWidth = outlineWidth;
    ctx.stroke();
}

function drawSkewbFace(ctx, face, faceVertices, centerVertex, outlineWidth, theme) {
    if (!Array.isArray(face) || face.length < 5) return;

    const [tl, tr, br, bl] = faceVertices;
    const midTop = [(tl[0] + tr[0]) / 2, (tl[1] + tr[1]) / 2];
    const midRight = [(tr[0] + br[0]) / 2, (tr[1] + br[1]) / 2];
    const midBottom = [(br[0] + bl[0]) / 2, (br[1] + bl[1]) / 2];
    const midLeft = [(bl[0] + tl[0]) / 2, (bl[1] + tl[1]) / 2];

    drawSkewbRhombus(ctx, [tl, midTop, centerVertex, midLeft],
        theme.colors[face[1]] || theme.colors[0], outlineWidth, theme.outline);
    drawSkewbRhombus(ctx, [tr, midRight, centerVertex, midTop],
        theme.colors[face[2]] || theme.colors[0], outlineWidth, theme.outline);
    drawSkewbRhombus(ctx, [br, midBottom, centerVertex, midRight],
        theme.colors[face[3]] || theme.colors[0], outlineWidth, theme.outline);
    drawSkewbRhombus(ctx, [bl, midLeft, centerVertex, midBottom],
        theme.colors[face[4]] || theme.colors[0], outlineWidth, theme.outline);
    drawSkewbRhombus(ctx, [midTop, midRight, midBottom, midLeft],
        theme.colors[face[0]] || theme.colors[0], outlineWidth, theme.outline);
}

export function drawSkewb(canvas, skewb) {
    const ctx = canvas.getContext('2d');
    const { width: w, height: h } = getCanvasLogicalSize(canvas);
    const theme = getSkewbPreviewTheme();

    ctx.clearRect(0, 0, w, h);

    if (!Array.isArray(skewb) || skewb.length < 6) return;

    const margin = Math.max(4, Math.min(w, h) * 0.04);
    const cos30 = Math.cos(SKEWB_ISO_ANGLE);
    const sin30 = Math.sin(SKEWB_ISO_ANGLE);

    const isoWidth = 4 * cos30;
    const isoHeight = 2 + (2 * sin30);
    const scale = Math.max(0, Math.min(
        (w - (margin * 2)) / isoWidth,
        (h - (margin * 2)) / isoHeight,
    ));

    const cx = w / 2;
    const cy = (h / 2) - (0.5 * scale);

    const top = [cx, cy - scale];
    const topLeft = [cx - (cos30 * scale), cy - (sin30 * scale)];
    const topRight = [cx + (cos30 * scale), cy - (sin30 * scale)];
    const center = [cx, cy];
    const botLeft = [cx - (cos30 * scale), cy + (sin30 * scale)];
    const botRight = [cx + (cos30 * scale), cy + (sin30 * scale)];
    const bottom = [cx, cy + scale];

    const lFaceTopLeft = [topLeft[0] - (cos30 * scale), topLeft[1] - (sin30 * scale)];
    const lFaceBotLeft = [botLeft[0] - (cos30 * scale), botLeft[1] - (sin30 * scale)];
    const bFaceTopRight = [topRight[0] + (cos30 * scale), topRight[1] - (sin30 * scale)];
    const bFaceBotRight = [botRight[0] + (cos30 * scale), botRight[1] - (sin30 * scale)];
    const dFaceBotLeft = [botLeft[0], botLeft[1] + scale];
    const dFaceBottom = [bottom[0], bottom[1] + scale];

    const outlineWidth = scale * SKEWB_OUTLINE_RATIO;

    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    const lFaceVerts = [lFaceTopLeft, topLeft, botLeft, lFaceBotLeft];
    drawSkewbFace(ctx, skewb[4], lFaceVerts, averagePoints(lFaceVerts), outlineWidth, theme);

    const bFaceVerts = [topRight, bFaceTopRight, bFaceBotRight, botRight];
    drawSkewbFace(ctx, skewb[5], bFaceVerts, averagePoints(bFaceVerts), outlineWidth, theme);

    const dFaceVerts = [botLeft, bottom, dFaceBottom, dFaceBotLeft];
    drawSkewbFace(ctx, skewb[3], dFaceVerts, averagePoints(dFaceVerts), outlineWidth, theme);

    const uFaceVerts = [top, topRight, center, topLeft];
    drawSkewbFace(ctx, skewb[0], uFaceVerts, averagePoints(uFaceVerts), outlineWidth, theme);

    const fFaceVerts = [topLeft, center, bottom, botLeft];
    drawSkewbFace(ctx, skewb[2], fFaceVerts, averagePoints(fFaceVerts), outlineWidth, theme);

    const rFaceVerts = [center, topRight, botRight, bottom];
    drawSkewbFace(ctx, skewb[1], rFaceVerts, averagePoints(rFaceVerts), outlineWidth, theme);

    ctx.restore();
}

export function drawCube(canvas, cube) {
    const ctx = canvas.getContext('2d');
    const { width: w, height: h } = getCanvasLogicalSize(canvas);
    const cubeSize = getFaceSize(cube?.[0]);
    const theme = getCubePreviewTheme();

    const faceGap = Math.max(2, Math.min(w, h) * 0.02);
    const availW = w - (faceGap * 3);
    const availH = h - (faceGap * 2);
    const cellSize = Math.min(availW / (cubeSize * 4), availH / (cubeSize * 3));
    const faceSize = cellSize * cubeSize;
    const stickerGap = cellSize * STICKER_GAP_TO_CELL_RATIO;

    const totalW = (faceSize * 4) + (faceGap * 3);
    const totalH = (faceSize * 3) + (faceGap * 2);
    const offsetX = (w - totalW) / 2;
    const offsetY = (h - totalH) / 2;

    ctx.clearRect(0, 0, w, h);

    for (let face = 0; face < 6; face += 1) {
        const [fc, fr] = FACE_POSITIONS[face];
        const fx = offsetX + (fc * (faceSize + faceGap));
        const fy = offsetY + (fr * (faceSize + faceGap));

        for (let row = 0; row < cubeSize; row += 1) {
            for (let col = 0; col < cubeSize; col += 1) {
                const x = fx + (col * cellSize) + stickerGap;
                const y = fy + (row * cellSize) + stickerGap;
                const sizePx = cellSize - (stickerGap * 2);
                const sticker = cube[face][(row * cubeSize) + col];

                ctx.fillStyle = theme.colors[sticker] || theme.colors[0];
                ctx.beginPath();
                const radius = Math.max(0.6, sizePx * 0.08);
                ctx.moveTo(x + radius, y);
                ctx.arcTo(x + sizePx, y, x + sizePx, y + sizePx, radius);
                ctx.arcTo(x + sizePx, y + sizePx, x, y + sizePx, radius);
                ctx.arcTo(x, y + sizePx, x, y, radius);
                ctx.arcTo(x, y, x + sizePx, y, radius);
                ctx.closePath();
                ctx.fill();

                ctx.strokeStyle = theme.outline;
                ctx.lineWidth = Math.max(0.45, Math.min(1, cellSize * 0.06));
                ctx.stroke();
            }
        }
    }
}

function tracePolygon(ctx, points) {
    if (!Array.isArray(points) || points.length === 0) return;

    ctx.beginPath();
    ctx.moveTo(points[0][0], points[0][1]);

    for (let index = 1; index < points.length; index += 1) {
        ctx.lineTo(points[index][0], points[index][1]);
    }

    ctx.closePath();
}

function createInsetTriangle(points, insetDistance) {
    const centroid = averagePoints(points);
    const sideLength = distance2D(points[0], points[1]);
    const inradius = (sideLength * Math.sqrt(3)) / 6;
    const scale = inradius > 0 ? Math.max(0, 1 - (insetDistance / inradius)) : 1;

    return points.map((point) => [
        centroid[0] + ((point[0] - centroid[0]) * scale),
        centroid[1] + ((point[1] - centroid[1]) * scale),
    ]);
}

function createInsetPolygon(points, insetDistance) {
    const centroid = averagePoints(points);
    const maxDistance = Math.max(
        ...points.map((point) => distance2D(point, centroid)),
        0,
    );
    const scale = maxDistance > 0 ? Math.max(0, 1 - (insetDistance / maxDistance)) : 1;

    return points.map((point) => [
        centroid[0] + ((point[0] - centroid[0]) * scale),
        centroid[1] + ((point[1] - centroid[1]) * scale),
    ]);
}

function createRegularPentagonVertices(centerX, centerY, radius, rotation = 0) {
    return Array.from({ length: 5 }, (_, index) => {
        const angle = rotation + (index * ((2 * Math.PI) / 5));
        return [
            centerX + (Math.cos(angle) * radius),
            centerY + (Math.sin(angle) * radius),
        ];
    });
}

function reflectPointAcrossLine2D(point, lineStart, lineEnd) {
    const [px, py] = point;
    const [ax, ay] = lineStart;
    const [bx, by] = lineEnd;
    const dx = bx - ax;
    const dy = by - ay;
    const lengthSquared = (dx * dx) + (dy * dy);
    if (lengthSquared === 0) return [px, py];

    const factor = (((px - ax) * dx) + ((py - ay) * dy)) / lengthSquared;
    const projection = [
        ax + (factor * dx),
        ay + (factor * dy),
    ];

    return [
        (projection[0] * 2) - px,
        (projection[1] * 2) - py,
    ];
}

function reflectPolygon2D(points, edgeIndex) {
    const edgeStart = points[edgeIndex];
    const edgeEnd = points[(edgeIndex + 1) % points.length];
    return points.map((point) => reflectPointAcrossLine2D(point, edgeStart, edgeEnd));
}

function getPolygonBounds(polygons) {
    const allPoints = polygons.flat();
    const xs = allPoints.map(([x]) => x);
    const ys = allPoints.map(([, y]) => y);

    return {
        minX: Math.min(...xs),
        maxX: Math.max(...xs),
        minY: Math.min(...ys),
        maxY: Math.max(...ys),
    };
}

function getSignedPolygonArea(points) {
    let area = 0;

    for (let index = 0; index < points.length; index += 1) {
        const current = points[index];
        const next = points[(index + 1) % points.length];
        area += (current[0] * next[1]) - (next[0] * current[1]);
    }

    return area / 2;
}

function scaleAndTranslatePolygon(points, scale, offsetX, offsetY) {
    return points.map(([x, y]) => [
        offsetX + (x * scale),
        offsetY + (y * scale),
    ]);
}

function scalePolygonAroundCentroid(points, scaleFactor = 1) {
    const centroid = averagePoints(points);

    return points.map(([x, y]) => [
        centroid[0] + ((x - centroid[0]) * scaleFactor),
        centroid[1] + ((y - centroid[1]) * scaleFactor),
    ]);
}

function interpolatePoint2D(a, b, ratio) {
    return [
        a[0] + ((b[0] - a[0]) * ratio),
        a[1] + ((b[1] - a[1]) * ratio),
    ];
}

function getMegaminxEdgeSlotIndex(neighborIndex) {
    return neighborIndex === 0 ? 10 : neighborIndex * 2;
}

function getMegaminxCornerSlotIndex(neighborIndex) {
    return neighborIndex === 0 ? 9 : (neighborIndex * 2) - 1;
}

function findMegaminxEdgeNeighborStartForStep(faceId, anchorFaceId, anchorEdge = 0, edgeNeighborStep = 1) {
    const anchorNeighborIndex = MEGAMINX_FACE_NEIGHBORS[faceId].indexOf(anchorFaceId);
    return edgeNeighborStep >= 0
        ? positiveModulo(anchorNeighborIndex - anchorEdge, 5)
        : positiveModulo(anchorNeighborIndex + anchorEdge, 5);
}

function getPyraminxScreenTriangleVertices(x, y, sideLength, triangleHeight, orientation = 'down') {
    if (orientation === 'up') {
        return [
            [x, y + triangleHeight],
            [x + sideLength, y + triangleHeight],
            [x + (sideLength / 2), y],
        ];
    }

    return [
        [x, y],
        [x + sideLength, y],
        [x + (sideLength / 2), y + triangleHeight],
    ];
}

function drawPyraminxFace(ctx, face, vertices, sideLength, theme) {
    const smallSide = sideLength / PYRAMINX_FACE_SIZE;
    const stickerGap = smallSide * STICKER_GAP_TO_CELL_RATIO * 1/2;
    const outlineWidth = Math.max(0.45, Math.min(1, smallSide * 0.06));
    const [a, b, c] = vertices;

    PYRAMINX_TRIANGLE_DEFINITIONS.forEach((triangle, index) => {
        const stickerPoints = createInsetTriangle(
            triangle.map(([u, v]) => interpolateTrianglePoint(a, b, c, u, v)),
            stickerGap,
        );
        const stickerColor = face[index];

        ctx.fillStyle = theme.colors[stickerColor] || theme.colors[0];
        tracePolygon(ctx, stickerPoints);
        ctx.fill();

        ctx.strokeStyle = theme.outline;
        ctx.lineWidth = outlineWidth;
        ctx.stroke();
    });
}

export function drawPyraminx(canvas, pyraminx) {
    const ctx = canvas.getContext('2d');
    const { width: w, height: h } = getCanvasLogicalSize(canvas);
    const theme = getPyraminxPreviewTheme();

    ctx.clearRect(0, 0, w, h);

    if (!Array.isArray(pyraminx) || pyraminx.length === 0) {
        return;
    }

    const margin = Math.max(10, Math.min(w, h) * 0.06);
    const maxWidthUnits = 1 + (PYRAMINX_FACE_HORIZONTAL_STEP_RATIO * 2);
    const maxHeightUnits = (PYRAMINX_TRIANGLE_HEIGHT_RATIO * 2) + PYRAMINX_FACE_VERTICAL_GAP_RATIO;
    const sideLength = Math.max(0, Math.min(
        (w - (margin * 2)) / maxWidthUnits,
        (h - (margin * 2)) / maxHeightUnits,
    ));
    const triangleHeight = sideLength * PYRAMINX_TRIANGLE_HEIGHT_RATIO;
    const verticalGap = sideLength * PYRAMINX_FACE_VERTICAL_GAP_RATIO;
    const offsetX = (w - (sideLength * maxWidthUnits)) / 2;
    const offsetY = (h - ((triangleHeight * 2) + verticalGap)) / 2;
    const faceOrigins = [
        [offsetX, offsetY],
        [offsetX + (sideLength * PYRAMINX_FACE_HORIZONTAL_STEP_RATIO), offsetY],
        [offsetX + (sideLength * PYRAMINX_FACE_HORIZONTAL_STEP_RATIO * 2), offsetY],
        [offsetX + (sideLength * PYRAMINX_FACE_HORIZONTAL_STEP_RATIO), offsetY + triangleHeight + verticalGap],
    ];

    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    faceOrigins.forEach(([x, y], faceIndex) => {
        const config = PYRAMINX_FACE_DRAW_CONFIGS[faceIndex] || PYRAMINX_FACE_DRAW_CONFIGS[3];
        const baseVertices = getPyraminxScreenTriangleVertices(
            x,
            y,
            sideLength,
            triangleHeight,
            config.orientation,
        );
        const faceVertices = config.vertexOrder.map((vertexIndex) => baseVertices[vertexIndex]);

        drawPyraminxFace(
            ctx,
            pyraminx[faceIndex] || [],
            faceVertices,
            sideLength,
            theme,
        );
    });

    ctx.restore();
}

function getMegaminxStarOffset(leftCenterPolygon, rightCenterPolygon) {
    // Align the seam so the center-facing pentagons share a full edge instead of only touching at a point.
    const leftInnerFace = reflectPolygon2D(leftCenterPolygon, 0);
    const rightInnerFace = reflectPolygon2D(rightCenterPolygon, 2);
    const leftEdgeStart = leftInnerFace[3];
    const rightEdgeEnd = rightInnerFace[1];

    return [
        leftEdgeStart[0] - rightEdgeEnd[0],
        leftEdgeStart[1] - rightEdgeEnd[1],
    ];
}

function createMegaminxLayoutTemplate() {
    const layouts = [];
    const leftCenterPolygon = createRegularPentagonVertices(0, 0, 1, MEGAMINX_U_STAR_ROTATION);
    const rightCenterBasePolygon = createRegularPentagonVertices(0, 0, 1, MEGAMINX_D_STAR_ROTATION);
    const [rightCenterOffsetX, rightCenterOffsetY] = getMegaminxStarOffset(
        leftCenterPolygon,
        rightCenterBasePolygon,
    );
    const rightCenterPolygon = rightCenterBasePolygon.map(([x, y]) => [
        x + rightCenterOffsetX,
        y + rightCenterOffsetY,
    ]);
    const referenceOrientationSign = Math.sign(getSignedPolygonArea(leftCenterPolygon)) || 1;
    const getEdgeNeighborStep = (polygon) => (
        (Math.sign(getSignedPolygonArea(polygon)) || referenceOrientationSign) === referenceOrientationSign ? 1 : -1
    );
    const leftCenterStep = getEdgeNeighborStep(leftCenterPolygon);
    const rightCenterStep = getEdgeNeighborStep(rightCenterPolygon);

    layouts.push({
        faceId: MEGAMINX_U_FACE,
        polygon: leftCenterPolygon,
        edgeNeighborStart: findMegaminxEdgeNeighborStartForStep(
            MEGAMINX_U_FACE,
            MEGAMINX_U_STAR_EDGE_TO_FACE[0],
            0,
            leftCenterStep,
        ),
        edgeNeighborStep: leftCenterStep,
        label: 'U',
    });
    MEGAMINX_U_STAR_EDGE_TO_FACE.forEach((faceId, edgeIndex) => {
        const polygon = reflectPolygon2D(leftCenterPolygon, edgeIndex);
        const edgeNeighborStep = getEdgeNeighborStep(polygon);
        layouts.push({
            faceId,
            polygon,
            edgeNeighborStart: findMegaminxEdgeNeighborStartForStep(
                faceId,
                MEGAMINX_U_FACE,
                edgeIndex,
                edgeNeighborStep,
            ),
            edgeNeighborStep,
            label: faceId === MEGAMINX_FRONT_FACE ? 'F' : '',
        });
    });

    layouts.push({
        faceId: MEGAMINX_D_FACE,
        polygon: rightCenterPolygon,
        edgeNeighborStart: findMegaminxEdgeNeighborStartForStep(
            MEGAMINX_D_FACE,
            MEGAMINX_D_STAR_EDGE_TO_FACE[0],
            0,
            rightCenterStep,
        ),
        edgeNeighborStep: rightCenterStep,
        label: '',
    });
    MEGAMINX_D_STAR_EDGE_TO_FACE.forEach((faceId, edgeIndex) => {
        const polygon = reflectPolygon2D(rightCenterPolygon, edgeIndex);
        const edgeNeighborStep = getEdgeNeighborStep(polygon);
        layouts.push({
            faceId,
            polygon,
            edgeNeighborStart: findMegaminxEdgeNeighborStartForStep(
                faceId,
                MEGAMINX_D_FACE,
                edgeIndex,
                edgeNeighborStep,
            ),
            edgeNeighborStep,
            label: '',
        });
    });

    const spacedLayouts = layouts.map((layout) => ({
        ...layout,
        polygon: scalePolygonAroundCentroid(layout.polygon, MEGAMINX_FACE_LAYOUT_SCALE),
    }));

    return {
        faces: spacedLayouts,
        bounds: getPolygonBounds(spacedLayouts.map(({ polygon }) => polygon)),
    };
}

const MEGAMINX_LAYOUT_TEMPLATE = createMegaminxLayoutTemplate();
const MEGAMINX_PREVIEW_FACE_EDGE_NEIGHBOR_START = MEGAMINX_LAYOUT_TEMPLATE.faces.find(
    ({ faceId }) => faceId === MEGAMINX_U_FACE,
)?.edgeNeighborStart ?? 0;

function drawMegaminxSticker(ctx, polygon, color, insetDistance, outlineWidth, outlineColor) {
    const insetPolygon = createInsetPolygon(polygon, insetDistance);
    ctx.fillStyle = color;
    tracePolygon(ctx, insetPolygon);
    ctx.fill();

    ctx.strokeStyle = outlineColor;
    ctx.lineWidth = outlineWidth;
    ctx.stroke();
}

function drawMegaminxFace(ctx, face, polygon, edgeNeighborStart = 0, edgeNeighborStep = 1, theme) {
    const centroid = averagePoints(polygon);
    const innerPolygon = polygon.map(([x, y]) => [
        centroid[0] + ((x - centroid[0]) * MEGAMINX_INNER_PENTAGON_SCALE),
        centroid[1] + ((y - centroid[1]) * MEGAMINX_INNER_PENTAGON_SCALE),
    ]);
    const edgeCutsNearStart = polygon.map((point, edgeIndex) => (
        interpolatePoint2D(point, polygon[(edgeIndex + 1) % 5], MEGAMINX_EDGE_SPLIT_RATIO)
    ));
    const edgeCutsNearEnd = polygon.map((point, edgeIndex) => (
        interpolatePoint2D(point, polygon[(edgeIndex + 1) % 5], 1 - MEGAMINX_EDGE_SPLIT_RATIO)
    ));
    const sideLength = distance2D(polygon[0], polygon[1]);
    const insetDistance = Math.max(MEGAMINX_STICKER_INSET_MIN, sideLength * MEGAMINX_STICKER_INSET_RATIO);
    const outlineWidth = Math.max(0.55, Math.min(1.25, sideLength * 0.03));

    for (let edgeIndex = 0; edgeIndex < 5; edgeIndex += 1) {
        const neighborIndex = positiveModulo(edgeNeighborStart + (edgeNeighborStep * edgeIndex), 5);
        const cornerNeighborIndex = edgeNeighborStep >= 0
            ? neighborIndex
            : positiveModulo(neighborIndex + 1, 5);
        const cornerSlot = getMegaminxCornerSlotIndex(cornerNeighborIndex);
        const edgeSlot = getMegaminxEdgeSlotIndex(neighborIndex);
        const nextIndex = (edgeIndex + 1) % 5;
        const previousIndex = positiveModulo(edgeIndex - 1, 5);
        const cornerColor = theme.colors[face?.[cornerSlot]] || theme.colors[0];
        const edgeColor = theme.colors[face?.[edgeSlot]] || theme.colors[0];

        drawMegaminxSticker(
            ctx,
            [
                edgeCutsNearEnd[previousIndex],
                polygon[edgeIndex],
                edgeCutsNearStart[edgeIndex],
                innerPolygon[edgeIndex],
            ],
            cornerColor,
            insetDistance,
            outlineWidth,
            theme.outline,
        );
        drawMegaminxSticker(
            ctx,
            [
                edgeCutsNearStart[edgeIndex],
                edgeCutsNearEnd[edgeIndex],
                innerPolygon[nextIndex],
                innerPolygon[edgeIndex],
            ],
            edgeColor,
            insetDistance,
            outlineWidth,
            theme.outline,
        );
    }

    drawMegaminxSticker(
        ctx,
        innerPolygon,
        theme.colors[face?.[0]] || theme.colors[0],
        insetDistance * 0.72,
        outlineWidth,
        theme.outline,
    );
}

function drawMegaminxFaceLabel(ctx, polygon, label) {
    if (!label) return;

    const centroid = averagePoints(polygon);
    const sideLength = distance2D(polygon[0], polygon[1]);
    const fontSize = Math.max(13, Math.min(34, sideLength * 0.36));

    ctx.font = `700 ${fontSize}px Inter, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = Math.max(1.4, fontSize * 0.14);
    ctx.strokeStyle = MEGAMINX_LABEL_STYLE.stroke;
    ctx.fillStyle = MEGAMINX_LABEL_STYLE.fill;
    ctx.strokeText(label, centroid[0], centroid[1] + (fontSize * 0.02));
    ctx.fillText(label, centroid[0], centroid[1] + (fontSize * 0.02));
}

function drawMegaminxLayout(ctx, megaminx, layoutFaces, scale, offsetX, offsetY, theme, { showLabels = true } = {}) {
    layoutFaces.forEach(({ faceId, polygon, edgeNeighborStart, edgeNeighborStep = 1 }) => {
        const transformedPolygon = scaleAndTranslatePolygon(polygon, scale, offsetX, offsetY);
        drawMegaminxFace(
            ctx,
            megaminx?.[faceId] || [],
            transformedPolygon,
            edgeNeighborStart,
            edgeNeighborStep,
            theme,
        );
    });

    if (!showLabels) return;

    layoutFaces.forEach(({ polygon, label }) => {
        if (!label) return;
        const transformedPolygon = scaleAndTranslatePolygon(polygon, scale, offsetX, offsetY);
        drawMegaminxFaceLabel(ctx, transformedPolygon, label);
    });
}

export function drawMegaminx(canvas, megaminx) {
    const ctx = canvas.getContext('2d');
    const { width: w, height: h } = getCanvasLogicalSize(canvas);
    const theme = getMegaminxPreviewTheme();

    ctx.clearRect(0, 0, w, h);

    if (!Array.isArray(megaminx) || megaminx.length === 0) {
        return;
    }

    const margin = Math.max(4, Math.min(w, h) * 0.02);
    const templateWidth = MEGAMINX_LAYOUT_TEMPLATE.bounds.maxX - MEGAMINX_LAYOUT_TEMPLATE.bounds.minX;
    const templateHeight = MEGAMINX_LAYOUT_TEMPLATE.bounds.maxY - MEGAMINX_LAYOUT_TEMPLATE.bounds.minY;
    const scale = Math.max(0, Math.min(
        (w - (margin * 2)) / templateWidth,
        (h - (margin * 2)) / templateHeight,
    ));
    const offsetX = ((w - (templateWidth * scale)) / 2) - (MEGAMINX_LAYOUT_TEMPLATE.bounds.minX * scale);
    const offsetY = ((h - (templateHeight * scale)) / 2) - (MEGAMINX_LAYOUT_TEMPLATE.bounds.minY * scale);

    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    drawMegaminxLayout(
        ctx,
        megaminx,
        MEGAMINX_LAYOUT_TEMPLATE.faces,
        scale,
        offsetX,
        offsetY,
        theme,
        { showLabels: true },
    );
    ctx.restore();
}

export function drawMegaminxFacePreview(canvas, face, { label = '' } = {}) {
    const ctx = canvas.getContext('2d');
    const { width: w, height: h } = getCanvasLogicalSize(canvas);
    const theme = getMegaminxPreviewTheme();
    const margin = Math.max(1.4, Math.min(w, h) * 0.08);
    const radius = Math.max(0, Math.min(w, h) - (margin * 2)) / 2;
    const polygon = createRegularPentagonVertices(w / 2, h / 2, radius, MEGAMINX_U_STAR_ROTATION);

    ctx.clearRect(0, 0, w, h);
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    drawMegaminxFace(ctx, face, polygon, MEGAMINX_PREVIEW_FACE_EDGE_NEIGHBOR_START, 1, theme);
    if (label) drawMegaminxFaceLabel(ctx, polygon, label);
    ctx.restore();
}

function isSquare1State(square1) {
    return Boolean(square1)
        && Array.isArray(square1.top)
        && square1.top.length === 12
        && Array.isArray(square1.bottom)
        && square1.bottom.length === 12;
}

function getSquare1PieceBasePolygons(piece) {
    return piece?.type === 'corner'
        ? SQUARE1_CORNER_BASE_POLYGONS
        : SQUARE1_EDGE_BASE_POLYGONS;
}

function getSquare1PieceRotationRad(piece, angleDeg) {
    const nativeLeadingEdge = piece?.type === 'corner' ? 75 : 15;
    return ((angleDeg - nativeLeadingEdge) * Math.PI) / 180;
}

function rotatePoint2DAboutOrigin(point, angleRad) {
    const [x, y] = point;
    const cos = Math.cos(angleRad);
    const sin = Math.sin(angleRad);

    return [
        (x * cos) - (y * sin),
        (x * sin) + (y * cos),
    ];
}

function transformSquare1Polygon(points, angleRad, offsetX = 0, offsetY = 0) {
    return points.map((point) => {
        const [x, y] = rotatePoint2DAboutOrigin(point, angleRad);
        return [x + offsetX, y + offsetY];
    });
}

function getSquare1FacePolygons(slots, startAngleDeg, centerX = 0, centerY = 0) {
    const polygons = [];
    if (!Array.isArray(slots) || slots.length !== 12) return polygons;

    for (let index = 0; index < 12; index += 1) {
        const pieceId = slots[index];
        if (slots[positiveModulo(index - 1, 12)] === pieceId) continue;

        const piece = SQUARE1_PIECE_LAYOUTS[pieceId];
        if (!piece) continue;

        const angleDeg = startAngleDeg - (index * 30);
        const angleRad = getSquare1PieceRotationRad(piece, angleDeg);
        getSquare1PieceBasePolygons(piece).forEach((polygon) => {
            polygons.push(transformSquare1Polygon(polygon, angleRad, centerX, centerY));
        });
    }

    return polygons;
}

function createRectanglePolygon(x, y, width, height) {
    return [
        [x, y],
        [x + width, y],
        [x + width, y + height],
        [x, y + height],
    ];
}

function getSquare1MiddleLayerPolygons(mlFlipped, centerX = 0, centerY = 0) {
    const leftRatio = SQUARE1_MIDDLE_LAYER_LEFT_RATIO;
    const leftWidth = SQUARE1_MIDDLE_LAYER_WIDTH * leftRatio;
    const rightWidth = mlFlipped
        ? leftWidth
        : (SQUARE1_MIDDLE_LAYER_WIDTH - leftWidth);
    const startX = centerX - (SQUARE1_MIDDLE_LAYER_WIDTH / 2);
    const startY = centerY + SQUARE1_MIDDLE_LAYER_Y_OFFSET - (SQUARE1_MIDDLE_LAYER_HEIGHT / 2);

    return [
        createRectanglePolygon(startX, startY, leftWidth, SQUARE1_MIDDLE_LAYER_HEIGHT),
        createRectanglePolygon(startX + leftWidth, startY, rightWidth, SQUARE1_MIDDLE_LAYER_HEIGHT),
    ];
}

function getSquare1ReferenceFacePolygons(startAngleDeg, centerX = 0, centerY = 0) {
    const polygons = [];
    const referencePieces = [SQUARE1_PIECE_LAYOUTS[0], SQUARE1_PIECE_LAYOUTS[1]];

    for (let index = 0; index < 12; index += 1) {
        const angleDeg = startAngleDeg - (index * 30);

        referencePieces.forEach((piece) => {
            const angleRad = getSquare1PieceRotationRad(piece, angleDeg);
            getSquare1PieceBasePolygons(piece).forEach((polygon) => {
                polygons.push(transformSquare1Polygon(polygon, angleRad, centerX, centerY));
            });
        });
    }

    return polygons;
}

function drawSquare1Piece(ctx, piece, angleDeg) {
    if (!piece) return;

    ctx.save();
    ctx.rotate(getSquare1PieceRotationRad(piece, angleDeg));

    getSquare1PieceBasePolygons(piece).forEach((polygon, index) => {
        ctx.fillStyle = piece.colors[index];
        tracePolygon(ctx, polygon);
        ctx.fill();
        ctx.stroke();
    });

    ctx.restore();
}

function drawSquare1Face(ctx, slots, startAngleDeg, pieces) {
    if (!Array.isArray(slots) || slots.length !== 12) return;

    for (let index = 0; index < 12; index += 1) {
        const pieceId = slots[index];
        if (slots[positiveModulo(index - 1, 12)] === pieceId) continue;

        const piece = pieces[pieceId];
        if (!piece) continue;

        drawSquare1Piece(ctx, piece, startAngleDeg - (index * 30));
    }
}

function drawSquare1MiddleLayer(ctx, mlFlipped, colors) {
    const leftRatio = SQUARE1_MIDDLE_LAYER_LEFT_RATIO;
    const leftWidth = SQUARE1_MIDDLE_LAYER_WIDTH * leftRatio;
    const rightWidth = mlFlipped
        ? leftWidth
        : (SQUARE1_MIDDLE_LAYER_WIDTH - leftWidth);
    const startX = -(SQUARE1_MIDDLE_LAYER_WIDTH / 2);
    const startY = SQUARE1_MIDDLE_LAYER_Y_OFFSET - (SQUARE1_MIDDLE_LAYER_HEIGHT / 2);

    ctx.fillStyle = colors.F;
    ctx.fillRect(startX, startY, leftWidth, SQUARE1_MIDDLE_LAYER_HEIGHT);
    ctx.strokeRect(startX, startY, leftWidth, SQUARE1_MIDDLE_LAYER_HEIGHT);

    ctx.fillStyle = mlFlipped ? colors.B : colors.F;
    ctx.fillRect(startX + leftWidth, startY, rightWidth, SQUARE1_MIDDLE_LAYER_HEIGHT);
    ctx.strokeRect(startX + leftWidth, startY, rightWidth, SQUARE1_MIDDLE_LAYER_HEIGHT);
}

function getSquare1LayoutCenters({ topOnly = false } = {}) {
    return {
        topFaceCenter: topOnly ? SQUARE1_SINGLE_FACE_CENTER : SQUARE1_TOP_FACE_CENTER,
        bottomFaceCenter: topOnly ? null : SQUARE1_BOTTOM_FACE_CENTER,
    };
}

function getSquare1LayoutBounds({ topOnly = false } = {}) {
    const { topFaceCenter, bottomFaceCenter } = getSquare1LayoutCenters({ topOnly });
    const polygons = [
        ...getSquare1ReferenceFacePolygons(
            SQUARE1_TOP_START_ANGLE,
            topFaceCenter[0],
            topFaceCenter[1],
        ),
        createRectanglePolygon(
            topFaceCenter[0] - (SQUARE1_MIDDLE_LAYER_WIDTH / 2),
            topFaceCenter[1] + SQUARE1_MIDDLE_LAYER_Y_OFFSET - (SQUARE1_MIDDLE_LAYER_HEIGHT / 2),
            SQUARE1_MIDDLE_LAYER_WIDTH,
            SQUARE1_MIDDLE_LAYER_HEIGHT,
        ),
        ...getSquare1MiddleLayerPolygons(false, topFaceCenter[0], topFaceCenter[1]),
        ...getSquare1MiddleLayerPolygons(true, topFaceCenter[0], topFaceCenter[1]),
    ];

    if (bottomFaceCenter) {
        polygons.push(
            ...getSquare1ReferenceFacePolygons(
                SQUARE1_BOTTOM_START_ANGLE,
                bottomFaceCenter[0],
                bottomFaceCenter[1],
            ),
        );
    }

    return getPolygonBounds(polygons);
}

export function drawSquare1(canvas, square1, { topOnly = false } = {}) {
    const ctx = canvas.getContext('2d');
    const { width: w, height: h } = getCanvasLogicalSize(canvas);
    const state = isSquare1State(square1) ? square1 : createSolvedSquare1State();
    const { topFaceCenter, bottomFaceCenter } = getSquare1LayoutCenters({ topOnly });
    const theme = getSquare1PreviewTheme();
    const pieces = createSquare1Pieces(theme.colors);

    ctx.clearRect(0, 0, w, h);

    const bounds = getSquare1LayoutBounds({ topOnly });
    const worldWidth = Math.max(0.001, bounds.maxX - bounds.minX);
    const worldHeight = Math.max(0.001, bounds.maxY - bounds.minY);
    const margin = 0;
    const availableWidth = Math.max(1, w - (margin * 2));
    const availableHeight = Math.max(1, h - (margin * 2));
    const scale = Math.min(availableWidth / worldWidth, availableHeight / worldHeight);
    const centerX = (bounds.minX + bounds.maxX) / 2;
    const centerY = (bounds.minY + bounds.maxY) / 2;

    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.scale(scale, -scale);
    ctx.translate(-centerX, -centerY);
    ctx.strokeStyle = theme.outline;
    ctx.lineWidth = SQUARE1_OUTLINE_WIDTH;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    ctx.save();
    ctx.translate(topFaceCenter[0], topFaceCenter[1]);
    drawSquare1MiddleLayer(ctx, state.mlFlipped, theme.colors);
    drawSquare1Face(ctx, state.top, SQUARE1_TOP_START_ANGLE, pieces);
    ctx.restore();

    if (bottomFaceCenter) {
        ctx.save();
        ctx.translate(bottomFaceCenter[0], bottomFaceCenter[1]);
        drawSquare1Face(ctx, state.bottom, SQUARE1_BOTTOM_START_ANGLE, pieces);
        ctx.restore();
    }

    ctx.restore();
}

let _lastDisplay = null;

function redrawLastDisplay(canvas) {
    if (!_lastDisplay) return;

    if (_lastDisplay.puzzle === 'pyraminx') {
        drawPyraminx(canvas, _lastDisplay.state);
        return;
    }

    if (_lastDisplay.puzzle === 'megaminx') {
        drawMegaminx(canvas, _lastDisplay.state);
        return;
    }

    if (_lastDisplay.puzzle === 'skewb') {
        drawSkewb(canvas, _lastDisplay.state);
        return;
    }

    if (_lastDisplay.puzzle === 'square1') {
        drawSquare1(canvas, _lastDisplay.state);
        return;
    }

    if (_lastDisplay.puzzle === 'clock') {
        drawClock(canvas, _lastDisplay.state);
        return;
    }

    drawCube(canvas, _lastDisplay.state);
}

export function clearCubeDisplay(canvas) {
    syncCanvasToDisplaySize(canvas);
    const ctx = canvas.getContext('2d');
    const { pixelRatio, width: w, height: h } = getCanvasLogicalSize(canvas);
    ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    _lastDisplay = null;
    ctx.clearRect(0, 0, w, h);
}

export function initCubeDisplay(canvas) {
    let resizeFrame = 0;
    const syncAndRedraw = () => {
        resizeFrame = 0;
        if (!syncCanvasToDisplaySize(canvas)) return;

        if (_lastDisplay) {
            redrawLastDisplay(canvas);
        } else {
            clearCubeDisplay(canvas);
        }
    };
    const scheduleSyncAndRedraw = () => {
        if (resizeFrame) return;
        resizeFrame = window.requestAnimationFrame(syncAndRedraw);
    };
    const observer = new ResizeObserver(() => {
        scheduleSyncAndRedraw();
    });

    observer.observe(canvas);
    if (canvas.parentElement) observer.observe(canvas.parentElement);
    scheduleSyncAndRedraw();
    return observer;
}

export function updateCubeDisplay(canvas, scramble, orientation = 'standard', size = 3) {
    const didSync = syncCanvasToDisplaySize(canvas);
    _lastDisplay = {
        puzzle: 'cube',
        state: applyScramble(scramble, orientation, size),
    };
    if (!didSync) return;

    const ctx = canvas.getContext('2d');
    const pixelRatio = getCanvasPixelRatio();
    ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    redrawLastDisplay(canvas);
}

export function updatePyraminxDisplay(canvas, scramble) {
    const didSync = syncCanvasToDisplaySize(canvas);
    _lastDisplay = {
        puzzle: 'pyraminx',
        state: applyPyraminxScramble(scramble),
    };
    if (!didSync) return;

    const ctx = canvas.getContext('2d');
    const pixelRatio = getCanvasPixelRatio();
    ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    redrawLastDisplay(canvas);
}

export function updateSkewbDisplay(canvas, scramble) {
    const didSync = syncCanvasToDisplaySize(canvas);
    _lastDisplay = {
        puzzle: 'skewb',
        state: applySkewbScramble(scramble),
    };
    if (!didSync) return;

    const ctx = canvas.getContext('2d');
    const pixelRatio = getCanvasPixelRatio();
    ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    redrawLastDisplay(canvas);
}

export function updateSquare1Display(canvas, scramble) {
    const didSync = syncCanvasToDisplaySize(canvas);
    _lastDisplay = {
        puzzle: 'square1',
        state: applySquare1Scramble(scramble),
    };
    if (!didSync) return;

    const ctx = canvas.getContext('2d');
    const pixelRatio = getCanvasPixelRatio();
    ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    redrawLastDisplay(canvas);
}

export function updateMegaminxDisplay(canvas, scramble) {
    const didSync = syncCanvasToDisplaySize(canvas);
    _lastDisplay = {
        puzzle: 'megaminx',
        state: applyMegaminxScramble(scramble),
    };
    if (!didSync) return;

    const ctx = canvas.getContext('2d');
    const pixelRatio = getCanvasPixelRatio();
    ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    redrawLastDisplay(canvas);
}

export function applyClockScramble(scrambleStr) {
    let front = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    let back  = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    let pins = { UL: false, UR: false, DL: false, DR: false };

    const tokens = (scrambleStr || '').trim().split(/\s+/).filter(Boolean);
    
    const mutate = (fIdxs, bIdxs, x) => {
        for (let i of fIdxs) front[i] = positiveModulo(front[i] + x, 12);
        for (let i of bIdxs) back[i] =  positiveModulo(back[i] - x, 12);
    };

    for (let token of tokens) {
        if (token === 'y2') {
            let temp = front;
            front = back;
            back = temp;
            continue;
        }

        if (['UL', 'UR', 'DL', 'DR'].includes(token) && !token.includes('+') && !token.includes('-')) {
            pins[token] = true;
            continue;
        }

        let match = token.match(/^([A-Z]+)(\d+)([\+\-])$/);
        if (!match) continue;

        const move = match[1];
        let x = parseInt(match[2], 10);
        if (match[3] === '-') x = -x;

        if (move === 'UR') mutate([1, 2, 4, 5], [0], x);
        else if (move === 'DR') mutate([4, 5, 7, 8], [6], x);
        else if (move === 'DL') mutate([3, 4, 6, 7], [8], x);
        else if (move === 'UL') mutate([0, 1, 3, 4], [2], x);
        else if (move === 'U') mutate([0, 1, 2, 3, 4, 5], [0, 2], x);
        else if (move === 'R') mutate([1, 2, 4, 5, 7, 8], [0, 6], x);
        else if (move === 'D') mutate([3, 4, 5, 6, 7, 8], [6, 8], x);
        else if (move === 'L') mutate([0, 1, 3, 4, 6, 7], [2, 8], x);
        else if (move === 'ALL') mutate([0, 1, 2, 3, 4, 5, 6, 7, 8], [0, 2, 6, 8], x);
    }

    return { front, back, pins };
}

function drawClockFace(ctx, dials, pinsState, isBackFace, theme) {
    const S = 1;
    const R_dial = 0.36;
    const R_main = S + R_dial + 0.32; 
    const R_corner = R_dial + 0.12;
    const R_pin = 0.12;
    const strokeW = 0.05;

    ctx.fillStyle = theme.body;
    ctx.beginPath();
    ctx.arc(0, 0, R_main + strokeW, 0, Math.PI*2);
    ctx.fill();
    for (let dx of [-1, 1]) {
        for (let dy of [-1, 1]) {
            ctx.beginPath();
            ctx.arc(dx*S, dy*S, R_corner + strokeW, 0, Math.PI*2);
            ctx.fill();
        }
    }

    ctx.fillStyle = isBackFace ? theme.backFace : theme.frontFace;
    ctx.beginPath();
    ctx.arc(0, 0, R_main, 0, Math.PI*2);
    ctx.fill();
    for (let dx of [-1, 1]) {
        for (let dy of [-1, 1]) {
            ctx.beginPath();
            ctx.arc(dx*S, dy*S, R_corner, 0, Math.PI*2);
            ctx.fill();
        }
    }

    for (let i = 0; i < 9; i++) {
        const col = (i % 3) - 1;
        const row = Math.floor(i / 3) - 1;
        const cx = col * S;
        const cy = row * S;

        ctx.fillStyle = theme.body;
        ctx.beginPath(); ctx.arc(cx, cy, R_dial + strokeW*0.6, 0, Math.PI*2); ctx.fill();
        
        ctx.fillStyle = isBackFace ? theme.backDial : theme.frontDial;
        ctx.beginPath(); ctx.arc(cx, cy, R_dial, 0, Math.PI*2); ctx.fill();

        const angle = dials[i] * (Math.PI / 6);
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(angle);
        
        ctx.fillStyle = theme.handFill;
        ctx.strokeStyle = theme.handStroke;
        ctx.lineWidth = strokeW * 0.4;
        ctx.lineJoin = 'round';
        
        ctx.beginPath();
        ctx.arc(0, 0, 0.06, 0, Math.PI, false);
        ctx.lineTo(0, -R_dial * 0.85);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        
        ctx.restore();
    }

    const pinPos = [
        [-0.5, -0.5], [0.5, -0.5], 
        [-0.5, 0.5],  [0.5, 0.5]
    ];
    for (let i = 0; i < 4; i++) {
        const px = pinPos[i][0] * S;
        const py = pinPos[i][1] * S;
        
        let isUp;
        if (!isBackFace) {
            if (i === 0) isUp = pinsState.UL;
            else if (i === 1) isUp = pinsState.UR;
            else if (i === 2) isUp = pinsState.DL;
            else if (i === 3) isUp = pinsState.DR;
        } else {
            if (i === 0) isUp = !pinsState.UR;
            else if (i === 1) isUp = !pinsState.UL;
            else if (i === 2) isUp = !pinsState.DR;
            else if (i === 3) isUp = !pinsState.DL;
        }

        ctx.fillStyle = theme.body;
        ctx.beginPath(); ctx.arc(px, py, R_pin + strokeW*0.6, 0, Math.PI*2); ctx.fill();
        
        ctx.fillStyle = isUp ? theme.pinUp : theme.pinDown;
        ctx.beginPath(); ctx.arc(px, py, R_pin, 0, Math.PI*2); ctx.fill();
    }
}

export function drawClock(canvas, clock, { previewOnly = false } = {}) {
    const ctx = canvas.getContext('2d');
    const { width: w, height: h } = getCanvasLogicalSize(canvas);
    const theme = getClockPreviewTheme();
    ctx.clearRect(0, 0, w, h);

    const state = clock || {
        front: [0,0,0,0,0,0,0,0,0],
        back: [0,0,0,0,0,0,0,0,0],
        pins: { UL: true, UR: true, DL: true, DR: true }
    };

    const bodyR = 1.73; // 1 + R_dial (0.36) + 0.32 + strokeW (0.05)
    const gap = 0.3;
    const totalW = previewOnly ? bodyR * 2 : bodyR * 4 + gap;
    const totalH = bodyR * 2;
    
    // Use similar margin scaling to other 2D puzzle previews
    const margin = 0;
    const availableWidth = Math.max(1, w - (margin * 2));
    const availableHeight = Math.max(1, h - (margin * 2));
    const scale = Math.min(availableWidth / totalW, availableHeight / totalH);

    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.scale(scale, scale);

    if (previewOnly) {
        drawClockFace(ctx, state.front, state.pins, false, theme);
    } else {
        const offset = bodyR + gap / 2;
        ctx.save();
        ctx.translate(-offset, 0);
        drawClockFace(ctx, state.front, state.pins, false, theme);
        ctx.restore();

        ctx.save();
        ctx.translate(offset, 0);
        drawClockFace(ctx, state.back, state.pins, true, theme);
        ctx.restore();
    }

    ctx.restore();
}

export function updateClockDisplay(canvas, scramble) {
    const didSync = syncCanvasToDisplaySize(canvas);
    _lastDisplay = {
        puzzle: 'clock',
        state: applyClockScramble(scramble),
    };
    if (!didSync) return;

    const ctx = canvas.getContext('2d');
    const pixelRatio = getCanvasPixelRatio();
    ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    redrawLastDisplay(canvas);
}
