/* globals
CONST,
Dialog,
game,
SearchFilter
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

// Much of this is from
// https://github.com/DFreds/dfreds-convenient-effects/blob/main/scripts/app/convenient-effects-controller.js

import { TerrainSettings } from "./settings.js";
import { Terrain } from "./Terrain.js";
import { EffectHelper } from "./EffectHelper.js";

/**
 * Controller class to handle app events and manipulate underlying Foundry data.
 */
export class TerrainEffectsController {
  /**
   * Initializes the controller and its dependencies
   * @param {TerrainEffectsApp} viewMvc - the app that the controller can interact with
   */
  constructor(viewMvc) {
    this._viewMvc = viewMvc;

//     this._customEffectsHandler = new CustomEffectsHandler();
//     this._dynamicEffectsAdder = new DynamicEffectsAdder();
//     this._foundryHelpers = new FoundryHelpers();
  }

  /**
   * Configures and returns the data that the app will send to the template
   * @returns {Object} the data to pass to the template
   */
  get data() {
    return {
      // Folders:
      // - Favorites: Smart folder; displays any item that is favorited.
      // - Scene: Smart folder; displays any terrain in the scene.
      // - All: Smart folder; displays all defined terrains.
      folders: [
        {
          id: 'favorites',
          name: 'Favorites',
          effects: this._fetchFavorites().map(e => {
            return {
              name: e.name,
              icon: e.icon,
              id: e.id,
              description: e.description
            };
          }),
        },
        {
          id: 'scene',
          name: 'Scene',
          effects: this._fetchSceneTerrains().map(e => {
            return {
              name: e.name,
              icon: e.icon,
              id: e.id,
              description: e.description
            };
          }),
        },
        {
          id: 'all',
          name: 'All',
          effects: this._fetchAllTerrains().map(e => {
            return {
              name: e.name,
              icon: e.icon,
              id: e.id,
              description: e.description
            };
          }),
        }
      ],

      isGM: game.user.isGM
    };
  }

  _fetchFavorites() {
    console.debug("TerrainEffectsController|_fetchFavorites");

    // Data needed: name, icon, id


    return [];
//     return this._settings.favoriteEffectNames
//       .map((name) => {
//         return game.dfreds.effects.all.find((effect) => effect.name == name);
//       })
//       .filter((effect) => effect)
//       .sort((a, b) => {
//         let nameA = a.name.toLowerCase();
//         let nameB = b.name.toLowerCase();
//
//         if (nameA < nameB) return -1;
//         if (nameA > nameB) return 1;
//         return 0;
//       });
  }

  _fetchSceneTerrains(terrains) {
    console.debug("TerrainEffectsController|_fetchSceneTerrains");
    return [];
  }

  _fetchAllTerrains() {
    console.debug("TerrainEffectsController|_fetchAllTerrains");
    return Terrain.getAll();
  }

  /**
   * Remove the collapsed class from all saved, expanded folders
   */
  expandSavedFolders() {
    TerrainSettings.expandedFolders.forEach(folderId => {
      this._viewMvc.expandFolder(folderId);
    });
  }

  /**
   * Handles clicks on the create effect button
   *
   * @param {MouseEvent} event
   */
  async onCreateEffectClick(event) {
    console.debug("TerrainEffectsController|onCreateEffectClick");
    // await this._customEffectsHandler.createNewCustomEffect();
  }

  /**
   * Handle editing the custom effect
   *
   * @param {jQuery} effectItem - jQuery element representing the effect list item
   */
  async onEditEffectClick(effectItem) {
    console.debug("TerrainEffectsController|onEditEffectClick");

//     const effectName = effectItem.data().effectName;
//     const customEffect = this._customEffectsHandler
//       .getCustomEffects()
//       .find((effect) => effect.name == effectName);
//
//     await this._customEffectsHandler.editCustomEffect(customEffect);
  }

  /**
   * Handle deleting the custom effect
   *
   * @param {jQuery} effectItem - jQuery element representing the effect list item
   */
  async onDeleteEffectClick(effectItem) {
    console.debug("TerrainEffectsController|onDeleteEffectClick");

//     const effectName = effectItem.data().effectName;
//     const customEffect = this._customEffectsHandler
//       .getCustomEffects()
//       .find((effect) => effect.name == effectName);
//
//     await this._customEffectsHandler.deleteCustomEffect(customEffect);
//     this._viewMvc.render();
  }

