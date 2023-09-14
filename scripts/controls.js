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
import { TerrainLayerToolBar } from "./TerrainLayerToolBar.js";
import { TerrainEffectsApp } from "./TerrainEffectsApp.js";

Hooks.on("getSceneControlButtons", addTerrainLayerSceneControls);
Hooks.on("renderSceneControls", addTerrainLayerSubControls);
Hooks.on("renderTerrainLayerToolBar", renderTerrainLayerSubControls);

function addTerrainLayerSceneControls(controls) {
  const isGM = game.user.isGM;
  controls.push({
    name: "terrain",
    title: game.i18n.localize(`${MODULE_ID}.name`),
    icon: "fas fa-mountain-sun",
    visible: isGM,
    layer: "terrain",
    activeTool: "fill-by-grid",
    currentTerrain: 0,
    tools: [
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

    ]
  });
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
