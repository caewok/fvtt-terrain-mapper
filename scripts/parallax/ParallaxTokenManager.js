/* globals
canvas,
foundry,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID, HOOKS } from "../const.js";
import {
  ParallaxTokenShadow, ParallaxGeometryBuilder, ParallaxMath, parallaxEnabled
} from "./parallax_geometry.js";
import { gridUnitsToPixels } from "../geometry/util.js";

export const PATCHES = {};
PATCHES.PARALLAX = {};

/**
 * Owns one ParallaxTokenShadow per FLOATING token. Grounded tokens have no shadow object, so they cost
 * nothing per frame (the shadow registers itself with the per-frame ticker only while it exists).
 *
 * Lifecycle:
 *   create   a token is floating and has no shadow                      --> new ParallaxTokenShadow
 *   update   a token is still floating                                  --> nothing (the shadow follows the token each frame)
 *   remove   a token lands, is hidden, is deleted, or the canvas tears down --> shadow.destroy()
 */
export class ParallaxTokenManager {

  /** @type {Map<string, ParallaxTokenShadow>} tokenD.id --> shadow */
  shadows = new Map();

  /**
   * Elevation (scene units) of the surface under the token.
   * @param {Token} token
   * @returns {number}
   */
  groundElevation(token) {
    const tm = token[MODULE_ID];
    if ( !tm ) return canvas.level.elevation.base;
    return tm.groundAt();
  }

  /**
   * Should this token currently cast a floating shadow?
   * @param {Token} token
   * @returns {boolean}
   */
  isFloating(token) {
    if ( !token?.document || !token.isVisible ) return false; // Do not leak hidden tokens.
    // MIN_HEIGHT is in elevation units.
    return (token.document.elevation - this.groundElevation(token)) >= ParallaxGeometryBuilder.MIN_HEIGHT;
  }

  /**
   * Create or remove the token's shadow to match its current state. Cheap; safe to call often.
   * @param {Token|null} token    The placeable (may be null if not drawn yet)
   */
  sync(token) {
    if ( !token?.document ) return;
    const id = token.document.id;
    const existing = this.shadows.get(id);
    const floating = parallaxEnabled() && this.isFloating(token); // Disabled: removes any existing shadow.
    if ( floating && !existing ) {
      this.shadows.set(id, new ParallaxTokenShadow(token, { groundElevation: t => this.groundElevation(t) }));
    } else if ( !floating && existing ) {
      this.remove(id);
    }
  }

  /**
   * Destroy a token's shadow, if any.
   * @param {string|TokenDocument} idOrTokenD
   */
  remove(idOrTokenD) {
    const id = typeof idOrTokenD === "string" ? idOrTokenD : idOrTokenD.id;
    this.shadows.get(id)?.destroy();
    this.shadows.delete(id);
  }

  clear() {
    for ( const shadow of this.shadows.values() ) shadow.destroy();
    this.shadows.clear();
  }

  /**
   * Match every token to the global parallax setting: shadows are created (or destroyed) and sizes applied
   * (or restored to core's).
   */
  syncAll() {
    if ( !parallaxEnabled() ) this.clear();
    for ( const token of canvas.tokens?.placeables ?? [] ) {
      this.sync(token);
      this.applySize(token); // sizeFactor is 1 when parallax is disabled, which restores core's scale.
    }
  }

  // ----- NOTE: Token sizing ----- //

  /** @type {number|null} Unsaved value from the scene config form (live preview), if any. */
  sizingOverride = null;

  /**
   * Size factor for a token: grows with elevation above the viewed level's floor, so a token standing on
   * a plateau is scaled like the plateau art beside it. 1 if sizing is off (kill switch or scene setting).
   * @param {Token} token
   * @returns {number}
   */
  sizeFactor(token) {
    if ( !ParallaxMath.tokenSizingEnabled() ) return 1;
    const sizing = this.sizingOverride ?? ParallaxMath.sceneTokenSizing(canvas.scene);
    if ( sizing === 1 ) return 1;
    const height = token.document.elevation - ParallaxGeometryBuilder.defaultGroundElevation();
    return ParallaxMath.tokenScale(gridUnitsToPixels(height), sizing);
  }

  /**
   * Scale the token's mesh to match its elevation. Safe to call on every refresh.
   *
   * Core sets the mesh scale from the token's size and texture, and only when it thinks that changed. So
   * this remembers the scale core last set (the base) and the scale it applied. If the mesh still has the
   * scale applied here, the base is unchanged and is reused; otherwise core reset it, so the current
   * scale is the new base. This keeps repeated calls from compounding.
   * ASSUMPTION: the token's visual is token.mesh, anchored at its center, and core drives its size via mesh.scale.
   * @param {Token} token
   */
  applySize(token) {
    const mesh = token?.mesh;
    if ( !mesh?.scale ) return;
    const factor = this.sizeFactor(token);
    let st = SIZE_STATE.get(mesh);
    if ( !st ) {
      if ( factor === 1 ) return; // Never touched; leave it to core.
      st = { bx: 1, by: 1, sx: Number.NaN, sy: Number.NaN };
      SIZE_STATE.set(mesh, st);
    }
    const { x, y } = mesh.scale;
    if ( x !== st.sx || y !== st.sy ) { st.bx = x; st.by = y; }
    const nx = st.bx * factor;
    const ny = st.by * factor;
    if ( nx !== x || ny !== y ) mesh.scale.set(nx, ny);
    st.sx = nx;
    st.sy = ny;
  }

