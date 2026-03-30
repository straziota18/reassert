/// <reference lib="webworker" />
import * as _ from 'lodash';
import { WorkerRequest, WorkerResponse } from './optimizer.worker.types';

addEventListener('message', ({ data }: MessageEvent<WorkerRequest>) => {
  const response: WorkerResponse = {status: 'success', actionId: data.actionId, result: data.payload};
  // TODO
  postMessage(response);
});
