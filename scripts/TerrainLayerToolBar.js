/* globals
Application,
canvas,
game,
mergeObject,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID } from "./const.js";

export class TerrainLayerToolBar extends Application {
  /** @type {number} */
  get currentTerrain() { return canvas.terrain.controls.currentTerrain; }

  set currentTerrain(value) {
    canvas.terrain.controls.currentTerrain = canvas.terrain.clampTerrainId(value);
  }

  /** @type {number} */
  get currentTerrainLayer() { return canvas.terrain.controls.currentTerrainLayer; }

  set currentTerrainLayer(value) { canvas.terrain.controls.currentTerrainLayer = value; }

  static get defaultOptions() {
    const options = {
      classes: ["form"],
      left: 98,
      popOut: false,
      template: `modules/${MODULE_ID}/templates/terrain-step-controls.html`,
      id: `${MODULE_ID}-config`,
      title: "TerrainLayer Terrain Selection",
      closeOnSubmit: false,
      submitOnChange: false,
      submitOnClose: false
    };

    options.editable = game.user.isGM;
    return mergeObject(super.defaultOptions, options);
  }

  activateListeners(html) {
    super.activateListeners(html);
    $(".control-btn[data-tool]", html).on("click", this._onHandleClick.bind(this));
    $("#el-curr-terrain", html).on("change", this._onHandleChange.bind(this));
  }

  getData(_options) {
    return {
      terrainmax: canvas.terrain.constructor.MAX_TERRAIN_ID,
      terraincurr: this.currentTerrain,
      terrainlayercurr: this.currentTerrainLayer
    };
  }

  /**
   * Handle when the user manually changes the elevation number
   * @param {Event} event
   */
  _onHandleChange(event) {
    if ( event.currentTarget.id !== "el-curr-terrain" ) return;
    this.currentTerrain = parseInt(event.currentTarget.value);
    this.render();
  }

  _onHandleClick(event) {
    const btn = event.currentTarget;
    const id = $(btn).attr("id");
    this.currentTerrain += TERRAIN_CLICKS[id];
    this.render();
  }

  async _render(...args) {
    await super._render(...args);
    $("#controls").append(this.element);
  }
}

// NOTE: Helpers

const TERRAIN_CLICKS = {
  "el-inc-terrain": 1,
  "el-dec-terrain": -1
};
