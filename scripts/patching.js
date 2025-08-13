/* globals
game
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { Patcher } from "./Patcher.js";
import { MODULES_ACTIVE } from "./const.js";

import { PATCHES_SidebarTab, PATCHES_ItemDirectory } from "./settings.js";
import { PATCHES as PATCHES_ActiveEffect } from "./ActiveEffect.js";
import { PATCHES as PATCHES_ActiveEffectConfig } from "./ActiveEffectConfig.js";
import { PATCHES as PATCHES_Token } from "./Token.js";
import { PATCHES as PATCHES_Wall } from "./Wall.js";
import { PATCHES as PATCHES_CanvasEdges } from "./CanvasEdges.js";
import { PATCHES as PATCHES_RegionSceneControls } from "./regions/controls.js";
import { PATCHES as PATCHES_RegionLayer } from "./regions/RegionLayer.js";
import { PATCHES as PATCHES_SceneConfig } from "./SceneConfig.js";
import { PATCHES as PATCHES_StairsRegionBehaviorType } from "./regions/StairsRegionBehaviorType.js";
import { PATCHES as PATCHES_ElevatorRegionBehaviorType } from "./regions/ElevatorRegionBehaviorType.js";
import { PATCHES as PATCHES_ModuleSettingsAbstract } from "./ModuleSettingsAbstract.js";
import { PATCHES as PATCHES_ItemSheet } from "./ItemSheet.js";
import { PATCHES as PATCHES_Region } from "./regions/Region.js";
import { PATCHES as PATCHES_RegionConfig } from "./regions/RegionConfig.js";
import { PATCHES as PATCHES_Tile } from "./Tile.js";
import { PATCHES as PATCHES_TileConfig } from "./TileConfig.js";
import { PATCHES as PATCHES_ClockwiseSweepPolygon } from "./regions/ClockwiseSweepPolygon.js";

export const PATCHES = {
  ActiveEffect: PATCHES_ActiveEffect,
  ActiveEffectConfig: PATCHES_ActiveEffectConfig,
  "foundry.canvas.edges.CanvasEdges": PATCHES_CanvasEdges,
  ClientSettings: PATCHES_ModuleSettingsAbstract,
  ClockwiseSweepPolygon: PATCHES_ClockwiseSweepPolygon,
  ItemDirectory: PATCHES_ItemDirectory,
  ItemSheet: PATCHES_ItemSheet,
  Region: PATCHES_Region,
  "foundry.applications.sheets.RegionConfig": PATCHES_RegionConfig,
  RegionLayer: PATCHES_RegionLayer,
  SceneConfig: PATCHES_SceneConfig,
  SidebarTab: PATCHES_SidebarTab,
  Tile: PATCHES_Tile,
  TileConfig: PATCHES_TileConfig,
  Token: PATCHES_Token,
  Wall: PATCHES_Wall,

  // Only hooks
  RegionSceneControls: PATCHES_RegionSceneControls,
  StairsRegionBehaviorType: PATCHES_StairsRegionBehaviorType,
  ElevatorRegionBehaviorType: PATCHES_ElevatorRegionBehaviorType
};

export const PATCHER = new Patcher();
PATCHER.addPatchesFromRegistrationObject(PATCHES);

export function initializePatching() {
  PATCHER.registerGroup("BASIC");
  PATCHER.registerGroup("REGIONS");
  PATCHER.registerGroup("ELEVATION");
  PATCHER.registerGroup(game.system.id);

  if ( game.system.id === "sfrpg" || game.system.id === "pf2e" ) PATCHER.registerGroup("COVER_ITEM");
  if ( !MODULES_ACTIVE.ELEVATION_RULER ) PATCHER.registerGroup("RULER");
}
