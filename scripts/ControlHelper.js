/* globals
canvas
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

/**
 * Handle when a given control is used, with special handling of mouse clicks depending
 * on the tool. Most methods here intended to be overriden.
 */
export class ControlHelper {
  /** @type {TerrainLayer} */
  tm = canvas.terrain;

  /**
   * Handle a click left.
   * If polygon is in progress, continue.
   * @param {PIXI.InteractionEvent} event
   */
  _onClickLeft(_event) {}

  /**
   * Handle a double-click left.
   * If polygon is in progress, conclude.
   * @param {PIXI.InteractionEvent} event
   */
  _onClickLeft2(_event) {}

  /**
   * Handle a right click.
   * @param {PIXI.InteractionEvent} event
   */
  _onClickRight(_event) {}

  /**
   * Handle a click left.
   * If polygon is in progress, continue.
   * @param {PIXI.InteractionEvent} event
   */
  _onDragLeftStart(_event) {}

  /**
   * Handle a drag move.
   * @param {PIXI.InteractionEvent} event
   */
  _onDragLeftMove(_event) {}

  /**
   * Handle a mouse-up event after dragging.
   * @param {PIXI.InteractionEvent} event
   */
  async _onDragLeftDrop(_event) {}

  /**
   * Handle a drag cancel.
   * @param {PIXI.InteractionEvent} event
   */
  _onDragLeftCancel(_event) {}
}
