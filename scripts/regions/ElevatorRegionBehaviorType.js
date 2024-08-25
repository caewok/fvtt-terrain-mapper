/* globals
CONST,
foundry
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID, FLAGS } from "../const.js";
import { log, isFirstGM } from "../util.js";
import { ElevationHandler } from "../ElevationHandler.js";

export const PATCHES = {};
PATCHES.REGIONS = {};


/**
 * @typedef RegionPathWaypoint extends RegionMovementWaypoint
 * RegionMovementWaypoint with added features to describe its position along a segment and the regions encountered
 * @prop {object} regions
 *   - @prop {Set<Region>} enter    All regions entered at this location; the region contains this point but not the previous
 *   - @prop {Set<Region>} exit     All regions exited at this location; the region contains this point but not the next
 *   - @prop {Set<Region>} move     All regions were already entered at the start
 * @prop {number} dist2             Distance squared to the start
 * @prop {RegionMovementWaypoint} start   Starting waypoint
 */

/**
 * Region behavior set the elevation of a token based on multiple elevation options.
 * @property {Set<>}
 * @property {FLAGS.REGION.CHOICES} algorithm       How elevation change should be handled. plateau, ramp, stairs
 */
export class ElevatorRegionBehaviorType extends foundry.data.regionBehaviors.RegionBehaviorType {
  static defineSchema() {
    const fields = foundry.data.fields;
    const setFieldOptions = {
      label: `${MODULE_ID}.phrases.elevatorFloors`,
      hint: `${MODULE_ID}.behavior.types.elevator.fields.floors.hint`
    };

    return {
      floors: new fields.SetField(new fields.StringField({
      }), setFieldOptions),

      strict: new fields.BooleanField({
        label: `${MODULE_ID}.behavior.types.set-elevation.fields.strict.name`,
        hint: `${MODULE_ID}.behavior.types.set-elevation.fields.strict.hint`,
        initial: false
      }),

      dialog: new fields.BooleanField({
        label: `${MODULE_ID}.behavior.types.set-elevation.fields.dialog.name`,
        hint: `${MODULE_ID}.behavior.types.set-elevation.fields.dialog.hint`,
        initial: false
      })
    }
  }

  /** @override */
  static events = {
    [CONST.REGION_EVENTS.TOKEN_ENTER]: this.#onTokenEnter,
  };

  /**
   * @type {RegionEvent} event
   *   - @prop {object} data        Data related to the event
   *     - @prop {Token} token      Token triggering the event
   *   - @prop {string} name        Name of the event type (e.g., "tokenEnter")
   *   - @prop {RegionDocument}     Region for the event
   *   - @prop {User} user          User that triggered the event
   */
  static async #onTokenEnter(event) {
    const data = event.data;
    log(`Token ${data.token.name} entering ${event.region.name}!`);
    if ( event.user !== game.user ) return;
    const tokenD = data.token;
//     if ( strict && tokenD.elevation !== this.elevation && tokenD.elevation !== this.floor ) return;
//
//     // Determine the target elevation.
//     let elevation;
//     if ( this.algorithm === FLAGS.SET_ELEVATION_BEHAVIOR.CHOICES.ONE_WAY ) elevation = this.elevation;
//     else {
//       // Stairs
//       const midPoint = (this.elevation - this.floor) / 2;
//       elevation = tokenD.elevation <= midPoint ? this.elevation : this.floor;
//     }
//     if ( elevation === tokenD.elevation ) return; // Already at the elevation.
//
//     // If dialog is set, ask the user to accept the elevation change.
//     if ( this.dialog ) {
//       const content = game.i18n.localize(elevation > tokenD.elevation ? `${MODULE_ID}.phrases.stairs-go-up` : `${MODULE_ID}.phrases.stairs-go-down`);
//       const proceed = await foundry.applications.api.DialogV2.confirm({ content, rejectClose: false, modal: true });
//       if ( !proceed ) return;
//     }
//     return tokenD.update({ elevation });
  }
}

/**
 * Hook preCreateRegionBehavior
 * Set the default elevation to the region top elevation if defined.
 * @param {Document} document                     The pending document which is requested for creation
 * @param {object} data                           The initial data object provided to the document creation request
 * @param {Partial<DatabaseCreateOperation>} options Additional options which modify the creation request
 * @param {string} userId                         The ID of the requesting user, always game.user.id
 * @returns {boolean|void}                        Explicitly return false to prevent creation of this Document
 */
function preCreateRegionBehavior(document, data, _options, _userId) {
  log("preCreateRegionBehavior");
//   if ( data.type !== `${MODULE_ID}.setElevation` ) return;
//   const topE = document.region.elevation.top;
//   const elevation = topE ?? ElevationHandler.sceneFloor;
//   const floor = ElevationHandler.sceneFloor;
//   document.updateSource({ ["system.elevation"]: elevation, ["system.floor"]: floor });
}

PATCHES.REGIONS.HOOKS = { preCreateRegionBehavior };

