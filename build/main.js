"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_fs_1 = require("node:fs");
const adapter_core_1 = require("@iobroker/adapter-core");
const WidgetsManagement_1 = __importDefault(require("./lib/WidgetsManagement"));
class DevicesAdapter extends adapter_core_1.Adapter {
    deviceManagement = null;
    language = 'en';
    constructor(options = {}) {
        super({
            ...options,
            name: 'devices',
            objectChange: (id, obj) => {
                this.deviceManagement?.objectChange(id, obj);
            },
            ready: () => this.main(),
            unload: cb => this.unload(cb),
            install: () => this.onInstall(),
        });
    }
    async onInstall(noTerminate) {
        // DB ist hier nutzbar → bestehendes Objekt anpassen
        const instances = await this.getObjectViewAsync('system', 'instance', {
            startkey: 'system.adapter.devices.',
            endkey: 'system.adapter.devices.香',
        });
        if (instances.rows) {
            for (const instance of instances.rows) {
                if (instance.value?.common?.mode !== 'daemon') {
                    instance.value.common.mode = 'daemon';
                    await this.setForeignObjectAsync(instance.value._id, instance.value);
                }
                await this.ensureInstanceIndicatorObjects(instance.value._id);
            }
        }
        if (!noTerminate) {
            this.terminate?.('install finished', 0);
        }
    }
    /**
     * Recreate the instance indicator objects (`alive`, `connected`, `cpu`, …) if they are missing.
     *
     * This adapter used to be `common.mode: "none"`, and js-controller creates the daemon monitoring
     * objects only when an instance is created — never for a `none` instance. `onInstall()` flips the
     * mode of pre-existing instances to `daemon`, but nobody creates the missing child objects. The
     * heartbeat keeps writing the *state values* (the states DB does not need an object), so the admin
     * "Instances" tab shows the instance red for a few seconds on every load: its object-driven state
     * snapshot skips the object-less states, and `!alive || !connected` evaluates to red until the live
     * subscription delivers a heartbeat (issue #603).
     *
     * The definitions mirror `getInstanceIndicatorObjects()` from js-controller. `setForeignObjectNotExists`
     * is idempotent, so healthy instances stay untouched and no state value is lost.
     *
     * @param instanceId Instance object ID, e.g. `system.adapter.devices.0`
     */
    async ensureInstanceIndicatorObjects(instanceId) {
        const namespace = instanceId.substring('system.adapter.'.length);
        const indicators = [
            {
                id: 'alive',
                common: {
                    name: `${namespace} alive`,
                    type: 'boolean',
                    read: true,
                    write: true,
                    role: 'indicator.state',
                },
            },
            {
                id: 'connected',
                common: {
                    name: `${namespace} is connected`,
                    type: 'boolean',
                    read: true,
                    write: false,
                    role: 'indicator.state',
                },
            },
            {
                id: 'compactMode',
                common: {
                    name: `${namespace}.compactMode`,
                    type: 'boolean',
                    read: true,
                    write: false,
                    role: 'indicator.state',
                },
            },
            {
                id: 'cpu',
                common: {
                    name: `${namespace}.cpu`,
                    type: 'number',
                    read: true,
                    write: false,
                    role: 'indicator.state',
                    unit: '% of one core',
                },
            },
            {
                id: 'cputime',
                common: {
                    name: `${namespace}.cputime`,
                    type: 'number',
                    read: true,
                    write: false,
                    role: 'indicator.state',
                    unit: 'seconds',
                },
            },
            {
                id: 'memHeapUsed',
                common: {
                    name: `${namespace} heap actually Used`,
                    type: 'number',
                    read: true,
                    write: false,
                    role: 'indicator.state',
                    unit: 'MB',
                },
            },
            {
                id: 'memHeapTotal',
                common: {
                    name: `${namespace} total Size of the Heap`,
                    type: 'number',
                    read: true,
                    write: false,
                    role: 'indicator.state',
                    unit: 'MB',
                },
            },
            {
                id: 'memRss',
                common: {
                    name: `${namespace} resident Set Size`,
                    desc: 'Resident set size',
                    type: 'number',
                    read: true,
                    write: false,
                    role: 'indicator.state',
                    unit: 'MB',
                },
            },
            {
                id: 'uptime',
                common: {
                    name: `${namespace} uptime`,
                    type: 'number',
                    read: true,
                    write: false,
                    role: 'indicator.state',
                    unit: 'seconds',
                },
            },
            {
                id: 'inputCount',
                common: {
                    name: `${namespace} events input counter`,
                    desc: "State's inputs in 15 seconds",
                    type: 'number',
                    read: true,
                    write: false,
                    role: 'state',
                    unit: 'events/15 seconds',
                },
            },
            {
                id: 'outputCount',
                common: {
                    name: `${namespace} events output counter`,
                    desc: "State's outputs in 15 seconds",
                    type: 'number',
                    read: true,
                    write: false,
                    role: 'state',
                    unit: 'events/15 seconds',
                },
            },
            {
                id: 'eventLoopLag',
                common: {
                    name: `${namespace} Node.js event loop lag`,
                    desc: 'Node.js event loop lag in ms averaged over 15 seconds',
                    type: 'number',
                    read: true,
                    write: false,
                    role: 'state',
                    unit: 'ms',
                },
            },
            {
                id: 'sigKill',
                common: {
                    name: `${namespace} kill signal`,
                    desc: 'Process id that must survive. All other IDs must terminate itself',
                    type: 'number',
                    read: true,
                    write: false,
                    role: 'state',
                },
            },
            {
                id: 'logLevel',
                common: {
                    name: `${namespace} loglevel`,
                    desc: 'Loglevel of the adapter. Will be set on start with defined value but can be overridden during runtime',
                    type: 'string',
                    read: true,
                    write: true,
                    role: 'state',
                },
            },
        ];
        const created = [];
        for (const { id, common } of indicators) {
            const fullId = `${instanceId}.${id}`;
            try {
                if (await this.getForeignObjectAsync(fullId)) {
                    continue;
                }
                await this.setForeignObjectAsync(fullId, { type: 'state', common, native: {} });
                created.push(id);
            }
            catch (error) {
                this.log.warn(`Cannot create ${fullId}: ${error}`);
            }
        }
        if (created.length) {
            this.log.info(`Recreated missing instance objects for ${instanceId}: ${created.join(', ')}. ` +
                `They were never created because the instance predates the switch to "daemon" mode.`);
        }
    }
    unload(cb) {
        this.deviceManagement?.destroy();
        cb?.();
    }
    async main() {
        this.deviceManagement = new WidgetsManagement_1.default(this, true);
        const systemConfig = await this.getForeignObjectAsync('system.config');
        this.language = systemConfig?.common?.language || 'en';
        this.subscribeForeignObjects('*');
        // Migrates `common.mode` of pre-existing instances and repairs their missing monitoring
        // objects (see #603), so the admin does not show us red.
        await this.onInstall(true);
        // Upload one picture to devices.0, so it will be available in the File selector
        try {
            if (!(await this.fileExistsAsync(this.namespace, 'ioBrokerLogo.png'))) {
                const image = (0, node_fs_1.readFileSync)(`${__dirname}/../img/ioBrokerLogo.png`);
                await this.writeFileAsync(this.namespace, 'ioBrokerLogo.png', image);
            }
        }
        catch (error) {
            this.log.error(`Unable to upload default image: ${error}`);
        }
        // Warn if any installed `web` adapter instance is misconfigured for the devices GUI.
        // The widget manager backend talks to the GUI via socket.io sendTo; with the legacy
        // built-in socket.io transport on `web` this hangs (no router for our namespace), so
        // the instance must either run `usePureWebSockets` or delegate the socket layer to a
        // `ws.X` adapter instance via `native.socketio`.
        await this.checkWebInstances();
    }
    async checkWebInstances() {
        try {
            let found = false;
            const res = await this.getObjectViewAsync('system', 'instance', {
                startkey: 'system.adapter.web.',
                endkey: 'system.adapter.web.香',
            });
            for (const row of res?.rows || []) {
                const id = row.id;
                // Skip ws.* / other adapters that happen to alphabetically fall in this range
                if (!/^system\.adapter\.web\.\d+$/.test(id)) {
                    continue;
                }
                const native = (row.value?.native || {});
                if (!native.socketio && native.usePureWebSockets) {
                    found = true;
                    break;
                }
                if (typeof native.socketio === 'string' && /^ws\.\d+$/.test(native.socketio)) {
                    found = true;
                    break;
                }
            }
            if (!found) {
                this.log.warn(`web instance is not configured for the devices GUI — enable "Pure Web Sockets" or set "Socket.io adapter" to a "ws.X" instance, otherwise the widget view will hang.`);
            }
        }
        catch (error) {
            this.log.debug(`Could not check web instance configuration: ${error}`);
        }
    }
}
exports.default = DevicesAdapter;
if (require.main !== module) {
    // Export the constructor in compact mode
    module.exports = (options) => new DevicesAdapter(options);
}
else {
    // otherwise start the instance directly
    (() => new DevicesAdapter())();
}
//# sourceMappingURL=main.js.map