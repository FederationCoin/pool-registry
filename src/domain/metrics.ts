import { SampleCap } from './constants';
import type { MetricSample, MetricsOverlay } from './types';

export function pushSample(metrics: MetricsOverlay | undefined, sample: MetricSample): MetricsOverlay {
  const samples = [...(metrics?.samples ?? []), sample].slice(-SampleCap);
  const blocksFound = samples.reduce((n, s) => n + s.blocksFound, 0);
  const hashrate = samples.length ? samples[samples.length - 1].hashrate : 0;
  const vols = samples.map((s) => s.hashrate);
  let volatility: number | undefined;
  if (samples.length >= 8) {
    const mean = vols.reduce((a, b) => a + b, 0) / vols.length;
    if (mean > 0) {
      const variance = vols.reduce((a, b) => a + (b - mean) ** 2, 0) / vols.length;
      volatility = Math.sqrt(variance) / mean;
    }
  }
  return { blocksFound, hashrate, ...(volatility !== undefined ? { volatility } : {}), samples };
}
