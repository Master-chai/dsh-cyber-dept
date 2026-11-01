/** One lazy local sprite decode shared by office canvases. */
import { OFFICE_SPRITES } from '../assets.js';

var officeImagePromise;
export function loadOfficeImages() {
  if (!officeImagePromise) officeImagePromise=Promise.all(OFFICE_SPRITES.map(function(src){return new Promise(function(resolve,reject){var img=new Image();img.onload=function(){resolve(img);};img.onerror=reject;img.src=src;});})).catch(function(error){officeImagePromise=null;throw error;});
  return officeImagePromise;
}
