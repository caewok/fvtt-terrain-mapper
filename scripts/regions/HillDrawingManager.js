/* globals
canvas,
CONST,
foundry,
game,
PIXI,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID, FLAGS } from "../const.js";
import { Draw } from "../geometry/Draw.js";
import { pixelsToGridUnits, gridUnitsToPixels } from "../geometry/util.js";

/**
 * Allows the user to define a bezier curve to represent a hill in a region.
 */
export class HillDrawingManager {

  /** @type {boolean} */
  static active = false;

  /** @type {PIXI.Point[]} */
  static points = [];

  /** @type {PIXI.Graphics} */
  static graphics = new PIXI.Graphics();

  /** @type {Draw} */
  static draw = new Draw(this.graphics);

  /** @type {object} */
  static pointDrawingOpts = { radius: 2, color: Draw.COLORS.orange };

  /** @type {object} */
  static curveDrawingOpts = { width: 1, color: Draw.COLORS.orange }

  /**
   * Start monitoring for mouse movements.
   */
  static activate() {
    this.points.length = 0;
    this.active = true;

    // Add PIXI.Graphics object to the canvas.
    canvas.controls.addChild(this.graphics);

    // Bind PIXI canvas interaction events.
    canvas.stage.on("pointerdown", this._onPointerDown, this);
    canvas.stage.on("pointermove", this._onPointerMove, this);
  }

  /**
   * End monitoring for mouse movements.
   */
  static deactivate() {
    this.active = false;
    this.points.length = 0;
    this.draw.clearDrawings();
    this.draw.g.children.forEach(child => child.destroy());
    canvas.controls.removeChild(this.graphics);

    canvas.stage.off("pointerdown", this._onPointerDown, this);
    canvas.stage.off("pointermove", this._onPointerMove, this);
  }

  /**
   * Capture the start and end points of the curve.
   * First click: sets start point.
   * Second click: sets end point.
   * Third click finalizes curve and saves it.
   * @param {Event} event
   */
  static _onPointerDown(event) {
    if ( !this.active ) return;

    // Get local canvas coordinates.
    const position = event.data.getLocalPosition(canvas.app.stage);

    switch ( this.points.length ) {
      case 0:
      case 1: {
        const pt = PIXI.Point.fromObject(position)
        this.points.push(pt);
        this.draw.point(pt, this.pointDrawingOpts);
        break;
      }
      case 2: {
        // Finalize the curve with current mouse position dictating the arch.
        this._saveCurveToRegion();
        this.deactivate();
        break;
      }
    }
  }

  /**
   * Capture the mouse move to dynamically control points based on mouse position.
   * (Pull the curve upwards like a hill.)
   * @param {Event} event
   */
  static _onPointerMove(event) {
    if ( !this.active || this.points.length < 2 ) return;

    const position = event.data.getLocalPosition(canvas.app.stage);
    const [start, end] = this.points;

    // Calculate control dynamically based on mouse position.
    // For a simple hill, use the mouse Y position to pull the curve up.

    // Simple arc:
    // const cp1 = PIXI.Point.tmp.set(start.x, position.y);
    // const cp2 = PIXI.Point.tmp.set(end.x, position.y);

    const cp1 = PIXI.Point.tmp.set(position.x, position.y);
    const cp2 = PIXI.Point.tmp.set(position.x, position.y);

    this.draw.clearDrawings();
    this.draw.point(start, this.pointDrawingOpts);
    this.draw.point(end, this.pointDrawingOpts);
    this.draw.curve(start, cp1, cp2, end, this.curveDrawingOpts);

    // Label elevation based on distance from start|end base.
    this._updateElevationLabel(cp1);
  }

  /**
   * Update an elevation text label.
   */
  static _updateElevationLabel(position) {
    const [start, end] = this.points;

    // Label elevation based on distance from start|end base.
    const normal = end.subtract(start);
    const perp = PIXI.Point.tmp.set(normal.y, -normal.x);
    const ix = foundry.utils.lineLineIntersection(start, end, position, position.add(perp));
    const elevation = Math.round(pixelsToGridUnits(PIXI.Point.distanceBetween(ix, position)));

     // Create or update new label.
    const opts = {};
    const style = foundry.utils.mergeObject(CONFIG.canvasTextStyle, opts);
    let label;
    if ( this.draw.g.children.length ) label = this.draw.g.getChildAt(0);
    else {
      label = new PIXI.Text(String(elevation), style);
      this.draw.g.addChild(label);
    }
    label.text = String(elevation);
    label.position.set(position.x - 25, position.y); // Shift slightly left to not be in front of the arrow.
  }

