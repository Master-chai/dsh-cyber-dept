import base from './styles/base.css';
import scene from './office-scene.css';
import theme from './office-theme.css';
import {PLUGIN_ID} from '../shared/contract.js';
export const officeCss=base+scene+theme;
export function installStyles(){
 if(typeof document==='undefined')return;
 const id=PLUGIN_ID+'/office.css';
 const previous=document.querySelector('style[data-plugin-css='+JSON.stringify(id)+']');
 if(previous)previous.remove();
 const tag=document.createElement('style');tag.dataset.plugin=PLUGIN_ID;tag.dataset.pluginCss=id;tag.textContent=officeCss;document.head.appendChild(tag);
}
