import {Vector2} from './vector.js';
import {CircularBuffer} from './buffer.js';

var canvas = document.getElementById("canvas");
var ctx = canvas.getContext("2d");

/** Scaling of the canvas's internal resolution */
var scale = 2;
/** Width of the pen stroke */
var width = 10;
/** The last 3 points for each finger/stylus currently touching the screen */
var touches = {};
/** If this device has a stylus, then don't recognise normal touch inputs. */
var stylusEnabled = false;

class DrawingPoint {
    constructor(event) {
        let rect = canvas.getBoundingClientRect();
        this.x = (event.clientX - rect.left) * scale;
        this.y = (event.clientY - rect.top) * scale;

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
    return width * Math.pow(pressure, 0.5) * scale;
}

/**
 * Draw points from a buffer of DrawingPoint objects.
 * @params buffer {CircularBuffer} Buffer of max size 3 filled with drawing points.
 */
function drawFromBuffer(buffer) {
    if (buffer.size == 2) {
        /* Not enough points to interpolate, just draw a straight line */
        let pt1 = buffer.at(0);
        let pt2 = buffer.at(1);

        let v1 = pt1.toVec();
        let v2 = pt2.toVec();
        let end = v1.mid(v2);
        
        drawVariableWidthLine(v1.mid(end), v1, getWidth(pt1.pressure),
                              end, getWidth(pt2.pressure));
    } else if (buffer.size == 3){
        let pt1 = buffer.at(0);
        let pt2 = buffer.at(1);
        let pt3 = buffer.at(2);

        let v1 = pt1.toVec();
        let v2 = pt2.toVec();
        let v3 = pt3.toVec();

        let dist = v1.dist(v3);
        if (dist < 10) {
            /* Try to smooth out slow lines */
            v2 = v1.mid(v3);
            pt2.x = v2.x;
            pt2.y = v2.y;
        }

        drawVariableWidthLine(v2, v1.mid(v2), getWidth((pt1.pressure + pt2.pressure) * 0.5),
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
            buffer.push(new DrawingPoint(touch));
            drawFromBuffer(buffer);
        }
    });
});
canvas.addEventListener("touchend", (ev) => {
    ev.preventDefault();
    ev.changedTouches.forAll((touch, id) => { touches[id] = undefined; });
});

/* Mouse event handlers */
canvas.addEventListener("mousedown", (ev) => {
    touches["mouse"] = new CircularBuffer(3);
    touches["mouse"].push(new DrawingPoint(ev));
    touches["mouse"].button = ev.button;
});
canvas.addEventListener("mousemove", (ev) => {
    if (touches["mouse"] !== undefined) {
        let buffer = touches["mouse"];
        buffer.push(new DrawingPoint(ev));
        
        if (touches["mouse"].button === 2) {
            /* Erase with right click */
            let oldWidth = width;
            width *= 3;
            ctx.globalCompositeOperation = 'destination-out';
            
            drawFromBuffer(buffer);
            ctx.globalCompositeOperation = 'source-over';
            width = oldWidth;
        } else {
            drawFromBuffer(buffer);
        }
    }
});
canvas.addEventListener("mouseup", (ev) => {
    touches["mouse"] = undefined;
});

let buttons = document.getElementsByClassName("control");
for (let i = 0; i < buttons.length; i++) {
    buttons[i].addEventListener("click", (ev) => {
        if (buttons[i].classList.contains("selected")) {
            buttons[i].classList.remove("selected");
        } else {
            buttons[i].classList.add("selected");
        }
    });
}
