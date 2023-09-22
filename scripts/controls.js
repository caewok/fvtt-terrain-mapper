/* globals
canvas,
Dialog,
FilePicker,
game,
Hooks
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID } from "./const.js";
import { Terrain } from "./Terrain.js";
import { TerrainLayerToolBar } from "./TerrainLayerToolBar.js";
import { TerrainEffectsApp } from "./TerrainEffectsApp.js";
import { isString } from "./util.js";

Hooks.on("getSceneControlButtons", addTerrainLayerSceneControls);
Hooks.on("renderSceneControls", addTerrainLayerSubControls);
Hooks.on("renderTerrainLayerToolBar", renderTerrainLayerSubControls);


function addTerrainLayerSceneControls(controls) {
  const tools = [
    {
      name: "fill-by-grid",
      title: game.i18n.localize(`${MODULE_ID}.controls.fill-by-grid.name`),
      icon: "fas fa-brush"
    },

    {
      name: "fill-by-los",
      title: game.i18n.localize(`${MODULE_ID}.controls.fill-by-los.name`),
      icon: "fas fa-eye"
    },

    /* TODO: How feasible would be a "painting" option with circle or square brush?
    {
      name: "fill-by-pixel",
      title: "Fill by Pixel",
      icon: "fas fa-paintbrush-fine"
    },
    */

    // TODO: Paint by drawing a polygon on the scene.

    {
      name: "fill-space",
      title: game.i18n.localize(`${MODULE_ID}.controls.fill-space.name`),
      icon: "fas fa-fill-drip"
    },

    {
      name: "clear",
      title: game.i18n.localize(`${MODULE_ID}.controls.clear.name`),
      icon: "fas fa-trash-can",
      button: true,
      onClick: () => {
        Dialog.confirm({
          title: game.i18n.localize(`${MODULE_ID}.controls.clear.confirm.title`),
          content: game.i18n.localize(`${MODULE_ID}.controls.clear.confirm.content`),
          yes: () => canvas.terrain.clearData()
        });
      }
    },

    {
      name: "upload",
      title: game.i18n.localize(`${MODULE_ID}.controls.upload.name`),
      icon: "fas fa-file-arrow-up",
      button: true,
      onClick: () => {
        new FilePicker({
          type: "image",
          displayMode: "thumbs",
          tileSize: false,
          callback: file => { canvas.terrain.importFromImageFile(file); }
        }).render(true);
      }
    },

    {
      name: "download",
      title: game.i18n.localize(`${MODULE_ID}.controls.download.name`),
      icon: "fas fa-file-arrow-down",
      button: true,
      onClick: () => { canvas.terrain.downloadData({format: "image/webp"}); }
    },

    {
      name: "undo",
      title: game.i18n.localize(`${MODULE_ID}.controls.undo.name`),
      icon: "fas fa-rotate-left",
      button: true,
      onClick: () => { canvas.terrain.undo(); }
    },

    {
      name: "terrain-menu",
      title: game.i18n.localize(`${MODULE_ID}.controls.terrain-menu.name`),
      icon: "fas fa-book",
      button: true,
      onClick: () => { new TerrainEffectsApp().render(true); }
    }
  ];

  const controlObj = {
    name: "terrain",
    icon: "fas fa-mountain-sun",
    layer: "terrain",
    activeTool: "fill-by-grid",
    visible: game.user.isGM,
    title: game.i18n.localize(`${MODULE_ID}.name`),
    tools,
    _currentTerrain: undefined
  };

  Object.defineProperty(controlObj, "currentTerrain", {
    get: function() { return this._currentTerrain; },

    set: function(terrain) {
      if ( isString(terrain) ) terrain = Terrain.fromEffectId(terrain);
      if ( !(terrain instanceof Terrain) ) {
        console.error("Current terrain must be an instance of terrain.", terrain);
        return;
      }

      // Get terrain from the scene map or add to the scene map.
      if ( this.sceneMap.terrainIds.has(terrain.id) ) terrain = this.terrainForId(terrain.id);
      else this.sceneMap.add(terrain);
      this._currentTerrain = terrain;
    }
  });

  controls.push(controlObj);
}

function addTerrainLayerSubControls(controls) {
  if ( !canvas || !canvas.terrain ) return;

  if ( controls.activeControl === "terrain" ) {
    if ( !canvas.terrain.toolbar ) canvas.terrain.toolbar = new TerrainLayerToolBar();
    canvas.terrain.toolbar.render(true);

  } else {
    if ( !canvas.terrain.toolbar ) return;
    canvas.terrain.toolbar.close();
  }
}

function renderTerrainLayerSubControls() {
  const tools = $(canvas.terrain.toolbar.form).parent();
  if ( !tools ) return;
  const controltools = $("li[data-tool='fill-by-pixel']").closest(".sub-controls");
  controltools.addClass("terrain-controls");
  canvas.terrain.toolbar.element.addClass("active");
}
