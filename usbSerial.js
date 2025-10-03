const hardwareTable = {
    0x0403: {
        FTDI: {
            0x6001: 'FT232R',
            0x6010: 'FT2232H',
            0x6011: 'FT4232H',
            0x6014: 'FT232H',
            0x6015: 'FT231X'
        }
    },
    0x1a86: {
        Quinheng: {
            0x7523: 'CH340',
            0x5523: 'CH341A'
        }
    },
    0x10c4: {
        'Silicon Labs': {
            0xea60: 'CP210x',
            0xea70: 'CP2105',
            0xea71: 'CP2108'
        }
    },
    0x067b: {
        Prolific: {
            0x2303: 'PL2303'
        }
    }
};

const serialConfig = {
    DEBUG: true,
    DEFAULT_BAUD_RATE: 115200,
    BAUD_RATES: [600, 1200, 2400, 4800, 9600, 14400, 19200, 38400, 57600, 115200, 230400],
    CH340: {
        REQUEST_READ_VERSION: 0x5f,
        REQUEST_READ_REGISTRY: 0x95,
        REQUEST_WRITE_REGISTRY: 0x9a,
        REQUEST_SERIAL_INITIATION: 0xa1,
        REG_SERIAL: 0xc29c,
        REG_MODEМ_CTRL: 0xa4,
        REG_MODEM_CTRL: 0xa4,
        REG_MODEМ_VALUE_OFF: 0xff,
        REG_MODEM_VALUE_OFF: 0xff,
        REG_MODEМ_VALUE_ON: 0xdf,
        REG_MODEM_VALUE_ON: 0xdf,
        REG_MODEМ_VALUE_CALL: 0x9f,
        REG_MODEM_VALUE_CALL: 0x9f,
        REG_BAUD_FACTOR: 0x1312,
        REG_BAUD_OFFSET: 0x0f2c,
        REG_BAUD_LOW: 0x2518,
        REG_CONTROL_STATUS: 0x2727,
        BAUD_RATE: {
            600: { FACTOR: 0x6481, OFFSET: 0x76 },
            1200: { FACTOR: 0xb281, OFFSET: 0x3b },
            2400: { FACTOR: 0xd981, OFFSET: 0x1e },
            4800: { FACTOR: 0x6482, OFFSET: 0x0f },
            9600: { FACTOR: 0xb282, OFFSET: 0x08 },
            14400: { FACTOR: 0xd980, OFFSET: 0xeb },
            19200: { FACTOR: 0xd982, OFFSET: 0x07 },
            38400: { FACTOR: 0x6483, OFFSET: null },
            57600: { FACTOR: 0x9883, OFFSET: null },
            115200: { FACTOR: 0xcc83, OFFSET: null },
            230500: { FACTOR: 0xe683, OFFSET: null }
        }
    }
};

class USBSerialHelpers {
    static hexToDataView(number) {
        if (number === 0) {
            const array = new Uint8Array([0]);
            return new DataView(array.buffer);
        }
        const hexString = number.toString(16);
        const pairs = hexString.match(/[\dA-F]{2}/gi) || [];
        const integers = pairs.map(pair => parseInt(pair, 16));
        const array = new Uint8Array(integers);
        return new DataView(array.buffer);
    }

    static hexStringArrayToDataView(hexString) {
        const cleaned = hexString.replace(/^0x/, '');
        const pairs = cleaned.split(/ /);
        const integers = pairs.map(pair => parseInt(pair, 16));
        const array = new Uint8Array(integers);
        return new DataView(array.buffer);
    }

    static arrayBufferToHex(arrayBuffer) {
        const hex =
            '0x0' +
            Array.prototype
                .map.call(new Uint8Array(arrayBuffer), x => ('00' + x.toString(16)).slice(-2))
                .join('');
        return parseInt(hex);
    }
}

class USBSerialDriverRegistry {
    constructor() {
        this.registry = new Map();
    }

    register(chipId, driver) {
        this.registry.set(chipId, driver);
    }

    get(chipId) {
        return this.registry.get(chipId);
    }
}

class USBSerialManager {
    constructor(table, config) {
        this.table = table;
        this.config = config;
        this.driverRegistry = new USBSerialDriverRegistry();
        this.deviceInfo = {};
        this.currentPort = null;
        this._registerDefaultDrivers();
    }

    _registerDefaultDrivers() {
        this.driverRegistry.register('CH340', new CH340Driver(this.config));
    }

