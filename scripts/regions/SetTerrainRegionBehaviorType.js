/* globals
CONFIG,
CONST,
foundry
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID } from "../const.js";
import { log, isFirstGM } from "../util.js";


/* Move In vs Enter
https://ptb.discord.com/channels/170995199584108546/1184176344276406292/1243510660550361138

Move In/Out: Triggers only if the token enters or exits the region by movement (changes of x, y, or elevation).

Enter/Exit: Triggers when moved in/out and ...
when the region boundary changes such that it now contains/no longer contains the token,
when the token is created/deleted within the area of the region
when a behavior becomes active/inactive, in which case the event is triggered only for this behavior and not others.

Tokens Move In: You'll find a couple of new behaviors for Scene Regions that differ slightly from
Token Enter and Token Exit, providing subtle but important differences. Token Enter or Exit
should be used in cases where you want your behavior to trigger regardless of how a token entered
or left the region. Token Move In or Token Move Out should be used in cases where you want
the assigned behavior to trigger explicitly as a result of a user dragging, using their arrow keys,
or moving their token along a path to get into the region. "Why is this necessary?" You might ask.
Do you like infinitely looping teleportation? Because that is how you get infinitely looping teleportation.
*/

/**
 * Region behavior to set token to specifically the terrains with in the region.
 * Where regions overlap, other terrains may be added.
 * @property {number} elevation       The elevation at which to set the token
 * @property {boolean} reset          When enabled, elevation will be reset to scene background on exit.
 */
export class SetTerrainRegionBehaviorType extends foundry.data.regionBehaviors.RegionBehaviorType {
  static defineSchema() {
    return {
      terrains: this._createTerrainsField(`${MODULE_ID}.behavior.types.set-terrain.fields.terrain.hint`),
      secret: new foundry.data.fields.BooleanField({
        label: `${MODULE_ID}.behavior.types.add-terrain.fields.secret.name`,
        hint: `${MODULE_ID}.behavior.types.add-terrain.fields.secret.hint`,
        default: false
      })
    };
  }

  static _createTerrainsField(hint = "") {
    const fields = foundry.data.fields;
    const setFieldOptions = {
      label: `${MODULE_ID}.phrases.terrains`,
      hint,
    };

    return new fields.SetField(new fields.StringField({
      choices: this.terrainChoices,
      blank: false
    }), setFieldOptions);
  }

  static terrainChoices() {
    return CONFIG[MODULE_ID].Terrain._mapStoredEffectNames()
  }

  /** @override */
  static events = {
    [CONST.REGION_EVENTS.TOKEN_ENTER]: this.#onTokenEnter,
    [CONST.REGION_EVENTS.TOKEN_EXIT]: this.#onTokenExit
  };

  static async #onTokenEnter(event) {
    log(`Token ${event.data.token.name} entering ${event.region.name}!`);
    if ( !isFirstGM() ) return;
    const tokenD = event.data.token;
    const token = tokenD?.object;
    if ( !token ) return;

    // Add all terrains for this region.
    const Terrain = CONFIG[MODULE_ID].Terrain;
    const terrainsToAdd = new Set([...this.terrains].map(id => Terrain._instances.get(id)).filter(t => Boolean(t)));
    if ( !terrainsToAdd.size ) return;

    // ----- No async operations before this! -----
    const resumeMovement = tokenD.pauseMovement();

    // Await movement animation
    if ( tokenD.rendered ) await token.movementAnimationPromise;

    // Add the effect to the paused token.
    await Terrain.addToToken(token, terrainsToAdd, { origin: this.behavior.uuid });
    if ( resumeMovement ) return resumeMovement();
    return;
  }

  static async #onTokenExit(event) {
    log(`Token ${event.data.token.name} exiting ${event.region.name}!`);
    if ( !isFirstGM() ) return;
    const tokenD = event.data.token;
    const token = tokenD?.object;
    if ( !token ) return;

    // Get all terrains for this region.
    const Terrain = CONFIG[MODULE_ID].Terrain;
    let terrains = new Set([...this.terrains].map(id => Terrain._instances.get(id)).filter(t => Boolean(t)));
    if ( !terrains.size ) return;

    // If the token belongs to another terrain region, don't remove those terrains.
    // But if the terrain allows duplicates, remove once.
    // Otherwise, remove all.
    // #onTokenExit could be called multiple times at once.
    // To avoid errors conflicts with simultaneous removal, remove only effects labeled as such.
    const dupeTerrainsToReduce = [];
    const terrainsToRemove = [];
    for ( const terrain of terrains ) {
      const s = terrain.allowsDuplicates ? dupeTerrainsToReduce : terrainsToRemove;
      s.push(terrain);
    }
    if ( !(terrainsToRemove.length || dupeTerrainsToReduce.length) ) return;

    // ----- No async operations before this! -----
    const resumeMovement = tokenD.pauseMovement();

    // Await movement animation
    if ( tokenD.rendered ) await token.movementAnimationPromise;

    // Remove the effects from the paused token.
    if ( terrainsToRemove.length ) await Terrain.removeFromToken(token, terrainsToRemove, { removeAllDuplicates: true, origin: this.behavior.uuid });
    if ( dupeTerrainsToReduce.length) await Terrain.removeFromToken(token, dupeTerrainsToReduce, { removeAllDuplicates: false, origin: this.behavior.uuid });

    if ( resumeMovement ) return resumeMovement();
    return;
  }
}
