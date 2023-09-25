/* globals
canvas,
CONFIG,
CONST,
Drawing,
DrawingDocument,
DrawingsLayer,
foundry,
game,
getDocumentClass
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { ControlHelper } from "./ControlHelper.js";
import { TerrainPolygon } from "./TerrainPolygon.js";

/**
 * Handle when the polygon control is used.
 * Largely taken from DrawingsLayer
 */
export class FillPolygonHelper extends ControlHelper {

  /**
   * Use an adaptive precision depending on the size of the grid
   * @type {number}
   */
  get gridPrecision() {
    if ( canvas.scene.grid.type === CONST.GRID_TYPES.GRIDLESS ) return 0;
    return canvas.dimensions.size >= 128 ? 16 : 8;
  }

  /**
   * Get initial data for a new drawing.
   * @param {Point} origin      The initial coordinate
   * @returns {object}          The new drawing data
   */
  _getNewDrawingData(origin) {
    // See DrawingsLayer.prototype._getNewDrawingData
    // Get saved user defaults
    const defaults = game.settings.get("core", DrawingsLayer.DEFAULT_CONFIG_SETTING) || {};
    const data = foundry.utils.mergeObject(defaults, {
      fillColor: game.user.color,
      strokeColor: game.user.color,
      fontFamily: CONFIG.defaultFontFamily
    }, {overwrite: false, inplace: false});

    // Mandatory additions
    delete data._id;
    origin = canvas.grid.getSnappedPosition(origin.x, origin.y, this.gridPrecision);
    data.x = origin.x;
    data.y = origin.y;
    data.author = game.user.id;
    data.shape = {};

    // Polygon additions
    data.shape.type = Drawing.SHAPE_TYPES.POLYGON;
    data.shape.points = [0, 0];
    data.bezierFactor = 0;

    return data;
  }

  /**
   * Handle a click left.
   * If polygon is in progress, continue.
   * @param {PIXI.InteractionEvent} event
   */
  _onClickLeft(event) {
    const { preview, drawingsState, destination } = event.interactionData;
    if ( !drawingsState || !preview ) return;

    if ( drawingsState >= 1 ) {
      let point = destination;
      const snap = !event.shiftKey;
      preview._addPoint(point, {snap, round: true});
      preview._chain ||= true; // Note that we are now in chain mode.
      return preview.refresh();
    }

    // Standard left-click handling.
    // super._onClickLeft(event);

  }

  /**
   * Handle a click left.
   * If polygon is in progress, continue.
   * @param {PIXI.InteractionEvent} event
   */
  async _onDragLeftStart(event) {
    // ----- From PlaceablesLayer.prototype._onDragLeftStart
    const interaction = event.interactionData;

    // Clear any existing preview
    this.tm.clearPreviewContainer();

    // Snap the origin to the grid
    if ( !event.isShift ) {
      interaction.origin =
        canvas.grid.getSnappedPosition(interaction.origin.x, interaction.origin.y, this.gridPrecision);
    }

    // Register the ongoing creation
    interaction.layerDragState = 1;

    // ----- From DrawingsLayer.prototype._onDragLeftStart
    const cls = getDocumentClass("Drawing");
    const document = new cls(this._getNewDrawingData(interaction.origin), {parent: canvas.scene});
    const drawing = new DrawingsLayer.placeableClass(document);
    drawing.document.strokeWidth = 2;
    interaction.preview = this.tm.preview.addChild(drawing);
    interaction.drawingsState = 1;
    return drawing.draw();
  }

  /**
   * Handle a double-click left.
   * If polygon is in progress, conclude.
   * @param {PIXI.InteractionEvent} event
   */
  _onClickLeft2(event) {
    const { drawingsState, preview } = event.interactionData;

    // Conclude polygon placement with double-click
    if ( (drawingsState >= 1) && preview.isPolygon ) {
      event.interactionData.drawingsState = 2;
      return this._onDragLeftDrop(event);
    }

    // Standard double-click handling
    // super._onClickLeft2(event);
  }

  /**
   * Handle a drag move.
   * @param {PIXI.InteractionEvent} event
   */
  _onDragLeftMove(event) {
    const {preview, drawingsState} = event.interactionData;
    if ( !preview || preview._destroyed ) return;
    if ( preview.parent === null ) { // In theory this should never happen, but rarely does
      this.preview.addChild(preview);
    }
    if ( drawingsState >= 1 ) { preview._onMouseDraw(event); }
  }

  /**
   * Handle a mouse-up event after dragging.
   * @param {PIXI.InteractionEvent} event
   */
  async _onDragLeftDrop(event) {
    const {drawingsState, destination, origin, preview} = event.interactionData;

    // In-progress polygon
    if ( (drawingsState === 1) ) {
      event.preventDefault();
      if ( preview._chain ) return;
      return this._onClickLeft(event);
    }

    // Successful drawing completion
    if ( drawingsState === 2 ) {
      const distance = Math.hypot(Math.max(destination.x, origin.x) - preview.x,
        Math.max(destination.y, origin.x) - preview.y);
      const minDistance = distance >= (canvas.dimensions.size / 8);
      const completePolygon = preview.document.shape.points.length > 4;

      // Create a completed drawing
      if ( minDistance && completePolygon ) {
        event.interactionData.clearPreviewContainer = false;
        event.interactionData.drawingsState = 0;
        const data = preview.document.toObject(false);

        // Close the drawing.
        data.shape.points.push(data.shape.points[0], data.shape.points[1]);

        // Wipe the preview.
        preview._chain = false;
        this.tm.clearPreviewContainer();

        // Create the terrain shape and move to correct position.
        const shape = (new TerrainPolygon(data.shape.points)).translate(data.x, data.y);


        // Set the shape in the terrain set.
        // TODO: Allow user to modify after placement.
        //   Probably part of a larger overhaul to allow editing of terrain placeables.
        const currT = this.tm.toolbar.currentTerrain;
        shape.pixelValue = currT.pixelValue;
        this.tm.addTerrainShapeToCanvas(shape, currT);

        // Create the object
//         preview._chain = false;
//         const cls = getDocumentClass("Drawing");
//         const createData = DrawingsLayer.placeableClass.normalizeShape(data);
//         let drawing;
//         try {
//           drawing = await cls.create(createData, {parent: canvas.scene});
//         } finally {
//           this.tm.clearPreviewContainer();
//         }
//         const o = drawing.object;
//         o._creating = true;
//         o._pendingText = "";
//         o.control({ isNew: true });
      }

    }

    // Incomplete drawing or cancel the preview
    this._onDragLeftCancel(event);
  }

  /**
   * Handle a drag cancel.
   * @param {PIXI.InteractionEvent} event
   */
  _onDragLeftCancel(event) {
    const preview = this.tm.preview.children?.[0] || null;
    if ( preview?._chain ) {
      preview._removePoint();
      preview.refresh();
      if ( preview.document.shape.points.length ) return event.preventDefault();
    }
    event.interactionData.drawingsState = 0;
    // super._onDragLeftCancel(event);
  }

  /**
   * Handle a right click.
   * @param {PIXI.InteractionEvent} event
   */
  _onClickRight(_event) {
    const preview = this.tm.preview.children?.[0] || null;
    if ( preview ) return canvas.mouseInteractionManager._dragRight = false;
    // super._onClickRight(event);
  }
}