    async getPorts() {
        const devices = await navigator.usb.getDevices();
        return devices.map(device => new USBSerialPort(device, this));
    }

    async requestPort() {
        const filters = [];
        Object.keys(this.table).forEach(vendorId => {
            Object.keys(this.table[vendorId]).forEach(vendorName => {
                Object.keys(this.table[vendorId][vendorName]).forEach(productId => {
                    filters.push({
                        vendorId: Number(vendorId),
                        productId: Number(productId)
                    });
                });
            });
        });

        const device = await navigator.usb.requestDevice({ filters });
        return new USBSerialPort(device, this);
    }

    updateDeviceInfo(port) {
        const vendorData = this.table[port.device_.vendorId];
        if (!vendorData) {
            this.deviceInfo = {};
            return;
        }
        const vendorName = Object.keys(vendorData)[0];
        const chip = vendorData[vendorName][port.device_.productId];
        this.deviceInfo = {
            hostName: port.device_.productName,
            vendorName,
            chip,
            serialNumber: port.device_.serialNumber,
            manufacturerName: port.device_.manufacturerName
        };
    }

    getDriver(chip) {
        return this.driverRegistry.get(chip);
    }

    async controlledTransfer(
        port,
        direction,
        type,
        recipient,
        request,
        value = 0,
        data = new DataView(new ArrayBuffer(0)),
        index = port.interfaceNumber_
    ) {
        const formattedDirection = direction.charAt(0).toUpperCase() + direction.slice(1);
        const formattedType = type.toLowerCase();
        const formattedRecipient = recipient.toLowerCase();
        let transferData = data;
        if (formattedDirection === 'In') {
            if (transferData instanceof DataView) {
                if (transferData.byteLength === 0) {
                    transferData = 0;
                }
            } else if (typeof transferData !== 'number') {
                transferData = 0;
            }
        }

        const result = await port.device_['controlTransfer' + formattedDirection](
            {
                requestType: formattedType,
                recipient: formattedRecipient,
                request,
                value,
                index
            },
            transferData
        );

        if (this.config.DEBUG) {
            console.log(result);
        }

        if (result.status !== 'ok') {
            console.warn('USB control transfer error', {
                direction: formattedDirection,
                type: formattedType,
                recipient: formattedRecipient,
                request,
                value,
                index,
                data: transferData
            });
        }

        if (result.data && result.data.buffer) {
            return result.data.buffer;
        }

        return null;
    }
}

class USBSerialPort {
    constructor(device, manager) {
        this.device_ = device;
        this.manager = manager;
        this.onReceive = () => {};
        this.onReceiveError = () => {};
        this.interfaceNumber_ = null;
        this.endpointIn_ = null;
        this.endpointOut_ = null;
        this.endpointInPacketSize_ = null;
        this.endpointOutPacketSize_ = null;
    }

    async connect() {
        const readLoop = () => {
            this.device_.transferIn(this.endpointIn_, 64)
                .then(result => {
                    this.onReceive(result.data);
                    readLoop();
                })
                .catch(error => {
                    this.onReceiveError(error);
                });
        };

        await this.device_.open();
        this.manager.updateDeviceInfo(this);

        if (this.device_.configuration === null) {
            await this.device_.selectConfiguration(1);
        }

        this._configureEndpoints();

        await this.device_.claimInterface(this.interfaceNumber_);
        await this.device_.selectAlternateInterface(this.interfaceNumber_, 0);

        const chip = this.manager.deviceInfo.chip;
        const driver = this.manager.getDriver(chip);
        if (driver && driver.configure) {
            await driver.configure(this, this.manager);
        }

        readLoop();
    }

    _configureEndpoints() {
        const configInterfaces = this.device_.configuration.interfaces;
        configInterfaces.forEach(iface => {
            iface.alternates.forEach(alternate => {
                if (alternate.interfaceClass === 0xff) {
                    this.interfaceNumber_ = iface.interfaceNumber;
                    alternate.endpoints.forEach(endpoint => {
                        if (endpoint.direction === 'out' && endpoint.type === 'bulk') {
                            this.endpointOut_ = endpoint.endpointNumber;
                            this.endpointOutPacketSize_ = endpoint.packetSize;
                        }
                        if (endpoint.direction === 'in' && endpoint.type === 'bulk') {
                            this.endpointIn_ = endpoint.endpointNumber;
                            this.endpointInPacketSize_ = endpoint.packetSize;
                        }
                    });
                }
            });
        });
    }

