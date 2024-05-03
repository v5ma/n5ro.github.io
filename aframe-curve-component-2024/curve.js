/* global AFRAME, THREE */

if (typeof AFRAME === 'undefined') {
    throw new Error('Component attempted to register before AFRAME was available.');
}

/**
 * Curve component for A-Frame to deal with spline curves
 */
var zAxis = new THREE.Vector3(0, 0, 1);
var degToRad = THREE.MathUtils.degToRad;

AFRAME.registerComponent('curve-point', {
    schema: {},

    init: function () {
        this.el.addEventListener("componentchanged", this.changeHandler.bind(this));
        this.el.emit("curve-point-change");
    },

    changeHandler: function (event) {
        if (event.detail.name == "position") {
            this.el.emit("curve-point-change");
        }
    }
});

AFRAME.registerComponent('curve', {
    schema: {
        type: {
            type: 'string',
            default: 'CatmullRom',
            oneOf: ['CatmullRom', 'CubicBezier', 'QuadraticBezier', 'Line']
        },
        closed: {
            type: 'boolean',
            default: false
        }
    },

    init: function () {
        this.pathPoints = null;
        this.curve = null;

        this.el.addEventListener("curve-point-change", this.update.bind(this));
    },

    update: function (oldData) {
        this.points = Array.from(this.el.querySelectorAll("a-curve-point"));

        if (this.points.length <= 1) {
            console.warn("At least 2 curve-points needed to draw a curve");
            this.curve = null;
        } else {
            // Get Array of Positions from Curve-Points
            var pointsArray = this.points.map(function (point) {
                return point.object3D.position;
            });

            // Update the Curve if either the Curve-Points or other Properties changed
            if (!AFRAME.utils.deepEqual(pointsArray, this.pathPoints) || (oldData !== 'CustomEvent' && !AFRAME.utils.deepEqual(this.data, oldData))) {
                this.curve = null;

                this.pathPoints = pointsArray;

                // Create Curve
                switch (this.data.type) {
                    case 'CubicBezier':
                        if (this.pathPoints.length !== 4) {
                            throw new Error('The Three constructor of type CubicBezierCurve3 requires 4 points');
                        }
                        this.curve = new THREE.CubicBezierCurve3(this.pathPoints[0], this.pathPoints[1], this.pathPoints[2], this.pathPoints[3]);
                        break;
                    case 'QuadraticBezier':
                        if (this.pathPoints.length !== 3) {
                            throw new Error('The Three constructor of type QuadraticBezierCurve3 requires 3 points');
                        }
                        this.curve = new THREE.QuadraticBezierCurve3(this.pathPoints[0], this.pathPoints[1], this.pathPoints[2]);
                        break;
                    case 'Line':
                        if (this.pathPoints.length !== 2) {
                            throw new Error('The Three constructor of type LineCurve3 requires 2 points');
                        }
                        this.curve = new THREE.LineCurve3(this.pathPoints[0], this.pathPoints[1]);
                        break;
                    case 'CatmullRom':
                        this.curve = new THREE.CatmullRomCurve3(this.pathPoints);
                        break;
                    case 'Spline':
                        this.curve = new THREE.SplineCurve3(this.pathPoints);
                        break;
                    default:
                        throw new Error('No Three constructor of type (case sensitive): ' + this.data.type + 'Curve3');
                }

                this.curve.closed = this.data.closed;

                this.el.emit('curve-updated');
            }
        }
    },

    remove: function () {
        this.el.removeEventListener("curve-point-change", this.update.bind(this));
    },

    closestPointInLocalSpace: function closestPoint(point, resolution, testPoint, currentRes) {
        if (!this.curve) throw Error('Curve not instantiated yet.');
        resolution = resolution || 0.1 / this.curve.getLength();
        currentRes = currentRes || 0.5;
        testPoint = testPoint || 0.5;
        currentRes /= 2;
        var aTest = testPoint + currentRes;
        var bTest = testPoint - currentRes;
        var a = this.curve.getPointAt(aTest);
        var b = this.curve.getPointAt(bTest);
        var aDistance = a.distanceTo(point);
        var bDistance = b.distanceTo(point);
        var aSmaller = aDistance < bDistance;
        if (currentRes < resolution) {
            var tangent = this.curve.getTangentAt(aSmaller ? aTest : bTest);
            if (currentRes < resolution) return {
                result: aSmaller ? aTest : bTest,
                location: aSmaller ? a : b,
                distance: aSmaller ? aDistance : bDistance,
                normal: normalFromTangent(tangent),
                tangent: tangent
            };
        }
        if (aDistance < bDistance) {
            return this.closestPointInLocalSpace(point, resolution, aTest, currentRes);
        } else {
            return this.closestPointInLocalSpace(point, resolution, bTest, currentRes);
        }
    }
});

