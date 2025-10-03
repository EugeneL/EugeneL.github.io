class ChartManager {
    constructor(canvasId, bins, minDeviation = -2, maxDeviation = 2) {
        this.canvasId = canvasId;
        this.bins = bins;
        this.minDeviation = minDeviation;
        this.maxDeviation = maxDeviation;
        this.chart = null;
        this.histogramData = new Array(bins).fill(0);
    }

    init() {
        const canvas = document.getElementById(this.canvasId);
        if (!canvas) {
            console.warn(`Не удалось найти элемент canvas с id ${this.canvasId}`);
            return;
        }

        const ctx = canvas.getContext('2d');
        this.chart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: Array(this.bins).fill(''),
                datasets: [
                    {
                        label: 'Частота отклонений от среднего',
                        data: this.histogramData,
                        backgroundColor: 'rgba(75, 192, 192, 0.7)',
                        borderColor: 'rgba(75, 192, 192, 1)',
                        borderWidth: 1
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: {
                        title: {
                            display: true,
                            text: 'Отклонение от среднего (м)'
                        },
                        ticks: {
                            callback: (value, index) => {
                                const shouldRenderLabel = index % 10 === 0;
                                if (!shouldRenderLabel) {
                                    return '';
                                }
                                const binWidth = this.getBinWidth();
                                const deviation = this.minDeviation + index * binWidth;
                                return deviation.toFixed(2);
                            }
                        }
                    },
                    y: {
                        title: {
                            display: true,
                            text: 'Количество замеров'
                        },
                        beginAtZero: true
                    }
                },
                plugins: {
                    legend: {
                        display: false
                    },
                    tooltip: {
                        callbacks: {
                            label: context => {
                                const binWidth = this.getBinWidth();
                                const binStart = this.minDeviation + context.dataIndex * binWidth;
                                const binEnd = binStart + binWidth;
                                return `Диапазон: ${binStart.toFixed(2)} - ${binEnd.toFixed(2)} м: ${context.parsed.y} замеров`;
                            }
                        }
                    }
                }
            }
        });
    }

    update(deviations) {
        if (!this.chart || deviations.length === 0) {
            return;
        }

        const binWidth = this.getBinWidth();
        this.histogramData = new Array(this.bins).fill(0);

        deviations.forEach(deviation => {
            let index = Math.floor((deviation - this.minDeviation) / binWidth);
            index = Math.max(0, Math.min(this.bins - 1, index));
            this.histogramData[index] += 1;
        });

        this.chart.data.datasets[0].data = this.histogramData;
        this.chart.data.labels = this.histogramData.map((_, index) => {
            const binStart = this.minDeviation + index * binWidth;
            return `${binStart.toFixed(2)}`;
        });

        this.chart.update('none');
    }

    reset() {
        if (!this.chart) {
            return;
        }
        this.histogramData = new Array(this.bins).fill(0);
        this.chart.data.datasets[0].data = this.histogramData;
        this.chart.update();
    }

    getBinWidth() {
        return (this.maxDeviation - this.minDeviation) / this.bins;
    }
}

export default ChartManager;

export class WaterfallRenderer {
    constructor(canvasId, maxSamples = 240) {
        this.canvasId = canvasId;
        this.maxSamples = maxSamples;
        this.samples = [];
        this.canvas = null;
        this.ctx = null;
        this.active = false;
        this._resizeHandler = () => this.resizeCanvas();
    }

    init() {
        this.canvas = document.getElementById(this.canvasId);
        if (!this.canvas) {
            console.warn(`Не удалось найти элемент canvas с id ${this.canvasId}`);
            return;
        }

        const context = this.canvas.getContext('2d');
        if (!context) {
            console.warn('Не удалось получить контекст 2D для водопада');
            return;
        }

        this.ctx = context;
        window.addEventListener('resize', this._resizeHandler);
        this.resizeCanvas();
    }

    dispose() {
        window.removeEventListener('resize', this._resizeHandler);
    }

    setActive(isActive) {
        if (this.active === isActive) {
            return;
        }

        this.active = isActive;
        if (this.active) {
            this.resizeCanvas();
        }
    }

    resizeCanvas() {
        if (!this.canvas || !this.ctx) {
            return;
        }

        const parent = this.canvas.parentElement;
        const width = parent?.clientWidth || this.canvas.clientWidth || 600;
        const height = parent?.clientHeight || this.canvas.clientHeight || 280;

        if (width <= 0 || height <= 0) {
            return;
        }

        if (this.canvas.width !== width || this.canvas.height !== height) {
            this.canvas.width = width;
            this.canvas.height = height;
        }

        this.render();
    }

    addSample(avg, min, max) {
        if (!this.ctx || !Number.isFinite(avg) || !Number.isFinite(min) || !Number.isFinite(max)) {
            return;
        }

        this.samples.push({ avg, min, max });
        if (this.samples.length > this.maxSamples) {
            this.samples = this.samples.slice(-this.maxSamples);
        }

        if (this.active) {
            this.render();
        }
    }

    reset() {
        this.samples = [];
        this.clear();
    }

    clear() {
        if (!this.ctx || !this.canvas) {
            return;
        }
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }

    render() {
        if (!this.ctx || !this.canvas) {
            return;
        }

        const width = this.canvas.width;
        const height = this.canvas.height;

        this.ctx.clearRect(0, 0, width, height);

        this.ctx.fillStyle = '#0b1e39';
        this.ctx.fillRect(0, 0, width, height);

        if (this.samples.length === 0) {
            return;
        }

        const minValue = Math.min(...this.samples.map(sample => sample.min));
        const maxValue = Math.max(...this.samples.map(sample => sample.max));
        const range = Math.max(0.0001, maxValue - minValue);

        const step = width / Math.max(this.maxSamples, 1);
        const lineWidth = Math.max(1, step * 0.8);

        const valueToY = value => {
            const normalized = (value - minValue) / range;
            return height - normalized * height;
        };

        this.ctx.lineCap = 'round';

        this.samples.forEach((sample, index) => {
            const x = width - (this.samples.length - index) * step + step / 2;
            const yMin = valueToY(sample.min);
            const yMax = valueToY(sample.max);
            const yAvg = valueToY(sample.avg);

            this.ctx.strokeStyle = 'rgba(76, 209, 197, 0.45)';
            this.ctx.lineWidth = lineWidth;
            this.ctx.beginPath();
            this.ctx.moveTo(x, yMin);
            this.ctx.lineTo(x, yMax);
            this.ctx.stroke();

            this.ctx.strokeStyle = '#4cd1f7';
            this.ctx.lineWidth = Math.max(1, lineWidth * 0.5);
            this.ctx.beginPath();
            this.ctx.moveTo(x - lineWidth * 0.25, yAvg);
            this.ctx.lineTo(x + lineWidth * 0.25, yAvg);
            this.ctx.stroke();
        });
    }
}
