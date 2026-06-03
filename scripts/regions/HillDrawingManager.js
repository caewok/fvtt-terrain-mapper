/* globals
canvas,
foundry,
PIXI,
ui,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID, FLAGS } from "../const.js";
import { Draw } from "../geometry/Draw.js";
import { gridUnitsToPixels } from "../geometry/util.js";

/**
 * Allows the user to define a bezier curve to represent a hill in a region.
 */
export class HillDrawingManager {

  /** @type {boolean} */
  static active = false;

  /** @type {PIXI.Container} */
  static container = new PIXI.Container();

  /** @type {Map<Region, PIXI.Container>} */
  static regionContainers = new Map();

  /**
   * Start monitoring for mouse movements.
   */
  static activate() {
    this.active = true;

    // Initialize the UI for every region in the scene.
    for ( const region of canvas.regions.placeables ) this._activateRegionUI(region)


    // TODO: Temp Hook region creation and deletion to update.


    // Add PIXI.Graphics objects to the canvas.
    this.container.zIndex = 1000;
    canvas.controls.addChild(this.container);
    canvas.controls.sortableChildren = true;
  }

  // TODO: Add destroy and hook canvas takedown.

  /**
   * End monitoring for mouse movements.
   */
  static deactivate() {
    this.active = false;
    canvas.controls.removeChild(this.container);

    // Turn off draggability?
    // for ( const region of canvas.region.placeables ) this._deactivateRegionUI(region);

  }

  /**
   * Initialize the curve and interaction handles for a specific region.
   */
  static _activateRegionUI(region) {
    const defaultCurve = this._defaultCurve(region);
    const curveData = this._unadjustedHillDataForRegion(region) || defaultCurve;

    // Create or retrieve container for region's UI elements.
    if ( !this.regionContainers.has(region) ) {
      const regionUI = new PIXI.Container();
      const curveGraphics = new PIXI.Graphics();
      regionUI.addChild(curveGraphics);

      // Graphics for the region bounds.
      const boundsGraphics = new PIXI.Graphics();
      regionUI.addChild(boundsGraphics);
      boundsGraphics.zIndex = 1;

      // Create interactive handles.
      const startHandle = this._createHandle(Draw.COLORS.red);
      const endHandle = this._createHandle(Draw.COLORS.red);
      const cp1Handle = this._createHandle(Draw.COLORS.blue);
      const cp2Handle = this._createHandle(Draw.COLORS.blue);
      regionUI.addChild(startHandle, endHandle, cp1Handle, cp2Handle);

      // Add to the overall container.
      this.container.addChild(regionUI);

      // Store for future use.
      this.regionContainers.set(region, {
        regionUI,
        curveGraphics,
        boundsGraphics,
        startHandle,
        endHandle,
        cp1Handle,
        cp2Handle,
      });
    }

    const {
        curveGraphics,
        boundsGraphics,
        startHandle,
        endHandle,
        cp1Handle,
        cp2Handle } = this.regionContainers.get(region);

    // Update handles.
    this._updateHandle(startHandle, curveData.start);
    this._updateHandle(endHandle, curveData.end);
    this._updateHandle(cp1Handle, curveData.cp1);
    this._updateHandle(cp2Handle, curveData.cp2);

    // Draw the curve.
    this._drawCurve(curveGraphics, curveData);

    // Bind drag logic to the handles
    const updateCurve = () => {
      // Update the curveData object with the new handle positions
      curveData.start = { x: startHandle.x, y: startHandle.y };
      curveData.end = { x: endHandle.x, y: endHandle.y };
      curveData.cp1 = { x: cp1Handle.x, y: cp1Handle.y };
      curveData.cp2 = { x: cp2Handle.x, y: cp2Handle.y };

      this._drawCurve(curveGraphics, curveData);

      // Draw the bounds
      this._drawBounds(boundsGraphics, region);

    };

    const saveCurve = async () => {
      const curveArray = [curveData.start.x, curveData.start.y, curveData.cp1.x, curveData.cp1.y, curveData.cp2.x, curveData.cp2.y, curveData.end.x, curveData.end.y];
      await region.document.setFlag(MODULE_ID, FLAGS.REGION.HILL.CURVE, curveArray);
      ui.notifications.info(`Hill curve saved to region: ${region.document.name}`);

      boundsGraphics.clear();
    };

    this._makeDraggable(startHandle, updateCurve, saveCurve, endHandle, defaultCurve.start);
    this._makeDraggable(endHandle, updateCurve, saveCurve, startHandle, defaultCurve.end);
    this._makeDraggable(cp1Handle, updateCurve, saveCurve, cp2Handle, defaultCurve.cp1);
    this._makeDraggable(cp2Handle, updateCurve, saveCurve, cp1Handle, defaultCurve.cp2);
  }

