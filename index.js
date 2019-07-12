import {Vector2} from './vector.js';
import {CircularBuffer} from './buffer.js';

var canvas = document.getElementById("canvas");
var ctx = canvas.getContext("2d");

/** Scaling of the canvas's internal resolution */
const scale = 2;
const min_dist = 7;
/** Width of the pen stroke */
var width = 10;
var color = "rgba(0.0,0.0,0.0,1.0)";
/** The buffer of points for each current touch */
var touches = {};
/** If this device has a stylus, then don't recognise normal touch inputs. */
var stylusEnabled = false;
/** Current selected tool */
var curTool = null;

var widthSvg = document.querySelector("[setting=width]").children[1];
var colorSvg = document.querySelector("[setting=color]").children[1];
var colorCircle;
var widthLine;

widthSvg.addEventListener("load", function() {
    widthLine = widthSvg.getSVGDocument().getElementById("width-line");
});
colorSvg.addEventListener("load", function() {
    colorCircle = colorSvg.getSVGDocument().getElementById("color-circle");
});
window.addEventListener("load", function() {
    try {
        widthLine = widthSvg.getSVGDocument().getElementById("width-line");
        colorCircle = colorSvg.getSVGDocument().getElementById("color-circle");
    } catch {}
});

class DrawingPoint {
    constructor(event) {
        let rect = canvas.getBoundingClientRect();
        this.x = (event.clientX - rect.left) * scale;
        this.y = (event.clientY - rect.top) * scale;
        this.origX = this.x;
        this.origY = this.y;

        if ('webkitForce' in event) {
            this.pressure = event.webkitForce;
        } else if ('pressure' in event) {
            this.pressure = event.pressure;
        } else if ('force' in event) {
            this.pressure = event.force;
        } else {
            this.pressure = 1.0;
        }
    }

    toVec() {
        return new Vector2(this.x, this.y);
    }

    toOrigVec() {
        return new Vector2(this.origX, this.origY);
    }

    copy(other) {
        this.x = other.x;
        this.y = other.y;
        this.pressure = other.pressure;
    }
}

/**
 * For-all function for the touch list interface.
 * @param f Function callback that takes as arguments the touch, the touch identifier, and the
 * index into the touch list.
 */
try {
    /* TouchList will not be defined for devices w/o touch capabilities */
    TouchList.prototype.forAll = function(f) {
        for (let i = 0; i < this.length; i++) {
            let touch = this[i];
            let id = touch.identifier;
            f(touch, id, i);
        }
    }
} catch {}

/**
 * Evaluate a cubic hermite spline at a certain time value.
 * @param t Time, scalar between 0 and 1.
 * @param pt1 {Vector2} Starting point
 * @param tan1 {Vector2} Tangent at the starting point
 * @param pt2 {Vector2} Ending point
 * @param tan2 {Vector2} Tangent at the ending point
 * @returns {Vector2} the hermite spline evaluated at the specified time.
 */
function evalHermite(t, pt1, tan1, pt2, tan2) {
    if (t <= 0) {
        return pt1;
    } else if (t >= 1) {
        return pt2;
    }

    let t3 = t * t * t;
    let t2 = t * t;
    let p0 = pt1.multiply(2 * t3 - 3 * t2 + 1);
    let m0 = tan1.multiply(t3 - 2 * t2 + t);
    let p1 = pt2.multiply(-2 * t3 + 3 * t2);
    let m1 = tan2.multiply(t3 - t2);
    return p0.add(m0).add(p1.add(m1));
}

/**
 * Draw a variable width cubic hermite spline.  The width values are linearly interpolated.
 * @param pt1 {Vector2} Starting point
 * @param tan1 {Vector2} Tangent at the starting point
 * @param w1 {number} Starting width
 * @param pt2 {Vector2} Ending point
 * @param tan2 {Vector2} Tangent at the ending point
 * @param w2 {number} Ending width
 */
