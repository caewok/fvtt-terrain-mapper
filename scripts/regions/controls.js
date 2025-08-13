/* globals
canvas,
CONFIG,
game,
PIXI,
PreciseText,
ui
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID, FA_ICONS } from "../const.js";
import { Draw } from "../geometry/Draw.js";
import { TerrainEffectsApp } from "../TerrainEffectsApp.js";

export const PATCHES = {};
PATCHES.REGIONS = {};

const TOOLS = {};
TOOLS.FILL_BY_GRID = {
  name: "fill-by-grid",
  title: `${MODULE_ID}.controls.fill-by-grid.name`,
  icon: FA_ICONS.FILL_BY_GRID,
  toggle: false,
  order: 0,
};

TOOLS.FILL_BY_LOS = {
  name: "fill-by-los",
  title: `${MODULE_ID}.controls.fill-by-los.name`,
  icon: FA_ICONS.FILL_BY_LOS,
  toggle: false,
  order: 0,
}

TOOLS.FILL_BY_WALLS = {
  name: "fill-by-walls",
  title: `${MODULE_ID}.controls.fill-space.name`,
  icon: FA_ICONS.FILL_BY_WALLS,
  toggle: false,
  onClick: toggleWallDisplay,
  order: 0,
}

TOOLS.TERRAIN_BOOK = {
  name: "terrain-book",
  title: `${MODULE_ID}.phrases.terrains`,
  icon: FA_ICONS.TERRAIN_BOOK,
  onClick: () => { new TerrainEffectsApp().render(true); },
  button: true,
  order: 0,
}

let wallDisplay;

/**
 * Hook renderSceneControls
 * If the fill-by-walls control is active, display scene walls.
 * @param {Application} application     The Application instance being rendered
 * @param {jQuery} html                 The inner HTML of the document that will be displayed and may be modified
 * @param {object} data                 The object of data used when rendering the application
 */
function renderSceneControls(sceneControls, _html, _data) {
  const activeControl = sceneControls.control.name;
  const activeTool = sceneControls.tool.name;
  const fillWallsEnabled = activeControl === "regions" && activeTool === "fill-by-walls";
  if ( fillWallsEnabled && !wallDisplay ) {
    wallDisplay = new WallDisplay();
    wallDisplay.render();
  } else if ( !fillWallsEnabled && wallDisplay ) {
    wallDisplay.destroy();
    wallDisplay = undefined;
  }
}

/**
 * Hook getSceneControlButtons
 * Add additional shape controls to the region controls.
 */
function getSceneControlButtons(controls, _html, _data) {
  if ( !canvas.scene ) return;
  const regionTools = controls.regions;
  if ( !regionTools ) return;
  if ( !canvas.grid.isGridless ) {
    const selectIdx = regionTools.tools.select.order;
    TOOLS.FILL_BY_GRID.order = selectIdx + 1;
    Object.values(regionTools.tools)
      .filter(tool => tool.order >= selectIdx + 1)
      .forEach(tool => tool.order += 1);
    regionTools.tools[TOOLS.FILL_BY_GRID.name] = TOOLS.FILL_BY_GRID;
  }
  const polyIdx = regionTools.tools.polygon.order;
  TOOLS.FILL_BY_WALLS.order = polyIdx;
  TOOLS.FILL_BY_LOS.order = polyIdx + 1;
  Object.values(regionTools.tools)
      .filter(tool => tool.order >= polyIdx)
      .forEach(tool => tool.order += 2);
  regionTools.tools[TOOLS.FILL_BY_WALLS.name] = TOOLS.FILL_BY_WALLS;
  regionTools.tools[TOOLS.FILL_BY_LOS.name] = TOOLS.FILL_BY_LOS;

  if ( game.user.isGM ) {
    const trashIdx = regionTools.tools.clear;
    TOOLS.TERRAIN_BOOK.order = trashIdx;
    Object.values(regionTools.tools)
      .filter(tool => tool.order >= trashIdx)
      .forEach(tool => tool.order += 1);
    regionTools.tools[TOOLS.TERRAIN_BOOK.name] = TOOLS.TERRAIN_BOOK;
  }
}

