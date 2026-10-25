// まとめて答え合わせ用の作業スレッド: 1つのレース設定を n 回走らせて予想を返す
import { forecastRaces } from './forecast.js';

self.onmessage = event => {
  const { id, setup, runs } = event.data;
  try {
    const forecast = forecastRaces(setup, runs, { onProgress: (done, total) => { if (done % 5 === 0) self.postMessage({ id, type: 'progress', done, total }); } });
    self.postMessage({ id, type: 'done', forecast });
  } catch (error) {
    self.postMessage({ id, type: 'error', message: String(error?.message ?? error) });
  }
};
