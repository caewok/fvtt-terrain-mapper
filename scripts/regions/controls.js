/* globals
canvas,
CONFIG,
PIXI,
PreciseText,
ui,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID, FA_ICONS } from "../const.js";
import { Draw } from "../geometry/Draw.js";
import { HillDrawingManager } from "./HillDrawingManager.js";

export const PATCHES = {};
PATCHES.REGIONS = {};

const TOOLS = {};

TOOLS.FILL_BY_LOS = {
  name: "fill-by-los",
  title: `${MODULE_ID}.controls.fill-by-los.name`,
  icon: FA_ICONS.FILL_BY_LOS,
  toggle: false,
  onChange: () => renderSceneControls(ui.controls),
  control: true, // Keep the selected region when switching to this tool.
  order: 0,
}

TOOLS.FILL_BY_WALLS = {
  name: "fill-by-walls",
  title: `${MODULE_ID}.controls.fill-space.name`,
  icon: FA_ICONS.FILL_BY_WALLS,
  toggle: false,
  onChange: () => renderSceneControls(ui.controls),
  control: true, // Keep the selected region when switching to this tool.
  order: 0,
}

TOOLS.DRAW_HILL = {
  name: "draw-hill",
  title: `${MODULE_ID}.controls.draw-hill.name`,
  icon: FA_ICONS.DRAW_HILL,
  toggle: false,
  onChange: (_event, active) => {
    if ( active ) HillDrawingManager.activate.call(HillDrawingManager);
    else HillDrawingManager.deactivate.call(HillDrawingManager);
  },
  order: 0,
}

// Tools that should show the scene walls while active.
const WALL_DISPLAY_TOOLS = new Set(["fill-by-walls", "fill-by-los"]);

/** @type {WallDisplay|undefined} */
let wallDisplay;

/**
 * Show or hide the wall display so that it matches whether a wall-based tool is active.
 * Safe to call repeatedly.
 * @param {boolean} enabled
 */
function setWallDisplay(enabled) {
  if ( enabled ) {
    if ( !canvas.regions ) return;
    wallDisplay ??= new WallDisplay();
    wallDisplay.render();
  } else if ( wallDisplay ) {
    wallDisplay.destroy();
    wallDisplay = undefined;
  }
}

/**
 * Hook renderSceneControls
 * Display scene walls while a wall-based fill tool is active.
 * @param {SceneControls} sceneControls
 */
function renderSceneControls(sceneControls, _element, _context, _options) {
  const enabled = sceneControls.control?.name === "regions"
    && WALL_DISPLAY_TOOLS.has(sceneControls.tool?.name);
  setWallDisplay(enabled);
}

/**
 * Hook getSceneControlButtons
 * Add additional shape controls to the region controls.
 * @param {Record<string, SceneControl>} controls   Scene controls, keyed by control name
 */
function getSceneControlButtons(controls) {
  if ( !canvas.scene ) return;
  const tools = controls.regions?.tools;
  if ( !tools ) return;

  /**
   * Insert one or more tools at a given order, pushing existing tools at or after it down.
   * Copies the tool definitions so the shared TOOLS objects are never mutated.
   */
  const insertTools = (order, newTools) => {
    newTools = newTools.filter(tool => !tools[tool.name]); // Idempotent if the hook re-fires.
    if ( !newTools.length ) return;
    for ( const tool of Object.values(tools) ) {
      if ( tool.order >= order ) tool.order += newTools.length;
    }
    newTools.forEach((tool, i) => { tools[tool.name] = { ...tool, order: order + i, visible: !canvas.regions?.templateMode }; });
  };

  // Walls, LOS and hill tools go in front of the polygon tool.
  // Read the polygon order after the first insert, because it may have shifted.
  const polyOrder = tools.polygon?.order ?? Object.keys(tools).length;
  insertTools(polyOrder, [TOOLS.FILL_BY_WALLS, TOOLS.FILL_BY_LOS, TOOLS.DRAW_HILL]);
}

/**
 * Hook canvasTearDown
 * Drop the display so it is not left pointing at destroyed canvas layers.
 */
