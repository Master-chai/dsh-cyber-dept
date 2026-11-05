// Test-only entry. Production exposes only the DSH plugin lifecycle.
export {inject,apply} from './host/plugin.js';
import * as common from './common.js';
import * as normalize from './model/normalize.js';
import * as floor from './model/floor.js';
import * as scene from './office-scene.js';
import * as theme from './office-theme.js';
import * as interactions from './office-interactions.js';
import * as board from './task-board.js';
import * as selectors from './sync/selectors.js';
import * as cache from './sync/view-cache.js';
import * as protocol from './commands/protocol.js';
import {fetchOfficeText} from './transport.js';
import {Page} from './components/page.js';
import {CollapsibleSection,FloorPane} from './components/sections.js';
import {DetailPane} from './components/employee-card.js';
import {officeCss} from './styles.js';
import {SNAPSHOT_ROUTE,SNAPSHOT_METHOD} from '../shared/contract.js';
export const __internals={...common,...normalize,...floor,...scene,...theme,...interactions,...board,...selectors,...cache,...protocol,fetchOfficeText,Page,CollapsibleSection,FloorPane,DetailPane,officeCss,RPC_PATH:SNAPSHOT_ROUTE,RPC_METHOD:SNAPSHOT_METHOD};
