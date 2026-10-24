// 画面を止めずに予想を計算するための作業用スレッド
import { predictRace, forecastRaces } from './forecast.js';

self.onmessage = event => {
  const { id, setup, runs } = event.data;
  try {
    const main = predictRace(setup);
    self.postMessage({ id, type: 'main', main });
    const fc = forecastRaces(setup, runs, { onProgress: (done, total) => { if (done % 5 === 0) self.postMessage({ id, type: 'progress', done, total }); } });
    self.postMessage({ id, type: 'forecast', forecast: fc });
  } catch (error) {
    self.postMessage({ id, type: 'error', message: String(error?.message ?? error) });
  }
};
