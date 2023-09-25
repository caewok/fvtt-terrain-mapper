/* globals
canvas
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

/**
 * Handle when the fill-by-grid control is used.
 */
export class FillByGridHelper {

  /** @type {TerrainLayer} */
  tm = canvas.terrain;

  /**
   * Handle a click left.
   * @param {PIXI.InteractionEvent} event
   */
  _onClickLeft(event) {
    const o = event.interactionData.origin;
    this._setTerrainForGridSpace(o, { temporary: false });
  }

  /**
   * Handle a drag left start by adding the origin point as a terrain square.
   * @param {PIXI.InteractionEvent} event
   */
  _onDragLeftStart(event) {
    this.tm._clearTemporaryGraphics(); // Just in case.
    const o = event.interactionData.origin;
    this._setTerrainForGridSpace(o);
  }

  /**
   * Handle a drag left move by adding the destination square.
   * @param {PIXI.InteractionEvent} event
   */
  _onDragLeftMove(event) {
    const d = event.interactionData.destination;
    this._setTerrainForGridSpace(d);
  }

  /**
   * Handle a drag left drop by converting temp to permanent.
   * @param {PIXI.InteractionEvent} event
   */
  _onDragLeftDrop(_event) {
    this.tm._makeTemporaryGraphicsPermanent();
    this.tm._requiresSave = true;
  }

  /**
   * Handle a drag left cancel by removing the temp graphics.
   * @param {PIXI.InteractionEvent} event
   */
  _onDragLeftCancel(_event) { this.tm._clearTemporaryGraphics(); }

  /**
   * Set the grid space to the current terrain value.
   * @param {PIXI.Point} pt   Point to use to define the grid square.
   */
  _setTerrainForGridSpace(pt, { temporary = true } = {}) {
    const currT = this.tm.toolbar.currentTerrain;
    this.tm.setTerrainForGridSpace(pt, currT, { temporary });
  }
}
