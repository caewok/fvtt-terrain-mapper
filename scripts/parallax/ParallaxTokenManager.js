/* globals
canvas,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID } from "../const.js";
import { ParallaxTokenShadow, ParallaxGeometryBuilder } from "./parallax_geometry.js";
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
    const heightPx = gridUnitsToPixels(token.document.elevation - this.groundElevation(token));
    return heightPx >= ParallaxGeometryBuilder.MIN_HEIGHT;
  }

  /**
   * Create or remove the token's shadow to match its current state. Cheap; safe to call often.
   * @param {Token|null} token    The placeable (may be null if not drawn yet)
   */
  sync(token) {
    if ( !token?.document ) return;
    const id = token.document.id;
    const existing = this.shadows.get(id);
    const floating = this.isFloating(token);
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
}

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
  for ( const token of canvas.tokens.placeables ) parallaxTokenManager.sync(token);
}

PATCHES.PARALLAX.HOOKS = {
  createToken, updateToken, deleteToken, refreshToken, canvasTearDown, canvasReady
};