import { FactoryLayout } from "./model";

export interface WorkerRequest {
  action: 'optimize-dag';
  payload: FactoryLayout;
}

export interface WorkerResponse {
  status: 'success' | 'error';
  result: FactoryLayout;
}