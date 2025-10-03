// Переменные для хранения данных и состояния
import { averagingFactory } from './averagingStrategies.js';
import ChartManager, { WaterfallRenderer } from './chartManager.js';
import { hardwareTable, serialConfig, USBSerialManager } from './usbSerial.js';

let dataBuffer = [];
let deviations = [];
let updateIntervalId = null;
let totalSamples = 0;

const settings = {
    windowSize: 50,
    updateInterval: 500,
    algorithm: 'movingAverage',
    maxSpeedKmh: 10,
    useRssiFilter: false,
    rssiThreshold: 10,
    dataViewMode: 'histogram'
};

let averagingStrategy = averagingFactory.getStrategy(settings.algorithm);

const histogramBins = 50;
const chartManager = new ChartManager('histogramChart', histogramBins);
const waterfallRenderer = new WaterfallRenderer('waterfallCanvas');

const usbSerialManager = new USBSerialManager(hardwareTable, serialConfig);
let port = null;
let currentDeviceInfo = {};
let buffer = '';

function setConnectError(message = '') {
    const errorEl = document.getElementById('connectError');
    if (!errorEl) {
        return;
    }

    if (message) {
        errorEl.textContent = message;
        errorEl.hidden = false;
    } else {
        errorEl.textContent = '';
        errorEl.hidden = true;
    }
}

function extractErrorMessage(args = []) {
    for (const arg of args) {
        if (arg instanceof Error && arg.message) {
            return arg.message;
        }
    }

    for (const arg of args) {
        if (typeof arg === 'string' && arg.trim()) {
            return arg;
        }
    }

    return args.length ? 'Произошла ошибка. Подробности в консоли.' : '';
}

const originalConsoleError = console.error.bind(console);
console.error = (...args) => {
    originalConsoleError(...args);
    const message = extractErrorMessage(args);
    if (message) {
        setConnectError(message);
    }
};

window.addEventListener('error', event => {
    const message = event?.error?.message || event?.message;
    if (message) {
        setConnectError(message);
    }
});

window.addEventListener('unhandledrejection', event => {
    const reason = event?.reason;
    const message = reason instanceof Error
        ? reason.message
        : (typeof reason === 'string' && reason.trim())
            ? reason
            : 'Необработанная ошибка.';

    setConnectError(message);
    originalConsoleError('Unhandled promise rejection:', reason);
});

document.addEventListener('DOMContentLoaded', () => {
    chartManager.init();
    waterfallRenderer.init();
    registerEventListeners();
    syncSettingsFromUI();
    startUpdateInterval();
    //startDataSimulation();
});

function registerEventListeners() {
    const windowSizeInput = document.getElementById('windowSize');
    if (windowSizeInput) {
        windowSizeInput.addEventListener('change', syncSettingsFromUI);
    }

    const updateIntervalInput = document.getElementById('updateInterval');
    if (updateIntervalInput) {
        updateIntervalInput.addEventListener('change', syncSettingsFromUI);
    }

    const algorithmSelect = document.getElementById('algorithm');
    if (algorithmSelect) {
        algorithmSelect.addEventListener('change', syncSettingsFromUI);
    }

    const dataViewModeSelect = document.getElementById('dataViewMode');
    if (dataViewModeSelect) {
        dataViewModeSelect.addEventListener('change', syncSettingsFromUI);
    }

    const useRssiFilterInput = document.getElementById('useRssiFilter');
    if (useRssiFilterInput) {
        useRssiFilterInput.addEventListener('change', syncSettingsFromUI);
    }

    const rssiThresholdInput = document.getElementById('rssiThreshold');
    if (rssiThresholdInput) {
        rssiThresholdInput.addEventListener('change', syncSettingsFromUI);
    }

    const maxSpeedInput = document.getElementById('maxSpeedKmh');
    if (maxSpeedInput) {
        maxSpeedInput.addEventListener('change', syncSettingsFromUI);
    }

    const resetButton = document.getElementById('resetChart');
    if (resetButton) {
        resetButton.addEventListener('click', resetChart);
    }
}