PATCHES.REGIONS.HOOKS = {
  getSceneControlButtons,
  renderSceneControls
}

// ----- NOTE: Helper functions ----- //

/**
 * When fill-by-walls control is active, display the walls for the scene.
 * @param {PIXI.InteractionEvent} event
 */
function toggleWallDisplay() {
  const enabled = ui.controls.control.name == "regions" && ui.controls.control.activeTool !== "fill-by-walls";
  console.log(`Fill by walls ${enabled ? "enabled" : "disabled"}!`);
}

/**
 * Class to draw current wall set on the canvas.
 */
class WallDisplay {
  /** @type {PIXI.Container} */
  #displayContainer = new PIXI.Container();

  /** @type {PIXI.Graphics} */
  #graphics = new PIXI.Graphics();

  /** @type {Draw} */
  #draw;

  constructor() {
    this.#displayContainer.addChild(this.#graphics);
    canvas.regions.addChild(this.#displayContainer);
    this.#draw = new Draw(this.#graphics);
  }

  /**
   * Destroy this object.
   */
  destroy() {
    if ( this.#displayContainer.destroyed ) return;
    canvas.regions.removeChild(this.#displayContainer);
    this.#displayContainer.removeChildren().forEach(child => child.destroy());
    this.#displayContainer.destroy();
  }

  /**
   * Render all walls and inner boundaries.
   */
  render() {
    for ( const edge of canvas.edges.values() ) {
      if ( edge.type === "wall" ) this._drawWall(edge.object);
      else if ( edge.type === "innerBounds" ) this._drawEdgeSegment(edge);
    }
  }

  /**
   * Draw a single wall.
   */
  _drawWall(wall) {
    this._drawEdgeSegment(wall.edge, wall.isOpen);
    const text = this.#drawWallRange(wall);
    if ( text ) this.#displayContainer.addChild(text);
  }

  /**
   * Draw wall segments
   * @param {Wall} wall
   * @param {PIXI.Graphics} [graphics]   Optional graphics container to use
   * @returns {PIXI.Graphics} The added wall graphic
   */
  _drawEdgeSegment(edge, isOpen = true) {
    const draw = this.#draw;

    // Draw the wall, coloring blue if it is open, red if closed.
    const color = isOpen ? Draw.COLORS.blue : Draw.COLORS.red;
    const alpha = isOpen ? 0.5 : 1;
    draw.segment(edge, { color, alpha });
    draw.point(edge.a, { color: Draw.COLORS.red });
    draw.point(edge.b, { color: Draw.COLORS.red });
  }

  /**
   * From https://github.com/theripper93/wall-height/blob/12c204b44e6acfa1e835464174ac1d80e77cec4a/scripts/patches.js#L318
   * Draw the wall lower and upper heights on the canvas.
   * @param {Wall} wall
   * @param {PreciseText} [g]   Optional PreciseText container to use
   * @returns {PreciseText} The text label for the wall
   */
  #drawWallRange(wall, text) {
    // Fill in for WallHeight.getWallBounds
    const bounds = {
      top: wall.topE,
      bottom: wall.bottomE
    };
    if ( bounds.top === Infinity && bounds.bottom === -Infinity ) return;

    // Update or set new text.
    text ??= new PreciseText("", this.#wallRangeTextStyle);
    if ( bounds.top === Infinity ) bounds.top = "Inf";
    if ( bounds.bottom === -Infinity ) bounds.bottom = "-Inf";
    text.text = `${bounds.top} / ${bounds.bottom}`;
    text.style.fill = wall._getWallColor();
    text.name = "wall-height-text";
    let angle = (Math.atan2( wall.coords[3] - wall.coords[1], wall.coords[2] - wall.coords[0] ) * ( 180 / Math.PI ));
    angle = ((angle + 90 ) % 180) - 90;
    text.position.set(wall.center.x, wall.center.y);
    text.anchor.set(0.5, 0.5);
    text.angle = angle;
    text._wallId = wall.id;
    return text;
  }

  #wallRangeTextStyle() {
    const style = CONFIG.canvasTextStyle.clone();
    style.fontSize /= 1.5;
    return style;
  }

}