  /**
   * Handles clicks on the reset status effects button
   * @param {MouseEvent} event
   */
  async onResetStatusEffectsClick(event) {
    return Dialog.confirm({
      title: "Reset Status Effects",
      content:
        "<h4>Are You Sure?</h4><p>This will reset all configured terrain effects to the module defaults and reload Foundry.",
      yes: async () => {
        console.debug("TerrainEffectsController|onResetStatusEffectsClick");
        // await this._settings.resetStatusEffects();
        window.location.reload();
      },
    });
  }

  /**
   * Handles clicks on the collapse all button
   * @param {MouseEvent} event - event that corresponds to clicking the collapse all
   */
  async onCollapseAllClick(event) {
    this._viewMvc.collapseAllFolders();
    await TerrainSettings.clearExpandedFolders();
  }

  /**
   * Handles clicks on folders by collapsing or expanding them
   * @param {MouseEvent} event - event that corresponds to clicking on the folder
   */
  async onFolderClick(event) {
    let folderId = event.currentTarget.parentElement.dataset.folderId;

    if (this._viewMvc.isFolderCollapsed(folderId)) {
      this._viewMvc.expandFolder(folderId);
    } else {
      this._viewMvc.collapseFolder(folderId);
    }

    if (TerrainSettings.isFolderExpanded(folderId)) {
      await TerrainSettings.removeExpandedFolder(folderId);
    } else {
      await TerrainSettings.addExpandedFolder(folderId);
    }
  }

  /**
   * Handles clicks on effect items by toggling them on or off on selected tokens
   * @param {MouseEvent} event - event that corresponds to clicking an effect item
   */
  async onEffectClick(event) {
    console.debug("TerrainEffectsController|onEffectClick");
    const effectId = this._findNearestEffectId(event);


//     const effectName = this._findNearestEffectName(event);
//     await game.dfreds.effectInterface.toggleEffect(effectName);
  }

  _findNearestEffectName(event) {
    return $(event.target)
      .closest('[data-effect-name], .terrainmapper-effect')
      .data()?.effectName;
  }

  _findNearestEffectId(event) {
    return $(event.target)
      .closest('[data-effect-id], .terrainmapper-effect')
      .data()?.effectName;
  }

  /**
   * Handle adding the effect to the favorites settings and to the favorites folder
   * @param {jQuery} effectItem - jQuery element representing the effect list item
   */
  async onAddFavorite(effectItem) {
    console.debug("TerrainEffectsController|onAddFavorite");

    // const effectName = effectItem.data().effectName;
//
//     // Don't add favorites twice
//     if (this._settings.isFavoritedEffect(effectName)) return;
//
//     await this._settings.addFavoriteEffect(effectName);
//     this._viewMvc.render();
  }

  /**
   * Handle removing the effect from the favorites settings and from the favorites folder
   * @param {jQuery} effectItem - jQuery element representing the effect list item
   */
  async onRemoveFavorite(effectItem) {
    console.debug("TerrainEffectsController|onRemoveFavorite");

//     const effectName = effectItem.data().effectName;
//
//     await this._settings.removeFavoriteEffect(effectName);
//     this._viewMvc.render();
  }

  /**
   * Checks if the provided effect is favorited
   * @param {jQuery} effectItem - jQuery element representing the effect list item
   * @returns true if the effect is favorited
   */
  isFavoritedEffect(effectItem) {
    console.debug("TerrainEffectsController|isFavoritedEffect");
//     const effectName = effectItem.data().effectName;
//     return this._settings.isFavoritedEffect(effectName);
  }


  /**
   * Handle adding/removing the effect from the to/from the status effect settings
   * @param {jQuery} effectItem - jQuery element representing the effect list item
   */
  async onToggleStatusEffect(effectItem) {
    console.debug("TerrainEffectsController|onToggleStatusEffect");

//     const effectName = effectItem.data().effectName;
//
//     if (this._settings.isStatusEffect(effectName)) {
//       await this._settings.removeStatusEffect(effectName);
//     } else {
//       await this._settings.addStatusEffect(effectName);
//     }
//
//     this._viewMvc.showReloadRequired();
//     this._viewMvc.render();
  }

