async function getMicAccess(): Promise<MediaStream | null> {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        return stream;
    } catch (err) {
        console.error('Error accessing microphone:', err);
        return null;
    }
}

const SAMPLE_DURATION = 3000 //ms
const SAMPLE_INTERVAL = 16 // approx 60 samples per second
const PEAK_SAMPLE_SIZE = 0.2 // Take the 80th percentile as the peak

export class micInput {
    audioContext: AudioContext;
    analyser: AnalyserNode;
    dataArray: Uint8Array<ArrayBuffer>;
    stream: MediaStream | null;
    noiseFloor: number = 0;
    noiseCeiling: number = 1;
    calibrationPhase: 'idle' | 'noise' | 'peak' | 'done' = 'idle';
    calibrationStartTime: number = 0;

    constructor() {
        this.audioContext = new AudioContext();
        this.analyser = this.audioContext.createAnalyser();
        this.dataArray = new Uint8Array(this.analyser.frequencyBinCount) as Uint8Array<ArrayBuffer>;
        this.stream = null;
    }

    async init() {
        this.stream = await getMicAccess();
        if (this.stream) {
            const source = this.audioContext.createMediaStreamSource(this.stream);
            source.connect(this.analyser);
        }
    }

    private getVolume(): number { // Gets the nomralized volume at that given sample point
        if (!this.stream) {
            console.log("no device");
            return 0;
        }
        this.analyser.getByteFrequencyData(this.dataArray);
        let sum = 0;
        for (let i = 0; i < this.dataArray.length; i++) {
            sum += Math.abs(this.dataArray[i]);
        }
        return (sum / this.dataArray.length) / 255; // Normalize to [0, 1]
    }

    private async collectSamples(): Promise<number[]> { // Gets array of samples collected over interval
        const samples: number[] = [];
        for (let i = 0; i < SAMPLE_DURATION / SAMPLE_INTERVAL; i++) {
            samples.push(this.getVolume());
            await new Promise(resolve => setTimeout(resolve, SAMPLE_INTERVAL));
        }
        return samples;
    }

    getNormalizedVolume(): number {
        const range = this.noiseCeiling - this.noiseFloor;
        if (range <= 0) return 0;
        const rawVolume = this.getVolume();
        return Math.min(1, Math.max(0, (rawVolume - this.noiseFloor) / range));
    }

    async calibrateNoise(): Promise<void> {
        this.calibrationPhase = 'noise';
        this.calibrationStartTime = performance.now();
        const samples = await this.collectSamples();
        const sum = samples.reduce((acc, val) => acc + val, 0);
        this.noiseFloor = sum / samples.length;
    }

    async calibratePeak(): Promise<void> {
        this.calibrationPhase = 'peak';
        this.calibrationStartTime = performance.now();
        const samples = await this.collectSamples();
        const sorted = samples.sort((a,b) => b - a);
        this.noiseCeiling = sorted[Math.floor(samples.length * PEAK_SAMPLE_SIZE)];
        this.calibrationPhase = 'done';
    }
}