  /**
   * Save the curve to the region.
   */
  static async _saveCurveToRegion() {
    const [start, end] = this.points;

    // Grab the final mouse position.
    const interactionData = canvas.app.renderer.events.pointer.global;
    const finalPosition = canvas.stage.worldTransform.applyInverse(interactionData);

    const cp1 = PIXI.Point.tmp.set(start.x, finalPosition.y);
    const cp2 = PIXI.Point.tmp.set(end.x, finalPosition.y);
    const curveData = [start.x, start.y, cp1.x, cp1.y, cp2.x, cp2.y, end.x, end.y];

    let targetRegion = canvas.regions.placeables.filter(r => r.document.polygons.some(poly => poly.contains(start.x, start.y)));
    if ( targetRegion.length > 1 ) targetRegion = targetRegion.filter(r => r.document.polygons.some(poly => poly.contains(end.x, end.y)));
    else if ( !targetRegion.length ) targetRegion = canvas.regions.placeables.filter(r => r.document.polygons.some(poly => poly.contains(end.x, end.y)));
    targetRegion = targetRegion[0];

    canvas.regions.placeables.find(r => r.document.testPoint(start))
      ?? canvas.regions.placeables.find(r => r.document.testPoint(end));
    if ( targetRegion ) {
      // Save to document flag.
      await targetRegion.document.setFlag(MODULE_ID, FLAGS.REGION.HILL, curveData);
      ui.notifications.info(`Hill curve saved to region: ${targetRegion.document.name}`);
    } else ui.notifications.warn("No region found under the start or end points.");
  }

  /**
   * @typedef {BézierCurve}
   * @prop {PIXI.Point} start
   * @prop {PIXI.Point} cp1
   * @prop {PIXI.Point} cp2
   * @prop {PIXI.Point} end
   */

  /**
   * Return curve data for a given region.
   * @param {Region} region
   * @returns {BézierCurve}
   */
  static hillDataForRegion(region) {
    const hillData = region.document.getFlag(MODULE_ID, FLAGS.REGION.HILL);
    if ( !hillData || !hillData.length === 8 ) return null;

    const start = PIXI.Point.tmp.set(hillData[0], hillData[1]);
    const cp1 = PIXI.Point.tmp.set(hillData[2], hillData[3])
    const cp2 = PIXI.Point.tmp.set(hillData[4], hillData[5])
    const end = PIXI.Point.tmp.set(hillData[6], hillData[7]);

    // Determine the intended elevation from the control points.
    const normal = end.subtract(start);
    const perp = PIXI.Point.tmp.set(normal.y, -normal.x);
    const ix1 = PIXI.Point.fromObject(foundry.utils.lineLineIntersection(start, end, cp1, cp1.add(perp)));
    const ix2 = PIXI.Point.fromObject(foundry.utils.lineLineIntersection(start, end, cp2, cp2.add(perp)));
    const elevation = Math.round(pixelsToGridUnits(PIXI.Point.distanceBetween(ix1, cp1)))
    const elevationZ = gridUnitsToPixels(elevation);

    // Adjust the control points to the exact elevation.
    const cp1Adj = ix1.towardsPoint(cp1, elevationZ);
    const cp2Adj = ix2.towardsPoint(cp2, elevationZ)

    return { start, cp1: cp1Adj, cp2: cp2Adj, end };
  }

  /**
   * Create a polygon representing the vertical cut of the hill.
   * @param {BézierCurve} curve
   * @param {number} [resolution=20]
   * @returns {PIXI.Polygon}
   */
  static generateHillPolygon(curve, resolution = 20) {
    // Sample along the curved roof of the hill.
    const { start, cp1, cp2, end } = curve;
    const points = [start.x, start.y];
    const invRes = 1 / resolution;
    for ( let i = 1; i < resolution; i += 1 ) {
      const t = i * invRes;
      const x = bezierValue(t, start.x, cp1.x, cp2.x, end.x);
      const y = bezierValue(t, start.y, cp1.y, cp2.y, end.y);
      points.push(x, y);
    }
    points.push(end.x, end.y);
    return new PIXI.Polygon(points);
  }