  /**
   * Attach drag-and-drop event listeners to a handle.
   */
  static _makeDraggable(handle, onDragMove, onDragEnd, pairHandle, defaultPosition) {
    const DRAG_ALPHA = 0.5;
    const HANDLE_ALPHA = 1.0;
    let dragging = false;

    handle.on("pointerdown", event => {
      event.stopPropagation();
      // console.log("pointerdown");
      dragging = true;
      handle.alpha = DRAG_ALPHA; // Visual feedback for dragging

    });

    handle.on("click", event => {
      if ( event.detail === 2 ) { // Double-click.
        event.stopPropagation();
        handle.x = defaultPosition.x;
        handle.y = defaultPosition.y;
        onDragMove();
        onDragEnd();
      }
    });

    handle.on("globalpointermove", event => {
      if (dragging) {
        event.stopPropagation();
        // console.log("globalpointermove");
        const newPosition = handle.parent.toLocal(event.global);

        // If shift is held, move the partner in tandem.
        if ( event.shiftKey ) {
          using delta = newPosition.subtract(handle);
          pairHandle.x += delta.x
          pairHandle.y += delta.y
        }

        handle.x = newPosition.x;
        handle.y = newPosition.y;
        onDragMove(); // Redraw the curve dynamically
      }
    });

    const finishDrag = event => {
      if (dragging) {
        event.stopPropagation();
        // console.log("finish");
        dragging = false;
        handle.alpha = HANDLE_ALPHA;
        onDragEnd(); // Save to database flag
      }
    };

    handle.on("pointerup", finishDrag);
    handle.on("pointerupoutside", finishDrag);
  }


  /**
   * Create a single interactive PIXI.Graphics handle.
   */
  static _createHandle(color) {
    const handle = new PIXI.Graphics;
    const circle = new PIXI.Circle(0, 0, 8);
    const draw = new Draw(handle);
    draw.shape(circle, { color, width: 2, alpha: 1 });

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
  static _drawBounds(graphics, region) {
    const center = region.center;
    const bounds = region.bounds;
    const diameter = Math.hypot(bounds.width, bounds.height);
    const draw = new Draw(graphics);
    draw.clearDrawings();
    draw.shape(new PIXI.Circle(center.x, center.y, diameter * 0.5), { width: 2, color: Draw.COLORS.brown, alpha: 0.3, fill: Draw.COLORS.brown, fillAlpha: 0.1 });
      // width: 2, color: Draw.COLORS.brown, fill: Draw.COLORS.brown, alpha: 0.2, fillAlpha: 0.2 });
  }

  /**
   * Render the Bézier curve and the visual control lines connecting the points.
   */
  static _drawCurve(graphics, curveData) {
    const { start, cp1, cp2, end } = curveData;
    const draw = new Draw(graphics);
    draw.clearDrawings();

    // Draw thin lines to the control points.
    draw.segment({ a: start, b: cp1 }, { width: 2, color: Draw.COLORS.gray, alpha: 0.5 });
    draw.segment({ a: end, b: cp2 }, { width: 2, color: Draw.COLORS.gray, alpha: 0.5 });

    // Draw the main curve.
    draw.curve(start, cp1, cp2, end, { width: 4, color: Draw.COLORS.green, alpha: 1 });
  }


  /**
   * Flat baseline curve across a region's x-axis. Passing through center.
   */
  static _defaultCurve(region) {
    const bounds = region.bounds;
    const center = region.center;

    const start = PIXI.Point.tmp.set(bounds.left, center.y);
    const end = PIXI.Point.tmp.set(bounds.right, center.y);

    // Space the control points evenly along the flat line.
    const cp1 = PIXI.Point.tmp.set(bounds.left + (bounds.width / 3), center.y);
    const cp2 = PIXI.Point.tmp.set(bounds.left + (bounds.width * 2 / 3), center.y);
    return { start, end, cp1, cp2 };
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
      await targetRegion.document.setFlag(MODULE_ID, FLAGS.REGION.HILL.CURVE, curveData);
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
   * Retrieve hill curve data for a region.
   * @param {Region} region
   * @returns {BézierCurve}
   */
  static _unadjustedHillDataForRegion(region) {
    const hillData = region.document.getFlag(MODULE_ID, FLAGS.REGION.HILL.CURVE);
    if ( !hillData || !hillData.length === 8 ) return null;

    const start = PIXI.Point.tmp.set(hillData[0], hillData[1]);
    const cp1 = PIXI.Point.tmp.set(hillData[2], hillData[3])
    const cp2 = PIXI.Point.tmp.set(hillData[4], hillData[5])
    const end = PIXI.Point.tmp.set(hillData[6], hillData[7]);
    return { start, cp1, cp2, end };
  }

  /**
   * Return curve data for a given region.
   * @param {Region} region
   * @returns {BézierCurve}
   */
  static hillDataForRegion(region) {
    const data = this._unadjustedHillDataForRegion(region);
    if ( !data ) return null;

    // Determine the intended elevation from the control points.
    const elevationE = this.region[MODULE_ID].plateauElevation ?? this.region[MODULE_ID].finiteRegionTopE;
    const elevationZ = gridUnitsToPixels(elevationE);

    using tmp = PIXI.Point.tmp;
    using normal = data.end.subtract(data.start);
    using perp = PIXI.Point.tmp.set(normal.y, -normal.x);
    using ix1 = PIXI.Point.fromObject(foundry.utils.lineLineIntersection(data.start, data.end, data.cp1, data.cp1.add(perp, tmp)));
    using ix2 = PIXI.Point.fromObject(foundry.utils.lineLineIntersection(data.start, data.end, data.cp2, data.cp2.add(perp, tmp)));

    // Adjust the control points to the exact elevation.
    ix1.towardsPoint(data.cp1, elevationZ, data.cp1);
    ix2.towardsPoint(data.cp2, elevationZ, data.cp2);

    return data;
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
   * @param {"linear"|"symmetrical"|"ridge"} [opts.type]
   *   - linear: The hill has a defined linear direction and is the same at parallel lines to start|end.
   *   - symmetrical: Half the hill is rotated around its center point (center of start|end).
   *   - ridge: The hill defines the ridge line, and falls back proportionally on the sides.
   * @returns {number} Z height or 0 if outside the radius of the curve.
   */
  static hillZAtPoint(pt, curve, type = "linear") {
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
