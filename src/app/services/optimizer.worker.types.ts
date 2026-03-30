import { SerializedFactoryLayout } from "./object-store-service";

export interface WorkerRequest {
  action: 'optimize-dag';
  actionId: string;
  payload: SerializedFactoryLayout;
}

export interface WorkerResponse {
  status: 'success' | 'error';
  actionId: string;
  result: SerializedFactoryLayout;
}