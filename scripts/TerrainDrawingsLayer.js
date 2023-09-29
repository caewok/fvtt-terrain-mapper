/* globals
DrawingsLayer,
game,
Hooks
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

// import { MODULE_ID } from "./const.js";

/* Testing
// Create at least one drawing, then

let [d] = canvas.drawings.placeables
canvas.terraindrawings.createObject(d.document);


*/


const MODULE_ID = "terrainmapper";

Hooks.once("init", () => {
  TerrainDrawingsLayer.register();
});

Hooks.on("getSceneControlButtons", addTerrainLayerSceneControls);

export class TerrainDrawingsLayer extends PlaceablesLayer {

  /** @inheritdoc */
  static documentName = "Drawing";

  testContainer = new PIXI.Container();

  static get placeableClass() { return TerrainDrawing; }

  /** @inheritdoc */
  static get layerOptions() {
    return foundry.utils.mergeObject(super.layerOptions, {
      name: "terraindrawings",
      objectClass: TerrainDrawing,
      canDragCreate: true,
      controllableObjects: true,
      rotatableObjects: true,
      elevationSorting: true,
      zIndex: 20
    });
  }

  /**
   * Add the layer so it is accessible in the console.
   */
  static register() { CONFIG.Canvas.layers.terraindrawings = { group: "primary", layerClass: TerrainDrawingsLayer }; }
}

function addTerrainLayerSceneControls(controls) {
  const tools = [
    {
      name: "terrain-view-toggle",
      title: game.i18n.localize(`${MODULE_ID}.controls.terrain-view-toggle.name`),
      icon: "fas fa-font",
      toggle: true,
      active: false,
      onClick: active => console.debug(`TerrainDrawings toggle is ${active}`)
    }
  ];

  const controlObj = {
    name: "terraindrawings",
    icon: "fas fa-compass-drafting",
    layer: "terraindrawings",
    //activeTool: "terrain-view-toggle",
    visible: game.user.isGM,
    title: game.i18n.localize(`${MODULE_ID}.name`),
    tools
  };

  controls.push(controlObj);
}

class TerrainDrawing extends Drawing {
  get layer () { return canvas.terraindrawings; }

  _canControl(user, event) {
    if ( !user.isGM ) return false;

    if ( !canvas.terraindrawings.active ) return false;

    // Check if the edit toggle is active or if this is a preview.
    if ( this.isPreview ) return true;
    const editToggle = canvas.terrain.controls.tool.find(t => t.name === "terrain-view-toggle")
    return editToggle.active;
  }
}
