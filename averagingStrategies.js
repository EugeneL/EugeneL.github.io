class AveragingStrategy {
    constructor(id) {
        this.id = id;
    }

    compute(/* data */) {
        throw new Error('Метод compute должен быть реализован в наследнике');
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

class AveragingStrategyFactory {
    constructor() {
        this.strategies = new Map();
        this.register(new MovingAverageStrategy());
        this.register(new MedianAverageStrategy());
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
    AveragingStrategyFactory,
    averagingFactory
};
