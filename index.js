import {Vector2} from './vector.js';
import {CircularBuffer} from './buffer.js';

var canvas = document.getElementById("canvas");
var ctx = canvas.getContext("2d");

/** Scaling of the canvas's internal resolution */
var scale = 2;
/** Buffer storing the last three drawn points. */ 
var buffer = new CircularBuffer(3);
/** Width of the pen stroke */
var width = 10;

class DrawingPoint {
    constructor(event) {
        this.x = event.clientX * scale;
        this.y = event.clientY * scale;

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
function drawVariableWidthLine(ctrl, pt1, w1, pt2, w2) {
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
    return width * Math.pow(pressure, 1.5) * scale;
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
canvas.addEventListener("touchstart", (ev) => {
    ev.preventDefault();
    buffer.push(new DrawingPoint(ev.touches[0]));
});
canvas.addEventListener("touchmove", (ev) => {
    ev.preventDefault();
    
    buffer.push(new DrawingPoint(ev.touches[0]));
    if (buffer.size == 2) {
        /* Not enough points to interpolate, just draw a straight line */
        let pt1 = buffer.at(0);
        let pt2 = buffer.at(1);

        let v1 = pt1.toVec();
        let v2 = pt2.toVec();
        let end = v1.mid(v2);
        
        drawVariableWidthLine(v1.mid(end), v1, getWidth(pt1.pressure),
                                          end, getWidth(pt2.pressure));
    } else {
        let pt1 = buffer.at(0);
        let pt2 = buffer.at(1);
        let pt3 = buffer.at(2);

        let v1 = pt1.toVec();
        let v2 = pt2.toVec();
        let v3 = pt3.toVec();

        drawVariableWidthLine(v2, v1.mid(v2), getWidth((pt1.pressure + pt2.pressure) * 0.5),
                                  v2.mid(v3), getWidth((pt2.pressure + pt3.pressure) * 0.5));
    }
});
canvas.addEventListener("touchend", (ev) => {
    ev.preventDefault();
    buffer.clear();
});
