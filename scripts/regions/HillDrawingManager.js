/* globals
canvas,
CONFIG,
foundry,
PIXI,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID, FLAGS } from "../const.js";
import { Draw } from "../geometry/Draw.js";
import { MatrixFloat32 } from "../geometry/Matrix.js";

// TODO: Temp Hook region creation and deletion to update.
export const PATCHES = {};
PATCHES.BASIC = {};

// Hook region deletion to remove.

/**
 * Hook when regions are destroyed.
 * @param {PlaceableObject} object    The object instance being destroyed
 */
function destroyRegion(region) {
  HillDrawingManager.destroyRegionUI(region);
}

PATCHES.BASIC.HOOKS = { destroyRegion };

/**
 * Allows the user to define a bezier curve to represent a hill in a region.
 */
export class HillDrawingManager {

  // ------ NOTE: Static Manager Lifecycle ----- //

  /** @type {boolean} */
  static active = false;

  /** @type {PIXI.Container} */
  static container = new PIXI.Container();

  /** @type {Map<Region, HillDrawingManager>} */
  static managers = new Map();

  /**
   * Start monitoring for mouse movements.
   */
  static activate() {
    this.active = true;

    // Initialize the UI for every region in the scene.
    for ( const region of canvas.regions.placeables ) {
      if ( this.managers.has(region) ) continue;
      const mgr = new this(region);
      this.container.addChild(mgr.regionUI);
      this.managers.set(region, mgr);
      mgr.initUI();
    }

    // Drop managers for removed regions.
    // Don't use a weak map here b/c it would lose the graphic objects.
    const regionSet = new Set(canvas.regions.placeables);
    for ( const [region, mgr] of this.managers.entries() ) {
      if ( !regionSet.has(region) ) {
        this.container.removeChild(mgr.regionUI);
        mgr.destroy();
        this.managers.delete(region);

      } else mgr.activateUI();
    }

    // Add PIXI.Graphics objects to the canvas.
    this.container.zIndex = 1000;
    canvas.controls.addChild(this.container);
    canvas.controls.sortableChildren = true;
    this.container.eventMode = "static";
  }

  // TODO: Add destroy and hook canvas takedown.

  static destroy() {
    this.container.destroy(true); // True to destroy children.
    this.managers.clear();
  }

  /**
   * End monitoring for mouse movements.
   */
  static deactivate() {
    this.active = false;
    canvas.controls.removeChild(this.container);
    this.container.eventMode = "none";
  }

  static destroyRegionUI(region) {
    const mgr = this.managers.get(region);
    if ( !mgr ) return;
    this.container.removeChild(mgr.regionUI);
    mgr.destroy();
    this.managers.delete(region);
  }

  // ----- NOTE: Instance Lifecycle (per region) ----- //

  /** @type {RegionDocument} */
  regionDocument;

  /** @type {Region|undefined} */
  get region() { return this.regionDocument.object; }

  /** @type {number} */
  static terrainTop(regionD) { return regionD.getFlag(MODULE_ID, FLAGS.REGION.PLATEAU_ELEVATION) || 0; }

  /** @type {number} */
  static terrainBottom(regionD) { return regionD.getFlag(MODULE_ID, FLAGS.REGION.RAMP.FLOOR) || 0; }

  /** @type {PIXI.Container} */
  regionUI = new PIXI.Container();

  /** @type {object<PIXI.Graphics>} */
  handles = {}

  /** @type {PIXI.Graphics|undefined} */
  curveGraphics;

  /** @type {PIXI.Graphics|undefined} */
  boundsGraphics;

  constructor(regionDocument) {
    if ( regionDocument ) regionDocument = regionDocument.document; // Allow user to pass a region.
    this.regionDocument = regionDocument;
  }

  /**
   * Initialize the curve and interaction handles for a specific region.
   */
  #initialized = false;

