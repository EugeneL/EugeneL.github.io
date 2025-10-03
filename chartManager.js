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
