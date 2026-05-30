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
import { pixelsToGridUnits } from "../geometry/util.js";

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
}