  /** Re-apply sizing to every token, e.g., after the scene setting or the kill switch changed. */
  refreshSizes() {
    for ( const token of canvas.tokens?.placeables ?? [] ) this.applySize(token);
  }

  /**
   * Live preview of the scene's token sizing, e.g., while the scene config is open. Not saved.
   * @param {number} value      Ignored if not a finite number (an empty field)
   */
  previewSizing(value) {
    if ( !Number.isFinite(value) ) return;
    this.sizingOverride = ParallaxMath.normalizeTokenSizing(value);
    this.refreshSizes();
  }

  /** Discard a preview; back to the saved scene value. */
  restoreSizing() {
    this.sizingOverride = null;
    this.refreshSizes();
  }
}

/** @type {WeakMap<object, {bx: number, by: number, sx: number, sy: number}>} Mesh --> base and applied scale. */
const SIZE_STATE = new WeakMap();

// Only need a singleton for a given session.
export const parallaxTokenManager = new ParallaxTokenManager();

// ----- NOTE: Hooks ----- //

/**
 * A hook event that fires for every embedded Document type after conclusion of a creation workflow.
 *
 * The placeable usually is not drawn yet, so tokenD.object may be null; refreshToken then covers the first draw.
 *
 * @event
 * @category Document
 * @param {TokenDocument} tokenD
 * @param {Partial<DatabaseCreateOperation>} _options
 * @param {string} _userId
 */
function createToken(tokenD, _options, _userId) {
  parallaxTokenManager.sync(tokenD.object);
}

/**
 * A hook event that fires for every Document type after conclusion of an update workflow.
 *
 * Only changes that can alter "is floating" matter: elevation, position (the surface under the token can change),
 * and hidden.
 *
 * @event
 * @category Document
 * @param {TokenDocument} tokenD
 * @param {object} changed
 * @param {Partial<DatabaseUpdateOperation>} _options
 * @param {string} _userId
 */
function updateToken(tokenD, changed, _options, _userId) {
  if ( !("elevation" in changed || "x" in changed || "y" in changed || "hidden" in changed) ) return;
  parallaxTokenManager.sync(tokenD.object);
}

/**
 * A hook event that fires for every embedded Document type after conclusion of a deletion workflow.
 *
 * @event
 * @category Document
 * @param {TokenDocument} tokenD
 * @param {Partial<DatabaseDeleteOperation>} _options
 * @param {string} _userId
 */
function deleteToken(tokenD, _options, _userId) {
  parallaxTokenManager.remove(tokenD);
}

/**
 * A hook event that fires whenever a Token is refreshed, including every frame of a movement animation.
 *
 * Handles the first draw (createToken fires before the placeable exists), elevation and position changes
 * during animation, and visibility changes. Keep this cheap: sync() is a map lookup plus one multiply.
 * ASSUMPTION: flag names refreshPosition, refreshElevation, refreshState.
 *
 * @event
 * @category Token
 * @param {Token} token
 * @param {RenderFlags} flags
 */
function refreshToken(token, flags) {
  // Core may have reset the mesh scale on any refresh; re-apply. Cheap when nothing changed.
  parallaxTokenManager.applySize(token);
  if ( !(flags.refreshPosition || flags.refreshElevation || flags.refreshState) ) return;
  parallaxTokenManager.sync(token);
}

/**
 * Canvas teardown: the placeables the shadows point at are about to be destroyed.
 *
 * @event
 * @category Canvas
 */
function canvasTearDown(_canvas) {
  parallaxTokenManager.clear();
}

/**
 * Canvas ready: refreshToken does not necessarily fire for tokens drawn before hooks were ready.
 *
 * @event
 * @category Canvas
 */
function canvasReady(_canvas) {
  parallaxTokenManager.sizingOverride = null;
  parallaxTokenManager.syncAll();
}

/**
 * Hook fired by the parallax setting's onChange (Hooks.callAll(PARALLAX_ENABLED_HOOK)).
 * Disabled: destroy every token shadow and restore token sizes. Enabled: build them.
 */
function parallaxEnabledChanged(_value) {
  parallaxTokenManager.syncAll();
}

/**
 * A hook event that fires for every Document type after conclusion of an update workflow.
 *
 * When the viewed scene's token sizing changes, resize every token.
 *
 * @event
 * @category Document
 * @param {Scene} sceneD
 * @param {object} changed
 * @param {Partial<DatabaseUpdateOperation>} _options
 * @param {string} _userId
 */
function updateScene(sceneD, changed, _options, _userId) {
  if ( sceneD !== canvas.scene ) return;
  const hasProp = foundry.utils.hasProperty;
  if ( !(hasProp(changed, `flags.${MODULE_ID}.tokenSizing`) || hasProp(changed, `flags.${MODULE_ID}.-=tokenSizing`)) ) return;
  parallaxTokenManager.sizingOverride = null;
  parallaxTokenManager.refreshSizes();
}

PATCHES.PARALLAX.HOOKS = {
  createToken, updateToken, deleteToken, refreshToken, canvasTearDown, canvasReady, updateScene,
  [HOOKS.PARALLAX_ENABLED]: parallaxEnabledChanged
};