// Функция для обработки входящих данных
function handleData(rawData) {
    const data = rawData.trim();
    if (data.length > 64) {
        console.warn('Данные превышают 64 байта:', data.length);
        return;
    }

    try {
        // Парсинг данных в формате "%.2f %d"
        const parts = data.split(' ');
        if (parts.length !== 2) {
            throw new Error('Неверный формат данных');
        }

        const distance = parseFloat(parts[0]);
        const rssi = parseInt(parts[1]);

        // Добавление данных в буфер
        dataBuffer.push({ distance, rssi, timestamp: Date.now() });

        // Ограничение размера буфера
        if (dataBuffer.length > settings.windowSize * 2) {
            dataBuffer = dataBuffer.slice(-settings.windowSize);
        }

    } catch (error) {
        console.error('Ошибка обработки данных:', error, data);
    }
}

// Функция для обновления интерфейса
function updateDisplay() {
    if (dataBuffer.length === 0) return;

    // Получение данных для усреднения
    const recentData = dataBuffer.slice(-settings.windowSize);
    if (recentData.length === 0) return;

    let dataForCompute = recentData;

    if (settings.useRssiFilter) {
        const finiteRssi = recentData
            .map(item => item.rssi)
            .filter(value => Number.isFinite(value));

        if (finiteRssi.length > 0) {
            const sortedRssi = [...finiteRssi].sort((a, b) => a - b);
            const middle = Math.floor(sortedRssi.length / 2);
            const medianRssi = sortedRssi.length % 2 === 0
                ? (sortedRssi[middle - 1] + sortedRssi[middle]) / 2
                : sortedRssi[middle];

            const threshold = Math.max(1, settings.rssiThreshold);
            const filtered = recentData.filter(item =>
                !Number.isFinite(item.rssi) || Math.abs(item.rssi - medianRssi) <= threshold
            );

            if (filtered.length > 0) {
                dataForCompute = filtered;
            }
        }
    }

    if (dataForCompute.length === 0) {
        return;
    }

    // Вычисление средних значений
    const { avgDistance, avgRssi } = averagingStrategy.compute(dataForCompute);
    if (!isFinite(avgDistance) || !isFinite(avgRssi)) {
        return;
    }

    // Обновление отображаемых значений
    document.getElementById('avgDistance').textContent = avgDistance.toFixed(2) + ' м';
    document.getElementById('avgRssi').textContent = Math.round(avgRssi) + ' дБ';

    // Вычисление отклонений от среднего и среднеквадратичного отклонения
    const deviationsArray = dataForCompute.map(item => item.distance - avgDistance);
    const squaredDeviations = deviationsArray.map(dev => dev * dev);
    const variance = squaredDeviations.reduce((sum, sqDev) => sum + sqDev, 0) / squaredDeviations.length;
    const standardDeviation = Math.sqrt(variance);

    const finiteDistances = dataForCompute
        .map(item => item.distance)
        .filter(value => Number.isFinite(value));

    if (finiteDistances.length > 0) {
        const minDistance = Math.min(...finiteDistances);
        const maxDistance = Math.max(...finiteDistances);
        waterfallRenderer.addSample(avgDistance, minDistance, maxDistance);
    }

    // Добавление текущего отклонения в историю для гистограммы
    if (deviationsArray.length > 0) {
        const latestDeviation = deviationsArray[deviationsArray.length - 1];
        deviations.push(latestDeviation);
        totalSamples++;

        // Ограничение истории до 10000 точек для производительности
        if (deviations.length > 10000) {
            deviations = deviations.slice(-10000);
        }

        // Обновление гистограммы
        if (settings.dataViewMode === 'histogram') {
            chartManager.update(deviations);
        }

        // Обновление статистики
        document.getElementById('totalSamples').textContent = `Всего замеров: ${totalSamples}`;
        document.getElementById('currentSD').textContent = `Текущее СКО: ${standardDeviation.toFixed(2)} м`;
    }
}