  /**
   * Get the z value for a 2d point based on a Bézier hill profile.
   * @param {PIX.Point} pt          Point to test
   * @param {BézierCurve} curve     Curve data
   * @param {object} [opts]
   * @param {"linear"|"symmetrical"} [opts.type]
   *   - linear: The hill has a defined linear direction and is the same at parallel lines to start|end.
   *   - symmetrical: The hill is rotated around its center point (center of start|end)
   * @param {number} mirrorRatio
   *   - mirrorRatio === 1: End at center; edge of circle is middle of hill.
   *   - mirrorRatio === 2: End of hill is at center; edge of circle is start of hill.
   * @returns {number} Z height or 0 if outside the radius of the curve.
   */
  static hillZAtPoint(pt, curve, { type = "linear" } = {}) {
    const { start, cp1, cp2, end } = curve;

    // Center of the hill.

    using center = PIXI.Point.tmp;
    start.add(end, center).multiplyScalar(0.5, center);

    // Maximum radius of the hill base.
    const radius = PIXI.Point.distanceBetween(start, center);

    // Set t dependent on how the curve is mapped to the XY surface.
    let t = 0;
    switch ( type ) {
      case "linear": {
        // Oriented hill.
        // Rectangular hill base stretching infinitely in the normal to start|end.
        const pointOnLine = foundry.utils.closestPointToSegment(pt, start, end);
        t = PIXI.Point.distanceBetween(start, pointOnLine) / (radius * 2);
        if ( t.almostEqual(0) || t.almostEqual(1) ) return 0;
        break;
      }
      case "symmetrical": {
        const dist = PIXI.Point.distanceBetween(pt, center);
        if ( dist >= radius ) return 0;
        t = 0.5 * (1 - (dist / radius));
        break;
      }

      case "ridge": {
        // Non-symmetrical, treating the Bézier like a ridge line. Where the curve is
        // steeper, the fall-off from the ridge will be faster.
        /* Original:
        const dx = end.x - start.x;
        const dy = end.y - start.y;
        const length2 = dx * dx + dy * dy;
        */
        using tmp = PIXI.Point.tmp;
        using delta = end.subtract(start);
        const length2 = delta.dot2();
        if ( length2.almostEqual(0) ) return 0;

        // Project target point onto the ridge line.
        /* Original:
        const u = ((pt.x - start.x) * dx + (pt.y - start.y) * dy) / length2;
        */
        const u = pt.subtract(start, tmp).dot(delta) / length2;
        if ( u < 0 || u > 1 ) return 0;

        // Find closest point on the ridge line to calculate perpendicular distance "d".
        /* Original:
        const closestX = start.x + u * dx;
        const closestY = start.y + u * dy;
        const perpDist = Math.hypot(pt.x - closestX, pt.y - closestY);
        */

        // Could use foundry util but we already need to calculate u:
        // const closest = foundry.utils.closestPointToSegment(pt, start, end);
        // const perpDist = closestDistanceToSegment(pt, start, end)
        const closest = start.add(delta.multiplyScalar(u, tmp));
        const perpDist = pt.subtract(closest, tmp).magnitude()

        // Determine the dynamic maximum radius (slop footprint) at this specific slice.
        // Blend maximum footprint allowed at the start vs the end based on "u".
        const maxDist = Math.sqrt(length2) / 2; // Using half-length as max slope width.
        if ( perpDist >= maxDist ) return 0; // Beyond the foot of the hill.

        // Normalized distance down the slope (0 at ridge, 1 at base of hill).
        const slopeProgress = perpDist / maxDist;

        // Calculate the blended "t" parameter.
        // On the ridge: slopeProgress = 0, t = u.
        // At the base: slopeProgress = 1, t should migrate to 0 (near start) or 1 (near end).
        // Use "u" to smoothly blend whether the base edge pulls toward 0 or 1.
        const edgeTargetT = u; // Splitting 50/50 down the center normal line.
        if ( u < 0.5 ) t = u * (1 - slopeProgress);
        else t = u + (1 - u) * slopeProgress;
        t = Math.clamp(t, 0, 1);
        // return bezierValue(t, start.y, cp1.y, cp2.y, end.y);
        break;
      }
      default: t = 0.5;
    }

    // Evaluate the Bézier equation for z.
    // Distance from the XY point to the start|end base.
    const x = bezierValue(t, start.x, cp1.x, cp2.x, end.x);
    const y = bezierValue(t, start.y, cp1.y, cp2.y, end.y);
    return closestDistanceToSegment(PIXI.Point.tmp.set(x, y), start, end);
  }

}

/**
 * Calculate a value along the Bézier curve.
 * @param {number} t      Distance along the curve.
 * @param {number} start
 * @param {number} cp1
 * @param {number} cp2
 * @param {number} end
 * @returns {number}
 */
function bezierValue(t, start, cp1, cp2, end) {
  const mt = 1 - t;
  const mt2 = mt * mt;
  const mt3 = mt2 * mt;
  const t2 = t * t;
  const t3 = t2 * t;
  return (mt3 * start) + (3 * mt2 * t * cp1) + (3 * mt * t2 * cp2) + (t3 * end);
}

/**
 * Closest distance to segment
 */
function closestDistanceToSegment(c, a, b) {
  const ix = foundry.utils.closestPointToSegment(c, a, b);
  return PIXI.Point.distanceBetween(ix, c);
}
