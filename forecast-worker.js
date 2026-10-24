// 画面を止めずに予想を計算するための作業用スレッド
import { predictRace, forecastRaces } from './forecast.js';

self.onmessage = event => {
  const { id, setup, runs } = event.data;
  try {
    const main = predictRace(setup);
    self.postMessage({ id, type: 'main', main });
    const fc = forecastRaces(setup, runs, {
      onProgress: (done, total) => { if (done % 5 === 0) self.postMessage({ id, type: 'progress', done, total }); },
      // 先に半分の回数で予想を見せて、残りを走らせながら精度を上げる
      partialAt: Math.min(runs, 30), onPartial: partial => self.postMessage({ id, type: 'partial', forecast: partial })
    });
    self.postMessage({ id, type: 'forecast', forecast: fc });
  } catch (error) {
    self.postMessage({ id, type: 'error', message: String(error?.message ?? error) });
  }
};