function updateViewMode(force = false) {
    const histogramCanvas = document.getElementById('histogramChart');
    const waterfallCanvas = document.getElementById('waterfallCanvas');
    const showHistogram = settings.dataViewMode === 'histogram';

    if (histogramCanvas) {
        histogramCanvas.hidden = !showHistogram;
        histogramCanvas.style.display = showHistogram ? 'block' : 'none';
    }

    if (waterfallCanvas) {
        waterfallCanvas.hidden = showHistogram;
        waterfallCanvas.style.display = showHistogram ? 'none' : 'block';
    }

    waterfallRenderer.setActive(!showHistogram);

    if (!showHistogram) {
        waterfallRenderer.resizeCanvas();
    }

    if (showHistogram && chartManager?.chart) {
        if (deviations.length > 0) {
            chartManager.update(deviations);
        }
        chartManager.chart.resize();
    } else if (force && chartManager?.chart) {
        chartManager.chart.resize();
    }
}

// Обновление настроек
function syncSettingsFromUI() {
    const windowSizeInput = document.getElementById('windowSize');
    const updateIntervalInput = document.getElementById('updateInterval');
    const algorithmSelect = document.getElementById('algorithm');
    const dataViewModeSelect = document.getElementById('dataViewMode');
    const useRssiFilterInput = document.getElementById('useRssiFilter');
    const rssiThresholdInput = document.getElementById('rssiThreshold');
    const maxSpeedInput = document.getElementById('maxSpeedKmh');

    const previousStrategyId = averagingStrategy?.id;
    const previousMaxSpeed = averagingStrategy?.id === 'kalmanFilter'
        ? averagingStrategy.maxSpeedKmh
        : null;
    const previousViewMode = settings.dataViewMode;

    settings.windowSize = parseInt(windowSizeInput?.value, 10) || settings.windowSize;
    settings.updateInterval = parseInt(updateIntervalInput?.value, 10) || settings.updateInterval;
    const parsedAlgorithm = algorithmSelect?.value || settings.algorithm;
    const parsedDataViewMode = dataViewModeSelect?.value || settings.dataViewMode;

    settings.useRssiFilter = Boolean(useRssiFilterInput?.checked);

    const parsedRssiThreshold = parseFloat(rssiThresholdInput?.value);
    if (Number.isFinite(parsedRssiThreshold) && parsedRssiThreshold > 0) {
        settings.rssiThreshold = parsedRssiThreshold;
    }

    const parsedMaxSpeed = parseFloat(maxSpeedInput?.value);
    if (Number.isFinite(parsedMaxSpeed) && parsedMaxSpeed > 0) {
        settings.maxSpeedKmh = parsedMaxSpeed;
    }

    settings.algorithm = parsedAlgorithm;
    settings.dataViewMode = parsedDataViewMode;

    const newStrategy = averagingFactory.getStrategy(settings.algorithm);
    if (!newStrategy) {
        return;
    }

    averagingStrategy = newStrategy;

    const maxSpeedGroup = document.getElementById('maxSpeedGroup');
    if (maxSpeedGroup) {
        maxSpeedGroup.hidden = averagingStrategy.id !== 'kalmanFilter';
    }

    const rssiFilterGroup = document.getElementById('rssiFilterGroup');
    if (rssiFilterGroup) {
        rssiFilterGroup.hidden = !settings.useRssiFilter;
    }

    if (typeof averagingStrategy.setMaxSpeedKmh === 'function') {
        averagingStrategy.setMaxSpeedKmh(settings.maxSpeedKmh);
    }

    const needsReset = averagingStrategy.id !== previousStrategyId
        || (averagingStrategy.id === 'kalmanFilter' && previousMaxSpeed !== settings.maxSpeedKmh);

    if (needsReset && typeof averagingStrategy.reset === 'function') {
        averagingStrategy.reset();
    }

    updateViewMode(previousViewMode !== settings.dataViewMode);

    startUpdateInterval();
}