  /**
   * Handle duplicating an effect.
   * @param {jQuery} effectItem - jQuery element representing the effect list item
   */
  async onDuplicate(effectItem) {
    console.debug("TerrainEffectsController|onDuplicate");

//     const effectName = effectItem.data().effectName;
//
//     const effect = game.dfreds.effects.all.find(
//       (effect) => effect.name === effectName
//     );
//
//     await this._customEffectsHandler.duplicateExistingEffect(effect);
//
//     this._viewMvc.render();
  }

  /**
   * Handle clicks on the export custom effects button
   * @param {MouseEvent} event - event that corresponds to clicking the export
   */
  async onExportCustomEffectsClick(event) {
    console.debug("TerrainEffectsController|onExportCustomEffectsClick");
//     event.stopPropagation();
//     await this._customEffectsHandler.exportCustomEffectsToJson();
  }

  /**
   * Handle clicks on the import custom effects button
   * @param {MouseEvent} event - event that corresponds to clicking the export
   */
  async onImportCustomEffectsClick(event) {
    console.debug("TerrainEffectsController|onImportCustomEffectsClick");
//     event.stopPropagation();
//     await this._customEffectsHandler.importCustomEffectsFromJson();
  }

  /**
   * Handles starting the drag for effect items
   * For non-nested effects, populates the dataTransfer with Foundry's expected
   * ActiveEffect type and data to make non-nested effects behave as core does
   * @param {DragEvent} event - event that corresponds to the drag start
   */
  onEffectDragStart(event) {
    console.debug("TerrainEffectsController|onEffectDragStart");

    // const effectName = event.target.dataset.effectName;
//
//     const effect = game.dfreds.effectInterface.findEffectByName(effectName);
//
//     // special handling for nested effects
//     if (game.dfreds.effectInterface.hasNestedEffects(effect)) {
//       event.dataTransfer.setData(
//         'text/plain',
//         JSON.stringify({
//           effectName,
//         })
//       );
//       return;
//     }
//
//     event.dataTransfer.setData(
//       'text/plain',
//       JSON.stringify({
//         effectName,
//         type: 'ActiveEffect',
//         data: effect,
//       })
//     );
  }

  canDragStart() {
    return game.user.role >= CONST.USER_ROLES.ASSISTANT
  }

  /**
   * Handles search text changes
   * @param {KeyboardEvent} event - event that corresponds to the key press
   * @param {string} query - string representation of the entered search text
   * @param {RegExp} regex - the regex representation of the entered search text
   * @param {HTML} html - the html the SearchFilter is being applied to
   */
  onSearchTextChange(event, query, regex, html) {
    const isSearch = !!query;

    let matchingItems = {};

    if (isSearch) {
      matchingItems = this._getMatchingItems(regex);
    }

    for (let el of html.querySelectorAll('.directory-item')) {
      let isEntity = el.classList.contains('entity');
      let isFolder = el.classList.contains('folder');

      if (isEntity) {
        let match =
          isSearch && matchingItems.effectNames.has(el.dataset.effectName);
        el.style.display = !isSearch || match ? 'flex' : 'none';
      } else if (isFolder) {
        let match =
          isSearch && matchingItems.folderIds.has(el.dataset.folderId);
        el.style.display = !isSearch || match ? 'flex' : 'none';

        // Expand folders with matches
        if (match) el.classList.remove('collapsed');
        else el.classList.toggle(
          'collapsed',
          !TerrainSettings.isFolderExpanded(el.dataset.folderId)
        );
      }
    }
  }

  _getMatchingItems(regex) {
    let effectNames = new Set();
    let folderIds = new Set();

    for (let folder of this.data.folders) {
      for (let effect of folder.effects) {
        if (regex.test(SearchFilter.cleanQuery(effect.name))) {
          effectNames.add(effect.name);
          folderIds.add(folder.id);
        }
      }
    }

    return {
      effectNames,
      folderIds
    };
  }
}