  initUI() {
    if ( this.regionUI.destroyed ) {
      this.regionUI = new PIXI.Container();
      this.#initialized = false;
    }
    if ( this.#initialized ) return;

    // Graphics for the region curves.
    const curveGraphics = this.curveGraphics = new PIXI.Graphics();
    this.regionUI.addChild(curveGraphics);
    curveGraphics.eventMode = "none";

    // Graphics for the region bounds.
    const boundsGraphics = this.boundsGraphics = new PIXI.Graphics();
    this.regionUI.addChild(boundsGraphics);
    boundsGraphics.zIndex = 1;
    boundsGraphics.eventMode = "none";

    // Create interactive handles.
    const { HANDLE_COLORS, HANDLE_SHAPES } = this.constructor;
    for ( const key of Object.keys(HANDLE_COLORS) ) {
      const handle = this.handles[key] = this.constructor._createHandle(HANDLE_COLORS[key], HANDLE_SHAPES[key]);
      handle.name = key;
      this.regionUI.addChild(handle);

      // Add interactivity.
      handle.on("pointerdown", this._onDragStart.bind(this));
      handle.on("click", this._onDoubleClick.bind(this));
      handle.on("globalpointermove", this._onDragMove.bind(this));
      handle.on("pointerup", this._onDragEnd.bind(this));
      handle.on("pointerup", this._onDragEnd.bind(this));
      handle.on("pointerupoutside", this._onDragEnd.bind(this)); // Capture releases outside the handle.
    }

    this.#initialized = true;
  }

  #scaledCurveData;

  activateUI() {
    // Update the handle positions based on last saved data.
    const scaledCurveData = this.#scaledCurveData = this.constructor.scaledHillData(this.regionDocument);
    for ( const key of Object.keys(this.handles) ) { this.constructor._updateHandle(this.handles[key], scaledCurveData[key]); }

    // Draw the curve.
    this._drawCurve();
  }

  destroy() {
    this.regionUI.destroy(true); // True to destroy children.
    this.#initialized = false;
  }

  // ----- NOTE: User Interaction ----- //

  /** @type {number} */
  static DRAG_ALPHA = 0.5;

  /** @type {number} */
  static HANDLE_ALPHA = 1.0;

  /** @type {PIXI.Graphics|null} */
  #activeHandle = null;

  /**
   * Keys to move curve controls in pairs.
   * @type {object<string>}
   */
  static HANDLE_PAIR = {
    start: "end",
    end: "start",
    cp1: "cp2",
    cp2: "cp1",
    left: "right",
    right: "left",
  };

  /** @type {object<string>} */
  static HANDLE_SHAPES = {
    start: "circle",
    end: "circle",
    cp1: "square",
    cp2: "square",
    left: "triangle",
    right: "triangle",
  };

  /** @type {object<Hex>} */
  static HANDLE_COLORS = {
    start: Draw.COLORS.DARK.green,
    end: Draw.COLORS.LIGHT.green,
    cp1: Draw.COLORS.blue,
    cp2: Draw.COLORS.blue,
    left: Draw.COLORS.LIGHT.orange,
    right: Draw.COLORS.DARK.orange,
  };

  /**
   * Handle when a drag starts on a curve handle.
   * @param {InteractionEvent} event
   */
  _onDragStart(event) {
    const handle = event.currentTarget;
    if ( !handle.name ) return;

    event.stopPropagation();
    this.#activeHandle = handle;
    handle.alpha = this.constructor.DRAG_ALPHA; // Visual feedback for dragging.
    if ( handle.name === "left" || handle.name === "right" ) this._drawBounds();
  }

  /**
   * Handle when a curve handle is double-clicked.
   * @param {InteractionEvent} event
   */
  _onDoubleClick(event) {
    if ( event.detail !== 2 ) return;
    const handle = event.target;
    if ( !handle.name ) return;
    event.stopPropagation();

    // Reset the handle to its default position.
    const regionD = this.regionDocument;
    const curve = this.constructor.defaultCurve();
    this.constructor.scaleBezierForRegion(regionD, curve, curve);
    this.constructor.scaleCurveOrientationForRegion(regionD, curve, curve);

    const defaultPosition = curve[handle.name];
    handle.x = defaultPosition.x;
    handle.y = defaultPosition.y;
    this._updateCurveData();
    this._saveCurveData();
    this.boundsGraphics.clear();
  }

  /**
   * Handle when a curve handle is moved.
   * @param {InteractionEvent} event
   */
  _onDragMove(event) {
    if ( !this.#activeHandle ) return;
    event.stopPropagation();

    const handle = this.#activeHandle;
    const handleKey = handle.name;
    const newPosition = handle.parent.toLocal(event.global);

    // If shift is held, move the partner in tandem.
    if ( event.shiftKey ) {
      const pairKey = this.constructor.HANDLE_PAIR[handleKey];
      const pairHandle = this.handles[pairKey];
      using delta = newPosition.subtract(handle);
      pairHandle.x += delta.x
      pairHandle.y += delta.y
    }
    handle.x = newPosition.x;
    handle.y = newPosition.y;
    this._updateCurveData();

  }

  /**
   * Handle when a curve handle is dropped (drag is finished).
   * @param {InteractionEvent} event
   */
  _onDragEnd(event) {
    if ( !this.#activeHandle ) return;
    event.stopPropagation();

    const handle = this.#activeHandle;
    this.#activeHandle = null;
    handle.alpha = this.constructor.HANDLE_ALPHA;
    this._saveCurveData();
    this.boundsGraphics.clear();
  }

  /**
   * Update the temporary curve data for this manager.
   */
  _updateCurveData() {
    const curveData = this.#scaledCurveData;
    for ( const key of Object.keys(this.handles) ) curveData[key].copyFrom(this.handles[key]);
    this._drawCurve();
  }

  /**
   * Save the curve data from the UI. Normalizes it prior to saving.
   */
  async _saveCurveData() { await this.saveScaledHillData(this.#scaledCurveData); }


  /**
   * Create a single interactive PIXI.Graphics handle.
   */
  static _createHandle(color, shape = "circle") {
    const handle = new PIXI.Graphics;
    let obj;
    switch ( shape ) {
      case "square": obj = new PIXI.Rectangle(-5, -5, 10, 10); break;
      case "triangle": obj = new PIXI.Polygon(-8, 8, 0, -8, 8, 8); break;
      default: obj = new PIXI.Circle(0, 0, 8);
    }
    const draw = new Draw(handle);
    draw.shape(obj, { color, width: 2, alpha: 1 });

    handle.hitArea = new PIXI.Circle(0, 0, 15);
    handle.eventMode = "static";
    handle.cursor = "pointer";

    return handle;
  }

  static _updateHandle(handle, position) {
    handle.x = position.x;
    handle.y = position.y;
  }

  /**
   * Render the bounds of the region as a circular bounds to assist with placing the hill.
   */
  _drawBounds() {
    const center = this.region.center;
    const bounds = this.region.bounds;
    const diameter = Math.hypot(bounds.width, bounds.height);
    const radius = diameter * 0.5;
    const draw = new Draw(this.boundsGraphics);
    draw.clearDrawings();
    draw.shape(new PIXI.Circle(center.x, center.y, radius), { width: 2, color: Draw.COLORS.brown, alpha: 0.3, fill: Draw.COLORS.brown, fillAlpha: 0.1 });

    // Draw center and axis.
    using left = PIXI.Point.tmp.set(center.x - radius, center.y);
    using right = PIXI.Point.tmp.set(center.x + radius, center.y);
    using top = PIXI.Point.tmp.set(center.x, center.y - radius);
    using bottom = PIXI.Point.tmp.set(center.x, center.y + radius);
    draw.segment({ a: left, b: right }, { width: 2, color: Draw.COLORS.brown, alpha: 0.3, dashLength: 5, gapLength: 1 });
    draw.segment({ a: top, b: bottom }, { width: 2, color: Draw.COLORS.brown, alpha: 0.3, dashLength: 5, gapLength: 1 });
    draw.star(center, { radius: 4, color: Draw.COLORS.brown, alpha: 0.3 });
  }

  /**
   * Render the Bézier curve and the visual control lines connecting the points.
   */
  _drawCurve() {
    const { start, cp1, cp2, end, left, right } = this.#scaledCurveData ??= this.constructor.scaledHillData(this.regionDocument);
    const draw = new Draw(this.curveGraphics);
    draw.clearDrawings();

    // Draw thin lines to the control points.
    draw.segment({ a: start, b: cp1 }, { width: 2, color: Draw.COLORS.gray, alpha: 0.5 });
    draw.segment({ a: end, b: cp2 }, { width: 2, color: Draw.COLORS.gray, alpha: 0.5 });

    // Draw the "floor" for the curve.
    using baseEnd = PIXI.Point.tmp.set(end.x, start.y);
    draw.segment({ a: start, b: baseEnd },
      { width: 2, color: Draw.COLORS.green, alpha: 0.5, dashLength: 5, gapLength: 2 });

    // Draw the orientation line for the curve.
    using lrCenter = PIXI.Point.midPoint(left, right)
    draw.segment({ a: left, b: right }, { width: 4, color: Draw.COLORS.orange, alpha: 1 });
    draw.point(lrCenter, { radius: 6, color: Draw.COLORS.orange, alpha: 1, fill: Draw.COLORS.orange  });

    // Draw the main curve.
    draw.curve(start, cp1, cp2, end, { width: 4, color: Draw.COLORS.green, alpha: 1 });
  }

  // ----- NOTE: Scaling and normalization ----- //

  /**
   * Convert a world point to the curve model.
   * @param {PIXI.Point} point
   * @param {PIXI.Point} origin
   * @param {PIXI.Point} scale
   * @returns {PIXI.Point}
   */
  static toModel(point, origin, scale, out) {
    out ??= PIXI.Point.tmp;
    return point.subtract(origin, out).divide(scale, out);
  }

  /**
   * Convert a curve model point to a world point.
   * @param {PIXI.Point} point
   * @param {PIXI.Point} origin
   * @param {PIXI.Point} scale
   * @returns {PIXI.Point}
   */
  static toWorld(point, origin, scale, out) {
    out ??= PIXI.Point.tmp;
    return point.multiply(scale, out).add(origin, out);
  }

  /**
   * Duplicate a curve
   * @param {BézierCurve} curve
   * @returns {BézierCurve} New curve
   */
  static duplicateCurve(curve) {
    const newCurve = {};
    for ( const [key, pt] of Object.entries(curve) ) newCurve[key] = pt.clone();
    return newCurve;
  }

  /**
   * The single source of truth for mapping curve/orientation data between "model space"
   * (what is stored on the region flag, and what elevation math is evaluated against)
   * and "world/pixel space" (what is drawn and dragged on the canvas).
   *
   * Every scale/normalize pair below must derive its origin and scale from here--and
   * ONLY from here, never from the curve data being transformed. That is what makes
   * each pair a true inverse of the other, so save -> load is lossless.
   *
   * Note that curveScale.x and curveScale.y are numerically equal here, but that is
   * a UI layout choice, not a requirement: they are always applied as two independent
   * per-axis factors (never combined into one shared magnitude), which is what keeps
   * a curve's horizontal extent and its elevation from affecting one another.
   * @param {RegionDocument} regionD
   * @returns {object}
   * - @prop {PIXI.Point} curveOrigin
   * - @prop {PIXI.Point} curveScale
   * - @prop {PIXI.Point} orientationOrigin
   * - @prop {number} orientationScale
   */
  static regionReferenceCurveParameters(regionD) {
    const bounds = regionD.bounds;
    const center = bounds.center;

    // Where the curve-shape editing widget is drawn, and how large--purely a UI
    // layout choice. It has no bearing on the elevation values the curve represents,
    // because hillEvaluationData (used for z lookups) never applies curveScale.
    const curveLength = Math.max(bounds.width * 0.5, canvas.grid.size * 2);
    const widgetHeight = Math.max(bounds.height * 0.6, canvas.grid.size * 0.5);
    return {
      curveOrigin: PIXI.Point.tmp.set(center.x - (curveLength * 0.5), bounds.top + widgetHeight),
      curveScale: PIXI.Point.tmp.set(curveLength, curveLength),
    }
  }

  static regionReferenceOrientationParameters(regionD) {
    const bounds = regionD.bounds;
    const center = bounds.center;

    // Where the curve-shape editing widget is drawn, and how large--purely a UI
    // layout choice. It has no bearing on the elevation values the curve represents,
    // because hillEvaluationData (used for z lookups) never applies curveScale.
    return {
      orientationOrigin: PIXI.Point.tmp.copyFrom(center),
      orientationScale: PIXI.Point.tmp.set(bounds.width * 0.5, bounds.width * 0.5),
    }
  }



  /**
   * Convert a world/pixel-space curve shape back to model space for storage.
   * The exact inverse of scaleBezierForRegion. x (ridge position) and y (elevation)
   * are normalized independently, so a tall peak can no longer compress the curve's
   * horizontal extent, or vice versa.
   *
   * "start" is treated as a movable pivot rather than a stored position: the curve is
   * normalized relative to wherever start currently sits on screen (not to curveOrigin),
   * because only the shape relative to start carries meaning--the widget's absolute
   * position on the canvas does not. That is also why start is always saved as {0, 0}.
   * @param {RegionDocument} regionD
   * @param {BézierCurve} curve       start/cp1/cp2/end
   * @param {BézierCurve} [out]       where to save the result
   * @returns {BézierCurve}
   */
  static normalizeBezier(regionD, curve, out) {
    const { curveScale } = this.regionReferenceCurveParameters(regionD);
    const { start, cp1, cp2, end } = curve;

    out ??= {
      ...curve,
      start: PIXI.Point.tmp.set(0, 0),
      cp1: PIXI.Point.tmp.set(0, 0),
      cp2: PIXI.Point.tmp.set(0, 0),
      end: PIXI.Point.tmp.set(0, 0),
    };
    this.toModel(cp1, start, curveScale, out.cp1);
    this.toModel(cp2, start, curveScale, out.cp2);
    this.toModel(end, start, curveScale, out.end);
    out.start.set(0, 0); // Last in case out === curve.
    return out;
  }

  /**
   * Scale a model-space curve shape to world/pixel space for display on this region.
   * The exact inverse of normalizeBezier. See regionReferenceCurveParameters for why x and y
   * are scaled independently.
   * @param {RegionDocument} regionD
   * @param {BézierCurve} curve      start/cp1/cp2/end
   * @param {BézierCurve} [out]       where to save the result
   * @returns {BézierCurve}
   */
  static scaleBezierForRegion(regionD, curve, out) {
    const { curveOrigin, curveScale } = this.regionReferenceCurveParameters(regionD);
    const { cp1, cp2, end } = curve;
    out ??= {
      ...curve,
      start: PIXI.Point.tmp,
      cp1: PIXI.Point.tmp,
      cp2: PIXI.Point.tmp,
      end: PIXI.Point.tmp,
    };
    this.toWorld(cp1, curveOrigin, curveScale, out.cp1);
    this.toWorld(cp2, curveOrigin, curveScale, out.cp2);
    this.toWorld(end, curveOrigin, curveScale, out.end);
    out.start.copyFrom(curveOrigin);
    return out;


  }

  /**
   * Convert world/pixel-space orientation points (left/right) back to model space
   * (a fraction of the region's radius from its center) for storage. The exact
   * inverse of scaleCurveOrientationForRegion--uses the same origin/scale, never
   * a scale derived from left/right themselves, so a short orientation line no
   * longer gets stretched back out to the region's full radius on save.
   * @param {RegionDocument} regionD
   * @param {BézierCurve} curve      left/right
   * @param {BézierCurve} [out]       where to save the result
   * @returns {BézierCurve}
   */
  static normalizeCurveOrientationForRegion(regionD, curve, out) {
    const { orientationOrigin, orientationScale } = this.regionReferenceOrientationParameters(regionD);
    const { left, right } = curve;
    out ??= {
      ...curve,
      left: PIXI.Point.tmp,
      right: PIXI.Point.tmp,
    };
    this.toModel(left, orientationOrigin, orientationScale, out.left);
    this.toModel(right, orientationOrigin, orientationScale, out.right);
    return out;
  }

  /**
   * Scale model-space orientation points (left/right) to world/pixel space for this
   * region. The exact inverse of normalizeCurveOrientationForRegion.
   * @param {RegionDocument} regionD
   * @param {BézierCurve} curve      left/right modified
   * @param {BézierCurve} [out]       where to save the result
   * @returns {BézierCurve}
   */
  static scaleCurveOrientationForRegion(regionD, curve, out) {
    const { orientationOrigin, orientationScale } = this.regionReferenceOrientationParameters(regionD);
    const { left, right } = curve;
    out ??= {
      ...curve,
      left: PIXI.Point.tmp,
      right: PIXI.Point.tmp,
    };
    this.toWorld(left, orientationOrigin, orientationScale, out.left);
    this.toWorld(right, orientationOrigin, orientationScale, out.right);
    return out;
  }


  // ----- NOTE: Curve calculation ----- //

  /**
   * Flat baseline curve.
   */
  static defaultCurve() {
    // Curve points.
    const start = PIXI.Point.tmp.set(0, 0);
    const end = PIXI.Point.tmp.set(1, 0);
    const cp1 = PIXI.Point.tmp.set(0.25, 0);
    const cp2 = PIXI.Point.tmp.set(0.75, 0);

    // Orientation points, relative to a center.
    // Placed at the region bounds along the x axis.
    const left = PIXI.Point.tmp.set(-1, 0);
    const right = PIXI.Point.tmp.set(1, 0);

    const curve = { start, end, cp1, cp2, left, right };
    return curve;
  }

  /**
   * @typedef {BézierCurve}
   * @prop {PIXI.Point} start
   * @prop {PIXI.Point} cp1
   * @prop {PIXI.Point} cp2
   * @prop {PIXI.Point} end
   *
   * Optional orientation:
   * @prop {PIXI.Point} [left]      Where the hill starts on the 2d canvas.
   * @prop {PIXI.Point} [right]     Where the hill ends on the 2d canvas.
   *
   * Points are always entirely in one space or the other--never mixed--except for
   * the object returned by hillEvaluationData; see that method for why.
   *   - Model space (as stored on the region flag): start is always {0, 0}; cp1/cp2/end
   *     are relative to start, in units of the curve's own width (not tied to region
   *     size). left/right are a fraction of the region's radius from its center.
   *   - World/pixel space (as drawn and dragged on the canvas): ordinary scene coordinates.
   */

  /**
   * Retrieve hill curve data for a region, in model space (as stored on the flag).
   * @param {RegionDocument} regionD
   * @returns {BézierCurve|null}
   */
  static _unadjustedHillData(regionD) {
    const hillData = regionD.getFlag(MODULE_ID, FLAGS.REGION.HILL.CURVE);
    if ( !hillData || hillData.length !== 10 ) return null;

    // Shape of the curve.
    // Curve is relative to the
    const start = PIXI.Point.tmp.set(0, 0);
    const cp1 = PIXI.Point.tmp.set(hillData[0], hillData[1])
    const cp2 = PIXI.Point.tmp.set(hillData[2], hillData[3])
    const end = PIXI.Point.tmp.set(hillData[4], hillData[5]);

    // Orientation of the hill.
    const left = PIXI.Point.tmp.set(hillData[6], hillData[7]);
    const right = PIXI.Point.tmp.set(hillData[8], hillData[9]);

    return { start, cp1, cp2, end, left, right };
  }

  /**
   * Return curve data for a given region, fully in world/pixel space, for drawing
   * and dragging the interactive UI handles. Do NOT use this for elevation lookups--
   * see hillEvaluationData--because its y values have been resized to fit the on-screen
   * widget and no longer represent a clean elevation fraction.
   * @param {RegionDocument} regionD
   * @returns {BézierCurve}
   */
  static scaledHillData(regionD) {
    const curve = this._unadjustedHillData(regionD) ?? this.defaultCurve();

    // Scale the curve and orientation to fit the region.
    this.scaleBezierForRegion(regionD, curve, curve);
    this.scaleCurveOrientationForRegion(regionD, curve, curve);
    return curve;
  }

  /**
   * Return curve data for a given region, suitable for evaluating a hill's z-height
   * at a canvas point (see hillZAtPoint). This is a deliberate mix of spaces:
   *   - left/right are scaled to world/pixel space, because they are compared
   *     geometrically against canvas points.
   *   - start/cp1/cp2/end are left in model space, because their y values are
   *     elevation *fractions*--unrelated to region size--and are only ever
   *     multiplied by the region's plateau elevation at evaluation time. Scaling
   *     them here would make elevation depend on the region's on-screen width,
   *     which is exactly the bug this split is meant to avoid.
   * @param {RegionDocument} regionD
   * @returns {BézierCurve}
   */
  static hillEvaluationData(regionD) {
    const curve = this._unadjustedHillData(regionD) ?? this.defaultCurve();
    this.scaleCurveOrientationForRegion(regionD, curve, curve);
    return curve;
  }

  /**
   * Store hill curve data for a region. Expects a model-space curve (see typedef).
   * @param {RegionDocument} regionD
   * @param {BézierCurve} curve
   */
  static async saveHillDataForRegion(regionD, curve) {
    if ( curve.start.x !== 0 || curve.start.y !== 0 ) throw Error("saveHillDataForRegion|curve must be normalized (start at the model origin).");
    const { end, cp1, cp2, left, right } = curve;
    const curveArray = [
      cp1.x, cp1.y,
      cp2.x, cp2.y,
      end.x, end.y,
      left.x, left.y,
      right.x, right.y];
    await regionD.setFlag(MODULE_ID, FLAGS.REGION.HILL.CURVE, curveArray);
  }

  /**
   * Normalize and save region curve data.
   * @param {BézierCurve} curve
   */
  async saveScaledHillData(curve) {
    curve = this.constructor.duplicateCurve(curve);
    this.constructor.normalizeBezier(this.regionDocument, curve, curve);
    this.constructor.normalizeCurveOrientationForRegion(this.regionDocument, curve, curve);
    await this.constructor.saveHillDataForRegion(this.regionDocument, curve);
    Object.values(curve).forEach(pt => pt.release());
  }


  /**
   * Translate the Bézier hill data so that it is along the x origin, where the
   * y values represent elevation.
   * @param {BézierCurve} curve
   * @param {BézierCurve} [out]
   * @returns {BézierCurve} The curve
   */
  static translateCurveToOrigin(curve, out) {
    out ??= this.constructor.duplicateCurve(curve);

    using delta = curve.end.subtract(curve.start);
    const angle = Math.atan2(delta.y, delta.x);
    using negStart = curve.start.multiplyScalar(-1);
    using txMat = MatrixFloat32.translation(negStart, { d3: false });
    using rotMat = MatrixFloat32.rotationZ(angle, { d3: false });
    using M = rotMat.multiply3x3(txMat);
    M.multiplyPoint2d(curve.start, out.start);
    M.multiplyPoint2d(curve.end, out.end);
    M.multiplyPoint2d(curve.cp1, out.cp1);
    M.multiplyPoint2d(curve.cp2, out.cp2);
    return out;
  }

  /**
   * Find the maximum height of a cubic Bézier curve relative to its baseline.
   * May return a negative height.
   */
  static curveHeight(curve) {
    const { start, cp1, cp2, end } = curve;
    using deltaStartEnd = end.subtract(start);
    const len2 = deltaStartEnd.magnitudeSquared();
    if ( len2 === 0 ) return 0; // Curve start, end identical.

    const orient2d = foundry.utils.orient2dFast;
    const invLen = 1 / Math.sqrt(len2);
    const h1 = orient2d(start, end, cp1) * invLen;
    const h2 = orient2d(start, end, cp2) * invLen;

    // Quadratic coefficients for derivative of the equation of the signed distance of P from baseline.
    // Take the signed perpendicular distance and substitute the cubic Bézier formula.
    // Leaves us with: h(t) = 3(1 - t)^2 * h1 + 3(1 - t)^2 * h2
    // Take the derivative h'(t) = 0. to get At^2 + Bt + C = 0.
    const A = 3 * (h1 - h2);
    const B = (2 * h2) - (4 * h1);
    const C = h1;
    const tValues = [0, 1]; // Always evaluate boundaries.

    const EPSILON = 1e-08;
    if ( Math.abs(A) < EPSILON ) {
      if ( Math.abs(B) > EPSILON ) {
        const t = -C / B;
        if ( t >= 0 && t <= 1 ) tValues.push(t);
      }
    } else {
      const disc = (B * B) - (4 * A * C);
      if ( disc >= 0 ) {
        const sqrtDisc = Math.sqrt(disc);
        const invDenom = 1 / (2 * A);
        const t1 = (-B + sqrtDisc) * invDenom;
        const t2 = (-B - sqrtDisc) * invDenom;
        if ( t1 >= 0 && t1 <= 1 ) tValues.push(t1);
        if ( t2 >= 0 && t2 <= 1 ) tValues.push(t2);
      }
    }

    // Evaluate critical points to find the peak.
    let maxH = 0;
    let maxAbsH = 0;
    for ( const t of tValues ) {
      const mt = 1 - t;
      const hVal = (3 * mt * mt * t * h1) + (3 * mt * t * t * h2);
      if ( Math.abs(hVal) > maxAbsH ) {
        maxAbsH = Math.abs(hVal);
        maxH = hVal;
      }
    }
    return maxH;
  }

  /**
   * Scales control points perpendicularly away or toward the baseline.
   * Leaves start and end points untouched.
   * @param {BézierCurve} curve
   * @param {number} [scaleFactor=1]
   * @param {BézierCurve} [out]
   * @returns {BézierCurve}
   */
  static scaleCurvePerpendicular(curve, { scaleFactor = 1, out } = {}) {
    out ??= this.constructor.duplicateCurve(curve);
    const { start, cp1, cp2, end } = curve;
    using delta = end.subtract(start);
    const len2 = delta.magnitudeSquared()
    if ( len2.almostEqual(0) ) return curve;

    using tmp = PIXI.Point.tmp;
    const scalePoint = (p, out) => {
      // Project point onto the baseline vector to locate baseline anchor point.
      using deltaP = p.subtract(start);
      const u = deltaP.dot(delta) / len2;
      using proj = start.add(delta.multiplyScalar(u, tmp));

      // Adjust distance from the baseline anchor by scale factor.
      using deltaProj = p.subtract(proj);
      proj.add(deltaProj.multiplyScalar(scaleFactor, tmp), out);
    }

    scalePoint(cp1, out.cp1);
    scalePoint(cp2, out.cp2);
    return out;
  }

  /**
   * Scale a curve to a target height.
   * @param {BézierCurve} curve
   * @param {number} [targetHeight=1]
   * @param {BézierCurve} [out]
   * @returns {BézierCurve}
   */
  static scaleCurveElevation(curve, { targetHeight = 1, out } = {}) {
    out ??= this.constructor.duplicateCurve(curve);
    const maxH = Math.abs(this.curveHeight(curve));
    if ( maxH.almostEqual(0) ) return out;

    // Compute positive scaling factor based on absolute peak.
    const scaleFactor = targetHeight / maxH;
    return this.scaleCurvePerpendicular(curve, { scaleFactor, out });
  }

  // ----- NOTE: Curve polygon ----- //

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
   * Create a polygon representing the vertical cut of the hill.
   * Uses adaptive spacing for the points on the curve.
   * @param {BézierCurve} curve
   * @param {number} [tolerance=0.5]      Pixel tolerance; lower --> higher resolution near peaks
   * @returns {PIXI.Polygon}
   */
  static generateHillPolygonAdaptive(curve, tolerance = 0.5) {
    const points = [curve.start, ...subdivideCurve(curve, tolerance)];
    return new PIXI.Polygon(points);
  }

  // ----- NOTE: Curve elevation ----- //

  /**
   * Get the z value for a 2d point based on a Bézier hill profile.
   * @param {RegionDocument} regionD
   * @param {PIXI.Point} pt             Point to test
   * @param {"linear"|"symmetrical"|"ridge"} [type="linear"]
   *   - linear: The hill has a defined linear direction and is the same at parallel lines to start|end.
   *   - symmetrical: Half the hill is rotated around its center point (center of start|end).
   *   - ridge: The hill defines the ridge line, and falls back proportionally on the sides.
   * @param {BézierCurve} [curve]     Curve data as returned by hillEvaluationData
   *   (left/right in world/pixel space, start/cp1/cp2/end in model space). Do NOT
   *   pass the result of scaledHillData here--its shape has been resized to fit
   *   the on-screen editing widget and no longer represents a clean elevation fraction.
   * @returns {number} Z height or 0 if outside the radius of the curve.
   */
  static hillZAtPoint(regionD, pt, type = "linear", curve) {
    if ( !curve ) curve = this.scaledHillData(regionD);
    const percent = this._hillPercentHeightAtPoint(pt, type, curve);

    // Take the hill height percentage and scale to the region terrain.
    const zBottom = this.terrainBottom(regionD);
    const zHeight = this.terrainTop(regionD) - zBottom;
    return zBottom + (zHeight * percent);
  }

  /**
   * Same as hillZAtPoint but expects the scaled orientation curve.
   * @param {PIX.Point} pt                    Point to test
   * @param {"linear"|"symmetrical"|"ridge"}  type
   * @param {BézierCurve} evaluationCurve     As returned by hillEvaluationData: left/right
   *   in world/pixel space, start/cp1/cp2/end in model space (elevation fractions).
   * @returns {number} Percentage height, or 0 if outside the curve.
   */

  static _hillPercentHeightAtPoint(pt, type, evaluationCurve) {
    const { start, cp1, cp2, end, left, right } = evaluationCurve;

    // Center of the hill.
    using center = PIXI.Point.tmp;
    left.add(right, center).multiplyScalar(0.5, center);

    // Maximum radius of the hill base.
    const radius = PIXI.Point.distanceBetween(left, center);

    // Set t dependent on how the curve is mapped to the XY surface.
    let t = 0;
    switch ( type ) {
      case "linear": {
        // Oriented hill.
        // Rectangular hill base stretching infinitely in the normal to start|end.
        const pointOnLine = foundry.utils.closestPointToSegment(pt, left, right);
        t = PIXI.Point.distanceBetween(left, pointOnLine) / (radius * 2);
        break;
      }
      case "symmetrical": {
        // Curve start at center, curve end is furthest from center.
        const dist = PIXI.Point.distanceBetween(pt, center);
        t = dist / radius;

        // Interpret left.x > right.x as flipped curve, where end starts at the center.
        if ( left.x > right.x ) t = 1 - t;
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
        using delta = right.subtract(left);
        const length2 = delta.dot2();
        if ( length2.almostEqual(0) ) return 0;

        // Project target point onto the ridge line.
        /* Original:
        const u = ((pt.x - start.x) * dx + (pt.y - start.y) * dy) / length2;
        */
        const u = pt.subtract(left, tmp).dot(delta) / length2;
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
        const closest = left.add(delta.multiplyScalar(u, tmp));
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
        if ( u < 0.5 ) t = u * (1 - slopeProgress);
        else t = u + (1 - u) * slopeProgress;
        break;
      }
      default: t = 0.5;
    }

    if ( t.almostEqual(0) ) t = 0;
    if ( t.almostEqual(1) ) t = 1;
    if ( !t.between(0, 1) ) return 0;

    // Evaluate the Bézier equation for z.
    // Distance from the XY point to the start|end base.
    // Because the curve control points are normalized, the base is at y === 0.
    const y = bezierValue(t, start.y, cp1.y, cp2.y, end.y);
    return -y; // Y axis is inverted in Foundry, so multiply by -1.
  }
}

// ----- NOTE: Helper functions ----- //

/**
 * Calculate a value along the Bézier curve.
 * @param {number} t      Distance along the curve.
 * @param {number} start
 * @param {number} cp1
 * @param {number} cp2
 * @param {number} end
 * @returns {number}
 */
export function bezierValue(t, start, cp1, cp2, end) {
  t = Math.clamp(t, 0, 1);
  const mt = 1 - t;
  const mt2 = mt * mt;
  const mt3 = mt2 * mt;
  const t2 = t * t;
  const t3 = t2 * t;
  return (mt3 * start) + (3 * mt2 * t * cp1) + (3 * mt * t2 * cp2) + (t3 * end);
}

/**
 * Recursively subdivide a curve using De Casteljau's algorithm, based on flatness.
 * @param {BézierCurve} curve     Curve data
 * @returns {PIXI.Point[]} Points along the curve
 */
function subdivideCurve(curve, tolerance) {
  tolerance ||= CONFIG[MODULE_ID].polygonCurveTolerance || 1.0;
  // Calculate flatness metric (approximation of second derivative).
  using d1 = PIXI.Point.tmp.set(
    curve.cp1.x - (2 * curve.cp2.x) + curve.end.x,
    curve.cp1.y - (2 * curve.cp2.y) + curve.end.y,
  );
  using d2 = PIXI.Point.tmp.set(
    curve.start.x - (2 * curve.cp1.x) + curve.cp2.x,
    curve.start.y - (2 * curve.cp1.y) + curve.cp2.y,
  );
  const flatness = Math.max(d1.dot2(), d2.dot2());

  // If flat enough, stop dividing and return the point.
  if ( flatness <= (tolerance * tolerance) ) return [curve.end.clone()];

  // Not flat enough: Subdivide into two halves using De Casteljau's algorithm.
  using l1 = PIXI.Point.tmp;
  using l2 = PIXI.Point.tmp;
  using r1 = PIXI.Point.tmp;
  using r2 = PIXI.Point.tmp;
  using h = PIXI.Point.tmp;
  using mid = PIXI.Point.tmp;

  // Left side control points.
  curve.start.add(curve.cp1, l1).multiplyScalar(0.5, l1); // l1
  curve.cp1.add(curve.cp2, h).multiplyScalar(0.5, h);     // h
  l1.add(h, l2).multiplyScalar(0.5, l2);                  // l2

  // Right side control points.
  curve.cp2.add(curve.end, r2).multiplyScalar(0.5, r2);   // r2
  h.add(r2, r1).multiplyScalar(0.5, r1);                  // r1

  // Midpoint sharing both curves.
  l2.add(r1, mid).multiplyScalar(0.5, mid);               // mid

  // Handle left, then right.
  return [
    ...subdivideCurve({ start: curve.start, cp1: l1, cp2: l2, end: mid }, tolerance),
    ...subdivideCurve({ start: mid, cp1: r1, cp2: r2, end: curve.end }, tolerance),
  ];
}