// Запуск интервала обновления
function startUpdateInterval() {
    if (updateIntervalId) {
        clearInterval(updateIntervalId);
    }

    updateIntervalId = setInterval(updateDisplay, settings.updateInterval);
}

// Сброс графика
function resetChart() {
    deviations = [];
    totalSamples = 0;

    chartManager.reset();
    waterfallRenderer.reset();

    if (typeof averagingStrategy?.reset === 'function') {
        averagingStrategy.reset();
    }

    document.getElementById('totalSamples').textContent = `Всего замеров: 0`;
    document.getElementById('currentSD').textContent = `Текущее СКО: 0.00 м`;
}

// Эмуляция получения данных (для демонстрации)
function startDataSimulation() {
    // Генерация случайных данных в формате "%.2f %d"
    setInterval(() => {
        // Базовое расстояние с небольшими флуктуациями
        const baseDistance = 5.0;
        const fluctuation = (Math.random() - 0.5) * 2; // от -1 до 1
        const distance = (baseDistance + fluctuation).toFixed(2);

        const rssi = Math.floor(Math.random() * 40) - 70; // от -70 до -30 дБ
        const data = `${distance} ${rssi}`;

        handleData(data);
    }, 7); // Примерно 143 раза в секунду
}

window.addEventListener("load", initiate, false);

//GUI function "connect"
async function connect() {
    if (!port) {
        setConnectError('Устройство не выбрано.');
        return;
    }

    port.onReceive = data => {
        buffer += new TextDecoder().decode(data);
        const lines = buffer.split('\r\n');
        buffer = lines.pop() || '';
        lines.forEach(line => {
            if (/^-?\d+\.\d+ -?\d+$/.test(line)) {
                handleData(line);
            }
        });
    };

    port.onReceiveError = async error => {
        console.error('USB receive error:', error);
        try {
            await port.disconnect();
        } catch (disconnectError) {
            console.error('Ошибка при отключении после ошибки чтения:', disconnectError);
        }
    };

    try {
        await port.connect();
        currentDeviceInfo = { ...usbSerialManager.deviceInfo };
        const buttonLabel = currentDeviceInfo.chip || currentDeviceInfo.hostName || 'Connected';
        document.getElementById('connect').innerText = buttonLabel;
        setConnectError();
    } catch (error) {
        console.error('Не удалось подключиться к устройству:', error);
        document.getElementById('connect').innerText = 'Connect';
        setConnectError(error?.message || 'Не удалось подключиться к устройству.');
    }
}

//GUI function "disconnect"
async function disconnect() {
    if (!port) {
        return;
    }

    try {
        await port.disconnect();
        document.getElementById('connect').innerText = 'Connect';
        setConnectError();
    } catch (error) {
        console.error('Ошибка при отключении устройства:', error);
        setConnectError(error?.message || 'Ошибка при отключении устройства.');
    }
}

//GUI function "send"
async function send(string) {
    console.log("sending to serial:" + string.length);
    if (string.length === 0)
        return;
    console.log("sending to serial: [" + string +"]\n");

    const data = new TextEncoder('utf-8').encode(string);
    console.log(data);
    if (port) {
        try {
            await port.send(data);
        } catch (error) {
            console.error('Ошибка при отправке данных:', error);
        }
    }
}

//the init function which we have an event listener connected to
async function initiate(){
    try {
        const ports = await usbSerialManager.getPorts();
        if (ports.length > 0) {
            port = ports[0];
            await connect();
        }
    } catch (error) {
        console.error('Ошибка при получении USB портов:', error);
    }

    document.querySelector("#connect").onclick = async function () {
        try {
            const selectedPort = await usbSerialManager.requestPort();
            port = selectedPort;
            await connect();
        } catch (error) {
            console.error('Не удалось запросить USB устройство:', error);
            setConnectError(error?.message || 'Не удалось запросить USB устройство.');
        }
    }
}
