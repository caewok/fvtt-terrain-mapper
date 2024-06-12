/* globals
game
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { Patcher } from "./Patcher.js";

import { PATCHES_SidebarTab, PATCHES_ItemDirectory } from "./settings.js";
import { PATCHES as PATCHES_ActiveEffect } from "./ActiveEffect.js";
import { PATCHES as PATCHES_ActiveEffectConfig } from "./ActiveEffectConfig.js";
import { PATCHES as PATCHES_PIXI_Graphics } from "./PIXI_Graphics.js";
import { PATCHES as PATCHES_MeasuredTemplate } from "./MeasuredTemplate.js";
import { PATCHES as PATCHES_MeasuredTemplateConfig } from "./MeasuredTemplateConfig.js";
import { PATCHES as PATCHES_Tile } from "./Tile.js";
import { PATCHES as PATCHES_TileConfig } from "./TileConfig.js";
import { PATCHES as PATCHES_Token } from "./Token.js";
import { PATCHES as PATCHES_Wall } from "./Wall.js";
import { PATCHES as PATCHES_CanvasEdges } from "./CanvasEdges.js";
import { PATCHES as PATCHES_RegionSceneControls } from "./regions/controls.js";
import { PATCHES as PATCHES_RegionLayer } from "./regions/RegionLayer.js";
import { PATCHES as PATCHES_SceneConfig } from "./SceneConfig.js";

export const PATCHES = {
  ActiveEffect: PATCHES_ActiveEffect,
  ActiveEffectConfig: PATCHES_ActiveEffectConfig,
  ["foundry.canvas.edges.CanvasEdges"]: PATCHES_CanvasEdges,
  ItemDirectory: PATCHES_ItemDirectory,
  "PIXI.Graphics": PATCHES_PIXI_Graphics,
  MeasuredTemplate: PATCHES_MeasuredTemplate,
  MeasuredTemplateConfig: PATCHES_MeasuredTemplateConfig,
  RegionLayer: PATCHES_RegionLayer,
  SceneConfig: PATCHES_SceneConfig,
  SidebarTab: PATCHES_SidebarTab,
  Tile: PATCHES_Tile,
  TileConfig: PATCHES_TileConfig,
  Token: PATCHES_Token,
  Wall: PATCHES_Wall,

  RegionSceneControls: PATCHES_RegionSceneControls // Only hooks.
};

export const PATCHER = new Patcher();
PATCHER.addPatchesFromRegistrationObject(PATCHES);

export function initializePatching() {
  PATCHER.registerGroup("BASIC");
  PATCHER.registerGroup("REGIONS");
  PATCHER.registerGroup(game.system.id);
}
