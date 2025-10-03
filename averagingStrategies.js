class AveragingStrategy {
    constructor(id) {
        this.id = id;
    }

    compute(/* data */) {
        throw new Error('Метод compute должен быть реализован в наследнике');
    }

    reset() {
        // Переопределяется в наследниках при необходимости
    }
}

class MovingAverageStrategy extends AveragingStrategy {
    constructor() {
        super('movingAverage');
    }

    compute(data) {
        if (!data || data.length === 0) {
            return { avgDistance: 0, avgRssi: 0 };
        }

        const sumDistance = data.reduce((sum, item) => sum + item.distance, 0);
        const sumRssi = data.reduce((sum, item) => sum + item.rssi, 0);

        return {
            avgDistance: sumDistance / data.length,
            avgRssi: sumRssi / data.length
        };
    }
}

class MedianAverageStrategy extends AveragingStrategy {
    constructor() {
        super('medianAverage');
    }

    compute(data) {
        if (!data || data.length === 0) {
            return { avgDistance: 0, avgRssi: 0 };
        }

        const distances = data
            .map(item => item.distance)
            .sort((a, b) => a - b);
        const rssis = data
            .map(item => item.rssi)
            .sort((a, b) => a - b);
        const middle = Math.floor(distances.length / 2);

        const medianDistance = distances.length % 2 === 0
            ? (distances[middle - 1] + distances[middle]) / 2
            : distances[middle];

        const medianRssi = rssis.length % 2 === 0
            ? (rssis[middle - 1] + rssis[middle]) / 2
            : rssis[middle];

        return { avgDistance: medianDistance, avgRssi: medianRssi };
    }
}

class KalmanFilterStrategy extends AveragingStrategy {
    constructor({ maxSpeedKmh = 10 } = {}) {
        super('kalmanFilter');
        this.maxSpeedKmh = maxSpeedKmh;
        this.reset();
    }

    setMaxSpeedKmh(value) {
        if (Number.isFinite(value) && value > 0) {
            this.maxSpeedKmh = value;
        }
    }

    reset() {
        this.initialized = false;
        this.position = 0;
        this.velocity = 0;
        this.P = [
            [1, 0],
            [0, 1]
        ];
        this.lastTimestamp = null;
    }

    compute(data) {
        if (!data || data.length === 0) {
            return { avgDistance: 0, avgRssi: 0 };
        }

        const validMeasurements = data
            .filter(item => Number.isFinite(item?.distance))
            .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

        if (validMeasurements.length === 0) {
            return { avgDistance: 0, avgRssi: 0 };
        }

        const measurementNoise = 0.5; // дисперсия измерения (м²)
        const maxSpeedMps = (this.maxSpeedKmh * 1000) / 3600;

        if (!this.initialized) {
            const lastMeasurement = validMeasurements[validMeasurements.length - 1];
            this.position = lastMeasurement.distance;
            this.velocity = 0;
            this.P = [
                [1, 0],
                [0, 1]
            ];
            this.lastTimestamp = lastMeasurement.timestamp || Date.now();
            this.initialized = true;
        }

        for (const measurement of validMeasurements) {
            const timestamp = measurement.timestamp || Date.now();
            let dt = this.lastTimestamp != null
                ? (timestamp - this.lastTimestamp) / 1000
                : 0;

            if (!Number.isFinite(dt) || dt <= 0) {
                dt = 0.02; // 50 Гц по умолчанию
            } else if (dt > 5) {
                // Слишком большой разрыв во времени: реинициализируем фильтр
                this.position = measurement.distance;
                this.velocity = 0;
                this.P = [
                    [1, 0],
                    [0, 1]
                ];
                this.lastTimestamp = timestamp;
                continue;
            }

            const dt2 = dt * dt;
            const dt3 = dt2 * dt;
            const dt4 = dt2 * dt2;
            const accelVariance = Math.pow(maxSpeedMps, 2) * 0.1;

            // Прогноз состояния
            const predictedPosition = this.position + this.velocity * dt;
            const predictedVelocity = this.velocity;

            // Прогноз ковариации ошибки: P = FPF^T + Q
            const [p00, p01] = this.P[0];
            const [p10, p11] = this.P[1];
            const fp00 = p00 + dt * (p01 + p10) + dt2 * p11;
            const fp01 = p01 + dt * p11;
            const fp10 = p10 + dt * p11;
            const fp11 = p11;

            const q00 = 0.25 * dt4 * accelVariance;
            const q01 = 0.5 * dt3 * accelVariance;
            const q11 = dt2 * accelVariance;

            let predP00 = fp00 + q00;
            let predP01 = fp01 + q01;
            let predP10 = fp10 + q01;
            let predP11 = fp11 + q11;

            // Обновление по измерению
            const innovation = measurement.distance - predictedPosition;
            const innovationVariance = predP00 + measurementNoise;
            const kalmanGain0 = predP00 / innovationVariance;
            const kalmanGain1 = predP10 / innovationVariance;

            const updatedPosition = predictedPosition + kalmanGain0 * innovation;
            let updatedVelocity = predictedVelocity + kalmanGain1 * innovation;

            // Ограничение скорости
            if (Math.abs(updatedVelocity) > maxSpeedMps) {
                updatedVelocity = Math.sign(updatedVelocity) * maxSpeedMps;
            }

            // Обновлённая ковариация: P = (I - K H) * P
            const newP00 = (1 - kalmanGain0) * predP00;
            const newP01 = (1 - kalmanGain0) * predP01;
            const newP10 = predP10 - kalmanGain1 * predP00;
            const newP11 = predP11 - kalmanGain1 * predP01;

            this.position = updatedPosition;
            this.velocity = updatedVelocity;
            this.P = [
                [newP00, newP01],
                [newP10, newP11]
            ];
            this.lastTimestamp = timestamp;
        }

        const avgRssi = validMeasurements.reduce((sum, item) => sum + (item.rssi || 0), 0) / validMeasurements.length;

        return {
            avgDistance: this.position,
            avgRssi
        };
    }
}

class AveragingStrategyFactory {
    constructor() {
        this.strategies = new Map();
        this.register(new MovingAverageStrategy());
        this.register(new MedianAverageStrategy());
        this.register(new KalmanFilterStrategy());
    }

    register(strategy) {
        this.strategies.set(strategy.id, strategy);
    }

    getStrategy(id) {
        return this.strategies.get(id) || this.strategies.get('movingAverage');
    }
}

const averagingFactory = new AveragingStrategyFactory();

export {
    AveragingStrategy,
    MovingAverageStrategy,
    MedianAverageStrategy,
    KalmanFilterStrategy,
    AveragingStrategyFactory,
    averagingFactory
};