function drawVariableWidthHermite(ctx, pt1, tan1, w1, pt2, tan2, w2) {
    let pts = Math.max(1, Math.ceil(Math.sqrt(pt2.subtract(pt1).length())));
    for (let i = 0; i < pts; i++) {
        let t = (i / pts);
        let tn = ((i+1) / pts);
        let tm = (t + tn) / 2;
        let st = evalHermite(t, pt1, tan1, pt2, tan2);
        let end = evalHermite(tn, pt1, tan1, pt2, tan2);
        
        ctx.beginPath();
        ctx.moveTo(st.x, st.y);
        ctx.lineTo(end.x, end.y);
        ctx.lineWidth = (w1 * (1 - tm)) + (w2 * tm);
        ctx.lineCap = 'round';
        ctx.stroke();
    }
}

/**
 * Evaluate a quadratic bezier curve at a certain time value.
 * @param t Time, scalar between 0 and 1.
 * @param ctrl {Vector2} Control point
 * @param pt1 {Vector2} Starting point
 * @param pt2 {Vector2} Ending point
 * @returns {Vector2} the bezier curve evaluated at the specified time.
 */
function evalBezier(t, ctrl, pt1, pt2) {
    if (t <= 0) {
        return pt1;
    } else if (t >= 1) {
        return pt2;
    }
    
    let invt = 1.0 - t;
    let lhs = pt1.multiply(invt).add(ctrl.multiply(t)).multiply(invt);
    let rhs = ctrl.multiply(invt).add(pt2.multiply(t)).multiply(t);
    return lhs.add(rhs);
}

/**
 * Draw a variable width quadratic bezier curve.  The width values are linearly interpolated.
 * @param ctrl {Vector2} Control point
 * @param pt1 {Vector2} Starting point
 * @param w1 {number} Starting width
 * @param pt2 {Vector2} Ending point
 * @param w2 {number} Ending width.
 */
function drawVariableWidthBezier(ctrl, pt1, w1, pt2, w2) {
    /* Evaluate the bezier at various points to make a smoother line,
       and because html5 canvas doesn't allow for width interpolation. */
    let pts = Math.max(1, Math.ceil(Math.sqrt(pt2.subtract(pt1).length())));
    for (let i = 0; i < pts; i++) {
        let t = (i / pts);
        let tn = ((i+1) / pts);
        let tm = (t + tn) / 2;
        let st = evalBezier(t, ctrl, pt1, pt2);
        let end = evalBezier(tn, ctrl, pt1, pt2);
        
        ctx.beginPath();
        ctx.moveTo(st.x, st.y);
        ctx.lineTo(end.x, end.y);
        ctx.lineWidth = (w1 * (1 - tm)) + (w2 * tm);
        ctx.lineCap = 'round';
        ctx.stroke();
    }
}

/**
 * Get the width of the pen stroke as a function of the input pressure.
 * @param pressure Pressure input from the pen, should be normalized from [0, 1]
 * @returns pen width.
 */
function getWidth(pressure) {
    let w = width * Math.pow(pressure, 0.75) * scale; 
    switch (curTool) {
    case 'eraser':
        return w * 3;
    default:
        return w;
    }
}

/**
 * Draw points from a buffer of DrawingPoint objects.
 * @params buffer {CircularBuffer} Buffer of max size 3 filled with drawing points.
 */
function drawFromBuffer(buffer) {
    switch (curTool) {
    case 'pen':
        ctx.globalCompositeOperation = 'source-over';
        ctx.strokeStyle = color;
        break;
    case 'eraser':
        ctx.globalCompositeOperation = 'destination-out';
        break;
    default:
        return;
    }

    if (buffer.size == 2) {
        /* Not enough points to interpolate, just draw a straight line */
        let pt1 = buffer.at(0);
        let pt2 = buffer.at(1);

        let v1 = pt1.toVec();
        let v2 = pt2.toVec();
        let end = v1.mid(v2);
        
        drawVariableWidthBezier(v1.mid(end), v1, getWidth(pt1.pressure),
                                end, getWidth(pt2.pressure));
    } else if (buffer.size == 3){
        let pt1 = buffer.at(0);
        let pt2 = buffer.at(1);
        let pt3 = buffer.at(2);

        let v1 = pt1.toVec();
        let v2 = pt2.toVec();
        let v3 = pt3.toVec();

        drawVariableWidthBezier(v2, v1.mid(v2), getWidth((pt1.pressure + pt2.pressure) * 0.5),
                                v2.mid(v3), getWidth((pt2.pressure + pt3.pressure) * 0.5));
    } 
}

/**
 * Resize the canvas to be the same size as the window.
 */