var tempQuaternion = new THREE.Quaternion();

function normalFromTangent(tangent) {
    var lineEnd = new THREE.Vector3(0, 1, 0);
    tempQuaternion.setFromUnitVectors(zAxis, tangent);
    lineEnd.applyQuaternion(tempQuaternion);
    return lineEnd;
}

AFRAME.registerComponent("draw-curve", {
    schema: {
        curve: { type: "string" }
    },
    init: function () {
        this.curve = null;
        this.el.sceneEl.addEventListener("curve-updated", this.update.bind(this));
    },
    update: function () {
        var curveEl = document.querySelector(this.data.curve);
        if (curveEl && curveEl.components.curve) {
            this.curve = curveEl.components.curve;
            if (this.curve.curve) {
                var lineGeometry = new THREE.BufferGeometry().setFromPoints(this.curve.curve.getPoints(50));
                var lineMaterial = new THREE.LineBasicMaterial({
                    color: "#ff0000"
                });
                var line = new THREE.Line(lineGeometry, lineMaterial);
                this.el.setObject3D("mesh", line);
            }
        }
    },
    remove: function () {
        this.el.sceneEl.removeEventListener("curve-updated", this.update.bind(this));
        var mesh = this.el.getObject3D("mesh");
        if (mesh) {
            mesh.geometry.dispose();
            mesh.material.dispose();
        }
    }
});

AFRAME.registerComponent("clone-along-curve", {
    schema: {
        curve: { type: "selector" },
        spacing: { default: 1 },
        rotation: { type: "vec3", default: { x: 0, y: 0, z: 0 } },
        scale: { type: "vec3", default: { x: 1, y: 1, z: 1 } }
    },
    init: function () {
        this.el.addEventListener("model-loaded", this.update.bind(this));
        this.data.curve.addEventListener("curve-updated", this.update.bind(this));
    },
    update: function () {
        this.remove();
        if (this.data.curve && (this.curve = this.data.curve.components.curve), !this.el.getObject3D("clones") && this.curve && this.curve.curve) {
            var mesh = this.el.getObject3D("mesh");
            var length = this.curve.curve.getLength();
            var start = 0;
            var counter = start;
            var cloneMesh = this.el.getOrCreateObject3D('clones', THREE.Group);
            var parent = new THREE.Object3D();
            mesh.scale.set(this.data.scale.x, this.data.scale.y, this.data.scale.z);
            mesh.rotation.set(degToRad(this.data.rotation.x), degToRad(this.data.rotation.y), degToRad(this.data.rotation.z));
            mesh.rotation.order = "YXZ";
            parent.add(mesh);
            while (counter <= length) {
                var child = parent.clone(true);
                child.position.copy(this.curve.curve.getPointAt(counter / length));
                tangent = this.curve.curve.getTangentAt(counter / length).normalize();
                child.quaternion.setFromUnitVectors(zAxis, tangent);
                cloneMesh.add(child);
                counter += this.data.spacing;
            }
        }
    },
    remove: function () {
        this.curve = null;
        var clones = this.el.getObject3D("clones");
        if (clones) {
            clones.traverse(function (clone) {
                if (clone.geometry) clone.geometry.dispose();
                if (clone.material) clone.material.dispose();
            });
            this.el.removeObject3D("clones");
        }
    }
});

AFRAME.registerPrimitive('a-draw-curve', {
    defaultComponents: {
        'draw-curve': {},
    },
    mappings: {
        curveref: 'draw-curve.curve',
    }
});

AFRAME.registerPrimitive('a-curve-point', {
    defaultComponents: {
        'curve-point': {},
    },
    mappings: {}
});

AFRAME.registerPrimitive('a-curve', {
    defaultComponents: {
        'curve': {}
    },
    mappings: {
        type: 'curve.type',
    }
});