    async disconnect() {
        const chip = this.manager.deviceInfo.chip;
        const driver = this.manager.getDriver(chip);
        if (driver && driver.disconnect) {
            await driver.disconnect(this, this.manager);
        }
        await this.device_.close();
    }

    async send(data) {
        return this.device_.transferOut(this.endpointOut_, data);
    }
}

class CH340Driver {
    constructor(config) {
        this.config = config;
    }

    async configure(port, manager, baudRate = this.config.DEFAULT_BAUD_RATE) {
        const data = USBSerialHelpers.hexToDataView(0);
        const cfg = this.config.CH340;
        const modemCallValue = cfg.REG_MODEМ_VALUE_CALL ?? cfg.REG_MODEM_VALUE_CALL;
        const modemOnValue = cfg.REG_MODEМ_VALUE_ON ?? cfg.REG_MODEM_VALUE_ON;

        await manager.controlledTransfer(port, 'out', 'vendor', 'device', cfg.REQUEST_SERIAL_INITIATION, cfg.REG_SERIAL, data, 0xb2b9);
        await manager.controlledTransfer(port, 'out', 'vendor', 'device', cfg.REG_MODEM_CTRL ?? cfg.REG_MODEМ_CTRL, modemOnValue);
        await manager.controlledTransfer(port, 'out', 'vendor', 'device', cfg.REG_MODEM_CTRL ?? cfg.REG_MODEМ_CTRL, modemCallValue);

        let response = await manager.controlledTransfer(port, 'in', 'vendor', 'device', cfg.REQUEST_READ_REGISTRY, 0x0706, 2);
        response = USBSerialHelpers.arrayBufferToHex(response);
        if (response < 0) {
            return;
        }

        await manager.controlledTransfer(port, 'out', 'vendor', 'device', cfg.REQUEST_WRITE_REGISTRY, cfg.REG_CONTROL_STATUS, data);
        await manager.controlledTransfer(port, 'out', 'vendor', 'device', cfg.REQUEST_WRITE_REGISTRY, cfg.REG_BAUD_FACTOR, data, 0xb282);
        await manager.controlledTransfer(port, 'out', 'vendor', 'device', cfg.REQUEST_WRITE_REGISTRY, cfg.REG_BAUD_OFFSET, data, 0x0008);
        await manager.controlledTransfer(port, 'out', 'vendor', 'device', cfg.REQUEST_WRITE_REGISTRY, cfg.REG_BAUD_LOW, data, 0x00c3);

        response = await manager.controlledTransfer(port, 'in', 'vendor', 'device', cfg.REQUEST_READ_REGISTRY, 0x0706, 2);
        response = USBSerialHelpers.arrayBufferToHex(response);
        if (response < 0) {
            return;
        }

        await manager.controlledTransfer(port, 'out', 'vendor', 'device', cfg.REQUEST_WRITE_REGISTRY, cfg.REG_CONTROL_STATUS, data);
        await this.setBaudRate(port, manager, baudRate);
    }

    async setBaudRate(port, manager, baudRate) {
        const cfg = this.config.CH340;
        const baudConfig = cfg.BAUD_RATE[baudRate];
        if (!baudConfig) {
            console.warn(`Baud rate ${baudRate} is not supported by CH340 driver`);
            return;
        }

        const data = USBSerialHelpers.hexToDataView(0);
        await manager.controlledTransfer(port, 'out', 'vendor', 'device', cfg.REQUEST_WRITE_REGISTRY, cfg.REG_BAUD_FACTOR, data, baudConfig.FACTOR);
        await manager.controlledTransfer(port, 'out', 'vendor', 'device', cfg.REQUEST_WRITE_REGISTRY, cfg.REG_BAUD_OFFSET, data, baudConfig.OFFSET ?? 0);
        await manager.controlledTransfer(port, 'out', 'vendor', 'device', cfg.REQUEST_WRITE_REGISTRY, cfg.REG_CONTROL_STATUS, data);
    }

    async disconnect(port, manager) {
        const cfg = this.config.CH340;
        const modemCtrl = cfg.REG_MODEM_CTRL ?? cfg.REG_MODEМ_CTRL;
        const modemOff = cfg.REG_MODEM_VALUE_OFF ?? cfg.REG_MODEМ_VALUE_OFF;
        await manager.controlledTransfer(port, 'in', 'vendor', 'device', modemCtrl, modemOff);
    }
}

export {
    hardwareTable,
    serialConfig,
    USBSerialHelpers,
    USBSerialDriverRegistry,
    USBSerialManager,
    USBSerialPort,
    CH340Driver
};