function canvasTearDown() {
  setWallDisplay(false);
}

/**
 * Refresh the display (if showing) when walls change.
 * Hooks: createWall, updateWall, deleteWall.
 */
function refreshWallDisplay() {
  wallDisplay?.render();
}

PATCHES.REGIONS.HOOKS = {
  getSceneControlButtons,
  renderSceneControls,
  canvasTearDown,
  createWall: refreshWallDisplay,
  updateWall: refreshWallDisplay,
  deleteWall: refreshWallDisplay,
}

// ----- NOTE: Helper functions ----- //



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
    this.#displayContainer.parent?.removeChild(this.#displayContainer);
    this.#displayContainer.destroy({ children: true });
  }

  /**
   * Remove prior drawings so that render can be called repeatedly.
   */
  #clear() {
    this.#graphics.clear();
    for ( const child of [...this.#displayContainer.children] ) {
      if ( child === this.#graphics ) continue;
      this.#displayContainer.removeChild(child);
      child.destroy();
    }
  }

  /**
   * Render all walls and inner boundaries for the current level.
   */
  render() {
    if ( this.#displayContainer.destroyed ) return;
    this.#clear();
    const levelId = canvas.level?.id;
    for ( const edge of canvas.edges.values() ) {
      if ( edge.type === "wall" ) {
        const wallD = edge.object;
        const wall = wallD?.object;
        if ( !wall ) continue; // Not drawn, e.g. on a level that is not rendered.
        if ( levelId && !wallD.levels?.has(levelId) ) continue;
        this._drawWall(wall);
      } else if ( edge.type === "innerBounds" ) this._drawEdgeSegment(edge);
    }
  }

  /**
   * Draw a single wall.
   * @param {Wall} wall
   */
  _drawWall(wall) {
    this._drawEdgeSegment(wall.edge, wall.isOpen);
    const text = this.#drawWallRange(wall);
    if ( text ) this.#displayContainer.addChild(text);
  }

  /**
   * Draw a wall segment, blue if open and red if closed.
   * @param {Edge} edge
   * @param {boolean} [isOpen=true]
   */
  _drawEdgeSegment(edge, isOpen = true) {
    const draw = this.#draw;
    const color = isOpen ? Draw.COLORS.blue : Draw.COLORS.red;
    const alpha = isOpen ? 0.5 : 1;
    draw.segment(edge, { color, alpha });
    draw.point(edge.a, { color: Draw.COLORS.red });
    draw.point(edge.b, { color: Draw.COLORS.red });
  }

  /**
   * Draw the wall lower and upper heights on the canvas.
   * Based on https://github.com/theripper93/wall-height/blob/12c204b44e6acfa1e835464174ac1d80e77cec4a/scripts/patches.js#L318
   * @param {Wall} wall
   * @returns {PreciseText|undefined} The text label for the wall, if the wall is height-limited
   */
  #drawWallRange(wall) {
    const { topE, bottomE } = wall;
    if ( topE === Infinity && bottomE === -Infinity ) return;

    const top = topE === Infinity ? "Inf" : topE;
    const bottom = bottomE === -Infinity ? "-Inf" : bottomE;

    const text = new PreciseText(`${top} / ${bottom}`, this.#wallRangeTextStyle());
    if ( typeof wall._getWallColor === "function" ) text.style.fill = wall._getWallColor();
    text.name = "wall-height-text";

    const [x0, y0, x1, y1] = wall.coords;
    let angle = Math.atan2(y1 - y0, x1 - x0) * (180 / Math.PI);
    angle = ((angle + 90) % 180) - 90;
    text.position.set(wall.center.x, wall.center.y);
    text.anchor.set(0.5, 0.5);
    text.angle = angle;
    text._wallId = wall.id;
    return text;
  }

  /**
   * Text style for the height labels. Clones the canvas default so the shared style is not altered.
   * @returns {PIXI.TextStyle}
   */
  #wallRangeTextStyle() {
    const style = CONFIG.canvasTextStyle.clone();
    style.fontSize /= 1.5;
    return style;
  }
}