function resizeCanvas() {
    canvas.width = window.innerWidth * scale;
    canvas.height = window.innerHeight * scale;
    canvas.style.width = window.innerWidth;
    canvas.style.height = window.innerHeight;
}
window.addEventListener("resize", resizeCanvas);
resizeCanvas();

document.body.addEventListener("contextmenu", (ev) => {
    ev.preventDefault();
});

/* Touch event handlers */
canvas.addEventListener("touchstart", (ev) => {
    ev.preventDefault();
    if (curTool === null) {
        return;
    }
    
    ev.changedTouches.forAll((touch, id) => {
        if ('touchType' in touch) {
            if (stylusEnabled && touch.touchType !== "stylus") {
                return;
            }
            if (touch.touchType === "stylus") {
                stylusEnabled = true;
            }
        }
        touches[id] = new CircularBuffer(3);
        touches[id].push(new DrawingPoint(touch));
    });
});
canvas.addEventListener("touchmove", (ev) => {
    ev.preventDefault();

    ev.changedTouches.forAll((touch, id) => {
        if (touches[id] !== undefined) {
            let buffer = touches[id];
            let last = buffer.at(buffer.length - 1);
            let curr = new DrawingPoint(touch);
            if (last.toOrigVec().dist(curr.toVec()) < min_dist) {
                last.copy(curr);
            } else {
                buffer.push(curr);
                drawFromBuffer(buffer);
            }
        }
    });
});
canvas.addEventListener("touchend", (ev) => {
    ev.preventDefault();
    ev.changedTouches.forAll((touch, id) => {
        if (touches[id] !== undefined) {
            drawFromBuffer(touches[id]);
        }
        touches[id] = undefined;
    });
});
canvas.addEventListener("touchcancel", (ev) => {
    ev.preventDefault();
    ev.changedTouches.forAll((touch, id) => {
        if (touches[id] !== undefined) {
            drawFromBuffer(touches[id]);
        }
        touches[id] = undefined;
    });
});

/* Mouse event handlers */
canvas.addEventListener("mousedown", (ev) => {
    if (curTool === null) {
        return;
    }
    
    touches["mouse"] = new CircularBuffer(3);
    touches["mouse"].push(new DrawingPoint(ev));
});
canvas.addEventListener("mousemove", (ev) => {
    if (touches["mouse"] !== undefined) {
        let buffer = touches["mouse"];
        let last = buffer.at(buffer.length - 1);
        let curr = new DrawingPoint(ev);
        if (last.toOrigVec().dist(curr.toVec()) < min_dist) {
            last.copy(curr);
        } else {
            buffer.push(curr);
            drawFromBuffer(buffer);
        }
    }
});
canvas.addEventListener("mouseup", (ev) => {
    if (touches["mouse"] !== undefined) {
        drawFromBuffer(touches["mouse"]);
    }
    touches["mouse"] = undefined;
});
document.body.addEventListener("mouseleave", (ev) => {
    if (touches["mouse"] !== undefined) {
        drawFromBuffer(touches["mouse"]);
    }
    touches["mouse"] = undefined;
});

var buttons = document.getElementsByClassName("control");
function deselectAllButtons() {
    for (let i = 0; i < buttons.length; i++) {
        buttons[i].classList.remove("selected");
    }
}

for (let i = 0; i < buttons.length; i++) {
    buttons[i].addEventListener("mousedown", (ev) => {
        if (buttons[i].classList.contains("selected")) {
            buttons[i].classList.remove("selected");
            curTool = null;
        } else {
            deselectAllButtons();
            buttons[i].classList.add("selected");
            curTool = buttons[i].getAttribute("control");
        }
    });
}

buttons[0].classList.add("selected");
curTool = "pen";

document.querySelector("[setting=color]").children[0].addEventListener("click", (ev) => {
    document.querySelector(".color-popup").classList.toggle("hidden");
});

var circle_buttons = document.getElementsByClassName("circle");
for (let i = 0; i < circle_buttons.length; i++) {
    let circ = circle_buttons[i];
    circ.addEventListener("mousedown", (ev) => {
        let col = circ.style.backgroundColor.toString();
        colorCircle.style.fill = col;
        color = col;
        document.querySelector(".color-popup").classList.add("hidden");
    });
}
