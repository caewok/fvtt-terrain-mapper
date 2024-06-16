/* globals
game
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { Patcher } from "./Patcher.js";

import { PATCHES_SidebarTab, PATCHES_ItemDirectory } from "./settings.js";
import { PATCHES as PATCHES_ActiveEffect } from "./ActiveEffect.js";
import { PATCHES as PATCHES_ActiveEffectConfig } from "./ActiveEffectConfig.js";
import { PATCHES as PATCHES_Token } from "./Token.js";
import { PATCHES as PATCHES_Wall } from "./Wall.js";
import { PATCHES as PATCHES_CanvasEdges } from "./CanvasEdges.js";
import { PATCHES as PATCHES_RegionSceneControls } from "./regions/controls.js";
import { PATCHES as PATCHES_RegionLayer } from "./regions/RegionLayer.js";
import { PATCHES as PATCHES_SceneConfig } from "./SceneConfig.js";
import { PATCHES as PATCHES_SetElevationRegionBehaviorType } from "./regions/SetElevationRegionBehaviorType.js";
import { PATCHES as PATCHES_ModuleSettingsAbstract } from "./ModuleSettingsAbstract.js";

export const PATCHES = {
  ActiveEffect: PATCHES_ActiveEffect,
  ActiveEffectConfig: PATCHES_ActiveEffectConfig,
  ["foundry.canvas.edges.CanvasEdges"]: PATCHES_CanvasEdges,
  ClientSettings: PATCHES_ModuleSettingsAbstract,
  ItemDirectory: PATCHES_ItemDirectory,
  RegionLayer: PATCHES_RegionLayer,
  SceneConfig: PATCHES_SceneConfig,
  SidebarTab: PATCHES_SidebarTab,
  Token: PATCHES_Token,
  Wall: PATCHES_Wall,

  // Only hooks
  RegionSceneControls: PATCHES_RegionSceneControls,
  SetElevationRegionBehaviorType: PATCHES_SetElevationRegionBehaviorType,
};

export const PATCHER = new Patcher();
PATCHER.addPatchesFromRegistrationObject(PATCHES);

export function initializePatching() {
  PATCHER.registerGroup("BASIC");
  PATCHER.registerGroup("REGIONS");
  PATCHER.registerGroup(game.system.id);
}
