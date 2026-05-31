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

    return { start, cp1, cp2, end };
  }

  /**
   * Create a polygon representing the vertical cut of the hill.
   * @param {BézierCurve} curve
   * @param {number} [resolution=20]
   * @returns {PIXI.Polygon}
   */
  static generateHillPolygon(curve, resolution = 20) {
    // Sample along the curved roof of the hill.
    const points = [curve.start];
    const invRes = 1 / resolution;
    for ( let i = 1; i <= resolution; i += 1 ) {
      const t = i * invRes;
      points.push(getBezierPoint(t, curve.start, curve.cp1, curve.cp2, end));
    }
    points.push(end);
    return new PIXI.Polygon(points);
  }

  /**
   * Get the z value for a 2d point based on a symmetrical Bézier hill profile.
   * @param {PIX.Point} pt          Point to test
   * @param {BézierCurve} curve     Curve data
   * @returns {number} Z height or 0 if outside the radius of the curve.
   */
  static hillZAtPoint(pt, curve) {
    const { start, cp1, cp2, end } = curve;

    // Center of the hill.
    using center = PIXI.Point.tmp;
    start.add(end, center).multiplyScalar(0.5, center);

    // Maximum radius of the hill base.
    const radius = PIXI.Point.distanceBetween(start, center);

    // Distance of the target point from the center.
    const dist = PIXI.Point.distanceBetween(pt, center);
    if ( dist >= radius ) return 0;

    // Map distance to a symmetrical Bézier "t" parameter (0 -> 1).
    // At center, t = 0.5 (peak). At edge, t = 0 or t = 1.
    const distRatio = dist / radius;
    const t = 0.5 * (1 - distRatio); // Project to 1/2 of the symmetrical curve.

    // Evaluate the Bézier equation for z.
    return bezierValue(t, start.y, cp1.y, cp2.y, end.y);
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

  // Calculate X (Ground distance)
  return (mt3 * start) + (3 * mt2 * t * cp1) + (3 * mt * t2 * cp2) + (t3 * end);
}

/**
 * Evaluate the cubic Bézier formula for a given value.
 * Map y value to height (z).
 * @param {number} t                Distance along the curve.
 * @param {BézierCurve} curve
 * @returns {PIXI.Point}
 */
function getBezierPoint(t, curve) {
  const { start, cp1, cp2, end } = curve;
  const x = bezierValue(t, start.x, cp1.x, cp2.x, end.x);
  const z = bezierValue(t, start.y, cp1.y, cp2.y, end.y);
  return PIXI.Point.tmp.set(x, z);
}

